// Live results: fetch scores from ESPN, cache finals, lock games at kickoff,
// and grade picks. Mirrors web/src/results.ts (see CLAUDE.md parity rule).

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Game, Picks, SeasonData, WeekData } from './types';
import { picksStorageKey } from './types';

const SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';

export interface GameResult {
  gameId: string;
  statusName: string;
  state: 'pre' | 'in' | 'post';
  completed: boolean;
  detail: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
}

/** gameId -> result */
export type WeekResults = Record<string, GameResult>;

export const resultsStorageKey = (season: number, seasonType: number, week: number) =>
  `cfb-pickem:results:${season}:${seasonType}:${week}`;

interface CachedWeekResults {
  fetchedAt: string;
  allFinal: boolean;
  results: WeekResults;
}

function parseScoreboard(json: unknown): WeekResults {
  const results: WeekResults = {};
  const events = (json as { events?: any[] }).events ?? [];
  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const statusType = comp.status?.type ?? {};
    const competitors: any[] = comp.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');
    const completed = statusType.completed === true;
    let winnerTeamId: string | null = null;
    if (completed) {
      const flagged = competitors.find((c) => c.winner === true);
      if (flagged?.team?.id) {
        winnerTeamId = flagged.team.id;
      } else {
        const hs = Number(home?.score);
        const as = Number(away?.score);
        if (Number.isFinite(hs) && Number.isFinite(as) && hs !== as) {
          winnerTeamId = (hs > as ? home?.team?.id : away?.team?.id) ?? null;
        }
      }
    }
    results[event.id] = {
      gameId: event.id,
      statusName: statusType.name ?? 'STATUS_SCHEDULED',
      state: (statusType.state as 'pre' | 'in' | 'post') ?? 'pre',
      completed,
      detail: statusType.shortDetail ?? statusType.detail ?? null,
      homeScore: home?.score != null ? Number(home.score) : null,
      awayScore: away?.score != null ? Number(away.score) : null,
      winnerTeamId,
    };
  }
  return results;
}

export function hasWeekStarted(week: WeekData): boolean {
  const now = Date.now();
  return week.games.some((g) => new Date(g.date).getTime() <= now);
}

export function isGameLocked(game: Game, result?: GameResult | null): boolean {
  if (result && result.state !== 'pre') return true;
  return new Date(game.date).getTime() <= Date.now();
}

export type PickGrade = 'win' | 'loss' | 'pending' | 'void';

export function gradePick(pickedTeamId: string, result?: GameResult | null): PickGrade {
  if (!result || !result.completed) return 'pending';
  if (!result.winnerTeamId) return 'void'; // canceled / no result — pick doesn't count
  return result.winnerTeamId === pickedTeamId ? 'win' : 'loss';
}

/**
 * Results for one week: no network before kickoff, cached forever once every
 * game is final, otherwise fetch fresh and fall back to cache on error.
 */
export async function getWeekResults(season: number, weekData: WeekData): Promise<WeekResults> {
  if (!hasWeekStarted(weekData)) return {};
  const key = resultsStorageKey(season, weekData.seasonType, weekData.week);
  let cached: CachedWeekResults | null = null;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) cached = JSON.parse(raw) as CachedWeekResults;
  } catch {
    cached = null;
  }
  if (cached?.allFinal) return cached.results;
  try {
    const url = `${SCOREBOARD}?dates=${season}&seasontype=${weekData.seasonType}&week=${weekData.week}&groups=80&limit=400`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = parseScoreboard(await res.json());
    const allFinal =
      weekData.games.length > 0 && weekData.games.every((g) => results[g.id]?.state === 'post');
    const payload: CachedWeekResults = {
      fetchedAt: new Date().toISOString(),
      allFinal,
      results,
    };
    AsyncStorage.setItem(key, JSON.stringify(payload)).catch(() => {});
    return results;
  } catch {
    return cached?.results ?? {};
  }
}

async function loadPicks(key: string): Promise<Picks> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Picks) : {};
  } catch {
    return {};
  }
}

export interface WeekSummary {
  seasonType: number;
  week: number;
  label: string;
  picks: number;
  wins: number;
  losses: number;
  pending: number;
  started: boolean;
}

export interface SeasonSummary {
  wins: number;
  losses: number;
  pending: number;
  totalPicks: number;
  weeks: WeekSummary[];
}

export async function buildSeasonSummary(season: SeasonData): Promise<SeasonSummary> {
  const weeks: WeekSummary[] = [];
  let wins = 0;
  let losses = 0;
  let pending = 0;
  let totalPicks = 0;
  for (const weekData of season.weeks) {
    const picks = await loadPicks(
      picksStorageKey(season.season, weekData.seasonType, weekData.week),
    );
    const ids = Object.keys(picks).filter((id) => weekData.games.some((g) => g.id === id));
    const started = hasWeekStarted(weekData);
    const summary: WeekSummary = {
      seasonType: weekData.seasonType,
      week: weekData.week,
      label: weekData.label,
      picks: ids.length,
      wins: 0,
      losses: 0,
      pending: 0,
      started,
    };
    if (started && ids.length) {
      const results = await getWeekResults(season.season, weekData);
      for (const id of ids) {
        const grade = gradePick(picks[id], results[id]);
        if (grade === 'win') summary.wins++;
        else if (grade === 'loss') summary.losses++;
        else if (grade === 'pending') summary.pending++;
      }
    } else {
      summary.pending = ids.length; // picked, not kicked off yet
    }
    wins += summary.wins;
    losses += summary.losses;
    pending += summary.pending;
    totalPicks += ids.length;
    weeks.push(summary);
  }
  return { wins, losses, pending, totalPicks, weeks };
}
