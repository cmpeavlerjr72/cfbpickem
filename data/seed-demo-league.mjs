#!/usr/bin/env node
/**
 * Seed the "Pick'em Demo League" that Apple App Review signs into.
 *
 *   DB_URL='postgresql://...' DEMO_PASSWORD='...' node data/seed-demo-league.mjs
 *
 * DB_URL is the Supabase POOLER connection string (the direct db host is
 * IPv6-only and unreachable from the dev box — see CLAUDE.md):
 *
 *   postgresql://postgres.nczxyombguocejgurwop:<DB_PASSWORD>@aws-0-us-west-2.pooler.supabase.com:5432/postgres
 *
 * The password is never stored in this repo. Run once:
 *   cd data && npm install && cd ..
 *   DB_URL='...' DEMO_PASSWORD='...' node data/seed-demo-league.mjs
 *
 * What it creates (idempotent — re-running updates in place, never duplicates):
 *   - 4 confirmed email/password accounts in auth.users + auth.identities
 *   - profiles for each, a pool with invite code REVIEW, 4 memberships
 *   - published ATS slates for week 0 (8 games) and week 1 (10 games)
 *   - week 0 entries for 3 of the 4 players, week 1 entries for 2 of them
 *     (the reviewer has NO entries, so they can make their own picks)
 *
 * Everything runs in one transaction: it either all lands or none of it does.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));

const SEASON = 2026;
const SEASON_TYPE = 2;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// Fixed ids so the seed is reproducible. If an account already exists under
// one of the demo emails (with some other id) we reuse THAT id instead —
// these are only used when the row has to be created.
const POOL_ID = 'd0e9a5c2-0000-4000-8000-000000000000';

const ACCOUNTS = [
  {
    key: 'reviewer',
    id: 'd0e9a5c2-0000-4000-8000-000000000001',
    email: 'applereview@pattersonspickem.com',
    displayName: 'App Reviewer',
    isCommissioner: true,
  },
  {
    key: 'hannah',
    id: 'd0e9a5c2-0000-4000-8000-000000000002',
    email: 'demo.hannah@pattersonspickem.com',
    displayName: 'Hannah',
    isCommissioner: false,
  },
  {
    key: 'marcus',
    id: 'd0e9a5c2-0000-4000-8000-000000000003',
    email: 'demo.marcus@pattersonspickem.com',
    displayName: 'Marcus',
    isCommissioner: false,
  },
  {
    key: 'priya',
    id: 'd0e9a5c2-0000-4000-8000-000000000004',
    email: 'demo.priya@pattersonspickem.com',
    displayName: 'Priya',
    isCommissioner: false,
  },
];

const POOL = {
  name: "Pick'em Demo League",
  inviteCode: 'REVIEW',
  pickType: 'ats',
  slateSize: 8,
  pushPoints: 0.5,
};

// Week 0 slate — mirrors a real league's opening-weekend sheet. Spreads are
// home-POV (negative = home favored), exactly as slates.games stores them.
const WEEK0_GAMES = [
  { gameId: '401856766', homeSpread: -7.5, isTiebreaker: true },
  { gameId: '401864494', homeSpread: -38.5, isTiebreaker: false },
  { gameId: '401858202', homeSpread: -5.5, isTiebreaker: false },
  { gameId: '401864577', homeSpread: -7, isTiebreaker: false },
  { gameId: '401866408', homeSpread: -9.5, isTiebreaker: false },
  { gameId: '401858201', homeSpread: -5.5, isTiebreaker: false },
  { gameId: '401864570', homeSpread: -31.5, isTiebreaker: false },
  { gameId: '401862693', homeSpread: -5.5, isTiebreaker: false },
];

const WEEK1_SIZE = 10;

// ESPN conference ids for the power conferences (games-2026.json carries
// team.conferenceId, not a conference name).
const POWER_CONF_IDS = new Set(['1' /* ACC */, '4' /* Big 12 */, '5' /* Big Ten */, '8' /* SEC */]);
const MAJOR_NETWORKS = new Set(['ABC', 'CBS', 'NBC', 'FOX']);

// ---------------------------------------------------------------- helpers

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

