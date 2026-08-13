-- Hourly cron that invokes the lock-spreads Edge Function, which freezes
-- ATS slate lines at ESPN's number once Monday-of-game-week has passed.
-- The function is idempotent and cheap when there's nothing to lock.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'lock-spreads-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://nczxyombguocejgurwop.supabase.co/functions/v1/lock-spreads',
    body := '{}'::jsonb
  )
  $$
);
