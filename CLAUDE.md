# CFB Pick'em

A college football pick'em game with two clients: a website and a mobile app. Starting with CFB (2026 season); may later expand to NFL / CBB.

## Structure

- `web/` — website: Vite + React + TypeScript
- `mobile/` — mobile app: Expo (React Native) + TypeScript
- `data/` — season data pipeline (source of truth for game data)
- `docs/launch-plan.md` — **pre-season launch-readiness plan** (P0 custom SMTP, egress
  work incl. the Kalshi worker design, the ESPN-stays-client-direct decision, backup
  strategy, pre-launch checks). Keep statuses there current.

## STANDING RULE: web/mobile parity

**Whenever a change is made to either the web app or the mobile app, check whether the same change needs to be made on the other, and make it in the same working session.** The two clients should always be at the same feature state. This applies to features, UI behavior, data-model changes, and business logic (pick rules, scoring, lock times). If a change genuinely applies to only one platform (e.g. a platform-specific fix), note why in the commit/summary.

**Parity resumed Android-first (2026-08-15):** mobile now has the full pool model
(auth, pick sheet, scoreboard, standings, slate lock, commissioner override) and ships
**Android-only OTA updates** while the iOS binary sits in App Review:
`cd mobile && npx eas update --branch production --platform android --environment production -m "..."`
(EAS is logged in on this box; runtime 1.0.0 — JS-only changes ship OTA, adding a
native module requires a new EAS build + Play submission). The in-review iOS build must
stay untouched — **never publish an update without `--platform android`** until Apple
approves; then one `--platform ios` update catches iOS up. Deliberate platform
exceptions: mobile has no LocalPoolStore fallback (Supabase config is baked in) and
password-reset links open the website. Everything else — including the commissioner
SlateBuilder and the league dashboard — exists on both platforms.

## Pool model (web, funofficepools.com-style)

- Commissioner picks any number of games/week (pool setting `slateSize` is a soft target
  only) and the pool plays **ATS or straight-up** (`pools.pick_type`, stamped onto each
  slate at save so mid-season switches don't rewrite history; SU slates store
  homeSpread=0 so the same grading code works). ATS spreads are **never hand-entered**:
  they track ESPN's line and freeze automatically at **Monday 00:00 ET of game week**
  (fixed -5h offset — see `web/src/pool/spreads.ts`, mirrored in
  `supabase/functions/lock-spreads`). The lock happens via an hourly pg_cron →
  lock-spreads Edge Function, with the commissioner's browser as a faster lazy path;
  both are idempotent (`spreads_locked_at` guards). Pre-lock, clients overlay live ESPN
  lines for display; grading always uses the stored locked numbers. No line by lock
  time = plays as PK. One game is the College GameDay tiebreaker (guess the final
  score, closest total wins). 1 pt/game, push = ½ pt (configurable). Weekly winners +
  season standings (total pts, weekly wins break ties). SU pools show Kalshi moneyline
  odds (`KXNCAAFGAME`) instead of spread odds.
- **Pick deadline: the whole slate locks at the week's first kickoff** (no per-game
  trickle — prevents late-addition picks after early games start). Enforced by the
  `enforce_pick_locks` trigger server-side and mirrored in the UI (`picksLocked` in
  `App.tsx`). Everyone's picks + tiebreaker reveal at that same instant (`week_entries`
  RPC). **Commissioner override:** the commish can enter/adjust any OTHER member's picks
  at any time (people text in picks they forgot to enter) via the "Entering picks for…"
  selector on the Picks tab; the trigger bypasses locks only when a commissioner writes
  someone else's entry — their own sheet locks like everyone's. The commish also sees all
  picks pre-lock.
- **Multi-league accounts (added 2026-08-15):** one account can belong to any number
  of pools. After sign-in, `AuthGate` resolves the account + ALL memberships; the
  league **Dashboard** (`Dashboard.tsx` on both platforms) lists leagues (tap to
  enter), joins by invite code, creates leagues, and holds account settings (display
  name, change password, sign out). The device remembers the last league
  (`cfb-pickem:pool:last`, localStorage/AsyncStorage); a lone league auto-enters; the
  header "Leagues" button returns to the dashboard. League switching remounts the app
  (`key={poolId}`).