/** ET calendar day of a kickoff, e.g. "2026-09-05". */
function etDay(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Deterministic, varied picks: each player gets a visibly different sheet
 * with a realistic home/away mix. Coprime-with-7 multipliers keep every
 * player off a degenerate all-home / all-away pattern.
 */
function pickSide(playerIndex, gameIndex) {
  return (gameIndex * 3 + playerIndex * 5 + 1) % 7 < 3 ? 'away' : 'home';
}

/**
 * Builds a parameterized INSERT column list, skipping any column the live
 * schema doesn't have. GoTrue's auth.users / auth.identities layout has
 * drifted across releases, so we only write columns that actually exist
 * rather than assuming one snapshot of the schema.
 */
class Cols {
  constructor(allowed, startIndex = 0) {
    this.allowed = allowed;
    this.names = [];
    this.exprs = [];
    this.values = [];
    this.offset = startIndex;
  }

  #param(value) {
    this.values.push(value);
    return `$${this.offset + this.values.length}`;
  }

  /** Plain parameterized value. */
  add(name, value) {
    if (!this.allowed.has(name)) return this;
    this.names.push(`"${name}"`);
    this.exprs.push(this.#param(value));
    return this;
  }

  /** SQL expression; call p(value) inside to bind a parameter. */
  addRaw(name, build) {
    if (!this.allowed.has(name)) return this;
    const sql = build((v) => this.#param(v));
    this.names.push(`"${name}"`);
    this.exprs.push(sql);
    return this;
  }

  has(name) {
    return this.allowed.has(name);
  }

  insert(qualifiedTable) {
    return `insert into ${qualifiedTable} (${this.names.join(', ')}) values (${this.exprs.join(', ')})`;
  }

  /** "col" = expr, ... — for UPDATE statements built the same way. */
  assignments() {
    return this.names.map((n, i) => `${n} = ${this.exprs[i]}`).join(', ');
  }
}

/** Writable (non-generated) column names of a table. */
async function writableColumns(db, schema, table) {
  const { rows } = await db.query(
    `select column_name
       from information_schema.columns
      where table_schema = $1
        and table_name = $2
        and is_generated <> 'ALWAYS'
        and identity_generation is null`,
    [schema, table],
  );
  if (rows.length === 0) die(`table ${schema}.${table} not found — is DB_URL pointing at the right project?`);
  return new Set(rows.map((r) => r.column_name));
}

async function columnType(db, schema, table, column) {
  const { rows } = await db.query(
    `select data_type from information_schema.columns
      where table_schema = $1 and table_name = $2 and column_name = $3`,
    [schema, table, column],
  );
  return rows[0]?.data_type ?? null;
}

/** Schema pgcrypto lives in (Supabase puts it in "extensions", not public). */
async function pgcryptoSchema(db) {
  const { rows } = await db.query(
    `select n.nspname from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pgcrypto'`,
  );
  if (rows.length === 0) die('pgcrypto is not installed — cannot hash the demo password');
  return rows[0].nspname;
}

// ------------------------------------------------------- slate assembly

function loadSeason() {
  const file = join(HERE, `games-${SEASON}.json`);
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    die(`could not read ${file}: ${err.message}`);
  }
  return data;
}

function weekGames(season, week) {
  const w = season.weeks.find((x) => x.week === week && x.seasonType === SEASON_TYPE);
  if (!w) die(`games-${SEASON}.json has no week ${week} (seasonType ${SEASON_TYPE})`);
  return w.games;
}

function buildWeek0(season) {
  const byId = new Map(weekGames(season, 0).map((g) => [g.id, g]));
  const missing = WEEK0_GAMES.filter((g) => !byId.has(g.gameId)).map((g) => g.gameId);
  if (missing.length > 0) {
    die(
      `week 0 slate references games that are not in week 0 of games-${SEASON}.json: ${missing.join(', ')}\n` +
        '  Re-run `node data/fetch-games.mjs 2026` or fix WEEK0_GAMES before seeding.',
    );
  }
  return { games: WEEK0_GAMES, labels: WEEK0_GAMES.map((g) => label(byId.get(g.gameId))) };
}

function label(g) {
  return `${g.away.abbrev} @ ${g.home.abbrev}`;
}

/**
 * Week 1: 10 marquee games, chosen deterministically from the Saturday
 * (Sep 5 ET) slate — the day with the real TV inventory (68 of week 1's 91
 * games). Ranking, in order:
 *   1. power-conference matchups first (both teams ACC/B1G/B12/SEC, then
 *      one, then neither),
 *   2. broadcast reach (ABC/CBS/NBC/FOX, then an ESPN/FOX-family cable net,
 *      then everything else),
 *   3. latest kickoff (primetime skews toward the featured games),
 *   4. game id, so ties never depend on JSON ordering.
 * Only 4 week-1 Saturday games are power-vs-power, hence the tiers rather
 * than a hard filter. The top-ranked game becomes the tiebreaker and leads
 * the array; the rest follow in kickoff order (the clients re-sort by
 * kickoff for display, so the order is cosmetic).
 */
function buildWeek1(season) {
  const games = weekGames(season, 1);
  const saturday = mostCommonDay(games);
  const candidates = games.filter((g) => etDay(g.date) === saturday);
  if (candidates.length < WEEK1_SIZE) {
    die(`only ${candidates.length} week 1 games on ${saturday} — need ${WEEK1_SIZE}`);
  }

  const powerRank = (g) =>
    2 - ((POWER_CONF_IDS.has(g.home.conferenceId) ? 1 : 0) + (POWER_CONF_IDS.has(g.away.conferenceId) ? 1 : 0));
  const tvRank = (g) => {
    const net = (g.broadcast ?? '').trim();
    if (MAJOR_NETWORKS.has(net)) return 0;
    if (/^(ESPN|ESPN2|FS1)$/.test(net)) return 1;
    return 2;
  };

  const ranked = candidates.slice().sort((a, b) =>
    powerRank(a) - powerRank(b) ||
    tvRank(a) - tvRank(b) ||
    b.date.localeCompare(a.date) ||
    a.id.localeCompare(b.id),
  );

  const chosen = ranked.slice(0, WEEK1_SIZE);
  const tiebreaker = chosen[0];
  const rest = chosen.slice(1).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const ordered = [tiebreaker, ...rest];

  return {
    // homeSpread 0 across the board: pre-lock the clients overlay live ESPN
    // lines for display, and the hourly lock-spreads cron freezes the real
    // numbers into the slate on Monday Aug 31 (Monday 00:00 ET of game week).
    games: ordered.map((g) => ({ gameId: g.id, homeSpread: 0, isTiebreaker: g.id === tiebreaker.id })),
    labels: ordered.map(label),
  };
}

function mostCommonDay(games) {
  const counts = new Map();
  for (const g of games) {
    const d = etDay(g.date);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

// ---------------------------------------------------------------- entries

/** Which players get an entry for which week, and their tiebreaker guesses. */
const ENTRY_PLAN = [
  { week: 0, key: 'hannah', tiebreaker: { home: 31, away: 20 } },
  { week: 0, key: 'marcus', tiebreaker: { home: 27, away: 24 } },
  { week: 0, key: 'priya', tiebreaker: { home: 24, away: 17 } },
  { week: 1, key: 'hannah', tiebreaker: { home: 34, away: 27 } },
  { week: 1, key: 'marcus', tiebreaker: { home: 28, away: 21 } },
  // Priya deliberately has no week 1 sheet (shows the "missing picks" state),
  // and the reviewer has none at all so they can enter their own.
];

function buildEntries(slates) {
  const order = ACCOUNTS.map((a) => a.key);
  const out = [];
  for (const plan of ENTRY_PLAN) {
    const slate = slates.get(plan.week);
    const playerIndex = order.indexOf(plan.key);
    const picks = {};
    slate.games.forEach((g, i) => {
      picks[g.gameId] = pickSide(playerIndex, i);
    });
    out.push({ ...plan, picks });
  }

  // Sanity: no two players in a week should end up with an identical sheet.
  for (const week of new Set(out.map((e) => e.week))) {
    const sheets = out.filter((e) => e.week === week).map((e) => JSON.stringify(e.picks));
    if (new Set(sheets).size !== sheets.length) {
      die(`week ${week} demo entries are not distinct — adjust pickSide()`);
    }
  }
  return out;
}

// ------------------------------------------------------------------- auth

/**
 * Create or refresh an email/password account straight in auth.users +
 * auth.identities. There is no service-role key on this box, so we use the
 * standard direct-insert pattern: bcrypt the password with pgcrypto, stamp
 * email_confirmed_at, and write empty strings (never NULL) into the token
 * columns — GoTrue scans those into non-nullable Go strings and a NULL makes
 * sign-in blow up with "converting NULL to string is unsupported".
 */
async function upsertAuthUser(db, ctx, account, password) {
  const { userCols, identityCols, identityIdType, crypto } = ctx;

  const existing = await db.query(`select id from auth.users where lower(email) = lower($1)`, [account.email]);
  const userId = existing.rows[0]?.id ?? account.id;
  const created = existing.rows.length === 0;

  const appMeta = JSON.stringify({ provider: 'email', providers: ['email'] });
  const emptyTokenCols = [
    'confirmation_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'email_change',
    'phone_change',
    'phone_change_token',
    'reauthentication_token',
  ];

  if (created) {
    const c = new Cols(userCols);
    c.add('instance_id', ZERO_UUID);
    c.add('id', userId);
    c.add('aud', 'authenticated');
    c.add('role', 'authenticated');
    c.add('email', account.email);
    c.addRaw('encrypted_password', (p) => `${crypto}.crypt(${p(password)}, ${crypto}.gen_salt('bf'))`);
    c.addRaw('email_confirmed_at', () => 'now()');
    c.addRaw('raw_app_meta_data', (p) => `${p(appMeta)}::jsonb`);
    c.addRaw('raw_user_meta_data', (p) => `${p('{}')}::jsonb`);
    c.addRaw('created_at', () => 'now()');
    c.addRaw('updated_at', () => 'now()');
    for (const col of emptyTokenCols) c.add(col, '');
    await db.query(c.insert('auth.users'), c.values);
  } else {
    const c = new Cols(userCols);
    c.addRaw('encrypted_password', (p) => `${crypto}.crypt(${p(password)}, ${crypto}.gen_salt('bf'))`);
    c.addRaw('email_confirmed_at', () => 'coalesce(email_confirmed_at, now())');
    c.add('aud', 'authenticated');
    c.add('role', 'authenticated');
    c.addRaw('raw_app_meta_data', (p) => `${p(appMeta)}::jsonb`);
    c.addRaw('updated_at', () => 'now()');
    for (const col of emptyTokenCols) {
      if (userCols.has(col)) c.addRaw(col, () => `coalesce("${col}", '')`);
    }
    // Make sure a previously disabled/soft-deleted demo account comes back.
    if (userCols.has('banned_until')) c.addRaw('banned_until', () => 'null');
    if (userCols.has('deleted_at')) c.addRaw('deleted_at', () => 'null');
    c.values.push(userId);
    await db.query(
      `update auth.users set ${c.assignments()} where id = $${c.values.length}`,
      c.values,
    );
  }

  // Matching email identity (GoTrue requires one to sign in with a password).
  const identityData = JSON.stringify({ sub: userId, email: account.email, email_verified: true });
  const haveIdentity = await db.query(
    `select 1 from auth.identities where user_id = $1 and provider = 'email'`,
    [userId],
  );

  if (haveIdentity.rows.length === 0) {
    const c = new Cols(identityCols);
    if (identityCols.has('id')) {
      // Modern GoTrue: uuid surrogate key. Older releases used the text user id.
      c.add('id', identityIdType === 'uuid' ? randomUuid() : userId);
    }
    c.add('user_id', userId);
    c.add('provider', 'email');
    c.add('provider_id', userId);
    c.addRaw('identity_data', (p) => `${p(identityData)}::jsonb`);
    c.addRaw('last_sign_in_at', () => 'now()');
    c.addRaw('created_at', () => 'now()');
    c.addRaw('updated_at', () => 'now()');
    await db.query(c.insert('auth.identities'), c.values);
  } else {
    const c = new Cols(identityCols);
    c.addRaw('identity_data', (p) => `${p(identityData)}::jsonb`);
    c.add('provider_id', userId);
    c.addRaw('updated_at', () => 'now()');
    c.values.push(userId);
    await db.query(
      `update auth.identities set ${c.assignments()} where user_id = $${c.values.length} and provider = 'email'`,
      c.values,
    );
  }

  return { id: userId, created };
}

function randomUuid() {
  return globalThis.crypto.randomUUID();
}

// -------------------------------------------------------------------- main

async function main() {
  const dbUrl = process.env.DB_URL;
  const password = process.env.DEMO_PASSWORD;

  if (!dbUrl) {
    die(
      'DB_URL is not set. Run:\n' +
        "    DB_URL='postgresql://postgres.nczxyombguocejgurwop:<DB_PASSWORD>@aws-0-us-west-2.pooler.supabase.com:5432/postgres' \\\n" +
        "      DEMO_PASSWORD='<pick one>' node data/seed-demo-league.mjs",
    );
  }
  if (!password) die("DEMO_PASSWORD is not set — it's the password all four demo accounts share.");
  if (password.length < 8) die('DEMO_PASSWORD must be at least 8 characters (Supabase Auth rejects shorter ones).');

  const season = loadSeason();
  const week0 = buildWeek0(season);
  const week1 = buildWeek1(season);
  const slates = new Map([
    [0, week0],
    [1, week1],
  ]);
  const entries = buildEntries(slates);

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await db.connect();
  } catch (err) {
    die(`could not connect to DB_URL: ${err.message}`);
  }

  try {
    await db.query('begin');

    const ctx = {
      userCols: await writableColumns(db, 'auth', 'users'),
      identityCols: await writableColumns(db, 'auth', 'identities'),
      identityIdType: await columnType(db, 'auth', 'identities', 'id'),
      crypto: await pgcryptoSchema(db),
    };

    // 1 + 2. Auth accounts and their profiles.
    const ids = new Map();
    const createdFlags = new Map();
    for (const account of ACCOUNTS) {
      const { id, created } = await upsertAuthUser(db, ctx, account, password);
      ids.set(account.key, id);
      createdFlags.set(account.key, created);
      await db.query(
        `insert into public.profiles (id, display_name) values ($1, $2)
         on conflict (id) do update set display_name = excluded.display_name`,
        [id, account.displayName],
      );
    }
    const reviewerId = ids.get('reviewer');

    // 3. The pool. Keyed on the invite code, so a re-run updates the existing
    //    league rather than failing on the unique index.
    const found = await db.query(`select id from public.pools where invite_code = $1`, [POOL.inviteCode]);
    const poolId = found.rows[0]?.id ?? POOL_ID;
    await db.query(
      `insert into public.pools (id, name, invite_code, slate_size, push_points, created_by, pick_type)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         name = excluded.name,
         invite_code = excluded.invite_code,
         slate_size = excluded.slate_size,
         push_points = excluded.push_points,
         created_by = excluded.created_by,
         pick_type = excluded.pick_type`,
      [poolId, POOL.name, POOL.inviteCode, POOL.slateSize, POOL.pushPoints, reviewerId, POOL.pickType],
    );

    for (const account of ACCOUNTS) {
      await db.query(
        `insert into public.pool_members (pool_id, player_id, is_commissioner)
         values ($1, $2, $3)
         on conflict (pool_id, player_id) do update set is_commissioner = excluded.is_commissioner`,
        [poolId, ids.get(account.key), account.isCommissioner],
      );
    }

    // 4. Slates. spreads_locked_at stays NULL: the hourly lock-spreads cron
    //    (and the commissioner's browser) will freeze ESPN's real lines once
    //    Monday-of-game-week passes. That means a re-run after the lock resets
    //    week 0 to the hand-entered numbers above and lets the cron re-lock it
    //    from ESPN within the hour — deliberate, so the seed is self-healing.
    for (const [week, slate] of slates) {
      await db.query(
        `insert into public.slates
           (pool_id, season, season_type, week, games, published, spreads_locked_at, pick_type, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, true, null, $6, now())
         on conflict (pool_id, season, season_type, week) do update set
           games = excluded.games,
           published = excluded.published,
           spreads_locked_at = excluded.spreads_locked_at,
           pick_type = excluded.pick_type`,
        [poolId, SEASON, SEASON_TYPE, week, JSON.stringify(slate.games), POOL.pickType],
      );
    }

    // 5. Entries.
    //
    //    The `entries_lock` trigger (enforce_pick_locks) starts with:
    //        if new.player_id <> auth.uid() and is_pool_commissioner(new.pool_id)
    //    i.e. the commissioner-override path. Under the plain `postgres` role
    //    auth.uid() is NULL, so `new.player_id <> NULL` is NULL, the IF is not
    //    taken, and we fall through to the slate-lock check. Today that check
    //    passes anyway (the first week 0 kickoff is Aug 29), but the seed must
    //    not silently start failing if it is re-run after kickoff.
    //
    //    So instead of disabling the trigger (session_replication_role is
    //    superuser-only on Supabase, and ALTER TABLE ... DISABLE TRIGGER would
    //    take an ACCESS EXCLUSIVE lock on a live table), we take the path the
    //    schema already sanctions: set the request JWT claims so auth.uid()
    //    resolves to the reviewer, who IS the pool commissioner. The trigger
    //    then treats these writes as exactly what they are — a commissioner
    //    entering other members' picks — and skips the locks. The setting is
    //    transaction-local (set_config(..., true)) and only affects auth.uid();
    //    RLS is still bypassed because we are connected as the table owner.
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: reviewerId, role: 'authenticated' }),
    ]);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [reviewerId]);

    let impersonated = false;
    await db.query('savepoint check_uid');
    try {
      const uid = await db.query(`select auth.uid()::text as uid`);
      impersonated = uid.rows[0]?.uid === reviewerId;
      await db.query('release savepoint check_uid');
    } catch {
      await db.query('rollback to savepoint check_uid');
      await db.query('release savepoint check_uid');
    }

    if (!impersonated) {
      // Fallback for an auth.uid() that reads its claims some other way.
      // session_replication_role is superuser-only on some setups, so this may
      // be refused — if it is, carry on: the slate locks are not reached
      // before the first kickoff. (Note replica mode also skips FK triggers;
      // acceptable here because every id written below was just inserted.)
      await db.query('savepoint before_replica');
      try {
        await db.query(`set local session_replication_role = replica`);
        await db.query('release savepoint before_replica');
        console.warn('  ! auth.uid() impersonation failed; disabled triggers for the entry writes instead');
      } catch {
        await db.query('rollback to savepoint before_replica');
        await db.query('release savepoint before_replica');
        console.warn(
          '  ! auth.uid() impersonation failed and triggers could not be disabled;\n' +
            '    entry writes will only succeed while the slates are still unlocked.',
        );
      }
    }

    for (const entry of entries) {
      await db.query(
        `insert into public.entries
           (pool_id, season, season_type, week, player_id, picks, tiebreaker, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())
         on conflict (pool_id, season, season_type, week, player_id) do update set
           picks = excluded.picks,
           tiebreaker = excluded.tiebreaker,
           updated_at = now()`,
        [
          poolId,
          SEASON,
          SEASON_TYPE,
          entry.week,
          ids.get(entry.key),
          JSON.stringify(entry.picks),
          JSON.stringify(entry.tiebreaker),
        ],
      );
    }

    // No need to reset session_replication_role: `set local` is undone by COMMIT.
    await db.query('commit');

    report({ poolId, ids, createdFlags, slates, entries });
  } catch (err) {
    await db.query('rollback').catch(() => {});
    console.error(`\n  Seed failed, nothing was written: ${err.message}\n`);
    if (err.detail) console.error(`  detail: ${err.detail}\n`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

function report({ poolId, ids, createdFlags, slates, entries }) {
  const nameOf = new Map(ACCOUNTS.map((a) => [a.key, a.displayName]));
  console.log('\n  Demo league seeded.\n');
  console.log(`  Pool         ${POOL.name}`);
  console.log(`  Pool id      ${poolId}`);
  console.log(`  Invite code  ${POOL.inviteCode}`);
  console.log(`  Rules        ${POOL.pickType.toUpperCase()}, slate_size ${POOL.slateSize}, push ${POOL.pushPoints}`);

  console.log('\n  Accounts (password: DEMO_PASSWORD from env — not printed)');
  for (const a of ACCOUNTS) {
    const role = a.isCommissioner ? 'commissioner' : 'player';
    const state = createdFlags.get(a.key) ? 'created' : 'updated';
    console.log(`    ${a.email.padEnd(38)} ${nameOf.get(a.key).padEnd(13)} ${role.padEnd(13)} ${state}`);
  }

  console.log('\n  Slates');
  for (const [week, slate] of slates) {
    const tb = slate.games.findIndex((g) => g.isTiebreaker);
    console.log(`    week ${week}: ${slate.games.length} games, tiebreaker ${slate.labels[tb]}`);
    slate.games.forEach((g, i) => {
      const spread = g.homeSpread === 0 ? 'PK (locks Monday)' : g.homeSpread.toString();
      console.log(`      ${g.gameId}  ${slate.labels[i].padEnd(16)} ${spread}${g.isTiebreaker ? '  [TB]' : ''}`);
    });
  }

  console.log(`\n  Entries (${entries.length})`);
  for (const e of entries) {
    const away = Object.values(e.picks).filter((s) => s === 'away').length;
    console.log(
      `    week ${e.week}  ${nameOf.get(e.key).padEnd(8)} ${Object.keys(e.picks).length} picks ` +
        `(${away} away / ${Object.keys(e.picks).length - away} home), TB ${e.tiebreaker.home}-${e.tiebreaker.away}`,
    );
  }
  console.log('    App Reviewer: no entries (they make their own picks).\n');
}

main();
