-- 92-directory.sql — session 92 (2026-10-05), GHS Tools & Services Directory (№148, CLAUDE.md §18)
--
-- ЗАЧЕМ. Каталог /directory/ — нейтральный справочник инструментов и услуг ниши GHS/SDS. Правила
-- записи зафиксированы в §18.2 ДО кода: факты из открытых источников + «Last verified», без оценок,
-- без логотипов, порядок не продаётся (claimed первыми, внутри — алфавит), партнёрства раскрыты,
-- мёртвое не удаляется (closed), страницы записей под noindex, пока владелец не заявил запись.
-- Решение Сергея s92: на карточке полная информация и цены — только опубликованные самим вендором,
-- с источником и датой; блок «за что вендор отвечает» — дословные цитаты из его Terms.
--
-- ДВЕ ТАБЛИЦЫ:
--   directory_entries — одна строка на запись (live / closed / not-listed). id = номер строки
--     посевного списка (directory-seed-v2.csv) — стабильный, его же носят отчёты проверки.
--   directory_facts — одна строка на ОДИН факт карточки, у каждой обязателен source_url
--     («откуда известно», §18.3). evidence — строка, которую scripts/check-directory.ts ищет на
--     странице-источнике; confirmed = true ставится ТОЛЬКО по отчёту этой проверки.
--     ⚠⚠ Цены (kind='price') и цитаты (kind='responsibility') страницы печатают ТОЛЬКО при
--     confirmed = true: обе собраны через инструмент, который пропускает страницу через
--     суммаризатор и может исказить число или обрезать цитату (s92: $9,293 vs $9,299 у одного тарифа).
--
-- ⚠ ДОСТУП (§15.1). Новые таблицы закрыты по умолчанию (default privileges отозваны в s78).
--   Здесь — ОСОЗНАННОЕ открытие на чтение: GRANT SELECT TO anon, authenticated + политика
--   «public read». ПРИЧИНА: страницы /directory/ пререндерятся при сборке на anon-ключе
--   (src/lib/supabase.ts), а всё содержимое таблиц и так печатается на публичных страницах —
--   скрывать нечего. Записи нет ни у кого, кроме service_role: заливка — scripts/import-directory.ts
--   (service-ключ из .env.local), правки по заявкам владельцев — MCP-миграциями с архивом.
--   Форма «Claim or correct» пишет НЕ сюда, а в tool_feedback/leads через /api/signal (tool='directory').
--
-- ДО:    таблиц нет. anon/authenticated: SELECT 68, INSERT 4.
-- ПОСЛЕ: две таблицы, RLS включён, у anon/authenticated SELECT 70, INSERT 4, больше ничего.
--        Строк 0 — данные заливает scripts/import-directory.ts (148 записей, 1 865 фактов на 05.10).
-- ROLLBACK: drop table public.directory_facts; drop table public.directory_entries;

create table public.directory_entries (
  id                 integer primary key,
  slug               text        not null,
  category           text        not null,
  state              text        not null default 'live',
  tier               text        not null default 'listed',
  title              text        not null,
  vendor             text,
  url                text,
  description        text        not null,
  description_source text,
  hq_country         text,
  hq_country_source  text,
  reason             text,
  reason_source      text,
  closed_on          text,
  closed_source      text,
  successor          text,
  affiliate          text,
  affiliate_url      text,
  tags               text[]      not null default '{}',
  claimed_on         date,
  last_verified      date        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint directory_entries_slug_uq unique (category, slug),
  constraint directory_entries_slug_chk check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint directory_entries_category_chk check (category in (
    'sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
    'authoring-services-consultants', 'training', 'closed', 'not-listed')),
  constraint directory_entries_state_chk check (state in ('live', 'closed', 'not-listed')),
  constraint directory_entries_state_category_chk check (
    (state = 'closed') = (category = 'closed') and (state = 'not-listed') = (category = 'not-listed')),
  constraint directory_entries_tier_chk check (tier in ('listed', 'claimed', 'featured')),
  constraint directory_entries_tier_live_chk check (tier = 'listed' or state = 'live'),
  constraint directory_entries_claimed_chk check ((tier = 'listed') or claimed_on is not null),
  constraint directory_entries_live_chk check (state <> 'live' or (url ~ '^https://' and description_source ~ '^https?://')),
  constraint directory_entries_notlisted_chk check (state <> 'not-listed' or reason is not null),
  constraint directory_entries_country_chk check (hq_country is null or hq_country ~ '^[A-Z]{2}$'),
  constraint directory_entries_affiliate_chk check (affiliate is null or affiliate in ('sds_manager', 'ghslabels')),
  constraint directory_entries_affiliate_url_chk check (
    affiliate_url is null or (affiliate = 'sds_manager' and affiliate_url ~ '[?&]fpr=ghs3&fp_sid=[a-z0-9]{1,8}$')),
  -- ⚠ Печатные строки пишутся для читателя (урок s84, data_release_no_internal_marks): ни номеров
  -- сессий, ни служебных пометок в том, что попадает на страницу.
  constraint directory_entries_no_internal_marks check (
    coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(reason, '')
      !~* '(\msession\M|\ms[0-9]{2,3}\M|\mTODO\M|to-verify|verify URL)')
);
comment on table public.directory_entries is
  'GHS Tools & Services Directory (/directory/, №148, s92). Public read by design (pages prerender on anon); writes: service_role only (scripts/import-directory.ts, MCP).';

