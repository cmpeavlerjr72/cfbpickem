// ATS grading and leaderboards. Pure functions — no storage, no network —
// so the same code works against local data now and Supabase rows later.

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
  /**
   * Did the guess have the actually-winning team scoring more? Null until the
   * TB game is final, when the player didn't guess, or in the (CFB-impossible)
   * tied-game case where there is no winner to have picked.
   */
  tbWinnerCorrect: boolean | null;
  /** |guess for the actually-winning team − that team's actual score|. */
  tbWinnerScoreError: number | null;
  /** |guess for the actually-losing team − that team's actual score|. */
  tbLoserScoreError: number | null;
  /** 1-based, ties share a rank. */
  rank: number;
}

/**
 * Tiebreak hierarchy for entries level on points (owner decision 2026-08-30),
 * applied in this order:
 *   1. picked the right WINNER of the tiebreaker game
 *   2. closest on the WINNING team's actual score
 *   3. closest on the LOSING team's actual score
 *   4. closest on the TOTAL score
 *   5. best season record so far (prior weeks, Week 1 onward)
 * An entry with no guess is "incorrect" at level 1 and infinitely far off at
 * 2–4, so it always sorts below anyone who guessed. Returns 0 when two entries
 * are genuinely inseparable — that is exactly when they share a rank.
 *
 * @param seasonPoints cumulative points per playerId from PRIOR weeks; a
 *   missing key (or no map at all) counts as 0.
 */
function compareTiebreak(
  a: EntryScore,
  b: EntryScore,
  seasonPoints?: Record<string, number>,
): number {
  if (b.points !== a.points) return b.points - a.points;
  // 1. right winner. `null` (no guess, or a tied TB game where nobody could
  // have picked a winner) ranks with "incorrect" — in the tied-game case
  // that's every entry, so the level is a no-op and 2–4 decide it.
  const aWinner = a.tbWinnerCorrect === true ? 0 : 1;
  const bWinner = b.tbWinnerCorrect === true ? 0 : 1;
  if (aWinner !== bWinner) return aWinner - bWinner;
  // 2–4. closest on the winner's score, then the loser's, then the total.
  // Compared, not subtracted: Infinity − Infinity is NaN.
  for (const pick of [
    (s: EntryScore) => s.tbWinnerScoreError,
    (s: EntryScore) => s.tbLoserScoreError,
    (s: EntryScore) => s.tiebreakerError,
  ]) {
    const aErr = pick(a) ?? Number.POSITIVE_INFINITY;
    const bErr = pick(b) ?? Number.POSITIVE_INFINITY;
    if (aErr !== bErr) return aErr < bErr ? -1 : 1;
  }
  // 5. best season record so far.
  const aSeason = seasonPoints?.[a.entry.playerId] ?? 0;
  const bSeason = seasonPoints?.[b.entry.playerId] ?? 0;
  if (aSeason !== bSeason) return bSeason - aSeason;
  return 0;
}

export function scoreWeek(
  slate: WeekSlate,
  entries: PoolEntry[],
  results: Record<string, GameResult>,
  settings: PoolSettings,
  /** Cumulative season points per playerId from PRIOR weeks (tiebreak level 5). */
  seasonPoints?: Record<string, number>,
): EntryScore[] {
  const tbGame = slate.games.find((g) => g.isTiebreaker) ?? null;
  const tbResult = tbGame ? results[tbGame.gameId] : undefined;
  const tbFinal =
    !!tbResult && tbResult.completed && tbResult.homeScore != null && tbResult.awayScore != null;
  // Which side actually won the tiebreaker game. A tie can't happen in CFB
  // (overtime), but if ESPN ever hands us one there is no winner to have
  // picked, so levels 1–3 stay null for everyone and level 4 decides.
  const tbHomeWon: boolean | null = !tbFinal
    ? null
    : tbResult!.homeScore! > tbResult!.awayScore!
      ? true
      : tbResult!.awayScore! > tbResult!.homeScore!
        ? false
        : null;

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
    let tbWinnerCorrect: boolean | null = null;
    let tbWinnerScoreError: number | null = null;
    let tbLoserScoreError: number | null = null;
    if (tbFinal && entry.tiebreaker) {
      const actualHome = tbResult!.homeScore!;
      const actualAway = tbResult!.awayScore!;
      const guessHome = entry.tiebreaker.home;
      const guessAway = entry.tiebreaker.away;
      tiebreakerError = Math.abs(guessHome + guessAway - (actualHome + actualAway));
      if (tbHomeWon !== null) {
        // A guess that has the game tied picked nobody, so it's wrong here
        // like any other miss.
        tbWinnerCorrect = guessHome === guessAway ? false : (guessHome > guessAway) === tbHomeWon;
        tbWinnerScoreError = Math.abs(
          (tbHomeWon ? guessHome : guessAway) - (tbHomeWon ? actualHome : actualAway),
        );
        tbLoserScoreError = Math.abs(
          (tbHomeWon ? guessAway : guessHome) - (tbHomeWon ? actualAway : actualHome),
        );
      }
    }
    return {
      entry,
      points: wins + pushes * settings.pushPoints,
      wins,
      losses,
      pushes,
      pending,
      tiebreakerError,
      tbWinnerCorrect,
      tbWinnerScoreError,
      tbLoserScoreError,
      rank: 0,
    };
  });

  // Points first, then the five-level tiebreak hierarchy. The name compare is
  // display determinism only — it never affects rank.
  scored.sort(
    (a, b) =>
      compareTiebreak(a, b, seasonPoints) || a.entry.playerName.localeCompare(b.entry.playerName),
  );

  let rank = 0;
  let prev: EntryScore | null = null;
  scored.forEach((s, i) => {
    // Ties share a rank only when every level came out equal.
    const tiedWithPrev = prev !== null && compareTiebreak(s, prev, seasonPoints) === 0;
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

/**
 * Owner decision 2026-08-30: **season record starts Week 1.** Week 0 is the
 * league's warm-up week — its weekly board and weekly winner stand exactly as
 * they are, but it contributes nothing to the season race (no points, no
 * W–L–P, no weeks played, no weekly-win credit).
 */
export function countsTowardSeason(week: ScoredWeek): boolean {
  return week.slate.week !== 0;
}

export function seasonStandings(weeks: ScoredWeek[]): SeasonRow[] {
  const rows = new Map<string, SeasonRow>();
  for (const wk of weeks) {
    if (!countsTowardSeason(wk)) continue;
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
