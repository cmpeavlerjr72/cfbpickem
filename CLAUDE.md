# CFB Pick'em

A college football pick'em game with two clients: a website and a mobile app. Starting with CFB (2026 season); may later expand to NFL / CBB.

## Structure

- `web/` — website: Vite + React + TypeScript
- `mobile/` — mobile app: Expo (React Native) + TypeScript
- `data/` — season data pipeline (source of truth for game data)
- `docs/launch-plan.md` — **pre-season launch-readiness plan** (P0 custom SMTP, egress
  work incl. the Kalshi worker design, the ESPN-stays-client-direct decision, backup
  strategy, pre-launch checks). Keep statuses there current.

## STANDING RULE: Fable is the project manager, workers do the work

**Claude Fable 5 (the session model) acts as project manager and delegates execution to
cheaper worker agents** via the Agent tool (`model: "opus"` / `"sonnet"` / `"haiku"`).
The goal is to spend Fable tokens on judgment — understanding the ask, scoping, briefing
workers, reviewing their output, and reporting — not on reading files or typing code.

- **Fable does:** clarify the task, locate the relevant code with a few targeted greps
  (or an Explore agent), decide the approach, write precise briefs, review diffs, run
  the final verification, commit/ship, and summarize for the user.
- **Workers do:** implementation, broad codebase exploration, mechanical edits, test
  runs, log/data digging. Pick the cheapest model that can do the job:
  - `haiku` — lookups, greps, file summaries, mechanical find/replace, running commands.
  - `sonnet` — ordinary feature work and bug fixes with a clear brief; parity ports
    (web ↔ mobile mirrors); writing migrations/scripts from a spec.
  - `opus` — multi-file design work, tricky debugging, anything where the brief can't
    fully pin down the approach.
- Briefs must be self-contained: files involved, the exact behavior wanted, constraints
  from this CLAUDE.md (parity, Android-only OTA, Week 0/espnWeek, etc.), and what to
  report back. Ask workers to return a short diff summary, not file dumps.
- Independent tasks run as parallel workers in one message. Fable still reviews every
  worker diff before committing — workers are fast, not trusted.
- Exceptions where Fable works directly: one-line edits, tasks where briefing costs
  more than doing, and anything needing the user's live context (credentials, running
  interactive commands).

## STANDING RULE: web/mobile parity

**Whenever a change is made to either the web app or the mobile app, check whether the same change needs to be made on the other, and make it in the same working session.** The two clients should always be at the same feature state. This applies to features, UI behavior, data-model changes, and business logic (pick rules, scoring, lock times). If a change genuinely applies to only one platform (e.g. a platform-specific fix), note why in the commit/summary.

**Parity resumed Android-first (2026-08-15):** mobile now has the full pool model
(auth, pick sheet, scoreboard, standings, slate lock, commissioner override) and ships
**Android-only OTA updates** while iOS is between App Store submissions:
`cd mobile && npx eas update --branch production --platform android --environment production -m "..."`
(EAS is logged in on this box; runtime 1.0.0 — JS-only changes ship OTA, adding a
native module requires a new EAS build + Play submission). **iOS status (2026-08-23):**
the original stripped account-free v1 build was rejected Aug 20 under Guideline 4.2
Minimum Functionality (read as too thin, like a notes app); we're resubmitting a new iOS
build of this same full pool app — no more account-free mode — with `supportsTablet:
false` (iPhone-only, since Apple reviewed on an iPad Air) and a demo league seeded via
`data/seed-demo-league.mjs` for App Review (see `mobile/store/SUBMISSION.md`). Until
Apple approves, **never publish an update without `--platform android`**; then one
`--platform ios` update catches iOS up. Deliberate platform
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

Production site: **https://saturdaysweats.com** (custom domain; the same Render
static site also answers on its default host **https://pattersonpickem.onrender.com**).
Always give members the custom domain — the two hostnames are **separate browser
origins**, so an installed PWA, its service worker and its localStorage do NOT
transfer between them. Render static site watching
`main` on github.com/cmpeavlerjr72/cfbpickem (root dir `web`, NODE_VERSION=22). Pushing to
main auto-deploys. `web/.env.production` (committed — public client config only) supplies
the Supabase URL/anon key to the production build.

### PWA — the website installs as "Saturday Sweats" (2026-08-28)

