# Store Listing Copy

Working title everywhere: **CFB Pick'em** — check name availability in App Store
Connect when creating the app record; if taken, fallback ideas: "CFB Pick'em: College Picks",
"Gridiron Pick'em". Keep the binary's display name (`app.json` → `name`) matched to whatever
you land on.

This is the full pool/league app: email+password accounts, a multi-league dashboard (join
by invite code or create a league), a commissioner slate builder, slate-wide pick locks at
first kickoff, a commissioner pick-override tool, live ESPN scoreboards, and weekly/season
standings. There is no account-free or local-only mode anymore — every copy block below
assumes accounts and leagues.

## Apple App Store

- **Name** (30 chars max): `CFB Pick'em`
- **Subtitle** (30 chars max): `Play pick'em with your league`
- **Category**: Sports
- **Age rating**: answer "None" to every content question → 4+. (No gambling: there is no
  real money, no prizes, no contest entry anywhere in the app. Any odds shown are
  informational context only — see the review notes below.)
- **Price**: Free. No in-app purchases.

**Promotional text** (170 chars, editable without review):

> Run a pick'em league with your friends. A commissioner sets the weekly slate, everyone
> picks before kickoff, and picks, live scores, and standings update automatically.

**Description**:

> CFB Pick'em turns picking college football winners into a weekly league with your
> friends — not just a solo tracker.
>
> • Create a league or join one with an invite code — one account, any number of leagues
> • The league commissioner builds the weekly slate (straight-up or against the spread)
> • Everyone makes their picks and a tiebreaker score before kickoff
> • The whole week locks the moment the first game kicks off — no late additions
> • Once locked, everyone's picks are revealed so you can see how you stack up
> • Live scores and automatic grading as games go final
> • Weekly winners and full season standings for the league
> • Point-spread and moneyline context is shown for information only — CFB Pick'em has
>   no wagering, entry fees, or prizes of any kind
>
> How good are your picks against your friends' picks? Start a league and find out, one
> Saturday at a time.

- **Keywords** (100 chars): `pickem,college football,league,friends,pool,CFB,NCAA football,picks,standings,scores`
- **Support URL**: `https://pattersonpickem.onrender.com/support.html`
- **Privacy Policy URL**: `https://pattersonpickem.onrender.com/privacy.html`

**App Privacy (nutrition label)** — the app now has accounts and shared league data, so
declare data collection (no longer "Data Not Collected"):

- **Email Address** — collected for account creation/sign-in; linked to the user.
- **Name** — the display name shown to league members; linked to the user.
- **User Content** — picks and tiebreaker guesses; linked to the user (visible to other
  members of the same league after that week's lock, and to the league commissioner).
- Not used for tracking (no cross-app/cross-site tracking, no data linked to third-party
  advertising).
- No advertising data collected; no ads in the app.
- No third-party analytics SDKs.
- Data is used for App Functionality only (running the league) — not shared with third
  parties for their own marketing.

**Review notes** (paste into App Review notes field):

> CFB Pick'em is a group pick'em game for college football, built around leagues rather
> than solo tracking: a league commissioner picks the week's games (straight up or against
> the spread), every member of the league makes their own picks before kickoff, and once
> the week locks everyone's picks are revealed so the league can compare and compete on a
> standings board. There is no real-money component of any kind — no entry fees, no
> prizes, no gambling; any point-spread or moneyline numbers shown are informational
> context only, with no wagering of any kind.
>
> A demo league is seeded for review:
>
> 1. Sign in with the demo account — email `<<DEMO_EMAIL>>`, password `<<DEMO_PASSWORD>>`.
>    This account is the commissioner of the demo league.
> 2. You'll land on the league Dashboard. Tap **"Pick'em Demo League"** to enter it.
> 3. Use the **Week 0** pill to select the demo/test week.
> 4. On the **My Picks** tab, tap a team on each game and enter a tiebreaker score —
>    picks save automatically. Because this account is the league commissioner, the "Entering picks for…"
>    selector at the top of the My Picks tab also lets you enter or adjust picks on behalf of
>    another member (Hannah, Marcus, or Priya) — this is how commissioners help members
>    who text in picks late.
> 5. The **Slate** tab shows the commissioner's slate builder — the tool used to choose
>    each week's games and (for ATS play) spreads.
> 6. The **Scoreboard** tab shows everyone's picks once the week locks (at the first game's
>    kickoff) plus live scores once games are underway; before lock, opponents' picks stay
>    hidden except to the commissioner.
> 7. The **Standings** tab shows weekly winners and season-long standings for the league.
> 8. **Account deletion (Guideline 5.1.1(v))** is in the app: tap **Leagues** in the header
>    to return to the Dashboard, scroll to the account settings at the bottom, and tap
>    **Delete account** (a confirmation alert follows). Please do **not** delete the demo
>    commissioner account — sign up for a second throwaway account and delete that one to
>    test the flow, otherwise the demo league above becomes unavailable for the rest of the
>    review.
>
> To see the join/create flow from a second account: sign up for a new account, then from
> the Dashboard either create a new league or join the demo league with invite code
> `REVIEW`.

## Google Play

- **App name** (30 chars): `CFB Pick'em`
- **Short description** (80 chars): `Run a pick'em league with friends. Free — no entry fees, no gambling.`
- **Full description**: reuse the App Store description above.
- **Category**: Sports
- **Content rating questionnaire**: no violence, no gambling (no real money / prizes), no
  open/public user-generated content (league picks and display names are only visible to
  that league's members), accounts required → Everyone.
- **Data safety form**: collects Email Address (account management), Name (display name),
  and User Content (picks/tiebreaker), all linked to the user account. Not shared with
  third parties for their own use. No data used for advertising or tracking. Data is
  encrypted in transit; users can delete their account and data in-app (Dashboard →
  account settings → Delete account) or request deletion via the support email.
- **Ads**: No ads.
- **Target audience**: 18+ recommended (simplest path — avoids the children's-policy branch)
  or "13+" if you prefer; the app contains nothing age-sensitive either way.
- **Privacy Policy URL**: `https://pattersonpickem.onrender.com/privacy.html`

## Assets needed at submission time

- iOS screenshots: 6.9"/6.7" phone set (1290×2796 works for both) — generated set in
  `store/screenshots/ios/`. `supportsTablet` is now `false`, so **no iPad screenshots are
  needed or accepted**. Regenerate the phone set if the existing screenshots still show
  the old account-free UI — they need to show the Dashboard, Picks, Board, and Standings
  tabs of the full app.
- Play screenshots: min 2, 1080×2160 set in `store/screenshots/android/`.
- Play feature graphic: 1024×500 — `store/screenshots/feature-graphic.png`.
- App icon is shipped in the binary (Play also wants a 512×512 upload: `store/screenshots/play-icon-512.png`).
