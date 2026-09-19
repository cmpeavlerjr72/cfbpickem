// When a pick locks (and, at the same instant, reveals to the league). The
// client mirror of `pick_lock_at()` in
// supabase/migrations/20260919140000_saturday_noon_pick_lock.sql — the server
// trigger + week_entries RPC are the enforcement; this only keeps the UI
// honest about it. Change the two together.

import type { Game } from '../types';
import type { GameResult } from '../results';
import { isGameLocked } from '../results';
import type { PickLockMode } from './types';

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

// A kickoff in the small hours ET (Hawaii) belongs to the night before.
const FOOTBALL_DAY_SHIFT_MS = 6 * 3600_000;

/** The instant picks for a game kicking at `kickoff` lock under `mode`. */
export function pickLockAt(kickoff: string | Date, mode: PickLockMode = 'kickoff'): Date {
  const kick = new Date(kickoff);
  if (mode !== 'saturday_noon') return kick;

  const shifted = new Date(kick.getTime() - FOOTBALL_DAY_SHIFT_MS);
  const p: Record<string, string> = {};
  for (const part of ET_PARTS.formatToParts(shifted)) p[part.type] = part.value;
  if (p.weekday !== 'Sat') return kick;

  // ET's UTC offset on that football day (DST flips on Sundays, so the
  // offset at the shifted instant is the offset at that Saturday's noon).
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMs = wallAsUtc - Math.floor(shifted.getTime() / 1000) * 1000;
  const noonEt = Date.UTC(+p.year, +p.month - 1, +p.day, 12) - offsetMs;
  // A Saturday game kicking before noon ET still locks at its kickoff.
  return new Date(Math.min(kick.getTime(), noonEt));
}

/** True once a game's pick is frozen — it has kicked, or its lock time passed. */
export function isPickLocked(
  game: Game,
  result: GameResult | null | undefined,
  mode: PickLockMode = 'kickoff',
): boolean {
  return isGameLocked(game, result) || pickLockAt(game.date, mode).getTime() <= Date.now();
}
