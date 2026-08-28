-- Fix a prod regression the dues migration introduced (caught by
-- verify-dues-rls.mjs check 11 immediately after the 2026-08-28 apply):
--
-- dues_updated_by referenced public.profiles, giving PostgREST a SECOND
-- relationship between pool_members and profiles (alongside player_id).
-- Every existing implicit embed -- `pool_members?select=...,profiles(...)`,
-- which the member-facing league roster uses -- became ambiguous and failed
-- with "more than one relationship was found for 'pool_members' and
-- 'profiles'".
--
-- Repoint the audit column at auth.users(id): same referential integrity
-- (profiles.id == auth.users.id in this schema), but auth.users is not a
-- PostgREST-exposed table, so no embeddable relationship is created and the
-- original implicit embed is unambiguous again. App queries need no change.

alter table public.pool_members
  drop constraint if exists pool_members_dues_updated_by_fkey;

alter table public.pool_members
  add constraint pool_members_dues_updated_by_fkey
  foreign key (dues_updated_by) references auth.users (id) on delete set null;
