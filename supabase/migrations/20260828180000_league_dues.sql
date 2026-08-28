-- Commissioner-only league roster + dues tracking.
--
-- Two things a commissioner has never been able to do from the app:
--   1. See who is actually in their league with a contact address — emails
--      live in auth.users, which PostgREST never exposes to clients; and
--   2. record whether each member has paid the league dues.
--
-- ---------- The email rule (PII) ----------
-- Emails are readable ONLY by the commissioner of the league the member
-- belongs to. There is deliberately no table, view or column in `public` that
-- exposes auth.users: the ONE path an email can reach a client is
-- public.league_roster(pool), a SECURITY DEFINER function that raises unless
-- public.is_pool_commissioner(pool) — the same privilege check the pick
-- override and the pre-lock pick reveal already use (20260815090000). A
-- regular member calling it for their own league gets an exception, not a
-- filtered list, so there is nothing for a client to "unfilter".
--
-- ---------- The dues rule ----------
-- Writes: RLS restricts WHICH ROWS (only members of a pool you commission),
-- and a column-level GRANT restricts WHICH COLUMNS (dues_paid alone), so the
-- new policy can never be leveraged into "the commissioner can flip
-- is_commissioner on anyone". dues_updated_at / dues_updated_by are stamped
-- server-side by a trigger, never by the client.
-- Reads: pool_members' existing "members see fellow members" SELECT policy now
-- also covers dues_paid, so every member can see their OWN status (and, as
-- with is_commissioner and joined_at, their league-mates'). That is this
-- table's existing norm and is deliberate — paid/unpaid is league bookkeeping.
-- The email is the thing that is gated.

-- ---------- dues columns ----------

alter table public.pool_members
  add column dues_paid boolean not null default false,
  add column dues_updated_at timestamptz,
  add column dues_updated_by uuid references public.profiles (id) on delete set null;

comment on column public.pool_members.dues_paid is
  'Has this member paid the league dues? Commissioner-writable only (RLS + column grant).';

-- Stamp who marked it and when, but only when the flag actually moves — the
-- delete_account() commissioner promotion also updates this table and must not
-- look like a dues edit.
create function public.stamp_dues_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dues_paid is distinct from old.dues_paid then
    new.dues_updated_at := now();
    new.dues_updated_by := auth.uid();
  end if;
  return new;
end $$;

create trigger pool_members_stamp_dues before update on public.pool_members
  for each row execute function public.stamp_dues_update();

-- ---------- write path: commissioner only, dues_paid only ----------
-- NOTE for future migrations: `authenticated` now holds a COLUMN-level UPDATE
-- grant on pool_members. Any new column that clients are meant to write needs
-- its own `grant update (<col>) on public.pool_members to authenticated`.

create policy "commissioner updates member dues"
  on public.pool_members for update to authenticated
  using (public.is_pool_commissioner(pool_id))
  with check (public.is_pool_commissioner(pool_id));

revoke update on public.pool_members from authenticated, anon;
grant update (dues_paid) on public.pool_members to authenticated;

-- ---------- read path: the commissioner's roster (includes emails) ----------

create function public.league_roster(p_pool uuid)
returns table (
  player_id uuid,
  display_name text,
  email text,
  is_commissioner boolean,
  joined_at timestamptz,
  dues_paid boolean,
  dues_updated_at timestamptz
)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_pool_commissioner(p_pool) then
    raise exception 'only this league''s commissioner can see the roster';
  end if;

  return query
    select m.player_id, p.display_name, u.email::text, m.is_commissioner,
           m.joined_at, m.dues_paid, m.dues_updated_at
    from pool_members m
    join profiles p on p.id = m.player_id
    left join auth.users u on u.id = m.player_id
    where m.pool_id = p_pool
    order by m.is_commissioner desc, p.display_name asc;
end $$;

comment on function public.league_roster(uuid) is
  'Commissioner-only roster for one league: display name, auth.users email, '
  'commissioner flag, joined_at and dues status. Raises for everyone else — '
  'this is the only path by which a member email reaches a client.';

revoke all on function public.league_roster(uuid) from public;
grant execute on function public.league_roster(uuid) to authenticated;
