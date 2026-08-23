# Submission Checklist — CFB Pick'em

## Resubmission after 4.2 rejection (Aug 2026)

Apple rejected the v1.0 build 1 iOS submission on **Aug 20, 2026** under **Guideline 4.2
Minimum Functionality**. That build was a deliberately stripped "v1" — account-free,
local-only pick tracker — and read to the reviewer as too thin (basically a notes app for
picks). It was never a fair test of the product: by the time of review, `main` already had
the full pool model (accounts, multi-league dashboard, commissioner slate builder,
slate-wide locks, commissioner override, live scoreboard, standings), which had already
shipped to Android via OTA. We're resubmitting a **new iOS build of the full app**, not a
patch to the rejected one.

What's changing for this submission:

- **New iOS build from `main`** — the current full pool app, not the old v1 code path.
  ```
  cd mobile
  eas build --platform ios --profile production
  eas submit --platform ios --latest
  ```
  The previous build is still attached to the in-review 1.0 version in App Store Connect,
  so before submitting the new one: open App Store Connect → the app → the version in
  "Waiting for Review"/"Rejected" status → **Remove this version from review** (or, if it's
  already rejected, it should already be editable) → under Build, **select the new build**
  once `eas submit` finishes processing it → **Submit for Review** again referencing the
  updated review notes below. Do this from the App Store Connect UI (Apple doesn't expose
  this as an API/CLI step).
- **`supportsTablet: false`** in `mobile/app.json` — Apple reviewed on an iPad Air; the app
  has no tablet-optimized layout, so iPhone-only avoids a second rejection reason for that
  screen size. See the rationale + iPad screenshot note in `LISTINGS.md`.
- **Seed the demo league** before the reviewer account is used. Run from the repo root
  (never commit the password):
  ```
  DB_URL=... DEMO_PASSWORD=... node data/seed-demo-league.mjs
  ```
  This creates league "Pick'em Demo League" (invite code `REVIEW`), commissioner account
  `applereview@pattersonspickem.com` (display name "App Reviewer"), members Hannah/Marcus/
  Priya with Week 0 picks already entered, and publishes Week 0 (Aug 29–30) and Week 1
  (Sep 3–5) slates.
- **Review notes**: copy the "Review notes" block from `LISTINGS.md` into App Store
  Connect's App Review Notes field, filling in `<<DEMO_EMAIL>>` /
  `<<DEMO_PASSWORD>>` with the seeded commissioner credentials (never commit the filled-in
  version — paste directly into App Store Connect).
- **App Privacy answers**: update the nutrition-label questions in App Store Connect to
  match the new "App Privacy (nutrition label)" subsection in `LISTINGS.md` — Email
  Address, Name, and User Content are now collected (all linked to the user); no
  tracking, no ads, no third-party analytics. The old "Data Not Collected" answer no
  longer applies.
- **Screenshots**: if `store/screenshots/ios/` still shows the old account-free UI
  (a bare pick sheet with no sign-in/league chrome), regenerate them against the full app
  — Dashboard, Picks, Board, Standings. Since `supportsTablet` is now false, no iPad
  screenshots are needed.

## 0. One-time values — DONE

- [x] App name: **CFB Pick'em** (`app.json` → `expo.name`). Change only if the App Store
      Connect name is taken; keep `app.json` in sync with whatever you register.
- [x] Bundle identifier: **`com.cfbpickem.app`** — set for both iOS `bundleIdentifier` and
      Android `package`. **Permanent now that a build exists.**
- [x] Contact email: `cmpeavlerjr@gmail.com`. Swap it for a dedicated address if you'd
      rather not publish a personal inbox.
- [x] Policy pages are **live on Render**, both verified returning 200:
      - Privacy Policy — `https://pattersonpickem.onrender.com/privacy.html`
      - Support — `https://pattersonpickem.onrender.com/support.html`

      Source of truth is `web/public/privacy.html` and `web/public/support.html` in the
      monorepo (github.com/cmpeavlerjr72/cfbpickem, Render root dir `web`). Vite copies
      `public/` verbatim into `dist/`, so they serve as real static files — no SPA rewrite
      needed and store crawlers get plain HTML.

      ⚠️ `mobile/store/privacy-policy.html` is a **stale duplicate** and now just points at
      the hosted page. Edit `web/public/privacy.html` and redeploy; don't edit the mobile
      copy.

## 1. EAS project setup — DONE

Project is created and linked: **`@cmpeavlerjr72/cfb-pickem`**
(projectId `eaf41eb9-4aea-419b-950f-b16acf0f7a5a`) —
https://expo.dev/accounts/cmpeavlerjr72/projects/cfb-pickem

