-- Per-pool pick-lock rule (owner decision 2026-09-19, for Degenerate Nation):
--   'kickoff'       — every pick locks at its own game's kickoff (the
--                     20260829173000 rule; stays the default for every pool).
--   'saturday_noon' — a game that isn't on Saturday still locks at its own
--                     kickoff; every SATURDAY game locks together at 12:00 PM
--                     ET that Saturday (a Saturday game kicking BEFORE noon
--                     still locks at its kickoff — never editable after kick).
--
-- "Saturday" is the football day in ET: the kickoff shifted back 6 hours, so a
-- Hawaii-style 12:00-1:00 AM ET Sunday kick counts as the Saturday slate it
-- belongs to. America/New_York (not a fixed offset) so noon is right on both
-- sides of the November DST change.
--
-- The LOCK/REVEAL pair from 20260829173000 is unchanged in spirit and must
-- keep moving together: both now key on pick_lock_at() instead of the raw
-- kickoff, so under 'saturday_noon' every Saturday pick reveals at noon — the
-- same instant it stops being editable. The tiebreaker follows the tiebreaker
-- game's pick_lock_at().
--
-- DO NOT flip a pool BACK to 'kickoff' (or to 'saturday_noon' and back)
-- between a Saturday noon and that night's last kickoff: picks that were
-- already revealed would become editable again. That is why this is set by
-- SQL and has no commissioner toggle.
--
-- This migration only adds the machinery. Turning it on for a pool is a
-- separate statement:
--   update public.pools set pick_lock = 'saturday_noon' where id = '<pool>';

alter table public.pools
  add column pick_lock text not null default 'kickoff'
  check (pick_lock in ('kickoff', 'saturday_noon'));

comment on column public.pools.pick_lock is
  'When picks lock/reveal: kickoff = per game at its kickoff; saturday_noon = non-Saturday games at kickoff, Saturday (ET football day) games together at 12:00 PM ET. Set by SQL only — see 20260919140000.';

-- The instant a pick for a game kicking at p_kickoff locks (and reveals) in
-- p_pool.
create or replace function public.pick_lock_at(p_pool uuid, p_kickoff timestamptz)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when (select pl.pick_lock from pools pl where pl.id = p_pool) = 'saturday_noon'
      and extract(isodow from (p_kickoff at time zone 'America/New_York') - interval '6 hours') = 6
    then least(
      p_kickoff,
      (date_trunc('day', (p_kickoff at time zone 'America/New_York') - interval '6 hours')
        + interval '12 hours') at time zone 'America/New_York'
    )
    else p_kickoff
  end
$$;

-- Same body as 20260829173000 except both lock checks go through
-- pick_lock_at().
create or replace function public.enforce_pick_locks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed text[];
  tb_kick timestamptz;
begin
  -- Commissioner override: editing another member's entry (texted-in picks)
  -- skips every lock. Their own entry falls through to the normal checks.
  if new.player_id <> auth.uid() and public.is_pool_commissioner(new.pool_id) then
    new.updated_at := now();
    return new;
  end if;

  -- Per-game lock: only the picks that actually changed are checked, so an
  -- entry save that keeps a locked game's pick byte-identical while editing
  -- a later game sails through. INSERTs treat every pick as changed.
  select coalesce(array_agg(d.k), '{}') into changed
  from (
    select coalesce(o.key, n.key) as k, o.value as ov, n.value as nv
    from jsonb_each_text(coalesce(case when tg_op = 'UPDATE' then old.picks end, '{}'::jsonb)) o
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

  if (tg_op = 'INSERT' and new.tiebreaker is not null)
     or (tg_op = 'UPDATE' and new.tiebreaker is distinct from old.tiebreaker) then
    tb_kick := public.slate_tiebreaker_kick(new.pool_id, new.season, new.season_type, new.week);
    if tb_kick is not null and public.pick_lock_at(new.pool_id, tb_kick) <= now() then
      raise exception 'tiebreaker locked: picks for the tiebreaker game have closed';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Same signature, row shape and body as 20260830170000 except both reveal
-- checks go through pick_lock_at().
create or replace function public.week_entries(
  p_pool uuid, p_season int, p_season_type int, p_week int
) returns table (
  player_id uuid,
  player_name text,
  real_name text,
  picks jsonb,
  tiebreaker jsonb,
  updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with tb as (
    select public.slate_tiebreaker_kick(p_pool, p_season, p_season_type, p_week) as kick
  )
  select
    e.player_id,
    p.display_name,
    p.real_name,
    case
      when e.player_id = auth.uid() or public.is_pool_commissioner(p_pool)
        then e.picks
      else coalesce((
        select jsonb_object_agg(je.key, je.value)
        from jsonb_each(e.picks) je
        join games g on g.id = je.key
        where public.pick_lock_at(p_pool, g.kickoff) <= now()
      ), '{}'::jsonb)
    end,
    case
      when e.player_id = auth.uid() or public.is_pool_commissioner(p_pool)
        or ((select kick from tb) is not null
            and public.pick_lock_at(p_pool, (select kick from tb)) <= now())
      then e.tiebreaker
      else null
    end,
    e.updated_at
  from entries e
  join profiles p on p.id = e.player_id
  where e.pool_id = p_pool and e.season = p_season
    and e.season_type = p_season_type and e.week = p_week
    and public.is_pool_member(p_pool)
$$;
