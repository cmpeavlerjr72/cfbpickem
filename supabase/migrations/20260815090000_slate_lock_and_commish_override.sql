-- Two rule changes from user feedback:
--
-- 1. Pick deadline is now the WHOLE SLATE locking at the week's first kickoff
--    (was: each game locking at its own kickoff). No late-addition picks after
--    the early games start. Everyone's picks reveal at that same instant.
-- 2. The commissioner can enter/adjust OTHER members' picks at any time —
--    people who forget text the commish their picks. Commissioner edits bypass
--    the lock for other players' entries but never their own, so the commish
--    is held to the same deadline as everyone else on their own sheet.

-- Lock instant for a week's slate: the earliest kickoff among its games.
create or replace function public.slate_lock_time(
  p_pool uuid, p_season int, p_season_type int, p_week int
) returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(g.kickoff)
  from slates s
  cross join jsonb_array_elements(s.games) sg
  join games g on g.id = sg->>'gameId'
  where s.pool_id = p_pool and s.season = p_season
    and s.season_type = p_season_type and s.week = p_week
$$;

-- Replace the per-game lock with the slate-wide one.
create or replace function public.enforce_pick_locks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lock_at timestamptz;
  changed text[];
begin
  -- Commissioner override: editing another member's entry (texted-in picks)
  -- skips every lock. Their own entry falls through to the normal checks.
  if new.player_id <> auth.uid() and public.is_pool_commissioner(new.pool_id) then
    new.updated_at := now();
    return new;
  end if;

  lock_at := public.slate_lock_time(new.pool_id, new.season, new.season_type, new.week);
  if lock_at is not null and lock_at <= now() then
    raise exception 'picks locked: the first game of the week has kicked off';
  end if;

  -- Fallback for slate games missing from the games table (no lock time):
  -- a changed pick still can't reference a game that already kicked off.
  select coalesce(array_agg(d.k), '{}') into changed
  from (
    select coalesce(o.key, n.key) as k, o.value as ov, n.value as nv
    from jsonb_each_text(coalesce(case when tg_op = 'UPDATE' then old.picks end, '{}'::jsonb)) o
    full outer join jsonb_each_text(new.picks) n on n.key = o.key
  ) d
  where d.ov is distinct from d.nv;

  if exists (select 1 from games g where g.id = any (changed) and g.kickoff <= now()) then
    raise exception 'pick locked: game already kicked off';
  end if;

  new.updated_at := now();
  return new;
end $$;

-- The commissioner can read and write every entry in their pool (the RPC
-- below also shows them full picks pre-lock, so they can enter texted picks
-- and see who's missing a sheet).
create policy "commissioner reads pool entries"
  on public.entries for select to authenticated
  using (public.is_pool_commissioner(pool_id));

create policy "commissioner inserts member entries"
  on public.entries for insert to authenticated
  with check (
    public.is_pool_commissioner(pool_id)
    and exists (select 1 from public.pool_members m
                where m.pool_id = entries.pool_id
                  and m.player_id = entries.player_id)
  );

create policy "commissioner updates pool entries"
  on public.entries for update to authenticated
  using (public.is_pool_commissioner(pool_id));

-- Reveal rule follows the new lock: everyone's picks + tiebreaker become
-- visible to the whole pool at the slate lock (first kickoff) — nothing can
-- change after that, so per-game hiding no longer buys anything. The
-- commissioner sees full picks at all times (needed for the override).
create or replace function public.week_entries(
  p_pool uuid, p_season int, p_season_type int, p_week int
) returns table (
  player_id uuid,
  player_name text,
  picks jsonb,
  tiebreaker jsonb,
  updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with lock as (
    select public.slate_lock_time(p_pool, p_season, p_season_type, p_week) as at
  )
  select
    e.player_id,
    p.display_name,
    case
      when e.player_id = auth.uid()
        or public.is_pool_commissioner(p_pool)
        or (select at from lock) <= now()
      then e.picks
      else '{}'::jsonb
    end,
    case
      when e.player_id = auth.uid()
        or public.is_pool_commissioner(p_pool)
        or (select at from lock) <= now()
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