The web app is installable to a phone home screen, which is the distribution path
while iOS is stuck in App Review. `public/manifest.webmanifest` (name "Saturday
Sweats", home-screen label "Sat Sweats" — iOS truncates past ~12 chars),
`src/sw.ts` (the service worker) and `src/pwa.ts` (registration) are the whole of
it; `components/InstallPrompt.tsx` is the in-app "Install app" bar, which shows a
Share-sheet guide on iOS because WebKit has no install API.

- **The worker caches the app shell and NOTHING else.** Only two routes are
  registered — workbox's precache (exact hashed same-origin URLs) and a
  network-first navigation route — so Supabase, ESPN and Kalshi fall through to
  the network untouched. Never add `setDefaultHandler` or runtime caching: a
  cached pick sheet or a cached score is a data bug, not a speed win.
- Updates are automatic (`skipWaiting`/`clientsClaim` + network-first
  navigations), so a Render deploy reaches installed phones on next launch.
- **`InstallPrompt` is mounted ONCE in `Root.tsx`**, above every screen — never
  per-page. Mounted per-page it only appeared wherever it had been added (the
  user found it on Leagues and nowhere else), and two instances would race the
  same single-use install event.
- **Reading the instructions is never a dismissal.** Closing the iOS/Android
  guide (X, tap-outside, backgrounding) records nothing — opening it is the
  strongest install-intent signal there is, and treating it as "no thanks" is
  what made the banner vanish on the user's iPhone. Only the X **on the
  banner** hides it, and that is a **7-day snooze**
  (`cfb-pickem:install:snoozeUntil`, try/catch'd), never permanent; a declined
  Chromium OS dialog gets the same 7 days. The old permanent
  `:install:dismissed` flag is deleted on sight.
- iOS cannot tell whether the app is already installed from a Safari tab
  (`getInstalledRelatedApps` is Chromium-only), so an installed iOS member may
  still see the banner while browsing. The overlay says "Already added it?
  You're all set" and we leave it there — do not get clever.
- **Android fallback:** Chrome suppresses `beforeinstallprompt` after an install
  or a dismissal, so "no event" ≠ "cannot install". On Android with no event
  after a 3s grace period the button still shows and opens manual ⋮ →
  "Add to Home screen" instructions. `navigator.getInstalledRelatedApps()`
  (needs `related_applications` in the manifest, which lists itself) hides it
  when the WebAPK really is installed; where that API is missing we show the
  button, since instructions to an installed user beat invisibility to an
  uninstalled one.
- **`beforeinstallprompt` is captured at MODULE LOAD in `src/pwa.ts`, never in a
  component effect** (regression fixed 2026-08-28 after an Android test): Chrome
  fires it before React mounts, so a late listener both misses the stash *and*
  fails to `preventDefault()`, letting Chrome's own install popup take over.
  `main.tsx` imports `./pwa` first for the same reason. The listener stays
  registered — Chrome re-fires after a decline.
- Everything in the manifest is origin-relative (`start_url`/`scope`/icon `src`),
  so the same build installs correctly on either hostname.
- Icons are committed; regenerate with `node scripts/make-pwa-icons.mjs`
  (headless Edge screenshot of vector source — no native image dependency).
- Render serves `manifest.webmanifest` as `binary/octet-stream` (its static
  sites have no `_headers` file; MIME/header overrides are dashboard-only).
  Browsers parse it anyway — verified with `Page.getAppManifest`, zero errors —
  so this is left alone rather than converted to a render.yaml blueprint.
- Deliberate parity exception: no mobile counterpart. `mobile/` IS a native app,
  so "add to home screen" has no meaning there.

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
- **Account deletion (Apple 5.1.1(v)):** the `delete_account()` RPC (called straight from
  `Dashboard.tsx` on both platforms, like the display-name/password updates) deletes the
  caller's leagues where they're the only member, promotes the longest-standing member
  (earliest `joined_at`) when the sole commissioner leaves, re-stamps `pools.created_by`
  onto a surviving member, then deletes the `auth.users` row so profiles → memberships →
  entries cascade away. One atomic function.
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
commands, known risks, and the current iOS resubmission steps after the Aug 20 4.2
rejection), `LISTINGS.md` has the store copy, `web/public/privacy.html` is the hosted
privacy policy (mobile's `store/privacy-policy.html` is just a pointer to it, not a
duplicate), and `screenshots/` holds generated store assets. The app being submitted is
the full pool app — accounts, multi-league dashboard, commissioner tools — not an
account-free v1; a demo league (`data/seed-demo-league.mjs`) is seeded for App Review.
Post-approval JS changes ship OTA via `eas update` without store review.

## Running

- Web: `cd web && npm run dev`
- Mobile: `cd mobile && npx expo start` (scan QR with Expo Go, or press `a`/`w` for Android emulator/web)
- Mobile quick preview in a browser: `cd mobile && npm run web` (react-native-web is installed)
