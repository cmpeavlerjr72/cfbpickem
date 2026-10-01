// Asserts the TBD-kickoff rule and that the two copies of the ESPN
// normalizer agree: data/normalize-game.mjs (bundle, via fetch-games.mjs)
// and supabase/functions/refresh-games/normalize.ts (hourly DB refresh).
// Run after editing either:  node data/check-normalize.mjs   (Node >= 22.18
// imports the .ts directly via type stripping)

import assert from 'node:assert/strict';
import * as mjs from './normalize-game.mjs';
import * as ts from '../supabase/functions/refresh-games/normalize.ts';

const event = (date, timeValid, rank = 7) => ({
  id: '1',
  date,
  name: 'A at B',
  shortName: 'A @ B',
  week: { number: 6 },
  competitions: [
    {
      ...(timeValid === undefined ? {} : { timeValid }),
      competitors: [
        { homeAway: 'home', team: { id: '9', location: 'B' }, curatedRank: { current: rank } },
        { homeAway: 'away', team: { id: '8', location: 'A' }, curatedRank: { current: 99 } },
      ],
    },
  ],
});

const cases = [
  // EDT placeholder (midnight ET = 04:00Z) -> noon ET same day
  [event('2026-10-10T04:00Z', false), '2026-10-10T16:00Z', true],
  // EST placeholder (midnight ET = 05:00Z) -> noon ET same day
  [event('2026-11-14T05:00Z', false), '2026-11-14T17:00Z', true],
  // announced times pass through untouched (flag true or absent)
  [event('2026-10-10T19:30Z', true), '2026-10-10T19:30Z', false],
  [event('2026-10-10T04:00Z', undefined), '2026-10-10T04:00Z', false],
];

for (const impl of [mjs, ts]) {
  for (const [ev, date, tbd] of cases) {
    const g = impl.normalizeEvent(ev, 2);
    assert.equal(g.date, date);
    assert.equal(g.timeTbd, tbd);
    assert.equal(g.home.rank, 7);
    assert.equal(g.away.rank, null); // ranks > 25 dropped
  }
}
for (const [ev] of cases) assert.deepEqual(mjs.normalizeEvent(ev, 2), ts.normalizeEvent(ev, 2));
console.log(`OK — ${cases.length} cases, both normalizers agree`);
