# CFB Pick'em

A college football pick'em game with two clients: a website and a mobile app. Starting with CFB (2026 season); may later expand to NFL / CBB.

## Structure

- `web/` — website: Vite + React + TypeScript
- `mobile/` — mobile app: Expo (React Native) + TypeScript
- `data/` — season data pipeline (source of truth for game data)

## STANDING RULE: web/mobile parity

**Whenever a change is made to either the web app or the mobile app, check whether the same change needs to be made on the other, and make it in the same working session.** The two clients should always be at the same feature state. This applies to features, UI behavior, data-model changes, and business logic (pick rules, scoring, lock times). If a change genuinely applies to only one platform (e.g. a platform-specific fix), note why in the commit/summary.

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
