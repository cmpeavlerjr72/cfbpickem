#!/usr/bin/env node
/**
 * End-to-end RLS check for the commissioner roster + dues tracker
 * (migration 20260828180000_league_dues.sql).
 *
 *   cd web && node scripts/verify-dues-rls.mjs
 *
 * Uses ONLY the public anon key (read from web/.env.local, or
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the environment) — no admin
 * credentials, so it exercises exactly what a browser can reach. It signs up
 * two throwaway accounts, makes one the commissioner of a fresh league and the
 * other a plain member, asserts the privacy rules from BOTH sides, and then
 * deletes both accounts via the existing delete_account() RPC (which also
 * removes the league). Re-runnable; every run uses fresh addresses.
 *
 * It never prints an email address — assertions report presence/shape only.
 *
 * Exit code 0 = every check passed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));

function env() {
  let url = process.env.VITE_SUPABASE_URL;
  let key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    for (const file of ['.env.local', '.env.production']) {
      try {
        for (const line of readFileSync(join(HERE, '..', file), 'utf8').split(/\r?\n/)) {
          const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
          if (!m) continue;
          const v = m[2].replace(/^["']|["']$/g, '');
          if (m[1] === 'VITE_SUPABASE_URL') url ||= v;
          if (m[1] === 'VITE_SUPABASE_ANON_KEY') key ||= v;
        }
      } catch {
        // file not present — try the next one
      }
      if (url && key) break;
    }
  }
  if (!url || !key) throw new Error('No Supabase URL/anon key found (web/.env.local).');
  return { url, key };
}

const { url, key } = env();
const client = () => createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Never print an address; this is all the detail any assertion needs. */
const emailShape = (v) => (typeof v === 'string' && /^[^@\s]+@[^@\s]+$/.test(v) ? 'valid email present' : `not an email (${v === null ? 'null' : typeof v})`);

