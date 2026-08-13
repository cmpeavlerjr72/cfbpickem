// Pool model: commissioner slate + ATS picks + weekly/season standings.
// Local-first for now; the store interface in store.ts is the seam where
// Supabase will slot in. Mobile parity intentionally deferred while the
// iOS build is in App Review (see CLAUDE.md standing rule).

export type PickSide = 'home' | 'away';

/** How the pool plays: against the spread or straight-up winners. */
export type PickType = 'ats' | 'su';

/** One game on the commissioner's weekly slate. */
export interface SlateGame {
  gameId: string;
  /**
   * Point spread applied to the HOME team's score when grading.
   * Negative = home favored (home -6.5 → homeSpread = -6.5).
   * Away team's line is always the negation.
   */
  homeSpread: number;
  /** The College GameDay game — players guess its final score as the tiebreaker. */
  isTiebreaker: boolean;
}

/** The commissioner's weekly slate (any number of games they choose). */
export interface WeekSlate {
  season: number;
  seasonType: number;
  week: number;
  games: SlateGame[];
  /** Stamped from pool settings at save time; absent on legacy slates = ATS. */
  pickType?: PickType;
  /** Once published, spreads are frozen (they're the Monday lines). */
  published: boolean;
  /** Set when the slate is published. */
  spreadsLockedAt: string | null;
  updatedAt: string;
}

export interface TiebreakerGuess {
  home: number;
  away: number;
}

/** One player's picks for one week. */
export interface PoolEntry {
  playerId: string;
  playerName: string;
  /** gameId -> side picked to cover. */
  picks: Record<string, PickSide>;
  tiebreaker: TiebreakerGuess | null;
  updatedAt: string;
}

/** Who's using this browser. Replaced by real auth when Supabase lands. */
export interface PoolProfile {
  playerId: string;
  playerName: string;
  isCommissioner: boolean;
}

export interface PoolSettings {
  name: string;
  /** Target games per weekly slate — a guide for the commissioner, not a hard cap. */
  slateSize: number;
  /** Points awarded when a pick pushes (spread ties). */
  pushPoints: number;
  /** Against the spread or straight-up. */
  pickType: PickType;
}

export const DEFAULT_SETTINGS: PoolSettings = {
  name: 'CFB Pick’em Pool',
  slateSize: 12,
  pushPoints: 0.5,
  pickType: 'ats',
};

/** Market odds that each side covers its spread (0–1), from Kalshi. */
export interface CoverOdds {
  home: number | null;
  away: number | null;
  label?: string;
}

/** "-6.5" / "+3" / "PK" */
export function formatSpread(spread: number): string {
  if (spread === 0) return 'PK';
  return spread > 0 ? `+${trimNum(spread)}` : `${trimNum(spread)}`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
