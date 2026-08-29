-- Per-game pick locks + per-game reveal (owner decision 2026-08-29, reversing
-- the 08-15 whole-slate rule after the first live game day: "the 12:00 game
-- just locked (as it should) but it locked everything else").
--
-- The rule pair that keeps this cheat-proof — they must always change
-- together:
--   LOCK:   a pick may be added/changed/removed until ITS OWN game kicks off.
--           The tiebreaker guess locks when the TIEBREAKER game kicks off.
--   REVEAL: another member's pick for a game becomes visible only once that
--           game has kicked (so a still-editable pick is never readable, and
--           a readable pick is never editable). Tiebreakers reveal when the
--           tiebreaker game kicks. Own entry + commissioner see everything,
--           as before (commissioner needs it for the texted-picks override).
--
-- Games missing from the games table: a changed pick with no kickoff row is
-- ALLOWED (can't prove it locked) but stays HIDDEN from other members (can't
-- prove it revealed) — both fail safe, and the seeded table is complete
-- (947 rows) so this is a corner, not a path.

-- The tiebreaker game's kickoff for a slate, if any.
create or replace function public.slate_tiebreaker_kick(
  p_pool uuid, p_season int, p_season_type int, p_week int
) returns timestamptz
language sql stable security definer set search_path = public as $$
  select g.kickoff
  from slates s
  cross join jsonb_array_elements(s.games) sg
  join games g on g.id = sg->>'gameId'
  where s.pool_id = p_pool and s.season = p_season
    and s.season_type = p_season_type and s.week = p_week
    and coalesce((sg->>'isTiebreaker')::boolean, false)
  limit 1
$$;

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
  -- entry save that keeps a kicked game's pick byte-identical while editing
  -- a later game sails through. INSERTs treat every pick as changed.
  select coalesce(array_agg(d.k), '{}') into changed
  from (
    select coalesce(o.key, n.key) as k, o.value as ov, n.value as nv
    from jsonb_each_text(coalesce(case when tg_op = 'UPDATE' then old.picks end, '{}'::jsonb)) o
    full outer join jsonb_each_text(coalesce(new.picks, '{}'::jsonb)) n on n.key = o.key
  ) d
  where d.ov is distinct from d.nv;

  if exists (select 1 from games g where g.id = any (changed) and g.kickoff <= now()) then
    raise exception 'pick locked: that game has already kicked off';
  end if;

  if (tg_op = 'INSERT' and new.tiebreaker is not null)
     or (tg_op = 'UPDATE' and new.tiebreaker is distinct from old.tiebreaker) then
    tb_kick := public.slate_tiebreaker_kick(new.pool_id, new.season, new.season_type, new.week);
    if tb_kick is not null and tb_kick <= now() then
      raise exception 'tiebreaker locked: that game has already kicked off';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Per-game reveal. Same signature and row shape as before — other members'
-- picks are simply a SPARSER jsonb (absent key = not yet revealed), which the
-- clients already tolerate (that was the pre-lock state under the old rule).
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
  with tb as (
    select public.slate_tiebreaker_kick(p_pool, p_season, p_season_type, p_week) as kick
  )
  select
    e.player_id,
    p.display_name,
    case
      when e.player_id = auth.uid() or public.is_pool_commissioner(p_pool)
        then e.picks
      else coalesce((
        select jsonb_object_agg(je.key, je.value)
        from jsonb_each(e.picks) je
        join games g on g.id = je.key
        where g.kickoff <= now()
      ), '{}'::jsonb)
    end,
    case
      when e.player_id = auth.uid() or public.is_pool_commissioner(p_pool)
        or ((select kick from tb) is not null and (select kick from tb) <= now())
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
