// Pregame TEAM LEADERS for a scoreboard card — the "who has been carrying
// this team" module ESPN shows above a kickoff.
//
// SOURCE (settled empirically 2026-08-29 against 2026 wk1/wk2 and 2025 wk3):
//   * The SCOREBOARD payload results.ts already fetches DOES carry leaders,
//     but at `competitions[0].leaders` — a flat list of three categories with
//     ONE leader each ACROSS BOTH TEAMS (the better of the two), whose
//     headshot is a bare string that is sometimes null. It cannot render a
//     two-team module, so it is not the source here. It is still useful as a
//     free "do these teams have stats yet" flag — see `hasStatLeaders` in
//     results.ts, which is what gates this section.
//   * The per-game SUMMARY (`summary?event=<id>`) `leaders` key IS the
//     per-team split: one entry per team, each with passing / rushing /
//     receiving / sacks / tackles, ESPN's own formatted `displayValue`, and
//     `athlete.headshot.href`. That is the source.
//
// So: fetched LAZILY — only when a card's leaders section is opened — and
// cached per event id for the session. Never in bulk for a slate.
//
// EARLY SEASON: before a team has played, ESPN still returns the category
// list but with zero leader entries (verified on 2026-09-12 UTM@WVU: UT
// Martin 5 entries, West Virginia 0; and on every wk1 game, 0 for both).
// Callers must treat "no entries" as "render nothing at all".
//
// Both ESPN hosts answer with `Access-Control-Allow-Origin: *`, so the
// browser fetches them directly (same decision as gamecast.ts).

import { useEffect, useState } from 'react';

const SUMMARY =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary';

/** The categories this app renders, in order. ESPN also serves `sacks` and
 * `totalTackles`; they are left out to keep the section short inside a game
 * card — add them here and they render with no other change. */
export const LEADER_CATEGORIES: { key: string; label: string }[] = [
  { key: 'passingYards', label: 'Passing' },
  { key: 'rushingYards', label: 'Rushing' },
  { key: 'receivingYards', label: 'Receiving' },
];

export interface LeaderAthlete {
  id: string | null;
  name: string;
  headshot: string | null;
  position: string | null;
}

export interface CategoryLeader {
  athlete: LeaderAthlete;
  /** ESPN's own formatting, e.g. "13/24, 147 YDS, 2 INT" or "1,204 YDS". */
  displayValue: string;
}

export interface TeamLeaders {
  teamId: string | null;
  abbrev: string | null;
  displayName: string | null;
  /** ESPN category key (`passingYards`, …) -> that team's leader. */
  byCategory: Record<string, CategoryLeader>;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Parse the summary feed's `leaders` block. Anything malformed is skipped
 * rather than thrown — a missing leader is a missing row, never an error. */
export function parseGameLeaders(json: unknown): TeamLeaders[] {
  const raw = (json as { leaders?: any[] } | null)?.leaders;
  if (!Array.isArray(raw)) return [];
  const out: TeamLeaders[] = [];
  for (const entry of raw) {
    const team = entry?.team ?? {};
    const byCategory: Record<string, CategoryLeader> = {};
    const cats: any[] = Array.isArray(entry?.leaders) ? entry.leaders : [];
    for (const cat of cats) {
      const key = str(cat?.name);
      const top = Array.isArray(cat?.leaders) ? cat.leaders[0] : null;
      const displayValue = str(top?.displayValue);
      const athlete = top?.athlete;
      if (!key || !displayValue || !athlete) continue;
      const name = str(athlete.displayName) ?? str(athlete.fullName) ?? str(athlete.shortName);
      if (!name) continue;
      byCategory[key] = {
        displayValue,
        athlete: {
          id: athlete.id != null ? String(athlete.id) : null,
          name,
          // The summary feed serves an object ({href, alt}); the scoreboard
          // feed serves a bare string. Accept either, and null is normal.
          headshot: str(athlete.headshot?.href) ?? str(athlete.headshot),
          position: str(athlete.position?.abbreviation) ?? str(athlete.position?.displayName),
        },
      };
    }
    out.push({
      teamId: team.id != null ? String(team.id) : null,
      abbrev: str(team.abbreviation),
      displayName: str(team.displayName) ?? str(team.shortDisplayName),
      byCategory,
    });
  }
  return out;
}

/** True when at least one RENDERED category has a leader on some team — the
 * test that decides whether the section exists at all. */
export function hasRenderableLeaders(teams: TeamLeaders[]): boolean {
  return teams.some((t) => LEADER_CATEGORIES.some((c) => !!t.byCategory[c.key]));
}

// Session cache: leaders move at most once a week, and the section is opened
// and closed repeatedly, so a parsed payload is kept for the page's life.
// Failures are deliberately NOT cached, so re-opening retries.
const cache = new Map<string, TeamLeaders[]>();
const inflight = new Map<string, Promise<TeamLeaders[]>>();

async function loadGameLeaders(eventId: string): Promise<TeamLeaders[]> {
  const hit = cache.get(eventId);
  if (hit) return hit;
  const pending = inflight.get(eventId);
  if (pending) return pending;
  const request = (async () => {
    const res = await fetch(`${SUMMARY}?event=${eventId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseGameLeaders(await res.json());
    cache.set(eventId, parsed);
    return parsed;
  })();
  inflight.set(eventId, request);
  try {
    return await request;
  } finally {
    inflight.delete(eventId);
  }
}

/** `idle` before the section is opened, `empty` when ESPN has nothing to show
 * (or the fetch failed) — callers hide the whole section on `empty`. */
export type LeadersStatus = 'idle' | 'loading' | 'ready' | 'empty';

/**
 * Leaders for one game, fetched only while `enabled` (i.e. while the card's
 * section is open) and served from the session cache on every re-open.
 */
export function useTeamLeaders(
  eventId: string,
  enabled: boolean,
): { status: LeadersStatus; teams: TeamLeaders[] } {
  const [teams, setTeams] = useState<TeamLeaders[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTeams(cache.get(eventId) ?? null);
    setFailed(false);
  }, [eventId]);

  useEffect(() => {
    if (!enabled) return;
    const hit = cache.get(eventId);
    if (hit) {
      setTeams(hit);
      return;
    }
    let cancelled = false;
    loadGameLeaders(eventId).then(
      (parsed) => {
        if (!cancelled) setTeams(parsed);
      },
      () => {
        // Network/parse failure degrades to "nothing to show" — this is a
        // nicety on a game card, never a place to surface an error.
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled]);

  if (failed) return { status: 'empty', teams: [] };
  if (teams == null) return { status: enabled ? 'loading' : 'idle', teams: [] };
  return { status: hasRenderableLeaders(teams) ? 'ready' : 'empty', teams };
}
