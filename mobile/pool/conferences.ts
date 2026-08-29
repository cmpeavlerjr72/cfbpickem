// Conference grouping for the commissioner's slate builder.
// Mirrors web/src/pool/conferences.ts (see CLAUDE.md parity rule).
//
// `conferenceId` on each team is ESPN's numeric conference GROUP id, mapped in
// data/fetch-games.mjs. The table below was verified EMPIRICALLY on 2026-08-29
// by grouping every team in data/games-2026.json by conferenceId and reading
// the member schools — not from memory:
//
//   1   ACC              Clemson, Florida State, Miami, SMU, Stanford, California…
//   4   Big 12           Arizona, BYU, Baylor, Houston, TCU, Texas Tech, Utah…
//   5   Big Ten          Michigan, Ohio State, Oregon, Penn State, UCLA, USC…
//   8   SEC              Alabama, Georgia, LSU, Oklahoma, Texas, Texas A&M…
//   9   Pac-12           Boise State, Colorado State, Fresno State, Oregon State,
//                        San Diego State, Texas State, Utah State, Washington State
//   12  Conference USA   Delaware, FIU, Jacksonville State, Kennesaw State, Liberty,
//                        Middle Tennessee, Missouri State, New Mexico State, Sam Houston, WKU
//   15  MAC              Akron, Ball State, Bowling Green, Buffalo, Ohio, Sacramento State, Toledo…
//   17  Mountain West    Air Force, Hawai'i, Nevada, New Mexico, North Dakota State,
//                        Northern Illinois, San José State, UNLV, UTEP, Wyoming
//   18  FBS Independents Notre Dame, UConn
//   37  Sun Belt         App State, Arkansas State, James Madison, Marshall, Troy…
//   151 American         Army, Memphis, Navy, North Texas, Tulane, UAB, UTSA…
//
// FCS conference ids also appear in the data (20 Big Sky, 21 MVFC, 24 MEAC,
// 25 NEC, 27 Patriot, 29 SoCon, 30 Southland, 31 SWAC, 32, 48 CAA, 177 UAC,
// 179 OVC/Big South) because the season file is FBS-only (ESPN groups=80) and
// FCS teams show up purely as visitors. They are deliberately NOT mapped: an
// FBS-vs-FCS game is already listed under the FBS host's conference, so giving
// the visitor its own section would just duplicate it into a dozen one-game
// buckets. Anything unmapped falls into "Other / Independents" — which in
// practice only catches games where NEITHER side maps (TBD bowl slots, or a
// conference id ESPN adds later).

import type { Game } from '../types';

export const TOP25_KEY = 'top25';
export const OTHER_KEY = 'other';

interface ConferenceDef {
  id: string;
  name: string;
  /** Power conferences sort to the top of the section list. */
  power?: boolean;
}

const CONFERENCES: ConferenceDef[] = [
  { id: '1', name: 'ACC', power: true },
  { id: '4', name: 'Big 12', power: true },
  { id: '5', name: 'Big Ten', power: true },
  { id: '8', name: 'SEC', power: true },
  { id: '151', name: 'American' },
  { id: '12', name: 'Conference USA' },
  { id: '18', name: 'FBS Independents' },
  { id: '15', name: 'MAC' },
  { id: '17', name: 'Mountain West' },
  { id: '9', name: 'Pac-12' },
  { id: '37', name: 'Sun Belt' },
];

/** id -> display name, for the conferences we recognize. */
export const CONFERENCE_NAMES: Record<string, string> = Object.fromEntries(
  CONFERENCES.map((c) => [c.id, c.name]),
);

/** Power conferences first, then the rest alphabetically. */
const CONFERENCE_ORDER: string[] = [
  ...CONFERENCES.filter((c) => c.power).map((c) => c.id),
  ...CONFERENCES.filter((c) => !c.power)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.id),
];

export function conferenceName(id: string | null | undefined): string | null {
  if (id == null) return null;
  return CONFERENCE_NAMES[String(id)] ?? null;
}

/** Either team carries a poll rank. */
export function isRankedGame(game: Game): boolean {
  return game.home?.rank != null || game.away?.rank != null;
}

/** Best (lowest) rank in the game, 99 when neither team is ranked. */
export function bestRank(game: Game): number {
  return Math.min(game.home?.rank ?? 99, game.away?.rank ?? 99);
}

/**
 * Conference sections a game belongs to. A cross-conference game belongs to
 * BOTH (same underlying game, listed twice). Games with no recognized
 * conference on either side land in "Other".
 */
export function conferenceKeysForGame(game: Game): string[] {
  const keys: string[] = [];
  for (const team of [game.away, game.home]) {
    const id = team?.conferenceId;
    if (id == null) continue;
    const key = String(id);
    if (CONFERENCE_NAMES[key] && !keys.includes(key)) keys.push(key);
  }
  return keys.length ? keys : [OTHER_KEY];
}

/** Ranked matchups first, then chronological. */
export function compareGames(a: Game, b: Game): number {
  return bestRank(a) - bestRank(b) || a.date.localeCompare(b.date);
}

export interface GameSection {
  key: string;
  title: string;
  games: Game[];
}

/**
 * Build the slate-builder's category sections: Top 25 first (every game with a
 * ranked team), then one section per conference (power first, then alphabetical),
 * then Other / Independents. Empty sections are dropped. The same game appears
 * in every section it qualifies for — selection is keyed by game id, so it stays
 * one game.
 */
export function buildGameSections(games: Game[]): GameSection[] {
  const buckets = new Map<string, Game[]>();
  const push = (key: string, game: Game) => {
    const list = buckets.get(key);
    if (list) list.push(game);
    else buckets.set(key, [game]);
  };

  for (const game of games) {
    if (isRankedGame(game)) push(TOP25_KEY, game);
    for (const key of conferenceKeysForGame(game)) push(key, game);
  }

  const sections: GameSection[] = [];
  const add = (key: string, title: string) => {
    const list = buckets.get(key);
    if (list?.length) sections.push({ key, title, games: list.sort(compareGames) });
  };

  add(TOP25_KEY, 'Top 25');
  for (const id of CONFERENCE_ORDER) add(id, CONFERENCE_NAMES[id]);
  add(OTHER_KEY, 'Other / Independents');
  return sections;
}
