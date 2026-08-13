-- CFB Pick'em pool schema. Mirrors web/src/pool/types.ts:
-- slates.games = [{gameId, homeSpread, isTiebreaker}], entries.picks =
-- {gameId: 'home'|'away'}, entries.tiebreaker = {home, away}.

-- ---------- profiles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "signed-in users can read profiles"
  on public.profiles for select to authenticated using (true);
create policy "users insert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "users update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());

-- ---------- pools + membership ----------

create table public.pools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  slate_size int not null default 12,
  push_points numeric not null default 0.5,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.pool_members (
  pool_id uuid not null references public.pools (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  is_commissioner boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (pool_id, player_id)
);

alter table public.pools enable row level security;
alter table public.pool_members enable row level security;

-- security definer helpers avoid recursive RLS between pools and pool_members
create function public.is_pool_member(p_pool uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from pool_members m
                  where m.pool_id = p_pool and m.player_id = auth.uid()) $$;

create function public.is_pool_commissioner(p_pool uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from pool_members m
                  where m.pool_id = p_pool and m.player_id = auth.uid()
                    and m.is_commissioner) $$;

create policy "members read their pools"
  on public.pools for select to authenticated using (public.is_pool_member(id));
create policy "commissioner updates pool"
  on public.pools for update to authenticated using (public.is_pool_commissioner(id));

create policy "members see fellow members"
  on public.pool_members for select to authenticated using (public.is_pool_member(pool_id));

-- Creation / joining go through RPCs (joining needs to look up a pool the
-- caller can't select yet, so both are security definer).
create function public.create_pool(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pool uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into pools (name, invite_code, created_by)
    values (
      coalesce(nullif(trim(p_name), ''), 'CFB Pick''em Pool'),
      upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
      auth.uid()
    )
    returning id into v_pool;
  insert into pool_members (pool_id, player_id, is_commissioner)
    values (v_pool, auth.uid(), true);
  return v_pool;
end $$;

create function public.join_pool(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pool uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into v_pool from pools where invite_code = upper(trim(p_code));
  if v_pool is null then raise exception 'invalid invite code'; end if;
  insert into pool_members (pool_id, player_id)
    values (v_pool, auth.uid())
    on conflict do nothing;
  return v_pool;
end $$;

-- ---------- games (reference data for lock enforcement) ----------
-- Written only by the data pipeline (direct DB connection); clients read.

create table public.games (
  id text primary key,
  season int not null,
  season_type int not null,
  week int not null,
  kickoff timestamptz not null,
  home_school text,
  away_school text,
  home_abbrev text,
  away_abbrev text
);

create index games_week_idx on public.games (season, season_type, week);

alter table public.games enable row level security;
create policy "signed-in users can read games"
  on public.games for select to authenticated using (true);

-- ---------- slates ----------

create table public.slates (
  pool_id uuid not null references public.pools (id) on delete cascade,
  season int not null,
  season_type int not null,
  week int not null,
  games jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  spreads_locked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (pool_id, season, season_type, week)
);

alter table public.slates enable row level security;

create policy "members read slates"
  on public.slates for select to authenticated using (public.is_pool_member(pool_id));
create policy "commissioner inserts slates"
  on public.slates for insert to authenticated with check (public.is_pool_commissioner(pool_id));
create policy "commissioner updates slates"
  on public.slates for update to authenticated using (public.is_pool_commissioner(pool_id));
create policy "commissioner deletes slates"
  on public.slates for delete to authenticated using (public.is_pool_commissioner(pool_id));

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger slates_touch before update on public.slates
  for each row execute function public.touch_updated_at();

-- ---------- entries ----------

create table public.entries (
  pool_id uuid not null,
  season int not null,
  season_type int not null,
  week int not null,
  player_id uuid not null references public.profiles (id) on delete cascade,
  picks jsonb not null default '{}'::jsonb,
  tiebreaker jsonb,
  updated_at timestamptz not null default now(),
  primary key (pool_id, season, season_type, week, player_id),
  foreign key (pool_id, season, season_type, week)
    references public.slates (pool_id, season, season_type, week) on delete cascade
);

alter table public.entries enable row level security;

-- Players only ever touch their own row; everyone else's picks come through
-- the week_entries RPC below, which hides picks until each game kicks off.
create policy "players read own entry"
  on public.entries for select to authenticated using (player_id = auth.uid());
create policy "players insert own entry"
  on public.entries for insert to authenticated
  with check (player_id = auth.uid() and public.is_pool_member(pool_id));
create policy "players update own entry"
  on public.entries for update to authenticated using (player_id = auth.uid());

-- Server-side kickoff locks: a pick (or the tiebreaker) can't change once
-- its game has kicked off, no matter what the client sends.
create function public.enforce_pick_locks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed text[];
  tb_game text;
begin
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

  if (tg_op = 'INSERT' and new.tiebreaker is not null)
     or (tg_op = 'UPDATE' and new.tiebreaker is distinct from old.tiebreaker) then
    select sg->>'gameId' into tb_game
    from slates s
    cross join jsonb_array_elements(s.games) sg
    where s.pool_id = new.pool_id and s.season = new.season
      and s.season_type = new.season_type and s.week = new.week
      and (sg->>'isTiebreaker')::boolean
    limit 1;
    if tb_game is not null
       and exists (select 1 from games g where g.id = tb_game and g.kickoff <= now()) then
      raise exception 'tiebreaker locked: game already kicked off';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger entries_lock before insert or update on public.entries
  for each row execute function public.enforce_pick_locks();

-- All entries for a week, with opponents' picks filtered to games that have
-- kicked off (and their tiebreaker hidden until the TB game kicks off).
create function public.week_entries(
  p_pool uuid, p_season int, p_season_type int, p_week int
) returns table (
  player_id uuid,
  player_name text,
  picks jsonb,
  tiebreaker jsonb,
  updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    e.player_id,
    p.display_name,
    case
      when e.player_id = auth.uid() then e.picks
      else coalesce((
        select jsonb_object_agg(k.key, k.value)
        from jsonb_each(e.picks) k
        join games g on g.id = k.key
        where g.kickoff <= now()
      ), '{}'::jsonb)
    end,
    case
      when e.player_id = auth.uid() then e.tiebreaker
      when exists (
        select 1
        from slates s
        cross join jsonb_array_elements(s.games) sg
        join games g on g.id = sg->>'gameId'
        where s.pool_id = p_pool and s.season = p_season
          and s.season_type = p_season_type and s.week = p_week
          and (sg->>'isTiebreaker')::boolean
          and g.kickoff <= now()
      ) then e.tiebreaker
      else null
    end,
    e.updated_at
  from entries e
  join profiles p on p.id = e.player_id
  where e.pool_id = p_pool and e.season = p_season
    and e.season_type = p_season_type and e.week = p_week
    and public.is_pool_member(p_pool)
$$;

-- Realtime on slates (publish/unpublish shows up live; entries go through
-- the RPC on a poll instead, since RLS hides other players' rows).
alter publication supabase_realtime add table public.slates;
