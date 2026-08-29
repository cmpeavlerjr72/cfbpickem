// Live results: fetch scores from ESPN, cache finals, lock games at kickoff,
// and grade picks. Mirrors mobile/results.ts (see CLAUDE.md parity rule) —
// only the storage layer differs (localStorage here, AsyncStorage on mobile).

import type { Game, Picks, SeasonData, WeekData } from './types';
import { picksStorageKey } from './types';

const SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';

export interface EspnOdds {
  details: string | null; // e.g. "UGA -6.5"
  spread: number | null; // home POV: negative = home favored
  overUnder: number | null;
  provider: string | null;
}

/** Stadium-level kickoff-window forecast (ESPN/AccuWeather-sourced). */
export interface GameWeather {
  temp: number | null;
  text: string;
  conditionId: number | null;
}

export interface GameResult {
  gameId: string;
  statusName: string;
  state: 'pre' | 'in' | 'post';
  completed: boolean;
  detail: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  /** Populated by ESPN within ~5 days of kickoff; null otherwise or on any
   * parse gap. Most useful pregame — see AtsGameCard's weather chip. */
  weather: GameWeather | null;
  /** Dome/enclosed venue — weather chip shows "Dome" instead when true. */
  indoor: boolean;
  // Live situation (in-progress games only; see monte-site's ESPN notes)
  period: number | null;
  clock: string | null;
  possessionTeamId: string | null;
  downDistance: string | null;
  isRedZone: boolean;
  lastPlay: string | null;
  /** Absolute ball spot, 0-100, home goal line = 0 (see gamecast.ts). */
  yardLine: number | null;
  down: number | null;
  distance: number | null;
  /** -1 = attacking yardLine 0 (home goal line), +1 = attacking 100. Inferred
   * from the last play's movement; null on any ambiguity. */
  attackDir: -1 | 1 | null;
  /** ESPN's live win model, P(home) in 0-100. */
  homeWinPct: number | null;
  /** ESPN's line for the game (pregame) — used to prefill commissioner spreads. */
  odds: EspnOdds | null;
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

/**
 * Direction of attack from the last play's movement. The scoreboard situation
 * carries no yards-to-endzone, so this is inferred: positive yardage that
 * moved the absolute spot DOWN means the offense attacks the home goal line.
 * Returns null on any ambiguity (no gain, spot unchanged, possession changed
 * on the play) — callers must render without an arrow in that case.
 */
function inferAttackDir(lastPlay: any, possessionId: string | null): -1 | 1 | null {
  const s = typeof lastPlay?.start?.yardLine === 'number' ? lastPlay.start.yardLine : null;
  const e = typeof lastPlay?.end?.yardLine === 'number' ? lastPlay.end.yardLine : null;
  const y = typeof lastPlay?.statYardage === 'number' ? lastPlay.statYardage : null;
  const playTeam = lastPlay?.team?.id != null ? String(lastPlay.team.id) : null;
  if (s === null || e === null || y === null) return null;
  if (y === 0 || e === s) return null;
  if (possessionId && playTeam && possessionId !== playTeam) return null;
  const moved: -1 | 1 = e < s ? -1 : 1;
  return y > 0 ? moved : moved === -1 ? 1 : -1;
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
    const situation = comp.situation ?? {};
    const rawOdds = comp.odds?.[0] ?? null;
    const spread = rawOdds ? Number(rawOdds.spread ?? rawOdds.pointSpread) : NaN;
    const overUnder = rawOdds ? Number(rawOdds.overUnder ?? rawOdds.total) : NaN;
    const possessionTeamId = situation.possession != null ? String(situation.possession) : null;
    const winPct = situation.lastPlay?.probability?.homeWinPercentage;
    const indoor = comp.venue?.indoor === true;
    const rawWeather = event.weather;
    let weather: GameWeather | null = null;
    if (rawWeather && typeof rawWeather === 'object') {
      const temp = typeof rawWeather.temperature === 'number' ? rawWeather.temperature : null;
      const text = typeof rawWeather.displayValue === 'string' ? rawWeather.displayValue : '';
      const rawConditionId = rawWeather.conditionId;
      let conditionId: number | null = null;
      if (typeof rawConditionId === 'number' && Number.isFinite(rawConditionId)) {
        conditionId = rawConditionId;
      } else if (typeof rawConditionId === 'string' && rawConditionId.trim() !== '') {
        const parsed = Number(rawConditionId);
        conditionId = Number.isFinite(parsed) ? parsed : null;
      }
      weather = { temp, text, conditionId };
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
      weather,
      indoor,
      period: comp.status?.period ?? event.status?.period ?? null,
      clock: comp.status?.displayClock ?? event.status?.displayClock ?? null,
      possessionTeamId,
      downDistance: situation.downDistanceText ?? situation.shortDownDistanceText ?? null,
      isRedZone: situation.isRedZone === true,
      lastPlay: situation.lastPlay?.text ?? null,
      yardLine: typeof situation.yardLine === 'number' ? situation.yardLine : null,
      down: typeof situation.down === 'number' ? situation.down : null,
      distance: typeof situation.distance === 'number' ? situation.distance : null,
      attackDir: inferAttackDir(situation.lastPlay, possessionTeamId),
      homeWinPct: typeof winPct === 'number' ? 100 * winPct : null,
      odds: rawOdds
        ? {
            details: rawOdds.details ?? null,
            spread: Number.isFinite(spread) ? spread : null,
            overUnder: Number.isFinite(overUnder) ? overUnder : null,
            provider: rawOdds.provider?.name ?? null,
          }
        : null,
    };
  }
  return results;
}

/**
 * Fresh scoreboard fetch with no started-week guard and no caching — used
 * pregame for ESPN lines (commissioner spread prefill). Returns {} on error.
 */
export async function fetchWeekScoreboard(
  season: number,
  weekData: WeekData,
): Promise<WeekResults> {
  try {
    const url = `${SCOREBOARD}?dates=${season}&seasontype=${weekData.seasonType}&week=${weekData.espnWeek ?? weekData.week}&groups=80&limit=400`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseScoreboard(await res.json());
  } catch {
    return {};
  }
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
    const raw = localStorage.getItem(key);
    if (raw) cached = JSON.parse(raw) as CachedWeekResults;
  } catch {
    cached = null;
  }
  if (cached?.allFinal) return cached.results;
  try {
    const url = `${SCOREBOARD}?dates=${season}&seasontype=${weekData.seasonType}&week=${weekData.espnWeek ?? weekData.week}&groups=80&limit=400`;
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
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // storage full — results just won't be cached
    }
    return results;
  } catch {
    return cached?.results ?? {};
  }
}

async function loadPicks(key: string): Promise<Picks> {
  try {
    const raw = localStorage.getItem(key);
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
