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
  date: string;
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
