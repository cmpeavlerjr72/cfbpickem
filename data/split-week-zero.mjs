// ESPN merges "Week 0" (the late-August weekend) into its regular-season
// week 1 — one label spanning two Saturdays. That breaks the pool's
// whole-slate-locks-at-first-kickoff rule (Labor Day picks would lock in
// August), so we split them: games before the big date gap become our
// Week 0. Both halves keep `espnWeek: 1` — that's the number the ESPN
// scoreboard API needs (it has no week 0) — while `week` is the app/DB key.
//
// Used by fetch-games.mjs after every fetch, and runnable standalone to
// re-split an existing data file:
//
//   node data/split-week-zero.mjs [year]   (defaults to 2026)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAP_DAYS = 3; // a gap this big inside one "week" = two real weeks

/**
 * Splits a merged ESPN week 1 into week 0 + week 1 (no-op when week 1 has
 * no early cluster, or a week 0 already exists). Mutates nothing; returns a
 * new weeks array.
 */
export function splitWeekZero(weeks) {
  if (weeks.some((w) => w.seasonType === 2 && w.week === 0)) return weeks;
  const w1 = weeks.find((w) => w.seasonType === 2 && w.week === 1);
  if (!w1 || w1.games.length === 0) return weeks;

  const dates = [...new Set(w1.games.map((g) => g.date.slice(0, 10)))].sort();
  let boundary = null;
  for (let i = 1; i < dates.length; i++) {
    const gap = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000;
    if (gap >= GAP_DAYS) {
      boundary = dates[i];
      break;
    }
  }
  if (!boundary) return weeks;

  const early = w1.games.filter((g) => g.date.slice(0, 10) < boundary);
  const late = w1.games.filter((g) => g.date.slice(0, 10) >= boundary);
  if (early.length === 0 || late.length === 0) return weeks;

  const weekZero = {
    week: 0,
    seasonType: 2,
    label: 'Week 0',
    espnWeek: 1,
    games: early.map((g) => ({ ...g, week: 0 })),
  };
  const weekOne = { ...w1, espnWeek: 1, games: late };

  return weeks.flatMap((w) => (w === w1 ? [weekZero, weekOne] : [w]));
}

// Standalone: re-split games-<year>.json in place.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const year = process.argv[2] ? Number(process.argv[2]) : 2026;
  const path = join(dirname(fileURLToPath(import.meta.url)), `games-${year}.json`);
  const season = JSON.parse(readFileSync(path, 'utf8'));
  const before = season.weeks.length;
  season.weeks = splitWeekZero(season.weeks);
  if (season.weeks.length === before) {
    console.log('No split needed — week 0 already separate or no merged cluster found.');
  } else {
    writeFileSync(path, JSON.stringify(season, null, 2));
    const w0 = season.weeks.find((w) => w.week === 0 && w.seasonType === 2);
    console.log(`Split ${w0.games.length} games into Week 0; rewrote ${path}`);
  }
}