`eas update:configure` has run: `expo-updates` is installed, the `production` channel and
branch exist, and `runtimeVersion` uses the `appVersion` policy. Post-approval JS-only
changes ship with `eas update --channel production` and never go through store review —
**but see the standing rule in CLAUDE.md: every update must pass `--platform android`
until Apple approves this resubmission**, then one `--platform ios` update catches iOS up.

Note `eas.json` sets `appVersionSource: "remote"`, so EAS owns `versionCode`/`buildNumber`
and auto-increments each production build. The values in `app.json` are ignored.

## 2. Build

**Android — handled.** Ran non-interactively; EAS generated and stores the upload keystore
(`eas credentials` to view it). Artifact is a signed `.aab` ready for Play Console, and the
full pool model already ships to it via Android-only OTA updates (see CLAUDE.md).

```
eas build --platform android --profile production
```

**iOS — YOU must run this.** It requires authenticating to your Apple Developer account:
Apple ID, password, and a 2FA code sent to your device. That prompt can't be automated.
This is the resubmission build described above — make sure `mobile/app.json` has
`supportsTablet: false` and the demo league is seeded before submitting.

```
cd mobile
npx eas-cli build --platform ios --profile production
```

Answer **yes** when it offers to create/manage the signing cert and provisioning profile —
EAS handles the whole certificate dance for you after login. Everything else about the iOS
build is already configured; login is the only manual part.

## 3. Store records

- [ ] **App Store Connect**: On the existing app record, remove the rejected version from
      review (if not already editable), attach the new build, and update the listing from
      `store/LISTINGS.md` — description, subtitle, keywords, promotional text, upload
      refreshed `store/screenshots/ios/`, set App Privacy to the new answers (Email
      Address / Name / User Content, all linked; no tracking, no ads, no third-party
      analytics), paste the updated review notes with credentials filled in, confirm the
      privacy policy URL.
- [ ] **Play Console**: Create the app (if not already created), fill in listing from
      `store/LISTINGS.md`, upload `store/screenshots/android/` + feature graphic + 512
      icon, complete Data safety (Email/Name/User Content, linked to user; no ads, no
      tracking) and content rating questionnaires, set privacy policy URL.

## 4. Submit

```
eas submit --platform ios --latest      # uploads to App Store Connect / TestFlight
eas submit --platform android --latest  # uploads to a Play Console track
```

- iOS: in App Store Connect, attach the new build to the version, fill in the updated
  listing/review notes/App Privacy answers above, and Submit for Review.
  (`ITSAppUsesNonExemptEncryption` is already set false, so no export-compliance prompt.)
- Android: institutional accounts aren't subject to the personal-account 14-day closed-test
  requirement — you can go straight to production, but a small closed track for a day or two
  is still a sane smoke test. Then promote to production (staged rollout is fine).

## 5. After approval — the iterate loop

- JS-only changes (UI, pick logic, new screens): `eas update --channel production` — live in
  minutes, no review. Keep passing `--platform android` only until the iOS resubmission is
  approved; then one `--platform ios` update catches iOS up, and after that ship both
  platforms together as usual.
- Anything touching native modules/permissions (push notifications, new SDK): bump
  `version`, rebuild (`eas build`), resubmit — routine update review.
- Keep the web app in lockstep per the CLAUDE.md parity rule.

## Known risks / judgment calls (read once before submitting)

- **4.2 re-rejection risk**: the fix here is showing Apple the real, full-featured app
  instead of the stripped v1. The review notes in `LISTINGS.md` walk the reviewer through
  the league/commissioner/board/standings flow explicitly so the group functionality is
  obvious in the first few taps — keep them in the submission, and keep the demo league's
  Week 0 picks populated so the Board tab isn't empty.
- **Team logos & schedule data** come from ESPN's public-but-unofficial endpoints, and team
  marks are university trademarks. Fan pick'em apps do this routinely and it rarely surfaces
  in app review, but it is unlicensed use — the conservative alternative is shipping
  school-color circles + abbreviations instead of logos. Your call; the app works either way.
- **Unofficial API**: if ESPN changes the endpoint, scores stop updating until we ship an
  OTA fix (once iOS is approved — Android-only until then). Low risk mid-season, and the
  app degrades gracefully (cached results keep working; schedule is bundled).
- **Demo account access**: the reviewer signs in as the demo league's commissioner, so they
  can also exercise "Entering picks for…" on behalf of other members and see the Slate
  Builder — make sure that account's password stays known/valid for the review window and
  isn't rotated mid-review.
- **Name collision**: "CFB Pick'em" may be taken in App Store Connect — have a fallback
  ready (see LISTINGS.md) and keep `app.json` name in sync with whatever you register.
