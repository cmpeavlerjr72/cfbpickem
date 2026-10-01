// ESPN scoreboard event -> the app's Game shape. Used by fetch-games.mjs.
// The refresh-games Edge Function carries a line-for-line TypeScript copy
// (supabase/functions/refresh-games/normalize.ts) — change them together;
// data/check-normalize.mjs asserts the two agree.

// ESPN gives a game with no announced kickoff a midnight-ET placeholder
// (T04:00Z in EDT, T05:00Z in EST) and flags it competitions[0].timeValid
// === false. Stored as-is, that placeholder locked whole Saturdays at
// midnight (incidents 2026-09-26 and 2026-09-30). Rule: a TBD game's
// kickoff becomes 12:00 PM ET of the same ET calendar day (placeholder +
// 12h — right in both EDT and EST) and carries timeTbd: true so the UI
// shows "TBD". Noon is exactly the saturday_noon lock and a safe early lock
// under the kickoff rule; day grouping and sorting stay correct.
export const TBD_SHIFT_MS = 12 * 60 * 60 * 1000;

/** ISO instant in ESPN's own format: 2026-10-03T16:00Z. */
export function espnIso(ms) {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

export function normalizeKickoff(date, timeValid) {
  if (!date || timeValid !== false) return { date, timeTbd: false };
  return { date: espnIso(Date.parse(date) + TBD_SHIFT_MS), timeTbd: true };
}

export function normalizeTeam(competitor) {
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

export function normalizeEvent(event, seasonType) {
  const comp = event.competitions?.[0] ?? {};
  const competitors = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const venue = comp.venue ?? {};
  const broadcasts = (comp.broadcasts ?? []).flatMap((b) => b.names ?? []);
  const kick = normalizeKickoff(event.date, comp.timeValid);
  return {
    id: event.id,
    date: kick.date,
    timeTbd: kick.timeTbd,
    week: event.week?.number ?? null,
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
