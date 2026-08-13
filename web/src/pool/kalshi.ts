// Live "odds to cover" from Kalshi's public market data (no auth needed).
// Series KXNCAAFSPREAD has one event per game (ticker chunk = YYMONDD +
// away/home team codes) and one market per spread rung. The real line is
// floor_strike — never the digits in the ticker. Mid of yes bid/ask ≈
// probability the named team covers that line; the opponent is 1 − p.
//
// Kalshi sends no CORS headers, so the browser goes through the /kalshi
// proxy (vite dev proxy now; a Supabase Edge Function in production).

import type { Game } from '../types';
import type { CoverOdds, WeekSlate } from './types';

// Dev: vite proxy (vite.config.ts). Prod: the `kalshi` Supabase Edge
// Function, which adds CORS headers and a shared 30s cache.
const KALSHI_PROXY = import.meta.env.DEV
  ? '/kalshi'
  : `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/kalshi`;

// ATS pools use the spread series; straight-up pools use the moneyline one.
const SPREAD_SERIES = 'KXNCAAFSPREAD';
const GAME_SERIES = 'KXNCAAFGAME';

interface KalshiEvent {
  event_ticker: string;
}

interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  floor_strike?: number | null;
  yes_bid_dollars?: string | null;
  yes_ask_dollars?: string | null;
  yes_bid?: number | null;
  yes_ask?: number | null;
  status?: string;
}

async function kalshiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${KALSHI_PROXY}${path}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Prefer the string *_dollars form; legacy field is integer cents. */
function priceDollars(market: KalshiMarket, key: 'yes_bid' | 'yes_ask'): number | null {
  const dollars = market[`${key}_dollars`];
  if (dollars != null) return parseFloat(dollars);
  const cents = market[key];
  return cents != null ? cents / 100 : null;
}

