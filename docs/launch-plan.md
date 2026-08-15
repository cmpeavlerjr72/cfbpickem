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

Steps (owner in brackets):

1. [user] Buy a domain (~$10/yr — Porkbun/Cloudflare/Namecheap). Needed because
   Resend requires a verified domain; sending from a gmail address via any relay has
   deliverability problems. (Bonus: Render can serve the site on it for free later.)
2. [user] Sign up at resend.com (free: 3,000 emails/mo, 100/day — plenty).
3. [user] Resend → Domains → Add domain → add the 3 DNS records at the registrar →
   wait for verification (usually minutes).
4. [user] Create a Resend API key, hand it to Claude.
5. [claude] Configure SMTP on the Supabase project (host `smtp.resend.com`, port 587,
   user `resend`, password = API key, sender `noreply@<domain>`) — via
   `supabase/config.toml` `[auth.email.smtp]` with `env()` secret substitution +
   `supabase config push` (needs `SUPABASE_ACCESS_TOKEN`; see session memory — creds
   stay out of the repo). Dashboard alternative: Project Settings → Authentication →
   SMTP.
6. [claude] Raise `[auth.rate_limit] email_sent` from 2/hour to ~30/hour and push.
7. [user+claude] End-to-end test: password reset to a real mailbox, check it's not in
   spam.
8. [user] Only after 7 passes: announce to legacy members that "Forgot password?" sets
   their password.

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

## Pre-launch checks (week of Aug 24)

- [ ] **Mon Aug 24**: first real automatic spread lock (hourly pg_cron →
  `lock-spreads`). Its server-side ESPN fetch has never run against a live week —
  Akamai may block it. Verify `slates.spreads_locked_at` got stamped / check function
  logs. Fallback exists: the commissioner's browser lazily locks on next visit.
- [ ] Auth flows with a fresh email: sign up → sign out → sign in → password reset
  (after P0 lands).
- [ ] Commissioner override walkthrough: "Entering picks for…" another member, before
  and after a (test) lock.
- [ ] First Saturday: confirm slate-wide lock at first kickoff behaves (picks freeze,
  scoreboard reveals all sheets).

## Already shipped (2026-08-15)

Email+password auth (magic link removed; legacy accounts migrate via "Forgot
password?"), slate-wide pick lock at first kickoff (server trigger + UI), commissioner
pick override with "Entering picks for…" selector. Deployed to Render + migration
`20260815090000` applied to prod.
