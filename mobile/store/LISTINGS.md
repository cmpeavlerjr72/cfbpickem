# Store Listing Copy

Working title everywhere: **CFB Pick'em** — check name availability in App Store
Connect when creating the app record; if taken, fallback ideas: "CFB Pick'em: College Picks",
"Gridiron Pick'em". Keep the binary's display name (`app.json` → `name`) matched to whatever
you land on.

## Apple App Store

- **Name** (30 chars max): `CFB Pick'em`
- **Subtitle** (30 chars max): `College football pick tracker`
- **Category**: Sports
- **Age rating**: answer "None" to every content question → 4+. (No gambling: there is no
  real money, no prizes, no contest entry anywhere in the app.)
- **Price**: Free. No in-app purchases.

**Promotional text** (170 chars, editable without review):

> The 2026 college football season is here. Make your picks for every FBS game and see how
> you stack up week after week.

**Description**:

> Pick the winner of every college football game, every week, all season long.
>
> CFB Pick'em is a simple, free pick tracker for the 2026 FBS season:
>
> • Every FBS game — all 900+ of them, from Week 1 kickoffs to conference championship week
> • Tap a team to pick them straight up — change your mind any time before kickoff
> • Picks lock automatically when the game starts
> • Live scores and automatic grading — your record updates as games go final
> • Week-by-week results and your season record at a glance
> • No account, no sign-up, no ads — your picks stay on your device
>
> How good are your gut calls? Prove it to yourself, one Saturday at a time.

- **Keywords** (100 chars): `college football,pickem,picks,CFB,football pool,predictions,NCAA football,score,schedule`
- **Support URL**: `https://pattersonpickem.onrender.com/support.html`
- **Privacy Policy URL**: `https://pattersonpickem.onrender.com/privacy.html`
- **App Privacy (nutrition labels)**: "Data Not Collected" — the app collects nothing.

**Review notes** (paste into App Review notes field):

> CFB Pick'em is a free game-prediction tracker for the 2026 college football season with no
> real-money component of any kind — no entry fees, no prizes, no gambling. There are no
> accounts; picks are stored locally on the device, so no demo login is needed.
>
> Note on timing: the 2026 season kicks off August 29. Before that date every game shows as
> upcoming and the Results tab shows a "nothing graded yet" state by design; once games are
> played, picks grade automatically from live scores. To exercise the full flow: open My
> Picks, tap teams to select them (tap again to unselect), switch weeks with the pills, and
> check the Results tab for the season record view.

## Google Play

- **App name** (30 chars): `CFB Pick'em`
- **Short description** (80 chars): `Pick every college football game, all season. Free, no account needed.`
- **Full description**: reuse the App Store description above.
- **Category**: Sports
- **Content rating questionnaire**: no violence, no gambling (no real money / prizes), no
  user-generated content, no data collection → Everyone.
- **Data safety form**: "No data collected, no data shared." App does not transmit any user
  or device data to the developer; the only network traffic is fetching public sports scores.
- **Ads**: No ads.
- **Target audience**: 18+ recommended (simplest path — avoids the children's-policy branch)
  or "13+" if you prefer; the app contains nothing age-sensitive either way.
- **Privacy Policy URL**: `https://pattersonpickem.onrender.com/privacy.html`

## Assets needed at submission time

- iOS screenshots: 6.9"/6.7" phone set (1290×2796 works for both) — generated set in
  `store/screenshots/ios/`. iPad set optional but recommended since `supportsTablet` is true —
  or set `supportsTablet: false` in app.json to skip iPad screenshots entirely.
- Play screenshots: min 2, 1080×2160 set in `store/screenshots/android/`.
- Play feature graphic: 1024×500 — `store/screenshots/feature-graphic.png`.
- App icon is shipped in the binary (Play also wants a 512×512 upload: `store/screenshots/play-icon-512.png`).