- Code: `web/src/pool/` — `types.ts` (model), `store.ts` (**PoolStore interface = the
  Supabase seam**; LocalPoolStore/localStorage for now), `scoring.ts` (pure ATS
  grading/leaderboards), `kalshi.ts` (cover odds). UI: `PoolSetup`, `Dashboard`,
  `SlateBuilder`, `PickSheet`, `AtsGameCard`, `ScoreboardTab`, `StandingsTab`.
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
  games (kickoffs, for lock enforcement), slates, entries. RLS: players write their own
  entry, commissioners can also write any member's entry in their pool; opponents' picks
  come via the `week_entries` RPC which hides them until the slate locks (first kickoff;
  commissioners always see them); the `enforce_pick_locks` trigger rejects writes after
  the slate lock except commissioner writes to others' entries; pools are created/joined
  via `create_pool`/`join_pool` RPCs.
- **Pushing migrations:** the direct db host is IPv6-only and unreachable from this box —
  use the pooler:
  `npx supabase db push --db-url "postgresql://postgres.nczxyombguocejgurwop:<DB_PASSWORD>@aws-0-us-west-2.pooler.supabase.com:5432/postgres"`
- After refetching season data, also regen + push the games seed:
  `node data/generate-games-migration.mjs 2026` then db push (keeps kickoff locks accurate).
- Auth = email + password (`AuthGate.tsx`), with a reset-email recovery flow
  (`resetPasswordForEmail` → `PASSWORD_RECOVERY` event → set-new-password form). Accounts
  from the old magic-link era have no password — they use "Forgot password?" to set one.
  Auth redirect URLs live in `supabase/config.toml` [auth] — add new URLs there and
  `supabase config push`. Free-tier built-in SMTP is heavily rate-limited (~2-4
  emails/hour), but only signup confirmations/resets send email now.
- Edge Function `supabase/functions/kalshi` proxies Kalshi for production
  (verify_jwt=false in config.toml); deploy with `npx supabase functions deploy kalshi`
  (needs `supabase login` + `supabase link`, which require the user's browser).

Shared concepts to keep in sync manually (no shared package yet):
- `Game` / `Team` / `SeasonData` types: `web/src/types.ts` and `mobile/types.ts`
- The pool layer: `web/src/pool/*` ↔ `mobile/pool/*` (types, scoring, spreads, store,
  kalshi — mobile hits Kalshi directly, no CORS on native; web needs the proxy)
- The results engine (`web/src/results.ts` / `mobile/results.ts`): live-score fetch from
  ESPN (`dates=<year>` param — `year=` is silently ignored!), finals cache
  (`cfb-pickem:results:<season>:<seasonType>:<week>`), lock-at-kickoff, pick grading;
  plus the adaptive poller `live.ts` (document.hidden on web ↔ AppState on mobile)
- Components: `AuthGate`, `AtsGameCard`, `PickSheet`, `ScoreboardTab`, `StandingsTab`
  (RN versions mirror the web ones; only storage/styling primitives differ)

## Data

- Fetch/refresh the season schedule: `node data/fetch-games.mjs 2026`
  (pulls every FBS game from ESPN's public scoreboard API into `data/games-2026.json`)
- **Week 0 split (2026-08-15):** ESPN merges the late-August "Week 0" weekend into its
  week 1. `data/split-week-zero.mjs` (applied automatically by fetch-games, runnable
  standalone on an existing data file) carves those games out into a real Week 0 —
  required because picks lock at a week's FIRST kickoff, and merged weeks would lock
  Labor Day picks in August. Split weeks carry `espnWeek` (both halves = 1), which is
  what `results.ts` and the `lock-spreads` Edge Function must use for ESPN API calls —
  ESPN has no week 0. Week 0 is the pool's designated TEST week.
- `generate-games-migration.mjs` always writes a NEW timestamped migration (never
  overwrites — pushed migrations are version-recorded and edits would silently not
  re-apply).
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
