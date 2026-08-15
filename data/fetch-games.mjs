// Downloads the full CFB (FBS) season schedule from ESPN's public scoreboard API
// and writes a normalized games JSON that both the web and mobile apps consume.
//
// Usage: node fetch-games.mjs [year]   (defaults to 2026)

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitWeekZero } from './split-week-zero.mjs';

const YEAR = process.argv[2] ? Number(process.argv[2]) : 2026;
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const GROUPS = 80; // FBS
const OUT_DIR = dirname(fileURLToPath(import.meta.url));

async function fetchWeek(seasonType, week) {
  // NOTE: the season is selected with `dates=<year>` — a `year=` param is silently ignored
  const url = `${BASE}?dates=${YEAR}&seasontype=${seasonType}&week=${week}&groups=${GROUPS}&limit=400`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function normalizeTeam(competitor) {
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

function normalizeEvent(event, seasonType) {
  const comp = event.competitions?.[0] ?? {};
  const competitors = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
  const venue = comp.venue ?? {};
  const broadcasts = (comp.broadcasts ?? []).flatMap((b) => b.names ?? []);
  return {
    id: event.id,
    date: event.date,
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

async function main() {
  const weeks = [];
  let calendarLabels = new Map();

  // Regular season: iterate weeks until ESPN returns no events.
  for (let week = 1; week <= 16; week++) {
    const data = await fetchWeek(2, week);
    if (week === 1) {
      for (const period of data.leagues?.[0]?.calendar ?? []) {
        for (const entry of period.entries ?? []) {
          calendarLabels.set(`${period.value}-${entry.value}`, entry.label);
        }
      }
    }
    const events = data.events ?? [];
    if (!events.length) break;
    weeks.push({
      week,
      seasonType: 2,
      label: calendarLabels.get(`2-${week}`) ?? `Week ${week}`,
      games: events.map((e) => normalizeEvent(e, 2)),
    });
    console.log(`Regular season week ${week}: ${events.length} games`);
  }

  // Postseason (bowls/playoff) — usually TBD matchups before the season; keep if present.
  try {
    const data = await fetchWeek(3, 1);
    const events = data.events ?? [];
    if (events.length) {
      weeks.push({
        week: 1,
        seasonType: 3,
        label: calendarLabels.get('3-1') ?? 'Postseason',
        games: events.map((e) => normalizeEvent(e, 3)),
      });
      console.log(`Postseason: ${events.length} games`);
    }
  } catch (err) {
    console.log(`Postseason not available yet (${err.message})`);
  }

  // ESPN merges "Week 0" into week 1 — separate them (see split-week-zero.mjs).
  const splitWeeks = splitWeekZero(weeks);

  const totalGames = splitWeeks.reduce((n, w) => n + w.games.length, 0);
  const out = {
    sport: 'college-football',
    season: YEAR,
    fetchedAt: new Date().toISOString(),
    source: 'ESPN site API (site.api.espn.com)',
    totalGames,
    weeks: splitWeeks,
  };

  const outPath = join(OUT_DIR, `games-${YEAR}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${totalGames} games across ${splitWeeks.length} weeks to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