async function signUpAccount(label, displayName) {
  const db = client();
  const email = `dues-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await db.auth.signUp({ email, password });
  if (error) throw new Error(`${label}: signUp failed — ${error.message}`);
  if (!data.session) throw new Error(`${label}: signUp returned no session (email confirmations on?)`);
  const { error: pErr } = await db.from('profiles').upsert({ id: data.user.id, display_name: displayName });
  if (pErr) throw new Error(`${label}: profile insert failed — ${pErr.message}`);
  return { db, userId: data.user.id, displayName };
}

async function main() {
  console.log(`Supabase: ${url}\n`);

  const commish = await signUpAccount('commish', 'RLS Commish');
  const member = await signUpAccount('member', 'RLS Member');
  let poolId = null;

  try {
    // ---- league setup: commish creates, member joins by invite code ----
    const { data: newPool, error: cErr } = await commish.db.rpc('create_pool', {
      p_name: 'RLS Verification League',
    });
    if (cErr) throw new Error(`create_pool failed — ${cErr.message}`);
    poolId = newPool;

    const { data: pool } = await commish.db.from('pools').select('invite_code').eq('id', poolId).single();
    const { error: jErr } = await member.db.rpc('join_pool', { p_code: pool.invite_code });
    if (jErr) throw new Error(`join_pool failed — ${jErr.message}`);
    console.log(`League ${poolId} · commissioner + 1 member\n`);

    // ---- 1. commissioner CAN read the roster, emails included ----
    const { data: roster, error: rErr } = await commish.db.rpc('league_roster', { p_pool: poolId });
    check('commissioner: league_roster() returns the roster', !rErr && Array.isArray(roster), rErr?.message ?? `${roster?.length} rows`);
    if (roster) {
      check('commissioner: roster covers every member', roster.length === 2, `${roster.length} rows`);
      const memberRow = roster.find((r) => r.player_id === member.userId);
      check('commissioner: sees the member row', !!memberRow);
      if (memberRow) {
        check('commissioner: member email is exposed to them', emailShape(memberRow.email) === 'valid email present', emailShape(memberRow.email));
        check('commissioner: dues start unpaid', memberRow.dues_paid === false, String(memberRow?.dues_paid));
        check('commissioner: display name present', memberRow.display_name === 'RLS Member', memberRow.display_name);
      }
    }

    // ---- 2. a regular member CANNOT read the roster ----
    const { data: mRoster, error: mErr } = await member.db.rpc('league_roster', { p_pool: poolId });
    check('member: league_roster() is refused', !!mErr && !mRoster, mErr ? `error: ${mErr.message}` : `LEAKED ${mRoster?.length} rows`);

    // ---- 3. no email reaches a member through the table API either ----
    const { data: mRows, error: mSelErr } = await member.db.from('pool_members').select('*').eq('pool_id', poolId);
    const cols = mRows?.length ? Object.keys(mRows[0]) : [];
    check('member: pool_members.select(*) exposes no email column', !mSelErr && cols.length > 0 && !cols.some((c) => /email/i.test(c)), `columns: ${cols.join(', ')}`);
    const { data: authProbe, error: authErr } = await member.db.from('users').select('*').limit(1);
    check('member: auth.users is not reachable via PostgREST', !!authErr || !authProbe?.length, authErr ? `error: ${authErr.code ?? authErr.message}` : 'empty');

    // ---- 4. a regular member CANNOT write dues (their own row or anyone's) ----
    const { data: selfWrite, error: selfErr } = await member.db
      .from('pool_members')
      .update({ dues_paid: true })
      .eq('pool_id', poolId)
      .eq('player_id', member.userId)
      .select('player_id');
    check('member: cannot mark THEMSELVES paid', !!selfErr || selfWrite?.length === 0, selfErr ? `error: ${selfErr.message}` : `${selfWrite?.length ?? 0} rows updated`);

    const { data: otherWrite, error: otherErr } = await member.db
      .from('pool_members')
      .update({ dues_paid: true })
      .eq('pool_id', poolId)
      .eq('player_id', commish.userId)
      .select('player_id');
    check('member: cannot mark ANOTHER member paid', !!otherErr || otherWrite?.length === 0, otherErr ? `error: ${otherErr.message}` : `${otherWrite?.length ?? 0} rows updated`);

    // ---- 5. the commissioner CAN toggle dues, and only the dues column ----
    const { data: paidRows, error: payErr } = await commish.db
      .from('pool_members')
      .update({ dues_paid: true })
      .eq('pool_id', poolId)
      .eq('player_id', member.userId)
      .select('player_id, dues_paid, dues_updated_at, dues_updated_by');
    check('commissioner: marks a member paid', !payErr && paidRows?.length === 1 && paidRows[0].dues_paid === true, payErr?.message ?? `${paidRows?.length ?? 0} rows`);
    if (paidRows?.length) {
      check('trigger: stamps dues_updated_at', !!paidRows[0].dues_updated_at, String(paidRows[0].dues_updated_at));
      check('trigger: stamps dues_updated_by = the commissioner', paidRows[0].dues_updated_by === commish.userId);
    }

    // The column-level grant should make this a hard permission error; a
    // silent 0-row RLS denial would also be safe, so both count as denied.
    const { data: escRows, error: escErr } = await commish.db
      .from('pool_members')
      .update({ is_commissioner: true })
      .eq('pool_id', poolId)
      .eq('player_id', member.userId)
      .select('player_id');
    check(
      'commissioner: CANNOT write other columns (is_commissioner)',
      !!escErr || (escRows?.length ?? 0) === 0,
      escErr ? `error: ${escErr.message}` : `${escRows?.length ?? 0} rows updated`,
    );

    // ---- 6. the state round-trips through the roster, and unticking works ----
    const { data: roster2 } = await commish.db.rpc('league_roster', { p_pool: poolId });
    const after = roster2?.find((r) => r.player_id === member.userId);
    check('commissioner: roster reflects the paid flag', after?.dues_paid === true, String(after?.dues_paid));
    check('commissioner: member is still not a commissioner', after?.is_commissioner === false, String(after?.is_commissioner));

    const { data: unpaid } = await commish.db
      .from('pool_members')
      .update({ dues_paid: false })
      .eq('pool_id', poolId)
      .eq('player_id', member.userId)
      .select('dues_paid');
    check('commissioner: can untick a member', unpaid?.[0]?.dues_paid === false);

    // ---- 7. an outsider (signed out) gets nothing ----
    const anon = client();
    const { data: anonRoster, error: anonErr } = await anon.rpc('league_roster', { p_pool: poolId });
    check('signed-out: league_roster() is refused', !!anonErr || !anonRoster?.length, anonErr ? `error: ${anonErr.message}` : `LEAKED ${anonRoster?.length} rows`);

    // ---- 8. no regression: the existing member list still loads ----
    const { data: legacy, error: legacyErr } = await member.db
      .from('pool_members')
      .select('player_id, is_commissioner, profiles(display_name)')
      .eq('pool_id', poolId);
    check('member: existing roster query (names only) still works', !legacyErr && legacy?.length === 2, legacyErr?.message ?? `${legacy?.length ?? 0} rows`);
  } finally {
    // Clean up: delete_account() removes the member, then the commissioner,
    // and the league goes with the last member out.
    for (const acct of [member, commish]) {
      const { error } = await acct.db.rpc('delete_account');
      if (error) console.log(`WARN  cleanup failed for ${acct.displayName}: ${error.message}`);
    }
    console.log('\nCleanup: both throwaway accounts deleted (league removed with them).');
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
