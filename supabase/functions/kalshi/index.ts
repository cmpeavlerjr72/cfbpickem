// Public read-only proxy for Kalshi market data (Kalshi sends no CORS
// headers, so browsers can't call it directly). Only the two endpoints the
// pick'em needs are allowed, and responses are cached ~30s per isolate so a
// whole pool refreshing on game day stays well under Kalshi's rate limits.
// Deployed with verify_jwt = false (see supabase/config.toml) — it serves
// public market data only.

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const ALLOWED = new Set(['events', 'markets']);
const TTL_MS = 30_000;

const cache = new Map<string, { at: number; status: number; body: string }>();

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Path arrives as /kalshi/<subpath>; strip the function name.
  const sub = url.pathname.replace(/^\/kalshi\/?/, '');
  if (!ALLOWED.has(sub.split('/')[0])) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const target = `${KALSHI}/${sub}${url.search}`;
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json', 'x-cache': 'hit' },
    });
  }

  const upstream = await fetch(target, { headers: { accept: 'application/json' } });
  const body = await upstream.text();
  if (upstream.ok) {
    cache.set(target, { at: Date.now(), status: upstream.status, body });
  }
  return new Response(body, {
    status: upstream.status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json', 'x-cache': 'miss' },
  });
});
