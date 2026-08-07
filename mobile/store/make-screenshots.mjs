// Generates Google Play store screenshots for CFB Pick'em at every required form factor.
//
//   node make-screenshots.mjs
//
// Requires: puppeteer-core + pngjs, and a static web export of the app:
//   cd mobile && npx expo export --platform web --output-dir web-build
//
// All output is 9:16 portrait (the app is portrait-locked) with the alpha channel
// stripped, because Play's asset validator wants 24-bit PNG without transparency.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';

const MOBILE = 'C:/Users/devuser/pickem/mobile';
const ROOT = `${MOBILE}/web-build`;
const OUT = `${MOBILE}/store/screenshots`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4180;

// css viewport x deviceScaleFactor = final pixel size.
// The iOS viewports are the real CSS sizes of those devices, so the render is
// exact rather than scaled.
const DEVICES = [
  { dir: 'android',       w: 360, h: 640,  dsf: 3 }, // -> 1080x1920  phone
  { dir: 'android-7in',   w: 540, h: 960,  dsf: 2 }, // -> 1080x1920  7" tablet
  { dir: 'android-10in',  w: 720, h: 1280, dsf: 2 }, // -> 1440x2560 10" tablet
  { dir: 'ios-6.5',       w: 414, h: 896,  dsf: 3 }, // -> 1242x2688  iPhone 11 Pro Max / XS Max
  { dir: 'ios-6.7',       w: 428, h: 926,  dsf: 3 }, // -> 1284x2778  iPhone 12/13 Pro Max, 14 Plus
  { dir: 'ipad-12.9',     w: 1024, h: 1366, dsf: 2 }, // -> 2048x2732 iPad Pro 12.9"
  { dir: 'ipad-13',       w: 1032, h: 1376, dsf: 2 }, // -> 2064x2752 iPad Pro 13" (M4)
];

// Optional substring filter: `node make-screenshots.mjs ios` renders only iOS sizes.
const FILTER = process.argv[2];
const TARGETS = FILTER ? DEVICES.filter((d) => d.dir.includes(FILTER)) : DEVICES;

// ---- seed a realistic set of picks -----------------------------------------
const season = JSON.parse(fs.readFileSync(`${MOBILE}/assets/games.json`, 'utf8'));
const wk = season.weeks[0];
const PICK_KEY = `cfb-pickem:picks:${season.season}:${wk.seasonType}:${wk.week}`;
const picks = {};
wk.games.forEach((g, i) => {
  if (i % 3 === 2) return;                   // leave a third unpicked -> partial meter
  const team = i % 2 === 0 ? g.away : g.home; // alternate for visual variety
  if (team?.id) picks[g.id] = team.id;
});
const PICK_VAL = JSON.stringify(picks);
console.log(`seeding ${Object.keys(picks).length} of ${wk.games.length} picks for ${wk.label}`);

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

// Real mouse click on the element whose trimmed text matches exactly.
async function clickText(page, text) {
  const box = await page.evaluate((t) => {
    for (const d of document.querySelectorAll('div')) {
      if (d.children.length === 0 && (d.innerText || '').trim() === t) {
        const r = d.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, text);
  if (!box) throw new Error(`could not find clickable text: ${text}`);
  await page.mouse.click(box.x, box.y);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1'] });

for (const d of TARGETS) {
  const dir = path.join(OUT, d.dir);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\n${d.dir}  (css ${d.w}x${d.h} @${d.dsf}x -> ${d.w * d.dsf}x${d.h * d.dsf})`);

  const page = await browser.newPage();
  await page.setViewport({ width: d.w, height: d.h, deviceScaleFactor: d.dsf });
  await page.evaluateOnNewDocument((k, v) => { localStorage.setItem(k, v); }, PICK_KEY, PICK_VAL);
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000); // let ESPN team logos settle

  // 1 - My Picks, top of the list
  await shoot(page, path.join(dir, '1-picks.png'));

  // 2 - scrolled into the game list
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((x) => x.scrollHeight > x.clientHeight + 30);
    if (el) el.scrollTop = Math.round(el.clientHeight * 1.6);
  });
  await sleep(2500);
  await shoot(page, path.join(dir, '2-games.png'));

  // 3 - Results tab
  await clickText(page, 'Results');
  await sleep(4000);
  await shoot(page, path.join(dir, '3-results.png'));

  await page.close();
}

await browser.close();
server.close();
console.log('\ndone');
