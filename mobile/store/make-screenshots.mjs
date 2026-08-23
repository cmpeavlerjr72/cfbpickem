// Generates App Store / Google Play screenshots for CFB Pick'em at every
// required form factor, driving the REAL app (the full pool app: accounts,
// leagues, commissioner slate, scoreboard, standings) against the live
// Supabase backend.
//
//   cd mobile
//   npx expo export --platform web --output-dir web-build
//   DEMO_PASSWORD='...' node store/make-screenshots.mjs [deviceFilter]
//
// Requires: puppeteer-core + pngjs (devDependencies of mobile/) and Chrome.
//
// It signs in as the two seeded demo accounts (data/seed-demo-league.mjs):
//   - demo.hannah@…  a regular member with a complete Week 0 sheet  -> shot 1
//   - applereview@…  the commissioner of "Pick'em Demo League"      -> shots 2-5
// The reviewer account must keep an EMPTY pick sheet (App Review makes their
// own picks), so this script never touches the My Picks tab while signed in
// as them — picks autosave straight to the database.
//
// Each account is signed in ONCE; localStorage (which is what AsyncStorage
// uses under react-native-web, session token included) is snapshotted and
// replayed into every later page via evaluateOnNewDocument, so the device
// loop costs no extra Supabase auth calls.
//
// All output is portrait with the alpha channel stripped, because Play's
// asset validator wants 24-bit PNG without transparency.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';

const MOBILE = 'C:/Users/devuser/pickem/mobile';
const ROOT = `${MOBILE}/web-build`;
const OUT = `${MOBILE}/store/screenshots`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;

const REVIEWER_EMAIL = 'applereview@pattersonspickem.com';
const MEMBER_EMAIL = 'demo.hannah@pattersonspickem.com';
const PASSWORD = process.env.DEMO_PASSWORD;

// Store listings are shot in ET so kickoff times read like the real season.
const TIMEZONE = 'America/New_York';

// Files this script used to produce, before the app grew accounts/leagues.
const STALE = ['2-games.png', '3-results.png'];

if (!PASSWORD) {
  console.error('DEMO_PASSWORD is not set — export it before running (never hardcode it).');
  process.exit(1);
}
if (!fs.existsSync(`${ROOT}/index.html`)) {
  console.error(`no web export at ${ROOT} — run: npx expo export --platform web --output-dir web-build`);
  process.exit(1);
}

// css viewport x deviceScaleFactor = final pixel size.
// The iOS viewports are the real CSS sizes of those devices, so the render is
// exact rather than scaled. The iPad sizes are retired: app.json now sets
// ios.supportsTablet = false, so the build is iPhone-only and Apple no longer
// asks for iPad assets (the old screenshots/ipad-* folders are left alone).
const DEVICES = [
  { dir: 'android',       w: 360, h: 640,  dsf: 3 }, // -> 1080x1920  phone
  { dir: 'android-7in',   w: 540, h: 960,  dsf: 2 }, // -> 1080x1920  7" tablet
  { dir: 'android-10in',  w: 720, h: 1280, dsf: 2 }, // -> 1440x2560 10" tablet
  { dir: 'ios-6.5',       w: 414, h: 896,  dsf: 3 }, // -> 1242x2688  iPhone 11 Pro Max / XS Max
  { dir: 'ios-6.7',       w: 428, h: 926,  dsf: 3 }, // -> 1284x2778  iPhone 12/13 Pro Max, 14 Plus
];

// Optional substring filter: `node store/make-screenshots.mjs ios` renders only iOS sizes.
const FILTER = process.argv[2];
const TARGETS = FILTER ? DEVICES.filter((d) => d.dir.includes(FILTER)) : DEVICES;
if (TARGETS.length === 0) {
  console.error(`no device matches "${FILTER}" — known: ${DEVICES.map((d) => d.dir).join(', ')}`);
  process.exit(1);
}

// ---- static server ----------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(ROOT, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Screenshot, then re-encode as RGB (drop alpha) so Play's validator is happy.
async function shoot(page, file) {
  const buf = await page.screenshot({ type: 'png' });
  const png = PNG.sync.read(buf);
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 2 }));
  const v = PNG.sync.read(fs.readFileSync(file));
  console.log(`  ${path.basename(path.dirname(file))}/${path.basename(file)}  ${v.width}x${v.height}`);
}

// Real mouse click on the smallest visible element whose trimmed text matches
// exactly. react-native-web renders <Text> as a leaf <div>, so an exact match
// on a childless div is the reliable handle for tabs/buttons.
async function clickText(page, text, { pick = 'first' } = {}) {
  const box = await page.evaluate(
    (t, which) => {
      const hits = [];
      for (const el of document.querySelectorAll('div')) {
        if (el.childElementCount !== 0) continue;
        if ((el.innerText || '').trim() !== t) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        hits.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y });
      }
      if (hits.length === 0) return null;
      hits.sort((a, b) => a.top - b.top);
      return which === 'last' ? hits[hits.length - 1] : hits[0];
    },
    text,
    pick,
  );
  if (!box) throw new Error(`could not find clickable text: ${text}`);
  await page.mouse.click(box.x, box.y);
}

const hasText = (page, needle) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 60000 }, needle);
const lacksText = (page, needle) =>
  page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout: 60000 }, needle);

