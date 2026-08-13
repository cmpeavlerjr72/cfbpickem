-- Each slate records the pick style it was played under, so a pool that
-- switches ATS <-> SU mid-season doesn't rewrite how past weeks display.
alter table public.slates
  add column pick_type text not null default 'ats'
  check (pick_type in ('ats', 'su'));
