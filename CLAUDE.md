# CFB Pick'em

A college football pick'em game with two clients: a website and a mobile app. Starting with CFB (2026 season); may later expand to NFL / CBB.

## Structure

- `web/` — website: Vite + React + TypeScript
- `mobile/` — mobile app: Expo (React Native) + TypeScript
- `data/` — season data pipeline (source of truth for game data)

## STANDING RULE: web/mobile parity

**Whenever a change is made to either the web app or the mobile app, check whether the same change needs to be made on the other, and make it in the same working session.** The two clients should always be at the same feature state. This applies to features, UI behavior, data-model changes, and business logic (pick rules, scoring, lock times). If a change genuinely applies to only one platform (e.g. a platform-specific fix), note why in the commit/summary.

**⚠️ Parity intentionally paused (Aug 2026):** while the iOS build sits in App Review, the
website is moving ahead with the pool model (see below). Mobile still has the old
"pick every game straight-up" flow. When Apple approves, port the pool features to mobile
in one catch-up pass, then resume the rule.

## Pool model (web, funofficepools.com-style)

- Commissioner picks 12 games/week, enters spreads **locked as of Monday** (publish freezes
  them), and flags the College GameDay game as the tiebreaker (guess the final score,
  closest total wins). Players pick each game ATS, 1 pt/game, push = ½ pt (configurable).
  Weekly winners + season standings (total pts, weekly wins break ties).
- Code: `web/src/pool/` — `types.ts` (model), `store.ts` (**PoolStore interface = the
  Supabase seam**; LocalPoolStore/localStorage for now), `scoring.ts` (pure ATS
  grading/leaderboards), `kalshi.ts` (cover odds). UI: `PoolSetup`, `SlateBuilder`,
  `PickSheet`, `AtsGameCard`, `ScoreboardTab`, `StandingsTab`.
- Spreads are stored home-POV (negative = home favored). Grading: home covers iff
  `homeScore + homeSpread > awayScore`.
- **Kalshi cover odds** (public API, no auth): series `KXNCAAFSPREAD`, one event per game
  (`-YYMONDD<TEAMS>` in ET), one market per rung. The real line is `floor_strike`, never
  the ticker digits. P(cover) = mid of `yes_bid_dollars`/`yes_ask_dollars`; reject
  one-sided or >30¢-wide books. Kalshi has no CORS → `/kalshi` path is proxied in
  `web/vite.config.ts` (dev); production needs a small proxy (Supabase Edge Function).
- Live scores: `web/src/live.ts` polls ESPN 20s live / 2min idle (monte-site cadence);
  `results.ts` now also parses period/clock/possession/down-distance/lastPlay and ESPN's
  pregame odds block (used to prefill commissioner spreads).

## Hosting

Production site: **https://pattersonpickem.onrender.com** — Render static site watching
`main` on github.com/cmpeavlerjr72/cfbpickem (root dir `web`, NODE_VERSION=22). Pushing to
main auto-deploys. `web/.env.production` (committed — public client config only) supplies
the Supabase URL/anon key to the production build.

## Supabase (backend for the pool)

- Project ref `nczxyombguocejgurwop` (region **us-west-2**). Client creds in
  `web/.env.local` (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, git-ignored).
  Without that file the app falls back to LocalPoolStore (offline single-browser mode).
- Schema in `supabase/migrations/`: profiles, pools (+invite codes), pool_members,
  games (kickoffs, for lock enforcement), slates, entries. RLS: players only write their
  own entry; opponents' picks come via the `week_entries` RPC which hides picks until each
  game kicks off; a trigger rejects pick changes after kickoff; pools are created/joined
  via `create_pool`/`join_pool` RPCs.
- **Pushing migrations:** the direct db host is IPv6-only and unreachable from this box —
  use the pooler:
  `npx supabase db push --db-url "postgresql://postgres.nczxyombguocejgurwop:<DB_PASSWORD>@aws-0-us-west-2.pooler.supabase.com:5432/postgres"`
- After refetching season data, also regen + push the games seed:
  `node data/generate-games-migration.mjs 2026` then db push (keeps kickoff locks accurate).
- Auth = email magic link (`AuthGate.tsx`); auth redirect URLs live in
  `supabase/config.toml` [auth] — add the production URL there and `supabase config push`
  when the site deploys.
- Edge Function `supabase/functions/kalshi` proxies Kalshi for production
  (verify_jwt=false in config.toml); deploy with `npx supabase functions deploy kalshi`
  (needs `supabase login` + `supabase link`, which require the user's browser).

Shared concepts to keep in sync manually (no shared package yet):
- `Game` / `Team` / `SeasonData` types: `web/src/types.ts` and `mobile/types.ts`
- Pick logic and storage key format (`cfb-pickem:picks:<season>:<seasonType>:<week>`)
- The results engine (`web/src/results.ts` / `mobile/results.ts`): live-score fetch from
  ESPN (`dates=<year>` param — `year=` is silently ignored!), finals cache
  (`cfb-pickem:results:<season>:<seasonType>:<week>`), lock-at-kickoff, pick grading
- `GameCard` and `ResultsTab` components

## Data

- Fetch/refresh the season schedule: `node data/fetch-games.mjs 2026`
  (pulls every FBS game from ESPN's public scoreboard API into `data/games-2026.json`)
- Sync data into both apps: `node data/sync-to-apps.mjs 2026`
  (writes minified copies to `web/src/data/games.json` and `mobile/assets/games.json`)
- After refetching data, always re-run the sync so both apps see the same data.

## App Store / Play submission (mobile)

Everything lives in `mobile/store/`: `SUBMISSION.md` is the step-by-step checklist (EAS
commands, the CHANGEME bundle IDs, known risks), `LISTINGS.md` has the store copy,
`privacy-policy.html` must be hosted publicly, and `screenshots/` holds generated store
assets. v1 is intentionally account-free and local-only; post-approval JS changes ship OTA
via `eas update` without store review.

## Running

- Web: `cd web && npm run dev`
- Mobile: `cd mobile && npx expo start` (scan QR with Expo Go, or press `a`/`w` for Android emulator/web)
- Mobile quick preview in a browser: `cd mobile && npm run web` (react-native-web is installed)
