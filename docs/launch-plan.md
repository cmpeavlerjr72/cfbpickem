# Launch plan — 2026 season opening

Written 2026-08-15. First kickoff: **Sat Aug 29, 2026, 12:00 PM ET** (Week 1 per
`data/games-2026.json`; Week 2 starts Fri Sep 11). Spreads for Week 1 hard-lock
**Mon Aug 24, 00:00 ET**. This doc is the source of truth for pre-season readiness —
update statuses here as items land.

Context: an influx of users is expected at season start. The app itself (static site,
RLS, server-enforced pick locks) scales fine; the work below is about the Supabase free
tier's email service and egress/invocation quotas, plus safety nets.

## P0 — Custom SMTP (the launch blocker)

Supabase's built-in email service delivers ~2–4 emails/hour and is not for production.
New signups send no email (confirmations off), but **every magic-link-era member must
use "Forgot password?" once** to set a password, and that sends an email. Without this,
onboarding night stalls.

**Status 2026-08-15: COMPLETE (technical side).** Custom SMTP live via Resend:
`[auth.email.smtp]` in config.toml (secret via `env(RESEND_API_KEY)` — key in session
memory, never the repo), sender `noreply@pattersonspickem.com`, rate limit 30/hr.
Domain **pattersonspickem.com** (note the extra `s` vs the `pattersonpickem` Render
subdomain) purchased same day, DNS at Squarespace (DKIM on `resend._domainkey`, MX+SPF
on `send`), verified in Resend, and a test reset was accepted end-to-end from the
domain sender. Note: the Resend API key is send-only restricted — check domain health
by probing DNS, not the Resend API.

Remaining human steps:

1. [user] Confirm the test reset landed in the inbox (not spam) from
   "Patterson Pick'em <noreply@pattersonspickem.com>".
2. [user] Have one pool member run "Forgot password?" as a real-world non-owner check.
3. [user] Announce to legacy members that "Forgot password?" sets their password.

## P1 — Egress work (before the first big Saturday)

Free-tier quotas: 5 GB egress/mo, 2M Edge Function invocations/mo. Back-of-envelope at
100 concurrent Saturday viewers, the current design burns ~8 GB egress and ~1M function
invocations **in one day** (Kalshi is the main offender). After the changes below:
~1 GB/month total.

### 1. Centralize Kalshi polling (user-approved architecture, not yet built)

Today every open tab calls the `kalshi` Edge Function proxy ~13×/min (1 events call +
1 markets call per slate game) and pulls raw market JSON. Replace with one worker:

- New table `market_odds`, keyed `(season, season_type, week)` — **pool-independent**
  (all pools share the same games/odds). One `odds jsonb` column mapping
  `gameId → CoverOdds` (`{home, away, label}`, same shape as `web/src/pool/types.ts`),
  plus `updated_at`. RLS: authenticated read; writes via service role only (no write
  policy needed).
- New Edge Function `poll-kalshi`: port the distillation logic from
  `web/src/pool/kalshi.ts` (series `KXNCAAFSPREAD` for ATS, `KXNCAAFGAME` moneyline for
  SU; real line = `floor_strike`; mid of `yes_bid_dollars`/`yes_ask_dollars`; reject
  one-sided or >30¢ books). First query the DB: if no published slate has games still
  pregame, exit immediately (cheap no-op). Otherwise fetch Kalshi once, upsert the row.
  Server→Kalshi works fine (the existing proxy proves it) and inbound bandwidth is free.
- Schedule via pg_cron every minute (`* * * * *`), same pattern as
  `20260813210000_lock_spreads_cron.sql` (pg_cron + pg_net already enabled).
  ~43K invocations/mo — negligible.
- Client: in `App.tsx`, replace the `fetchCoverOddsForSlate` poll with a select from
  `market_odds` on the same 60s cadence (works in dev too — same Supabase project).
  Keep the direct Kalshi path only for the LocalPoolStore/offline mode (vite `/kalshi`
  proxy). Afterwards the per-client `kalshi` proxy function can be retired.

### 2. ESPN stays browser-direct — decision, do not "fix"

