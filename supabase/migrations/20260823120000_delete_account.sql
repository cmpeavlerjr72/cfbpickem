-- In-app account deletion (Apple App Store Guideline 5.1.1(v): any app that
-- lets you create an account must let you delete it from inside the app).
--
-- One atomic RPC does the whole thing so a half-deleted account can never be
-- left behind: leagues are tidied up first, then the auth user is deleted and
-- the cascade chain (auth.users -> profiles -> pool_members / entries) removes
-- everything else the account owns.
--
-- ---------- Commissioner-promotion policy ----------
-- Deleting the last commissioner would orphan a league (nobody could set the
-- slate again), and pools.created_by is NOT NULL with no ON DELETE action, so
-- a dangling creator would also block the profile delete outright. For every
-- pool the leaving account belongs to:
--
--   1. Only member  -> the pool is deleted (cascades slates, members, entries).
--   2. Sole commissioner with other members left -> the remaining member with
--      the earliest joined_at (longest-standing member; player_id breaks exact
--      ties) is promoted to commissioner.
--   3. Not the sole commissioner -> nothing to promote; the other
--      commissioner(s) keep running the league.
--
-- Then any pool still stamped created_by = <leaving account> is re-stamped to
-- a surviving member, preferring a commissioner and then the earliest
-- joined_at, so the FK to profiles stays valid. That sweep also covers the
-- defensive case of a pool the account created but is no longer a member of
-- (no such path in the UI today, but the FK would fail if one ever existed);
-- if such a pool has no members left at all it is deleted.
--
-- ---------- Why this can delete from auth.users ----------
-- Migrations run as the `postgres` role, so this function is owned by
-- `postgres`, and a SECURITY DEFINER function executes with the owner's
-- privileges rather than the caller's. On Supabase `postgres` holds DML rights
-- on the auth schema, so the delete below succeeds even though the caller is
-- an ordinary `authenticated` user. auth.identities / auth.sessions /
-- auth.refresh_tokens all cascade from auth.users, and public.profiles
-- references auth.users ON DELETE CASCADE, which in turn cascades
-- public.pool_members and public.entries.

create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_pool record;
  v_members int;
  v_other_commish uuid;
  v_heir uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  -- 1) Leave every league cleanly (delete solo leagues, hand off commissioner).
  for v_pool in select pool_id from public.pool_members where player_id = v_uid loop
    select count(*) into v_members
      from public.pool_members where pool_id = v_pool.pool_id;

    if v_members <= 1 then
      -- Last one out: the league goes with them.
      delete from public.pools where id = v_pool.pool_id;
      continue;
    end if;

    select m.player_id into v_other_commish
      from public.pool_members m
      where m.pool_id = v_pool.pool_id
        and m.player_id <> v_uid
        and m.is_commissioner
      limit 1;

    if v_other_commish is null
       and exists (
         select 1 from public.pool_members m
         where m.pool_id = v_pool.pool_id and m.player_id = v_uid and m.is_commissioner
       )
    then
      -- Sole commissioner leaving: promote the longest-standing member.
      select m.player_id into v_heir
        from public.pool_members m
        where m.pool_id = v_pool.pool_id and m.player_id <> v_uid
        order by m.joined_at asc, m.player_id asc
        limit 1;

      update public.pool_members
        set is_commissioner = true
        where pool_id = v_pool.pool_id and player_id = v_heir;
    end if;
  end loop;

  -- 2) Keep pools.created_by pointing at a real, surviving profile.
  for v_pool in select id as pool_id from public.pools where created_by = v_uid loop
    select m.player_id into v_heir
      from public.pool_members m
      where m.pool_id = v_pool.pool_id and m.player_id <> v_uid
      order by m.is_commissioner desc, m.joined_at asc, m.player_id asc
      limit 1;

    if v_heir is null then
      delete from public.pools where id = v_pool.pool_id;
    else
      update public.pools set created_by = v_heir where id = v_pool.pool_id;
    end if;
  end loop;

  -- 3) Delete the auth user; profiles (and through it memberships + entries)
  --    cascade away. Everything above runs in this one statement's
  --    transaction, so a failure anywhere rolls the whole deletion back.
  delete from auth.users where id = v_uid;
end $$;

comment on function public.delete_account() is
  'Deletes the calling account: leaves/deletes their leagues (promoting the '
  'longest-standing member if they were the sole commissioner), then deletes '
  'the auth user so profiles, memberships and entries cascade away.';

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;
