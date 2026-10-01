// Live schedule overlay. The bundled games.json is a snapshot (first paint
// and the offline/LocalPoolStore fallback); public.games is the schedule
// source of truth, kept current hourly by the refresh-games Edge Function
// (kickoffs, TBD flags, ranks). Signed-in clients pull rows written after
// the bundle was fetched and merge them in, so the UI's locks
// (lockedGameIds), cards and slate builder agree with what the server's
// enforce_pick_locks trigger reads.

import { useEffect, useState } from 'react';
import type { Game, SeasonData } from './types';
import { supabase } from './pool/supabase';

interface GameRow {
  id: string;
  season_type: number;
  week: number;
  kickoff: string;
  time_tbd: boolean;
  data: Game | null;
  refreshed_at: string;
}

const PAGE_SIZE = 1000; // PostgREST max_rows
const MIN_INTERVAL_MS = 15 * 60_000;
// refresh-games stamps a whole run with its start time while rows commit
// over the run, so the next poll re-reads a margin behind the newest row.
const CURSOR_OVERLAP_MS = 10 * 60_000;

/** ISO instant in ESPN's format (2026-10-03T16:00Z) — what the bundle uses. */
function espnIso(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16)}Z`;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Merge DB rows into the season. Pure; returns the SAME object when nothing
 * changed, and reuses every untouched week/game object, so consumers keyed
 * on identity (pollers, memos) only restart for a week that really moved.
 */
export function mergeSchedule(season: SeasonData, rows: GameRow[]): SeasonData {
  const where = new Map<string, { wi: number; gi: number }>();
  season.weeks.forEach((w, wi) => w.games.forEach((g, gi) => where.set(g.id, { wi, gi })));

  const weekGames = new Map<number, Game[]>(); // copy-on-write per week index
  const resort = new Set<number>();
  const gamesOf = (wi: number) => {
    let games = weekGames.get(wi);
    if (!games) {
      games = [...season.weeks[wi].games];
      weekGames.set(wi, games);
    }
    return games;
  };
  let added = 0;

  for (const row of rows) {
    const at = where.get(row.id);
    const base = row.data ?? (at ? season.weeks[at.wi].games[at.gi] : null);
    if (!base || !row.kickoff) continue;
    const next: Game = { ...base, date: espnIso(row.kickoff), timeTbd: row.time_tbd };
    if (at) {
      const current = (weekGames.get(at.wi) ?? season.weeks[at.wi].games)[at.gi];
      if (sameJson({ ...current, timeTbd: current.timeTbd ?? false }, next)) continue;
      gamesOf(at.wi)[at.gi] = next;
      if (current.date !== next.date) resort.add(at.wi);
    } else {
      const wi = season.weeks.findIndex(
        (w) => w.seasonType === row.season_type && w.week === row.week,
      );
      if (wi === -1) continue; // no such week in this build — leave it to a bundle refresh
      const games = gamesOf(wi);
      where.set(row.id, { wi, gi: games.length });
      games.push(next);
      resort.add(wi);
      added++;
    }
  }

  if (weekGames.size === 0) return season;
  const weeks = season.weeks.map((w, wi) => {
    const games = weekGames.get(wi);
    if (!games) return w;
    // stable sort, so ESPN's order within a kickoff slot is kept
    if (resort.has(wi)) games.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    return { ...w, games };
  });
  return { ...season, weeks, totalGames: season.totalGames + added };
}

async function fetchRows(season: number, since: string): Promise<GameRow[]> {
  if (!supabase) return [];
  const rows: GameRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('games')
      .select('id, season_type, week, kickoff, time_tbd, data, refreshed_at')
      .eq('season', season)
      .gt('refreshed_at', since)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as GameRow[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/**
 * The season schedule: the bundle, overlaid with public.games when
 * `enabled` (Supabase store, signed in). Loads on mount, then at most every
 * 15 min while visible (interval + tab-visible), so a phone left open picks
 * up kickoff changes. Any failure keeps what is already showing.
 */
export function useSeasonSchedule(bundle: SeasonData, enabled: boolean): SeasonData {
  const [season, setSeason] = useState(bundle);

  useEffect(() => {
    if (!enabled || !supabase) return;
    let cancelled = false;
    let inFlight = false;
    let lastLoad = 0;
    let cursorMs = Date.parse(bundle.fetchedAt) || 0;
    const floorMs = cursorMs;

    const load = async (force: boolean) => {
      if (inFlight || document.hidden) return;
      // (a minute of slack so the 15-min interval's own tick is never skipped)
      if (!force && Date.now() - lastLoad < MIN_INTERVAL_MS - 60_000) return;
      inFlight = true;
      lastLoad = Date.now();
      try {
        const rows = await fetchRows(bundle.season, new Date(cursorMs).toISOString());
        if (cancelled || rows.length === 0) return;
        setSeason((prev) => mergeSchedule(prev, rows));
        const newest = Math.max(...rows.map((r) => Date.parse(r.refreshed_at) || 0));
        cursorMs = Math.max(floorMs, cursorMs, newest - CURSOR_OVERLAP_MS);
      } catch {
        // offline / RLS / network: keep the current schedule, retry next tick
      } finally {
        inFlight = false;
      }
    };

    load(true);
    const timer = window.setInterval(() => load(false), MIN_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [bundle, enabled]);

  return season;
}
