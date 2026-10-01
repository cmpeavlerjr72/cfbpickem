// Hourly self-refresh of public.games (pg_cron -> this function, migration
// 20261001004000). public.games is the schedule source of truth: the lock
// trigger / pick_lock_at() / week_entries read its kickoffs, and clients
// overlay its `data` on their bundled games.json (web/src/schedule.ts).
// Before this it was a hand-pushed snapshot that went stale — ESPN's
// midnight-ET TBD placeholders locked whole Saturdays at midnight twice.
//
// Which weeks: every (season, season_type, week) with a stored kickoff in
// [now - 1 day, now + 16 days], read from the table itself. App week 0 is
// carved out of ESPN's merged week 1 (data/split-week-zero.mjs; ESPN has no
// week 0), so it maps to ESPN week 1 and ESPN calls are deduped.
//
// Rules:
//  - Existing ids NEVER change season/season_type/week (preserves the week-0
//    split), and data.week stays the app's week.
//  - A row whose STORED kickoff <= now() keeps kickoff/time_tbd: its picks
//    have locked and been revealed, and moving the kickoff later would
//    re-open them. Its data is still refreshed (ranks, status), with
//    data.date pinned to the stored kickoff.
//  - A failed ESPN fetch or an empty week is skipped — never delete rows,
//    never write a half-parsed week.
//  - Every week's outcome is in the response. Silent crons are banned here:
//    lock-spreads' blind counters once hid a week of failures (2026-08-29).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { espnIso, normalizeEvent, type NormalizedGame } from './normalize.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_BACK_MS = 1 * DAY_MS;
const WINDOW_AHEAD_MS = 16 * DAY_MS;

interface StoredRow {
  id: string;
  season: number;
  season_type: number;
  week: number;
  kickoff: string;
  time_tbd: boolean;
}

interface EspnTarget {
  season: number;
  seasonType: number;
  espnWeek: number;
  appWeeks: number[];
}

Deno.serve(async () => {
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const nowMs = Date.now();
  // One stamp per run: clients page the overlay by refreshed_at with an
  // overlap margin, so a run's rows must not straddle their own cursor.
  const runAt = new Date(nowMs).toISOString();
  const windowFrom = new Date(nowMs - WINDOW_BACK_MS).toISOString();
  const windowTo = new Date(nowMs + WINDOW_AHEAD_MS).toISOString();

  const { data: windowRows, error } = await db
    .from('games')
    .select('season, season_type, week')
    .gte('kickoff', windowFrom)
    .lte('kickoff', windowTo)
    .limit(5000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const targets = new Map<string, EspnTarget>();
  for (const r of windowRows ?? []) {
    const espnWeek = r.week === 0 ? 1 : r.week;
    const key = `${r.season}:${r.season_type}:${espnWeek}`;
    const t = targets.get(key) ??
      { season: r.season, seasonType: r.season_type, espnWeek, appWeeks: [] };
    if (!t.appWeeks.includes(r.week)) t.appWeeks.push(r.week);
    targets.set(key, t);
  }

  const detail: Array<Record<string, unknown>> = [];
  let errors = 0;

  for (const t of targets.values()) {
    const d: Record<string, unknown> = {
      season: t.season, season_type: t.seasonType, espn_week: t.espnWeek,
      app_weeks: t.appWeeks,
    };
    detail.push(d);
    try {
      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard` +
        `?dates=${t.season}&seasontype=${t.seasonType}&week=${t.espnWeek}&groups=80&limit=400`;
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0', 'cache-control': 'no-cache' },
      });
      if (!res.ok) { d.action = 'skip_espn_http'; d.status = res.status; errors++; continue; }
      const json = await res.json();
      const games: NormalizedGame[] = ((json.events ?? []) as unknown[])
        .map((e) => normalizeEvent(e, t.seasonType))
        .filter((g) => g.id && g.date && Number.isFinite(Date.parse(g.date)));
      d.fetched = games.length;
      if (games.length === 0) { d.action = 'skip_espn_empty'; continue; }

      const { data: stored, error: rErr } = await db
        .from('games')
        .select('id, season, season_type, week, kickoff, time_tbd')
        .in('id', games.map((g) => g.id));
      if (rErr) { d.action = 'error_games_read'; d.error = rErr.message; errors++; continue; }
      const byId = new Map((stored as StoredRow[] ?? []).map((r) => [r.id, r]));

      let updated = 0, inserted = 0, locked = 0, tbd = 0;
      const kickoffChanged: Array<Record<string, unknown>> = [];
      const rows = games.map((g) => {
        const ex = byId.get(g.id);
        let kickoff = g.date;
        let timeTbd = g.timeTbd;
        let data: NormalizedGame = { ...g, week: ex ? ex.week : t.espnWeek };
        if (ex) {
          updated++;
          const storedMs = Date.parse(ex.kickoff);
          if (storedMs <= nowMs) {
            locked++;
            kickoff = espnIso(storedMs);
            timeTbd = ex.time_tbd;
            data = { ...data, date: kickoff, timeTbd };
          } else if (storedMs !== Date.parse(g.date)) {
            kickoffChanged.push({
              id: g.id, game: g.shortName, from: espnIso(storedMs), to: g.date, tbd: g.timeTbd,
            });
          }
        } else {
          inserted++;
        }
        if (timeTbd) tbd++;
        return {
          id: g.id,
          season: ex ? ex.season : t.season,
          season_type: ex ? ex.season_type : t.seasonType,
          week: ex ? ex.week : t.espnWeek,
          kickoff,
          time_tbd: timeTbd,
          data,
          refreshed_at: runAt,
          home_school: g.home?.school ?? null,
          away_school: g.away?.school ?? null,
          home_abbrev: g.home?.abbrev ?? null,
          away_abbrev: g.away?.abbrev ?? null,
        };
      });

      const { error: upErr } = await db.from('games').upsert(rows, { onConflict: 'id' });
      if (upErr) { d.action = 'error_upsert'; d.error = upErr.message; errors++; continue; }
      d.action = 'refreshed';
      d.updated = updated;
      d.inserted = inserted;
      d.kickoff_changed = kickoffChanged.length;
      if (kickoffChanged.length) d.kickoff_changes = kickoffChanged;
      d.tbd = tbd;
      d.locked_kept = locked;
    } catch (err) {
      // one week failing must not block the rest — but it must be SAID
      d.action = 'error_thrown';
      d.error = err instanceof Error ? err.message : String(err);
      errors++;
    }
  }

  return Response.json({
    run_at: runAt,
    window: { from: windowFrom, to: windowTo },
    window_rows: windowRows?.length ?? 0,
    espn_weeks: targets.size,
    errors,
    detail,
  });
});
