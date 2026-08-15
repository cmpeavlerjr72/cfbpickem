// ATS grading and leaderboards — mirrors web/src/pool/scoring.ts (see
// CLAUDE.md parity rule). Pure functions: no storage, no network.

import type { GameResult } from '../results';
import type { PickSide, PoolEntry, PoolSettings, SlateGame, WeekSlate } from './types';

export type AtsGrade = 'win' | 'loss' | 'push' | 'pending' | 'void';

/**
 * Home cover margin: > 0 home covers, < 0 away covers, 0 push.
 * Usable live (partial scores) and for finals.
 */
export function coverMargin(homeSpread: number, result: GameResult): number | null {
  if (result.homeScore == null || result.awayScore == null) return null;
  return result.homeScore + homeSpread - result.awayScore;
}

export function gradeAts(
  side: PickSide,
  slateGame: SlateGame,
  result: GameResult | undefined | null,
): AtsGrade {
  if (!result || !result.completed) return 'pending';
  const margin = coverMargin(slateGame.homeSpread, result);
  if (margin == null) return 'void'; // canceled / no score — pick doesn't count
  if (margin === 0) return 'push';
  return (side === 'home') === margin > 0 ? 'win' : 'loss';
}

export interface EntryScore {
  entry: PoolEntry;
  points: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  /**
   * Tiebreaker distance: |guessed total − actual total| of the GameDay game.
   * Null until that game is final or if the player didn't guess.
   */
  tiebreakerError: number | null;
  /** Secondary tiebreaker: sum of per-team absolute errors. */
  tiebreakerTeamError: number | null;
  /** 1-based, ties share a rank. */
  rank: number;
}

export function scoreWeek(
  slate: WeekSlate,
  entries: PoolEntry[],
  results: Record<string, GameResult>,
  settings: PoolSettings,
): EntryScore[] {
  const tbGame = slate.games.find((g) => g.isTiebreaker) ?? null;
  const tbResult = tbGame ? results[tbGame.gameId] : undefined;
  const tbFinal =
    !!tbResult && tbResult.completed && tbResult.homeScore != null && tbResult.awayScore != null;

  const scored: EntryScore[] = entries.map((entry) => {
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let pending = 0;
    for (const slateGame of slate.games) {
      const side = entry.picks[slateGame.gameId];
      if (!side) continue;
      const grade = gradeAts(side, slateGame, results[slateGame.gameId]);
      if (grade === 'win') wins++;
      else if (grade === 'loss') losses++;
      else if (grade === 'push') pushes++;
      else if (grade === 'pending') pending++;
    }
    let tiebreakerError: number | null = null;
    let tiebreakerTeamError: number | null = null;
    if (tbFinal && entry.tiebreaker) {
      const actualHome = tbResult!.homeScore!;
      const actualAway = tbResult!.awayScore!;
      tiebreakerError = Math.abs(
        entry.tiebreaker.home + entry.tiebreaker.away - (actualHome + actualAway),
      );
      tiebreakerTeamError =
        Math.abs(entry.tiebreaker.home - actualHome) + Math.abs(entry.tiebreaker.away - actualAway);
    }
    return {
      entry,
      points: wins + pushes * settings.pushPoints,
      wins,
      losses,
      pushes,
      pending,
      tiebreakerError,
      tiebreakerTeamError,
      rank: 0,
    };
  });

  // Points first; among equals the tiebreaker guess (closest total, then
  // closest per-team) separates them; entries missing a guess sort last.
  scored.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aErr = a.tiebreakerError ?? Number.POSITIVE_INFINITY;
    const bErr = b.tiebreakerError ?? Number.POSITIVE_INFINITY;
    if (aErr !== bErr) return aErr - bErr;
    const aTeam = a.tiebreakerTeamError ?? Number.POSITIVE_INFINITY;
    const bTeam = b.tiebreakerTeamError ?? Number.POSITIVE_INFINITY;
    if (aTeam !== bTeam) return aTeam - bTeam;
    return a.entry.playerName.localeCompare(b.entry.playerName);
  });

  let rank = 0;
  let prev: EntryScore | null = null;
  scored.forEach((s, i) => {
    const tiedWithPrev =
      prev !== null &&
      s.points === prev.points &&
      (s.tiebreakerError ?? Infinity) === (prev.tiebreakerError ?? Infinity) &&
      (s.tiebreakerTeamError ?? Infinity) === (prev.tiebreakerTeamError ?? Infinity);
    rank = tiedWithPrev ? rank : i + 1;
    s.rank = rank;
    prev = s;
  });
  return scored;
}

/** Is every slate game final (so the week can be declared won)? */
export function isWeekComplete(slate: WeekSlate, results: Record<string, GameResult>): boolean {
  return (
    slate.games.length > 0 && slate.games.every((g) => results[g.gameId]?.state === 'post')
  );
}

export interface SeasonRow {
  playerId: string;
  playerName: string;
  totalPoints: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Weeks where this player finished rank 1 (after tiebreaker) with the week complete. */
  weeklyWins: number;
  weeksPlayed: number;
  rank: number;
}

export interface ScoredWeek {
  slate: WeekSlate;
  label: string;
  scores: EntryScore[];
  complete: boolean;
}

export function seasonStandings(weeks: ScoredWeek[]): SeasonRow[] {
  const rows = new Map<string, SeasonRow>();
  for (const wk of weeks) {
    for (const s of wk.scores) {
      let row = rows.get(s.entry.playerId);
      if (!row) {
        row = {
          playerId: s.entry.playerId,
          playerName: s.entry.playerName,
          totalPoints: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          weeklyWins: 0,
          weeksPlayed: 0,
          rank: 0,
        };
        rows.set(s.entry.playerId, row);
      }
      row.playerName = s.entry.playerName;
      row.totalPoints += s.points;
      row.wins += s.wins;
      row.losses += s.losses;
      row.pushes += s.pushes;
      row.weeksPlayed++;
      if (wk.complete && s.rank === 1) row.weeklyWins++;
    }
  }
  const list = [...rows.values()];
  list.sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.weeklyWins - a.weeklyWins ||
      b.wins - a.wins ||
      a.playerName.localeCompare(b.playerName),
  );
  let rank = 0;
  let prev: SeasonRow | null = null;
  list.forEach((r, i) => {
    const tied =
      prev !== null && r.totalPoints === prev.totalPoints && r.weeklyWins === prev.weeklyWins;
    rank = tied ? rank : i + 1;
    r.rank = rank;
    prev = r;
  });
  return list;
}