/**
 * Scroll the app's main vertical ScrollView (the biggest overflowing div) so
 * the element containing `needle` sits `pad` px below the top — device-height
 * independent, so no size ends up with a card sliced in half at the top edge.
 */
async function scrollToText(page, needle, pad = 23) {
  const ok = await page.evaluate(
    (t, padding) => {
      const scrollers = [...document.querySelectorAll('div')].filter(
        (el) => el.scrollHeight > el.clientHeight + 30 && el.clientHeight > 120,
      );
      scrollers.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
      const sc = scrollers[0];
      if (!sc) return false;
      const target = [...sc.querySelectorAll('div')].find(
        (el) => el.childElementCount === 0 && (el.innerText || '').includes(t),
      );
      if (!target) return false;
      sc.scrollTop += target.getBoundingClientRect().top - sc.getBoundingClientRect().top - padding;
      return true;
    },
    needle,
    pad,
  );
  if (!ok) console.warn(`  (could not scroll to "${needle}")`);
}

async function newPage(browser, device, storage) {
  const page = await browser.newPage();
  await page.setViewport({ width: device.w, height: device.h, deviceScaleFactor: device.dsf });
  await page.emulateTimezone(TIMEZONE);
  // Every tab shares one origin's localStorage, so wipe it first: otherwise
  // the second account's page boots into the first account's session.
  await page.evaluateOnNewDocument((json) => {
    try {
      localStorage.clear();
      if (json) for (const [k, v] of Object.entries(JSON.parse(json))) localStorage.setItem(k, v);
    } catch {}
  }, storage);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
  return page;
}

/** Sign in on a fresh page and hand back a localStorage snapshot to replay. */
async function captureSession(browser, email) {
  const page = await newPage(browser, { w: 414, h: 896, dsf: 1 }, null);
  await page.waitForSelector('input[type="password"]', { timeout: 60000 });
  await page.type('input[placeholder="you@example.com"]', email, { delay: 10 });
  await page.type('input[type="password"]', PASSWORD, { delay: 10 });
  await page.keyboard.press('Enter'); // TextInput onSubmitEditing
  try {
    await hasText(page, 'My Picks');
  } catch {
    // Enter didn't take — fall back to the submit button (the LAST "Sign in",
    // the first being the sign-in/create-account toggle).
    await clickText(page, 'Sign in', { pick: 'last' });
    await hasText(page, 'My Picks');
  }
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  await page.close();
  console.log(`signed in: ${email}`);
  return storage;
}

// ---- go ---------------------------------------------------------------------
// --disable-web-security lets the bundle's direct Kalshi call through (native
// fetch has no CORS, browsers do), so cover odds render the way they do on a
// real device. It needs its own profile directory.
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickem-shots-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--force-device-scale-factor=1',
    '--disable-web-security',
    `--user-data-dir=${profileDir}`,
  ],
});

try {
  const memberSession = await captureSession(browser, MEMBER_EMAIL);
  const reviewerSession = await captureSession(browser, REVIEWER_EMAIL);

  for (const d of TARGETS) {
    const dir = path.join(OUT, d.dir);
    fs.mkdirSync(dir, { recursive: true });
    for (const old of STALE) fs.rmSync(path.join(dir, old), { force: true });
    console.log(`\n${d.dir}  (css ${d.w}x${d.h} @${d.dsf}x -> ${d.w * d.dsf}x${d.h * d.dsf})`);

    // --- 1: a member's completed pick sheet ---------------------------------
    const member = await newPage(browser, d, memberSession);
    await hasText(member, 'My Picks');
    // The "N of M picks" bar only renders once the published slate has loaded.
    await member.waitForFunction(() => /\d+ of \d+ picks/.test(document.body.innerText), {
      timeout: 60000,
    });
    await sleep(6000); // ESPN logos + live lines + Kalshi odds
    await shoot(member, path.join(dir, '1-picks.png'));
    await member.close();

    // --- 2-5: the commissioner's view ---------------------------------------
    const commish = await newPage(browser, d, reviewerSession);
    await hasText(commish, 'Slate'); // commissioner-only tab == roles resolved
    await sleep(6000);

    // NB: never click a game on My Picks here — this account's sheet must stay
    // empty for App Review, and picks autosave to Supabase.
    await clickText(commish, 'Scoreboard');
    await hasText(commish, 'picks in');
    await sleep(5000);
    await shoot(commish, path.join(dir, '2-scoreboard.png'));

    await clickText(commish, 'Slate');
    await hasText(commish, 'Pool settings');
    await sleep(3000);
    // Park the "<week> slate · N games" card at the top: the settings card
    // above it scrolls away cleanly and the picked games fill the shot.
    await scrollToText(commish, 'slate · ');
    await sleep(1500);
    await shoot(commish, path.join(dir, '3-slate.png'));

    await clickText(commish, 'Standings');
    await lacksText(commish, 'Loading standings');
    await sleep(2500);
    await shoot(commish, path.join(dir, '5-standings.png'));

    await clickText(commish, 'Leagues');
    await hasText(commish, 'Your leagues');
    await sleep(2000);
    await shoot(commish, path.join(dir, '4-leagues.png'));

    await commish.close();
  }
} finally {
  await browser.close();
  server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log('\ndone');
