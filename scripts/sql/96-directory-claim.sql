-- 96-directory-claim.sql — session 96 (2026-10-06), каталог №148: профиль заявленной записи,
-- порядок по дате подтверждения, несколько категорий, подразделы услуг, закрытая таблица заявок.
-- Применено MCP-миграцией `s96_directory_claim` (DDL) + одним UPDATE-блоком (данные) 06.10.2026.
-- Проект решения — claude/directory-tiers-s95.md (§2b порядок, §2c несколько категорий, §3 поля).
--
-- ЧТО ИЗМЕНИЛОСЬ ПРОТИВ ПРОЕКТА s95 — два осознанных отступления:
--   1. Адрес, имя и роль заявителя НЕ в directory_entries (таблица публична на чтение — anon SELECT с s92,
--      и строки печатаются). Они в отдельной таблице directory_claims БЕЗ грантов: service_role only.
--      owner_domains (допустимые домены владельца, Priber ↔ sqlabel.com) — там же.
--   2. Логотипы и скриншоты — не в Storage-бакете, а в репозитории: public/directory-logos/<file>,
--      public/directory-screenshots/<file>; в базе только имя файла (logo_path, screenshot_path).
--      Причина: фаза 1 заявки и так требует сборки и деплоя (tier меняется в базе → страницы статические),
--      бакет добавил бы политику доступа и второе место, где что-то может не совпасть. Сторож dir-claimed
--      проверяет, что файл есть в dist.
--
-- ДО:    directory_entries 24 колонки; directory_facts 14; таблицы directory_claims нет. anon SELECT 70.
-- ПОСЛЕ: directory_entries +13 колонок, directory_facts +2 (provided_by, basis_for), directory_claims
--        (RLS, без грантов → у anon SELECT по-прежнему 70). Данные: subcategory у 39 записей услуг,
--        also_in у #1 ExactSDS и #24 SDS Manager (+ label-design-printing) на основании фактов #22 и #351,
--        подтверждённых 06.10 чтением страниц (evidence записан, check:directory перепроверит).
-- ROLLBACK: drop table public.directory_claims;
--           alter table public.directory_facts drop column provided_by, drop column basis_for;
--           alter table public.directory_entries drop column owner_confirmed_on, drop column logo_path, …
--           (все 13 колонок; CHECK-ограничения уходят вместе с колонками).

-- ─── 1. DDL (apply_migration s96_directory_claim) ───

alter table public.directory_entries
  add column owner_confirmed_on date,            -- владелец последний раз подтвердил факты; ключ порядка внутри claimed
  add column logo_path          text,            -- public/directory-logos/<file>; печатается при tier >= claimed
  add column owner_description  text,            -- <= 60 слов, без превосходных степеней (SUPERLATIVE_RE)
  add column pricing_url        text,
  add column terms_url          text,
  add column screenshot_path    text,            -- public/directory-screenshots/<file>; только featured
  add column contact_url        text,            -- кнопка Contact vendor; только featured
  add column rfq_opt_in         boolean not null default false,
  add column featured_from      date,
  add column featured_until     date,            -- после этой даты сборка печатает карточку как claimed (effectiveTier)
  add column featured_slots     text[] not null default '{}',
  add column also_in            text[] not null default '{}',  -- дополнительные категории; печатаются при подтверждённом basis_for
  add column subcategory        text;            -- только у authoring-services-consultants

alter table public.directory_entries
  add constraint directory_entries_owner_confirmed_chk check (tier = 'listed' or owner_confirmed_on is not null),
  add constraint directory_entries_owner_description_chk check (owner_description is null or length(owner_description) <= 420),
  add constraint directory_entries_logo_chk check (logo_path is null or logo_path ~ '^[a-z0-9]+(-[a-z0-9]+)*\.(svg|png)$'),
  add constraint directory_entries_screenshot_chk check (screenshot_path is null or screenshot_path ~ '^[a-z0-9]+(-[a-z0-9]+)*\.(png|jpg|webp)$'),
  add constraint directory_entries_owner_urls_chk check (
    (pricing_url is null or pricing_url ~ '^https?://') and (terms_url is null or terms_url ~ '^https?://')
    and (contact_url is null or contact_url ~ '^(https?://|mailto:)')),
  add constraint directory_entries_featured_dates_chk check (
    (featured_from is null) = (featured_until is null) and (featured_until is null or featured_until >= featured_from)
    and (tier <> 'featured' or featured_from is not null)),
  add constraint directory_entries_featured_slots_chk check (
    featured_slots <@ array['category-top','hub','tool:label-maker','tool:classifier','tool:ate','search-miss']::text[]),
  add constraint directory_entries_also_in_chk check (
    also_in <@ array['sds-authoring-software','sds-management','label-design-printing','regulatory-databases',
                     'authoring-services-consultants','training']::text[]
    and not (category = any (also_in))),
  add constraint directory_entries_subcategory_chk check (
    subcategory is null or (category = 'authoring-services-consultants'
      and subcategory in ('sds-translation','sds-authoring-eu','sds-authoring-north-america','regulatory-consulting')));

