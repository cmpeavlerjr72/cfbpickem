-- public.games becomes the live schedule: an hourly cron invokes the
-- refresh-games Edge Function, which re-reads ESPN for every week with a
-- game in [now - 1 day, now + 16 days] and updates kickoffs, TBD flags and
-- ranks. Before this the table was a static snapshot pushed by hand
-- (data/generate-games-migration.mjs), and stale ESPN midnight-ET TBD
-- placeholders locked whole Saturdays at midnight (2026-09-26, 2026-09-30).
--
--   time_tbd     ESPN timeValid=false. kickoff then holds 12:00 PM ET of
--                that day (placeholder + 12h), never the midnight
--                placeholder — pick_lock_at() needs no change.
--   data         the full normalized game (same shape as
--                web/src/data/games.json); clients overlay it on the bundle.
--   refreshed_at last time this row was written from ESPN data.
--
-- RLS unchanged: signed-in users can select (existing policy covers the new
-- columns); only the service role / migrations write.

alter table public.games
  add column time_tbd boolean not null default false,
  add column data jsonb,
  add column refreshed_at timestamptz;

create index games_refreshed_idx on public.games (season, refreshed_at);

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'refresh-games-hourly',
  '37 * * * *',
  $$
  select net.http_post(
    url := 'https://nczxyombguocejgurwop.supabase.co/functions/v1/refresh-games',
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  $$
);
