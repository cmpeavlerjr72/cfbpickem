#!/usr/bin/env node
/**
 * Generate the "Saturday Sweats" PWA icon set into web/public/icons/.
 *
 * The repo has no brand logo (public/favicon.svg is still the Vite starter
 * mark), so the icon is authored here as vector source: the app's navy header
 * colour as the field, a tilted football, and the same mint-green bar the
 * header uses to underline the active tab. Palette tokens are the ones in
 * src/index.css — keep them in sync if the theme moves.
 *
 * Rendering is a headless Edge/Chrome screenshot of a square page, so there is
 * no `sharp`/`canvas` native dependency to install or keep alive on Render.
 * The PNGs are committed; this script only runs when the mark changes.
 *
 * Usage:  node scripts/make-pwa-icons.mjs
 *         PWA_ICON_BROWSER="C:/path/to/chrome.exe" node scripts/make-pwa-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');

/** src/index.css: --navy, --navy-light, --green-border. */
const NAVY = '#0f2440';
const NAVY_LIGHT = '#1b3a63';
const MINT = '#86efac';
const BALL = '#f8fafc';

/**
 * The mark, on a 512 grid. `scale` shrinks the artwork about the centre for
 * the maskable variant, which must survive Android cropping the icon to a
 * circle inscribed in the middle 80%.
 */
function markSvg(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NAVY_LIGHT}"/>
      <stop offset="1" stop-color="${NAVY}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#field)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <g transform="translate(256 228) rotate(-15)">
      <!-- Football: cubic tips so the profile is full in the middle and
           pointed at the ends — a quadratic vesica reads as an eye. -->
      <path d="M-140 0 C-105 -118 105 -118 140 0 C105 118 -105 118 -140 0 Z" fill="${BALL}"/>
      <g stroke="${NAVY}" stroke-linecap="round" fill="none">
        <!-- End stripes: the give-away that this is a ball, not a lens. -->
        <path d="M-92 -58 Q-101 0 -92 58" stroke-width="9"/>
        <path d="M92 -58 Q101 0 92 58" stroke-width="9"/>
        <!-- Seam + laces. -->
        <path d="M-58 0 H58" stroke-width="11"/>
        <g stroke-width="10">
          <path d="M-46 -18 V18"/>
          <path d="M-23 -21 V21"/>
          <path d="M0 -21 V21"/>
          <path d="M23 -21 V21"/>
          <path d="M46 -18 V18"/>
        </g>
      </g>
    </g>
    <!-- The active-tab underline from the app header, as a plinth. -->
    <rect x="171" y="378" width="170" height="22" rx="11" fill="${MINT}"/>
  </g>
</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-512-maskable.png', size: 512, scale: 0.7 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
];

const CANDIDATES = [
  process.env.PWA_ICON_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) throw new Error(`No headless browser found. Tried:\n${CANDIDATES.join('\n')}`);

const work = mkdtempSync(path.join(tmpdir(), 'satsweats-icons-'));
mkdirSync(OUT_DIR, { recursive: true });

for (const { file, size, scale } of TARGETS) {
  const svg = markSvg(scale).replace('width="512" height="512"', `width="${size}" height="${size}"`);
  const page = path.join(work, `${file}.html`);
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${NAVY};}svg{display:block;}</style>${svg}`,
  );

  const out = path.join(OUT_DIR, file);
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${size},${size}`,
      `--screenshot=${out}`,
      '--virtual-time-budget=3000',
      `file:///${page.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  );

  if (!existsSync(out)) throw new Error(`screenshot failed: ${file}`);
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}

rmSync(work, { recursive: true, force: true });
