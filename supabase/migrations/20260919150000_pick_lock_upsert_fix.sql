-- Fix (2026-09-19, found live an hour after 20260919140000): the client saves
-- a sheet with an UPSERT (insert ... on conflict do update). Postgres fires
-- the BEFORE INSERT row trigger first, with tg_op = 'INSERT' and no OLD — so
-- the per-pick diff saw EVERY pick as changed, and the moment one slate game
-- had locked (Friday's kickoffs), every later save of that sheet was rejected
-- even though only an open Saturday pick moved.
--
-- The INSERT branch now diffs against the member's EXISTING row when there is
-- one (the row the upsert is about to turn into an UPDATE). That is no
-- loosening: when the conflict resolves to an UPDATE, the BEFORE UPDATE
-- trigger fires as well and re-checks against the true OLD; when there is no
-- existing row the baseline is still empty, so a first-time sheet cannot carry
-- a pick for a locked game. Same for the tiebreaker.
--
-- Everything else is byte-for-byte 20260919140000.

create or replace function public.enforce_pick_locks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed text[];
  tb_kick timestamptz;
  base_picks jsonb;
  base_tb jsonb;
begin
  -- Commissioner override: editing another member's entry (texted-in picks)
  -- skips every lock. Their own entry falls through to the normal checks.
  if new.player_id <> auth.uid() and public.is_pool_commissioner(new.pool_id) then
    new.updated_at := now();
    return new;
  end if;

  -- What this write is measured against: OLD on an UPDATE; on an INSERT the
  -- member's existing row if any (the upsert path), else nothing.
  if tg_op = 'UPDATE' then
    base_picks := old.picks;
    base_tb := old.tiebreaker;
  else
    select e.picks, e.tiebreaker into base_picks, base_tb
    from entries e
    where e.pool_id = new.pool_id and e.season = new.season
      and e.season_type = new.season_type and e.week = new.week
      and e.player_id = new.player_id;
  end if;

  -- Per-game lock: only the picks that actually changed are checked, so an
  -- entry save that keeps a locked game's pick byte-identical while editing
  -- a later game sails through.
  select coalesce(array_agg(d.k), '{}') into changed
  from (
    select coalesce(o.key, n.key) as k, o.value as ov, n.value as nv
    from jsonb_each_text(coalesce(base_picks, '{}'::jsonb)) o
    full outer join jsonb_each_text(coalesce(new.picks, '{}'::jsonb)) n on n.key = o.key
  ) d
  where d.ov is distinct from d.nv;

  if exists (
    select 1 from games g
    where g.id = any (changed)
      and public.pick_lock_at(new.pool_id, g.kickoff) <= now()
  ) then
    raise exception 'pick locked: picks for that game have closed';
  end if;

  if new.tiebreaker is distinct from base_tb then
    tb_kick := public.slate_tiebreaker_kick(new.pool_id, new.season, new.season_type, new.week);
    if tb_kick is not null and public.pick_lock_at(new.pool_id, tb_kick) <= now() then
      raise exception 'tiebreaker locked: picks for the tiebreaker game have closed';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
