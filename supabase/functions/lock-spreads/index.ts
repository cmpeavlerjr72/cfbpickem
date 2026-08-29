// Scheduled safety net for the Monday spread lock (pg_cron hits this
// hourly). For every ATS slate whose Monday-of-game-week deadline has
// passed and whose spreads aren't locked yet: snapshot ESPN's current
// lines into the slate and stamp spreads_locked_at. Idempotent — locked
// slates are never touched, so racing the commissioner's browser (which
// does the same thing on load) is harmless.
// Keep the lock-time math in sync with web/src/pool/spreads.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ET_OFFSET_MS = 5 * 60 * 60 * 1000;

function spreadLockTime(firstKickIso: string): number {
  const shifted = new Date(new Date(firstKickIso).getTime() - ET_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const mondayMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysSinceMonday,
  );
  return mondayMidnight + ET_OFFSET_MS;
}

interface SlateGame {
  gameId: string;
  homeSpread: number;
  isTiebreaker: boolean;
}

Deno.serve(async () => {
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: slates, error } = await db
    .from('slates')
    .select('pool_id, season, season_type, week, games')
    .is('spreads_locked_at', null)
    .eq('pick_type', 'ats');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let locked = 0;
  // Per-slate outcome, in the response. The original blind {checked, locked}
  // counts hid a whole week of the 2026 week-0 lock never firing server-side
  // (found 2026-08-29: every skip and every error was silent, so the cron
  // could fail forever and the response still read as healthy).
  const detail: Array<Record<string, unknown>> = [];
  const espnCache = new Map<string, Record<string, number>>();

  for (const slate of slates ?? []) {
    const d: Record<string, unknown> = {
      pool: slate.pool_id, week: slate.week, season_type: slate.season_type,
    };
    detail.push(d);
    try {
      const games = (slate.games ?? []) as SlateGame[];
      if (games.length === 0) { d.action = 'skip_empty_slate'; continue; }

      const { data: rows, error: gErr } = await db
        .from('games')
        .select('id, kickoff')
        .in('id', games.map((g) => g.gameId));
      if (gErr) { d.action = 'error_games_read'; d.error = gErr.message; continue; }
      const kicks = (rows ?? []).map((r) => r.kickoff as string).sort();
      if (kicks.length === 0) {
        d.action = 'skip_no_game_rows';
        d.game_ids = games.map((g) => g.gameId);
        continue;
      }
      if (kicks.length < games.length) {
        d.missing_game_rows = games.length - kicks.length;
      }
      if (Date.now() < spreadLockTime(kicks[0])) {
        d.action = 'waiting';
        d.locks_at = new Date(spreadLockTime(kicks[0])).toISOString();
        continue;
      }

      // App week 0 is carved out of ESPN's merged week 1 (ESPN has no week
      // 0) — see data/split-week-zero.mjs and WeekData.espnWeek.
      const espnWeek = slate.week === 0 ? 1 : slate.week;
      const weekKey = `${slate.season}:${slate.season_type}:${espnWeek}`;
      let lines = espnCache.get(weekKey);
      if (!lines) {
        lines = {};
        const url =
          `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard` +
          `?dates=${slate.season}&seasontype=${slate.season_type}&week=${espnWeek}&groups=80&limit=400`;
        const res = await fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0', 'cache-control': 'no-cache' },
        });
        if (res.ok) {
          const json = await res.json();
          for (const event of json.events ?? []) {
            const odds = event.competitions?.[0]?.odds?.[0];
            const spread = odds ? Number(odds.spread ?? odds.pointSpread) : NaN;
            if (Number.isFinite(spread)) lines[event.id] = spread;
          }
        }
        espnCache.set(weekKey, lines);
      }

      // Games ESPN has no line for keep their last-seen number (0 = PK).
      const updated = games.map((g) =>
        lines![g.gameId] != null ? { ...g, homeSpread: lines![g.gameId] } : g,
      );
      const { data: upRows, error: upErr } = await db
        .from('slates')
        .update({ games: updated, spreads_locked_at: new Date().toISOString() })
        .eq('pool_id', slate.pool_id)
        .eq('season', slate.season)
        .eq('season_type', slate.season_type)
        .eq('week', slate.week)
        .is('spreads_locked_at', null) // never overwrite a lock that raced us
        .select('pool_id');
      if (upErr) { d.action = 'error_update'; d.error = upErr.message; continue; }
      if (!upRows?.length) { d.action = 'update_matched_nothing'; continue; }
      locked++;
      d.action = 'locked';
      d.lines_found = Object.keys(lines!).length;
    } catch (err) {
      // one slate failing must not block the rest — but it must be SAID
      d.action = 'error_thrown';
      d.error = err instanceof Error ? err.message : String(err);
    }
  }

  return Response.json({ checked: slates?.length ?? 0, locked, detail });
});
