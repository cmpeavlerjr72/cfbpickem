// Keep in sync with mobile/types.ts (see CLAUDE.md parity rule)

export interface Team {
  id: string | null;
  school: string;
  mascot: string | null;
  abbrev: string | null;
  displayName: string | null;
  logo: string | null;
  color: string | null;
  altColor: string | null;
  conferenceId: string | null;
  rank: number | null;
  homeAway: 'home' | 'away' | null;
}

export interface Game {
  id: string;
  /**
   * Kickoff instant. When `timeTbd`, ESPN hasn't announced the time and this
   * holds 12:00 PM ET of the game's day (ESPN's midnight-ET placeholder +
   * 12h — data/normalize-game.mjs), so locks/day grouping stay sane.
   */
  date: string;
  /** Kickoff time not announced yet: show "TBD", keep the day. */
  timeTbd?: boolean;
  week: number | null;
  seasonType: number;
  name: string;
  shortName: string;
  neutralSite: boolean;
  conferenceGame: boolean;
  venue: { name: string | null; city: string | null; state: string | null };
  broadcast: string | null;
  status: string;
  home: Team | null;
  away: Team | null;
}

export interface WeekData {
  week: number;
  seasonType: number;
  label: string;
  /**
   * Week number to use against ESPN's API when it differs from `week` —
   * our "Week 0" is carved out of ESPN's merged week 1 (see
   * data/split-week-zero.mjs), and ESPN has no week 0.
   */
  espnWeek?: number;
  games: Game[];
}

export interface SeasonData {
  sport: string;
  season: number;
  fetchedAt: string;
  source: string;
  totalGames: number;
  weeks: WeekData[];
}

/** gameId -> picked teamId */
export type Picks = Record<string, string>;

export const picksStorageKey = (season: number, seasonType: number, week: number) =>
  `cfb-pickem:picks:${season}:${seasonType}:${week}`;