alter table public.directory_facts
  add column provided_by text not null default 'editor',   -- 'owner' = факт прислал владелец; подпись «stated by the vendor» до подтверждения
  add column basis_for   text;                              -- feature, на котором держится дополнительная категория
alter table public.directory_facts
  add constraint directory_facts_provided_by_chk check (provided_by in ('editor','owner')),
  add constraint directory_facts_basis_for_chk check (
    basis_for is null or (kind = 'feature' and basis_for in ('sds-authoring-software','sds-management',
      'label-design-printing','regulatory-databases','authoring-services-consultants','training')));

create table public.directory_claims (
  id            integer generated by default as identity primary key,
  entry_id      integer     not null references public.directory_entries (id) on delete cascade,
  owner_email   text        not null,
  owner_domains text[]      not null default '{}',
  owner_name    text,
  owner_role    text,
  requested_at  timestamptz not null default now(),
  verified_at   timestamptz,
  note          text,
  constraint directory_claims_email_chk check (owner_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
comment on table public.directory_claims is
  'Directory claim trail (s96): who claimed which listing, from which address; domain must match the listing host. service_role only — no anon/authenticated grants.';
alter table public.directory_claims enable row level security;

do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'directory_claims' and grantee in ('anon', 'authenticated');
  if n <> 0 then raise exception 'directory_claims: у anon/authenticated есть гранты (%)', n; end if;
end $$;

-- ─── 2. Данные (execute_sql, одна транзакция) ───
-- Те же значения стоят в посеве scripts/data/directory-v3.json — посев остаётся источником правды.

begin;
update public.directory_facts set basis_for = 'label-design-printing', evidence = 'generate compliant GHS labels',
  confirmed = true, confirmed_on = '2026-10-06' where id = 22 and entry_id = 1;     -- «generate compliant GHS labels directly from SDS data»
update public.directory_facts set basis_for = 'label-design-printing', evidence = 'secondary container labels',
  confirmed = true, confirmed_on = '2026-10-06' where id = 351 and entry_id = 24;   -- «One-click generation of secondary container labels»
update public.directory_entries set also_in = '{label-design-printing}' where id in (1, 24);
update public.directory_entries set subcategory = 'sds-translation'
  where category = 'authoring-services-consultants' and id in (146,147,148,149,151,152);
update public.directory_entries set subcategory = 'sds-authoring-eu'
  where category = 'authoring-services-consultants' and id in (62,63,64,65,66,67,72,124,128,131,134,145);
update public.directory_entries set subcategory = 'sds-authoring-north-america'
  where category = 'authoring-services-consultants' and id in (68,70,71,94,125,126,127,129,130,142);
update public.directory_entries set subcategory = 'regulatory-consulting'
  where category = 'authoring-services-consultants' and id in (61,132,133,135,136,137,138,139,140,143,144);
commit;
-- → regulatory-consulting 11 · sds-authoring-eu 12 · sds-authoring-north-america 10 · sds-translation 6 (= 39, null 0)

-- ─── 3. Шаблон заявки (фаза 1, руками) — по одной записи, архив scripts/sql/9x-claim-<slug>.sql ───
-- insert into public.directory_claims (entry_id, owner_email, owner_domains, owner_name, owner_role, verified_at, note)
--   values (<id>, '<name@vendor.tld>', '{vendor.tld}', '<Name>', '<Role>', now(), 'reply in thread <date>');
-- update public.directory_entries set tier = 'claimed', claimed_on = current_date, owner_confirmed_on = current_date,
--   logo_path = '<slug>.svg', owner_description = '<= 60 words', pricing_url = '…', terms_url = '…' where id = <id>;
-- update public.directory_facts set provided_by = 'owner' where id in (…);   -- факты, которые дал владелец
--
-- ОТЧЁТЫ:
--   select id, title, tier, claimed_on, owner_confirmed_on, also_in, subcategory from public.directory_entries
--     where tier <> 'listed' or cardinality(also_in) > 0 order by owner_confirmed_on desc nulls last;
--   select c.entry_id, e.title, c.owner_email, c.requested_at, c.verified_at from public.directory_claims c
--     join public.directory_entries e on e.id = c.entry_id order by c.requested_at desc;
