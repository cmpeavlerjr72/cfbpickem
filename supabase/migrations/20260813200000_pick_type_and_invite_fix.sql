-- 1) Pools choose their pick style: against the spread or straight-up.
-- 2) Fix create_pool: gen_random_bytes lives in the extensions schema on
--    Supabase, which isn't on the function's search_path — use md5() (core)
--    for invite codes instead, with a retry on the (rare) collision.

alter table public.pools
  add column pick_type text not null default 'ats'
  check (pick_type in ('ats', 'su'));

create or replace function public.create_pool(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pool uuid;
  v_code text;
  v_tries int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into pools (name, invite_code, created_by)
        values (
          coalesce(nullif(trim(p_name), ''), 'CFB Pick''em Pool'),
          v_code,
          auth.uid()
        )
        returning id into v_pool;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 5 then raise; end if;
    end;
  end loop;
  insert into pool_members (pool_id, player_id, is_commissioner)
    values (v_pool, auth.uid(), true);
  return v_pool;
end $$;
