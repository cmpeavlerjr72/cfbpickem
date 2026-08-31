-- Optional "real name" on a profile (owner decision 2026-08-30): a
-- second, owner-edited name distinct from the display name used everywhere
-- else in the app. Leaderboards (weekly + season boards) prefer it when set
-- and fall back to display_name when it's null — every other surface (pick
-- sheets, scoreboard, celebration overlay, commissioner "entering picks
-- for…" selector) keeps using display_name unchanged.

alter table public.profiles
  add column real_name text check (real_name is null or char_length(real_name) between 1 and 60);

comment on column public.profiles.real_name is
  'Optional, owner-edited in account settings. Leaderboards prefer this over display_name when set; null falls back to display_name.';

-- No new grant needed: the existing "users update own profile" RLS policy
-- (20260813120000_pool_schema.sql) has no column restriction, and there is no
-- revoke on public.profiles anywhere in the migration history (checked), so
-- the table-level UPDATE grant to authenticated already covers this new
-- column. Contrast pool_members.dues_paid (20260828180000_league_dues.sql),
-- which needed its own `grant update (dues_paid)` because that table's
-- UPDATE grant was revoked from authenticated/anon.

-- week_entries' return type is gaining a column, which `create or replace`
-- can't do — drop and recreate. Body is byte-for-byte the
-- 20260829173000_per_game_pick_locks.sql version except: the returns table
-- gains `real_name text` right after `player_name`, and the select list
-- gains `p.real_name` right after `p.display_name`. Same reveal logic
-- (own entry / commissioner see everything; others reveal per-game at that
-- game's kickoff, tiebreaker reveals at the tiebreaker game's kickoff),
-- same security definer + search_path, same stable sql.
drop function public.week_entries(uuid, int, int, int);

create function public.week_entries(
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