/** Two-sided mid in probability terms; null for one-sided or junk books. */
function midProbability(market: KalshiMarket): number | null {
  const bid = priceDollars(market, 'yes_bid');
  const ask = priceDollars(market, 'yes_ask');
  if (bid == null || ask == null) return null;
  if (bid <= 0 || ask >= 1 || ask <= bid) return null;
  if (ask - bid > 0.3) return null;
  return (bid + ask) / 2;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Kalshi date chunk (e.g. "25NOV01") for a kickoff, in Eastern time. */
function kalshiDateKey(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: '2-digit',
    month: 'numeric',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}${MONTHS[Number(get('month')) - 1]}${get('day')}`;
}

const EVENT_CHUNK = /^(\d{2}[A-Z]{3}\d{2})(?:\d{4})?([A-Z0-9]+)$/;

interface ParsedEvent {
  ticker: string;
  dateKey: string;
  teamBlob: string;
}

const eventsCache = new Map<string, { fetchedAt: number; events: ParsedEvent[] }>();
const EVENTS_TTL = 10 * 60 * 1000;

async function listSeriesEvents(series: string): Promise<ParsedEvent[]> {
  const cached = eventsCache.get(series);
  if (cached && Date.now() - cached.fetchedAt < EVENTS_TTL) return cached.events;
  const out: ParsedEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = `series_ticker=${series}&status=open&limit=200${cursor ? `&cursor=${cursor}` : ''}`;
    const json = await kalshiGet<{ events?: KalshiEvent[]; cursor?: string }>(`/events?${qs}`);
    for (const ev of json.events ?? []) {
      const chunk = ev.event_ticker.split('-')[1];
      const m = chunk ? EVENT_CHUNK.exec(chunk) : null;
      if (m) out.push({ ticker: ev.event_ticker, dateKey: m[1], teamBlob: m[2] });
    }
    cursor = json.cursor || undefined;
    if (!cursor) break;
  }
  eventsCache.set(series, { fetchedAt: Date.now(), events: out });
  return out;
}

function teamCode(team: Game['home']): string | null {
  return team?.abbrev ? team.abbrev.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

function matchEvent(events: ParsedEvent[], game: Game): ParsedEvent | null {
  const away = teamCode(game.away);
  const home = teamCode(game.home);
  if (!away || !home) return null;
  const dateKey = kalshiDateKey(game.date);
  const sameDay = events.filter((e) => e.dateKey === dateKey);
  // Kalshi's ticker order isn't guaranteed to be away-then-home, so try both.
  // Side probabilities key off the market's team code, so order doesn't matter.
  return (
    sameDay.find((e) => e.teamBlob === `${away}${home}`) ??
    sameDay.find((e) => e.teamBlob === `${home}${away}`) ??
    sameDay.find(
      (e) =>
        (e.teamBlob.startsWith(away) && e.teamBlob.endsWith(home)) ||
        (e.teamBlob.startsWith(home) && e.teamBlob.endsWith(away)),
    ) ??
    null
  );
}

const marketsCache = new Map<string, { fetchedAt: number; markets: KalshiMarket[] }>();
const MARKETS_TTL = 60 * 1000;

async function eventMarkets(eventTicker: string): Promise<KalshiMarket[]> {
  const cached = marketsCache.get(eventTicker);
  if (cached && Date.now() - cached.fetchedAt < MARKETS_TTL) return cached.markets;
  const json = await kalshiGet<{ markets?: KalshiMarket[] }>(
    `/markets?event_ticker=${encodeURIComponent(eventTicker)}&limit=200`,
  );
  const markets = json.markets ?? [];
  marketsCache.set(eventTicker, { fetchedAt: Date.now(), markets });
  return markets;
}

/** Team code from a market ticker suffix ("...-HOU14" → "HOU"). */
function marketTeamCode(ticker: string): string | null {
  const suffix = ticker.split('-')[2];
  if (!suffix) return null;
  const code = suffix.replace(/\d+$/, '');
  return code || null;
}

/**
 * Straight-up pools: odds each team wins, from the moneyline series.
 * Each team has its own "TEAM wins" market; if only one side has a clean
 * two-sided book, the other side is its complement.
 */
async function gameWinOdds(event: ParsedEvent, game: Game): Promise<CoverOdds | null> {
  const homeCode = teamCode(game.home);
  const awayCode = teamCode(game.away);
  if (!homeCode || !awayCode) return null;
  const markets = await eventMarkets(event.ticker);
  let homeP: number | null = null;
  let awayP: number | null = null;
  for (const market of markets) {
    const code = marketTeamCode(market.ticker);
    if (code === homeCode) homeP = midProbability(market) ?? homeP;
    else if (code === awayCode) awayP = midProbability(market) ?? awayP;
  }
  if (homeP == null && awayP == null) return null;
  return {
    home: homeP ?? (awayP != null ? 1 - awayP : null),
    away: awayP ?? (homeP != null ? 1 - homeP : null),
    label: 'Kalshi',
  };
}

/**
 * Odds that each side covers the pool's locked spread. Uses the rung whose
 * floor_strike is closest to the favorite's line (within 1 point) — Kalshi's
 * lines may drift from the Monday number, so this is "market's view of a
 * nearby line", shown as context, not gospel.
 */
async function gameCoverOdds(
  event: ParsedEvent,
  game: Game,
  homeSpread: number,
): Promise<CoverOdds | null> {
  if (homeSpread === 0) return null; // pick'em game — no spread rungs to match
  const favoriteIsHome = homeSpread < 0;
  const favorite = favoriteIsHome ? game.home : game.away;
  const favCode = teamCode(favorite);
  if (!favCode) return null;
  const line = Math.abs(homeSpread);

  const markets = await eventMarkets(event.ticker);
  let best: { market: KalshiMarket; distance: number } | null = null;
  for (const market of markets) {
    if (marketTeamCode(market.ticker) !== favCode) continue;
    const strike = market.floor_strike;
    if (strike == null || !Number.isFinite(strike)) continue;
    const distance = Math.abs(strike - line);
    if (distance <= 1 && (!best || distance < best.distance)) {
      best = { market, distance };
    }
  }
  if (!best) return null;
  const p = midProbability(best.market);
  if (p == null) return null;
  return {
    home: favoriteIsHome ? p : 1 - p,
    away: favoriteIsHome ? 1 - p : p,
    label: 'Kalshi',
  };
}

/**
 * Cover odds for every slate game that has an open Kalshi market.
 * Games without a match (or with junk books) are simply absent.
 */
export async function fetchCoverOddsForSlate(
  slate: WeekSlate,
  gamesById: Map<string, Game>,
): Promise<Record<string, CoverOdds>> {
  const out: Record<string, CoverOdds> = {};
  const straightUp = slate.pickType === 'su';
  let events: ParsedEvent[];
  try {
    events = await listSeriesEvents(straightUp ? GAME_SERIES : SPREAD_SERIES);
  } catch {
    return out; // proxy not running / network down — odds are optional
  }
  for (const slateGame of slate.games) {
    const game = gamesById.get(slateGame.gameId);
    if (!game) continue;
    try {
      const event = matchEvent(events, game);
      if (!event) continue;
      const odds = straightUp
        ? await gameWinOdds(event, game)
        : await gameCoverOdds(event, game, slateGame.homeSpread);
      if (odds) out[slateGame.gameId] = odds;
    } catch {
      // one game's market failing must not drop the rest
    }
  }
  return out;
}
