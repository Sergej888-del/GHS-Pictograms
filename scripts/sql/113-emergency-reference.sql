-- 113 - emergency lines: reference tables for official bodies (2026-10-15).
--
-- Purely additive: two new tables. No existing table, constraint or row is touched.
-- Official bodies (poison centres, spill-reporting centres, national helpdesks) are not vendors, so they do not
-- go into directory_entries (no tier, claim, logo, affiliate or click tracking). Commercial emergency services
-- stay in directory_entries (category emergency-response, see 109).
--
-- Rule enforced by the database: a row can be live only if it names an https source and is not 'unconfirmed'.
-- Value vocabularies (kind, sds_rule_kind, sds_use) live in code, as in step C; the database holds the format only.
-- Run the WHOLE file in the Supabase SQL Editor in one go. Rollback is at the end of the file.
-- Status: applied in the Supabase SQL Editor on 2026-10-15; RLS, policy and grants verified afterwards.
begin;

create table public.emergency_countries (
  country_code        text primary key check (country_code ~ '^[A-Z]{2}$'),
  name_en             text not null,
  wave                smallint not null default 1 check (wave in (1, 2)),
  general_number      text,
  general_number_src  text check (general_number_src is null or general_number_src ~ '^https?://'),
  sds_rule_kind       text not null check (sds_rule_kind ~ '^[a-z][a-z_]*$'),
  sds_rule_summary    text not null,
  sds_rule_source_url text not null check (sds_rule_source_url ~ '^https?://'),
  sds_rule_checked_on date not null,
  state               text not null default 'draft' check (state in ('draft', 'live')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint emergency_countries_general_chk check ((general_number is null) = (general_number_src is null)),
  constraint emergency_countries_no_internal_marks check (
    (coalesce(name_en, '') || ' ' || coalesce(sds_rule_summary, '')) !~* '(\msession\M|\ms[0-9]{2,3}\M|\mTODO\M|to-verify|verify URL)')
);

create table public.emergency_services (
  id             serial primary key,
  country_code   text not null references public.emergency_countries (country_code),
  slug           text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind           text not null check (kind ~ '^[a-z][a-z_]*$'),
  name           text not null,
  operator       text,
  phone_display  text not null,
  phone_tel      text not null check (phone_tel ~ '^\+[0-9]{6,15}$'),
  hours_kind     text not null check (hours_kind in ('24_7', 'stated_other', 'not_stated')),
  hours_note     text,
  audience       text not null check (audience in ('public', 'professionals_only', 'public_and_professionals', 'not_stated')),
  languages      text[] not null default '{}',
  sds_use        text not null check (sds_use ~ '^[a-z][a-z_]*$'),
  sds_use_note   text,
  cost_note      text,
  source_url     text not null check (source_url ~ '^https?://'),
  source_date    text check (source_date is null or source_date ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'),
  verification   text not null check (verification in ('confirmed', 'dated_source', 'unconfirmed')),
  checked_on     date not null,
  state          text not null default 'draft' check (state in ('draft', 'live')),
  sort           smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint emergency_services_slug_uq unique (country_code, slug),
  constraint emergency_services_hours_chk check (hours_kind <> 'stated_other' or hours_note is not null),
  constraint emergency_services_live_chk check (state <> 'live' or (verification <> 'unconfirmed' and source_url ~ '^https://')),
  constraint emergency_services_no_internal_marks check (
    (coalesce(name, '') || ' ' || coalesce(sds_use_note, '') || ' ' || coalesce(cost_note, '')) !~* '(\msession\M|\ms[0-9]{2,3}\M|\mTODO\M|to-verify|verify URL)')
);

create index emergency_services_country_idx on public.emergency_services (country_code, sort);

alter table public.emergency_countries enable row level security;
alter table public.emergency_services enable row level security;
create policy "public read live" on public.emergency_countries for select to anon, authenticated using (state = 'live');
create policy "public read live" on public.emergency_services for select to anon, authenticated using (state = 'live');
grant select on public.emergency_countries, public.emergency_services to anon, authenticated;

commit;

-- Check 1: RLS on, one policy each, anon and authenticated can only SELECT.
select c.relname, c.relrowsecurity as rls,
  (select string_agg(p.polname, ', ') from pg_policy p where p.polrelid = c.oid) as policies,
  (select string_agg(distinct g.grantee || ':' || g.privilege_type, ', ') from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname and g.grantee in ('anon', 'authenticated')) as grants
from pg_class c
where c.oid in ('public.emergency_countries'::regclass, 'public.emergency_services'::regclass)
order by 1;

-- Check 2: both tables are empty, the directory is untouched (expected today: 231 entries).
select (select count(*) from public.emergency_countries) as countries,
       (select count(*) from public.emergency_services) as services,
       (select count(*) from public.directory_entries) as entries;

-- Rollback (nothing else depends on these tables):
-- begin;
-- drop table public.emergency_services;
-- drop table public.emergency_countries;
-- commit;
