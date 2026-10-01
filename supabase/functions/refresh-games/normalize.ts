// deno-lint-ignore-file no-explicit-any
// ESPN scoreboard event -> the app's Game shape. Line-for-line copy of
// data/normalize-game.mjs (what fetch-games.mjs bakes into the bundle) —
// change them together; `node data/check-normalize.mjs` asserts they agree.
// Pure: no Deno APIs, so Node can import it for that check.

// ESPN gives a game with no announced kickoff a midnight-ET placeholder
// (T04:00Z in EDT, T05:00Z in EST) and flags it competitions[0].timeValid
// === false. Rule: kickoff becomes 12:00 PM ET of the same ET day
// (placeholder + 12h) and the game carries timeTbd: true.
export const TBD_SHIFT_MS = 12 * 60 * 60 * 1000;

/** ISO instant in ESPN's own format: 2026-10-03T16:00Z. */
export function espnIso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

export function normalizeKickoff(
  date: string | null | undefined,
  timeValid: unknown,
): { date: string | null | undefined; timeTbd: boolean } {
  if (!date || timeValid !== false) return { date, timeTbd: false };
  return { date: espnIso(Date.parse(date) + TBD_SHIFT_MS), timeTbd: true };
}

export function normalizeTeam(competitor: any) {
  const t = competitor.team ?? {};
  const rank = competitor.curatedRank?.current;
  return {
    id: t.id ?? null,
    school: t.location ?? t.name ?? 'TBD',
    mascot: t.name ?? null,
    abbrev: t.abbreviation ?? null,
    displayName: t.displayName ?? null,
    logo: t.logo ?? null,
    color: t.color ? `#${t.color}` : null,
    altColor: t.alternateColor ? `#${t.alternateColor}` : null,
    conferenceId: t.conferenceId ?? null,
    rank: rank && rank <= 25 ? rank : null,
    homeAway: competitor.homeAway ?? null,
  };
}

export type NormalizedGame = ReturnType<typeof normalizeEvent>;

export function normalizeEvent(event: any, seasonType: number) {
  const comp = event.competitions?.[0] ?? {};
  const competitors: any[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const venue = comp.venue ?? {};
  const broadcasts = (comp.broadcasts ?? []).flatMap((b: any) => b.names ?? []);
  const kick = normalizeKickoff(event.date, comp.timeValid);
  return {
    id: event.id as string,
    date: kick.date as string,
    timeTbd: kick.timeTbd,
    week: (event.week?.number ?? null) as number | null,
    seasonType,
    name: event.name,
    shortName: event.shortName,
    neutralSite: comp.neutralSite ?? false,
    conferenceGame: comp.conferenceCompetition ?? false,
    venue: {
      name: venue.fullName ?? null,
      city: venue.address?.city ?? null,
      state: venue.address?.state ?? null,
    },
    broadcast: broadcasts.length ? broadcasts.join(', ') : null,
    status: comp.status?.type?.name ?? 'STATUS_SCHEDULED',
    home: home ? normalizeTeam(home) : null,
    away: away ? normalizeTeam(away) : null,
  };
}
