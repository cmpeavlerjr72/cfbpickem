// Copies the fetched season data into both app trees (minified) so web and
// mobile always bundle identical data. Run after fetch-games.mjs.
//
// Usage: node sync-to-apps.mjs [year]   (defaults to 2026)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const YEAR = process.argv[2] ? Number(process.argv[2]) : 2026;
const DATA_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DATA_DIR, '..');

const srcPath = join(DATA_DIR, `games-${YEAR}.json`);
if (!existsSync(srcPath)) {
  console.error(`Missing ${srcPath} — run fetch-games.mjs first.`);
  process.exit(1);
}
const minified = JSON.stringify(JSON.parse(readFileSync(srcPath, 'utf8')));

const targets = [
  join(ROOT, 'web', 'src', 'data', 'games.json'),
  join(ROOT, 'mobile', 'assets', 'games.json'),
];

for (const target of targets) {
  const dir = dirname(target);
  if (!existsSync(join(dir, '..'))) {
    console.log(`Skipping ${target} (app not scaffolded yet)`);
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, minified);
  console.log(`Wrote ${target} (${(minified.length / 1024).toFixed(0)} KB)`);
}
