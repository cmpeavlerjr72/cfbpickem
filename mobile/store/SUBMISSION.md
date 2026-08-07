# Submission Checklist — CFB Pick'em v1.0

The app code is submission-ready. Everything below is either a value only you can supply
(marked **YOU**) or a command to run. Work top to bottom.

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

      ⚠️ `mobile/store/privacy-policy.html` is now a **stale duplicate** of the hosted page.
      Edit `web/public/privacy.html` and redeploy; don't edit the mobile copy.

## 1. EAS project setup — DONE

Project is created and linked: **`@cmpeavlerjr72/cfb-pickem`**
(projectId `eaf41eb9-4aea-419b-950f-b16acf0f7a5a`) —
https://expo.dev/accounts/cmpeavlerjr72/projects/cfb-pickem

`eas update:configure` has run: `expo-updates` is installed, the `production` channel and
branch exist, and `runtimeVersion` uses the `appVersion` policy. Post-approval JS-only
changes ship with `eas update --channel production` and never go through store review.

Note `eas.json` sets `appVersionSource: "remote"`, so EAS owns `versionCode`/`buildNumber`
and auto-increments each production build. The values in `app.json` are ignored.

## 2. Build

**Android — handled.** Ran non-interactively; EAS generated and stores the upload keystore
(`eas credentials` to view it). Artifact is a signed `.aab` ready for Play Console.

```
eas build --platform android --profile production
```

**iOS — YOU must run this.** It requires authenticating to your Apple Developer account:
Apple ID, password, and a 2FA code sent to your device. That prompt can't be automated.

```
cd mobile
npx eas-cli build --platform ios --profile production
```

Answer **yes** when it offers to create/manage the signing cert and provisioning profile —
EAS handles the whole certificate dance for you after login. Everything else about the iOS
build is already configured; login is the only manual part.

## 3. Store records

- [ ] **App Store Connect**: Create the app (name, primary language, bundle ID from step 0,
      SKU can be `cfb-pickem-1`). Fill in listing from `store/LISTINGS.md`, upload
      `store/screenshots/ios/`, set privacy to **Data Not Collected**, paste the review
      notes, set the privacy policy URL.
- [ ] **Play Console**: Create the app, fill in listing from `store/LISTINGS.md`, upload
      `store/screenshots/android/` + feature graphic + 512 icon, complete Data safety
      (**no data collected/shared**) and content rating questionnaires, set privacy policy URL.

## 4. Submit

```
eas submit --platform ios --latest      # uploads to App Store Connect / TestFlight
eas submit --platform android --latest  # uploads to a Play Console track
```

- iOS: in App Store Connect, attach the build to the 1.0 version and Submit for Review.
  (`ITSAppUsesNonExemptEncryption` is already set false, so no export-compliance prompt.)
- Android: institutional accounts aren't subject to the personal-account 14-day closed-test
  requirement — you can go straight to production, but a small closed track for a day or two
  is still a sane smoke test. Then promote to production (staged rollout is fine).

## 5. After approval — the iterate loop

- JS-only changes (UI, pick logic, new screens): `eas update --channel production` — live in
  minutes, no review.
- Anything touching native modules/permissions (push notifications, new SDK): bump
  `version`, rebuild (`eas build`), resubmit — routine update review.
- Keep the web app in lockstep per the CLAUDE.md parity rule.

## Known risks / judgment calls (read once before submitting)

- **Team logos & schedule data** come from ESPN's public-but-unofficial endpoints, and team
  marks are university trademarks. Fan pick'em apps do this routinely and it rarely surfaces
  in app review, but it is unlicensed use — the conservative alternative is shipping
  school-color circles + abbreviations instead of logos. Your call; the app works either way.
- **Unofficial API**: if ESPN changes the endpoint, scores stop updating until we ship an
  OTA fix. Low risk mid-season, and the app degrades gracefully (cached results keep
  working; schedule is bundled).
- **Pre-season review**: reviewers will see an app full of upcoming games and an empty
  Results tab. The review notes in LISTINGS.md explain this explicitly — keep them in the
  submission.
- **Name collision**: "CFB Pick'em" may be taken in App Store Connect — have a fallback
  ready (see LISTINGS.md) and keep `app.json` name in sync with whatever you register.