Deliberately NOT proxied through Supabase. Reasons: browser→ESPN traffic costs us
nothing (each user's own IP against ESPN's public API — no quota of ours); routing
scores through the DB would *add* 1–2 GB/Saturday of egress that is currently zero,
plus a 20s cron dependency; and ESPN is Akamai-fronted and blocks non-browser clients
aggressively (blocked from this dev box's shell; browsers fine), so a server-side score
poller is the fragile version of something currently free. Revisit only if ESPN starts
blocking browsers or we need server-side score truth; the `market_odds` pattern above is
the ready-made fallback shape.

### 3. Entries poll cadence by tab

`refresh()` in `App.tsx` polls `week_entries` every 60s regardless of tab — post-lock
that's everyone's full sheets (~3 GB/Saturday-weekend at 100 viewers). Change to: 60s on
the Scoreboard tab, ~5 min elsewhere, immediate refresh on tab switch. (Hidden tabs
already skip polling.)

## P2 — Decisions and safety nets

- **Supabase Pro ($25/mo)** — [user decision]. Buys: daily backups w/ 7-day retention
  (free tier has **no backups at all**), 250 GB egress, no auto-pause. Recommended for
  the season; the backup gap is the strongest argument.
- **If not Pro: scheduled `pg_dump`** — [claude] weekly (or pre-Saturday) dump from the
  dev box via the pooler host (`aws-0-us-west-2.pooler.supabase.com:5432`, creds in
  session memory / password manager — never in the repo).
- **Same-IP signup limit** — `sign_in_sign_ups` is 30 per 5 min per IP. If onboarding
  happens as a group event (draft party on one WiFi), tell Claude beforehand to bump it
  via config push.

## Pending prod migration — commissioner roster + dues (2026-08-28)

`supabase/migrations/20260828180000_league_dues.sql` is **written and committed but NOT
yet applied to prod** — this box has no DB password (the `.temp/pooler-url` the CLI
stores carries no credentials). One command, from the repo root, with the password the
user holds:

```
npx supabase db push --db-url "postgresql://postgres.nczxyombguocejgurwop:<DB_PASSWORD>@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
```

Then prove it, from `web/` (anon key only — it creates and deletes two throwaway
accounts, and prints no email addresses):

```
node scripts/verify-dues-rls.mjs      # expect: All checks passed.
```

Until it is applied the "Members & dues" view shows *Couldn't load the roster: Could not
find the function public.league_roster* — nothing else in the app is affected.

## Pre-launch checks (week of Aug 24)

- [ ] **Mon Aug 24**: first real automatic spread lock (hourly pg_cron →
  `lock-spreads`) — for **Week 0, the designated test week** (split from ESPN's merged
  week 1 on 2026-08-15; Week 1 proper starts Thu Sep 3, spreads lock Mon Aug 31). The
  server-side ESPN fetch has never run against a live week — Akamai may block it.
  Verify `slates.spreads_locked_at` got stamped / check function logs. Fallback
  exists: the commissioner's browser lazily locks on next visit.
- [ ] Auth flows with a fresh email: sign up → sign out → sign in → password reset
  (after P0 lands).
- [ ] Commissioner override walkthrough: "Entering picks for…" another member, before
  and after a (test) lock.
- [ ] First Saturday: confirm slate-wide lock at first kickoff behaves (picks freeze,
  scoreboard reveals all sheets).

## Mobile (Android-first, added 2026-08-15)

Apple review is slow, so mobile moved ahead on Android alone: the full pool model
(auth, pick sheet, scoreboard, standings, slate lock, commish override) was ported to
the Expo app and published as an **Android-only OTA update** on the `production`
channel (runtime 1.0.0 — reaches the published Play build on restart). **iOS status
(2026-08-23): the stripped account-free v1 build was rejected Aug 20 under Guideline
4.2 Minimum Functionality; resubmitting a new iOS build of the full pool app** (see
`mobile/store/SUBMISSION.md`). Until approved, **every update must pass
`--platform android`**, then one `--platform ios` update catches iOS up. User is
bug-hunting on their Android phone; expect mobile fix requests. Slate building stays
web-only by design.

**PWA fallback (2026-08-28):** the website (https://saturdaysweats.com) now installs to a home screen as
**Saturday Sweats** — standalone display, app-shell service worker, in-app
"Install app" button (native prompt on Android/Chromium, Share-sheet guide on
iOS). That gives iPhone members an app-like install today without waiting on
App Review, and it ships on the normal Render auto-deploy. No push
notifications (the app has never had them). See CLAUDE.md → Hosting → PWA.

## Already shipped (2026-08-15)

Email+password auth (magic link removed; legacy accounts migrate via "Forgot
password?"), slate-wide pick lock at first kickoff (server trigger + UI), commissioner
pick override with "Entering picks for…" selector. Deployed to Render + migration
`20260815090000` applied to prod.