create table public.directory_facts (
  id           integer generated by default as identity primary key,
  entry_id     integer     not null references public.directory_entries (id) on delete cascade,
  kind         text        not null,
  label        text,
  value        text        not null,
  detail       text,
  quote        text,
  source_url   text        not null,
  evidence     text,
  sort         smallint    not null default 0,
  checked_on   date        not null,
  confirmed    boolean,
  confirmed_on date,
  constraint directory_facts_kind_chk check (kind in (
    'jurisdiction', 'jurisdiction_claim', 'language', 'deployment', 'platform', 'free_trial', 'api',
    'iso17100', 'ufi_pcn', 'pricing_model', 'price', 'pricing_note', 'pricing_statement', 'feature',
    'certification', 'integration', 'responsibility')),
  constraint directory_facts_source_chk check (source_url ~ '^https?://'),
  constraint directory_facts_quote_chk check ((kind = 'responsibility') = (quote is not null)),
  constraint directory_facts_confirmed_chk check ((confirmed is null) = (confirmed_on is null)),
  constraint directory_facts_no_internal_marks check (
    coalesce(value, '') || ' ' || coalesce(detail, '') !~* '(\msession\M|\ms[0-9]{2,3}\M|\mTODO\M|to-verify|verify URL)')
);
comment on table public.directory_facts is
  'One verifiable fact per row for a directory card, each with source_url. price/responsibility rows print only when confirmed = true (scripts/check-directory.ts found the evidence on the source page).';
create index directory_facts_entry_idx on public.directory_facts (entry_id, kind, sort);

alter table public.directory_entries enable row level security;
alter table public.directory_facts enable row level security;
create policy "public read" on public.directory_entries for select to anon, authenticated using (true);
create policy "public read" on public.directory_facts for select to anon, authenticated using (true);
grant select on public.directory_entries, public.directory_facts to anon, authenticated;

do $$
declare n_sel int; n_other int; n_total_sel int; n_total_ins int;
begin
  select count(*) into n_sel from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('directory_entries', 'directory_facts')
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';
  select count(*) into n_other from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('directory_entries', 'directory_facts')
      and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
  if n_sel <> 4 or n_other <> 0 then
    raise exception 'directory: grants SELECT=% (ожидалось 4), прочие=% (ожидалось 0)', n_sel, n_other;
  end if;
  select count(*) filter (where privilege_type = 'SELECT'), count(*) filter (where privilege_type = 'INSERT')
    into n_total_sel, n_total_ins
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon';
  if n_total_sel <> 70 or n_total_ins <> 4 then
    raise exception 'anon: SELECT=% (ожидалось 70), INSERT=% (ожидалось 4)', n_total_sel, n_total_ins;
  end if;
end $$;

-- VERIFICATION (как anon, метод s78):
--   set local role anon;
--   select count(*) from public.directory_entries;                 → число строк (0 до заливки)
--   insert into public.directory_entries (id, slug, category, title, description, last_verified)
--     values (0,'x','training','x','x',now());                     → 42501 permission denied
--
-- ОТЧЁТЫ:
--   -- записи по категориям и состояниям
--   select category, state, tier, count(*) from public.directory_entries group by 1,2,3 order by 1,2,3;
--   -- что ещё не подтверждено проверкой (цены и цитаты не печатаются, пока confirmed не true)
--   select kind, confirmed, count(*) from public.directory_facts
--     where kind in ('price','responsibility') group by 1,2 order by 1,2;
--   -- источники, которые давно не перепроверялись (квартальный цикл §18.3)
--   select e.title, f.kind, f.source_url, f.checked_on from public.directory_facts f
--     join public.directory_entries e on e.id = f.entry_id
--     where f.checked_on < now() - interval '90 days' order by f.checked_on;
