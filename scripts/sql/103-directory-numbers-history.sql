-- 103-directory-numbers-history.sql — 2026-10-11, каталог /directory/: числа в фактах (A) и история (B)
-- Применено MCP apply_migration «directory_numbers_history».
--
-- ЗАЧЕМ. Отчёты по каталогу («сколько стоит SDS в Европе», «сколько языков у SDS-софта», «кто сменил
-- тарифы за год») требуют чисел и истории, а в базе — только текст факта на момент последней заливки.
--
-- A. ЧИСЛА РЯДОМ С ТЕКСТОМ. У факта остаётся value («EUR 1,249 per month») — его печатает сайт и по нему
--    сторож ищет evidence. Рядом — разобранные поля для отчётов:
--      num / num_max — число или диапазон («USD 175–300 per SDS» → 175 / 300);
--      num_qual      — exact | from («from EUR 30») | at_least («50+ languages») | up_to | approx | range;
--      unit          — цена: за что (flat — цена тарифа целиком, sds, user, site, workstation, licence, word,
--                      translation, label, package, language_option, document_block);
--                      языки: languages | eu_official («все языки ЕС», num = 24 и больше) | named (языки
--                      перечислены, num = их число) | unspecified (без числа); пробный период: days;
--      unit_qty      — сколько единиц покрывает цена («Standard - 15 SDS», USD 1,499 / year → sds × 15);
--      period        — month | year | one_off; null — период не назван (лицензия, цена за единицу);
--      currency      — ISO 4217; null у бесплатного и где страница валюту не называет («$1,299»);
--      price_role    — plan | service | training | add_on | upgrade | hardware | consumable | membership.
--    ⚠ Источник правды — посев scripts/data/directory-v3.json, как и для всего остального. Словари и
--      сверку числа с текстом (num обязан стоять в value) проверяет scripts/import-directory.ts
--      (src/lib/directoryNumbers.ts); база держит только формат — словарь расширяется без миграции.
--    У записи: terms_kind (html | pdf | website_only | none; null — не проверяли), terms_doc_url,
--    terms_dated (дата документа, как напечатана: «2017-03-01», «2022-02», «2006»).
--
-- B. ИСТОРИЯ. directory_fact_history / directory_entry_history — версии «с даты по дату» (valid_from включ.,
--    valid_to не включ.; открытая версия — valid_to null). Новая версия — только при настоящем изменении:
--      факт: запись, вид, подпись, текст, деталь, цитата, источник, тип источника, confirmed;
--      запись: slug, категория, подраздел, состояние, уровень, название, вендор, адрес, страна,
--              also_in, теги, pricing_url, terms_*, closed_on, successor.
--    Разобранные числа и дата последнего подтверждения (last_confirmed_on) переписываются в открытой
--    версии на месте: они следуют за текстом, событием не являются.
--    Снимок — функция directory_snapshot(): её вызывает scripts/import-directory.ts в конце заливки, и ею
--    кончается каждый SQL подтверждений по отчёту check:directory (scripts/sql/NNN-directory-check-*.sql).
--    Правка в тот же день, что открыла версию, переписывает её на месте (точность истории — день).
--    ⚠ Строк из истории не удаляет никто: ни функция, ни заливка (у истории нет внешних ключей — факт,
--    удалённый из посева, остаётся в истории с end_reason = 'removed').
--    ⚠ Предохранитель: если фактов в базе меньше 90 % открытых версий, снимок отказывается (заливка
--    оборвалась между очисткой и вставкой) — перезапустить заливку; сознательно — p_force => true.
--
-- ⚠ ДОСТУП (§15.1). Новые колонки directory_entries / directory_facts читаются anon так же, как
--   остальные (публичные данные, табличный GRANT SELECT из 92-directory.sql). Таблицы истории ЗАКРЫТЫ:
--   RLS включён, политик и грантов нет — читают service_role и MCP. Открыть на чтение — когда появится
--   публичная страница отчёта, отдельной миграцией. Функция — только service_role.
--
-- ДО:    у directory_facts нет числовых полей; истории нет.
-- ПОСЛЕ: + 8 колонок directory_facts, + 3 колонки directory_entries (все null до заливки посева),
--        + 2 таблицы истории (0 строк; первый снимок — заливка 2026-10-11), + функция directory_snapshot.
-- ROLLBACK:
--   drop function public.directory_snapshot(date, boolean);
--   drop table public.directory_fact_history; drop table public.directory_entry_history;
--   alter table public.directory_entries drop column terms_kind, drop column terms_doc_url, drop column terms_dated;
--   alter table public.directory_facts drop column num, drop column num_max, drop column num_qual, drop column unit,
--     drop column unit_qty, drop column period, drop column currency, drop column price_role;

-- ───────────────────────────── A ─────────────────────────────

alter table public.directory_facts
  add column num        numeric,
  add column num_max    numeric,
  add column num_qual   text,
  add column unit       text,
  add column unit_qty   numeric,
  add column period     text,
  add column currency   text,
  add column price_role text;

alter table public.directory_facts
  add constraint directory_facts_num_kind_chk check (
    (num is null and unit is null) or kind in ('price', 'language', 'free_trial')),
  add constraint directory_facts_num_qual_chk check (
    (num_qual is null) = (num is null)
    and (num_qual is null or num_qual in ('exact', 'from', 'at_least', 'up_to', 'approx', 'range'))),
  add constraint directory_facts_num_max_chk check (
    (num_max is not null) = (coalesce(num_qual, '') = 'range') and (num_max is null or num_max > num)),
  add constraint directory_facts_unit_chk check (
    (unit is null or unit ~ '^[a-z][a-z_]*$') and (unit_qty is null or (unit_qty > 0 and unit is not null))),
  add constraint directory_facts_price_cols_chk check (
    (period is null and currency is null and price_role is null) or kind = 'price'),
  add constraint directory_facts_period_chk check (period is null or period in ('month', 'year', 'one_off')),
  add constraint directory_facts_currency_chk check (currency is null or currency ~ '^[A-Z]{3}$'),
  add constraint directory_facts_price_role_chk check (price_role is null or price_role in (
    'plan', 'service', 'training', 'add_on', 'upgrade', 'hardware', 'consumable', 'membership'));

alter table public.directory_entries
  add column terms_kind    text,
  add column terms_doc_url text,
  add column terms_dated   text;

alter table public.directory_entries
  add constraint directory_entries_terms_chk check (
    (terms_kind is null or terms_kind in ('html', 'pdf', 'website_only', 'none'))
    and (terms_doc_url is null or (terms_doc_url ~ '^https?://' and terms_kind in ('html', 'pdf', 'website_only')))
    and (terms_dated is null or (terms_dated ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'
                                 and terms_kind in ('html', 'pdf', 'website_only'))));

-- ───────────────────────────── B ─────────────────────────────

create table public.directory_fact_history (
  id                bigint generated always as identity primary key,
  fact_id           integer not null,
  entry_id          integer not null,
  kind              text    not null,
  label             text,
  value             text    not null,
  detail            text,
  quote             text,
  source_url        text    not null,
  source_kind       text,
  confirmed         boolean,
  num               numeric,
  num_max           numeric,
  num_qual          text,
  unit              text,
  unit_qty          numeric,
  period            text,
  currency          text,
  price_role        text,
  valid_from        date    not null,
  valid_to          date,
  last_confirmed_on date,
  end_reason        text,
  constraint directory_fact_history_dates_chk check (valid_to is null or valid_to >= valid_from),
  constraint directory_fact_history_end_chk check (
    (valid_to is null) = (end_reason is null) and (end_reason is null or end_reason in ('changed', 'removed')))
);
create unique index directory_fact_history_open_uq on public.directory_fact_history (fact_id) where valid_to is null;
create index directory_fact_history_entry_idx on public.directory_fact_history (entry_id, kind, valid_from);
alter table public.directory_fact_history enable row level security;

create table public.directory_entry_history (
  id            bigint generated always as identity primary key,
  entry_id      integer not null,
  slug          text    not null,
  category      text    not null,
  subcategory   text,
  state         text    not null,
  tier          text    not null,
  title         text    not null,
  vendor        text,
  url           text,
  hq_country    text,
  also_in       text[]  not null default '{}',
  tags          text[]  not null default '{}',
  pricing_url   text,
  terms_kind    text,
  terms_doc_url text,
  terms_dated   text,
  closed_on     text,
  successor     text,
  valid_from    date    not null,
  valid_to      date,
  end_reason    text,
  constraint directory_entry_history_dates_chk check (valid_to is null or valid_to >= valid_from),
  constraint directory_entry_history_end_chk check (
    (valid_to is null) = (end_reason is null) and (end_reason is null or end_reason in ('changed', 'removed')))
);
create unique index directory_entry_history_open_uq on public.directory_entry_history (entry_id) where valid_to is null;
create index directory_entry_history_entry_idx on public.directory_entry_history (entry_id, valid_from);
alter table public.directory_entry_history enable row level security;

revoke all on public.directory_fact_history, public.directory_entry_history from anon, authenticated;

create or replace function public.directory_snapshot(
  p_on    date    default (now() at time zone 'Europe/Riga')::date,
  p_force boolean default false
)
returns table (opened_facts integer, corrected_facts integer, closed_facts integer, open_fact_versions integer,
               opened_entries integer, corrected_entries integer, closed_entries integer)
language plpgsql
set search_path = public
as $fn$
declare
  v_open  integer;
  v_now   integer;
  v_last  date;
  v_of    integer; v_cf integer; v_xf integer;
  v_oe    integer; v_ce integer; v_xe integer;
begin
  select count(*), max(valid_from) into v_open, v_last from directory_fact_history where valid_to is null;
  select count(*) into v_now from directory_facts;
  if v_last is not null and p_on < v_last then
    raise exception 'directory_snapshot: date % is earlier than the latest open version (%)', p_on, v_last;
  end if;
  if not p_force and v_open > 0 and v_now < v_open * 0.9 then
    raise exception 'directory_snapshot: % facts in the table vs % open versions — import cut off between clearing and inserting? Re-run the import (or p_force => true if the removal is intended)', v_now, v_open;
  end if;

  -- ── факты ──
  -- 1) версия открыта сегодня и сегодня же изменилась — переписать на месте
  update directory_fact_history h set
    entry_id = f.entry_id, kind = f.kind, label = f.label, value = f.value, detail = f.detail, quote = f.quote,
    source_url = f.source_url, source_kind = f.source_kind, confirmed = f.confirmed
  from directory_facts f
  where h.valid_to is null and h.fact_id = f.id and h.valid_from = p_on
    and (h.entry_id, h.kind, h.label, h.value, h.detail, h.quote, h.source_url, h.source_kind, h.confirmed)
        is distinct from (f.entry_id, f.kind, f.label, f.value, f.detail, f.quote, f.source_url, f.source_kind, f.confirmed);
  get diagnostics v_cf = row_count;

  -- 2) закрыть изменившиеся версии и версии удалённых фактов
  update directory_fact_history h set
    valid_to = p_on,
    end_reason = case when x.fid is null then 'removed' else 'changed' end
  from (
    select h2.id as hid, f.id as fid
    from directory_fact_history h2
    left join directory_facts f on f.id = h2.fact_id
    where h2.valid_to is null
      and (f.id is null
           or (h2.entry_id, h2.kind, h2.label, h2.value, h2.detail, h2.quote, h2.source_url, h2.source_kind, h2.confirmed)
              is distinct from (f.entry_id, f.kind, f.label, f.value, f.detail, f.quote, f.source_url, f.source_kind, f.confirmed))
  ) x
  where h.id = x.hid;
  get diagnostics v_xf = row_count;

  -- 3) открыть версии для новых и изменившихся фактов
  insert into directory_fact_history (
    fact_id, entry_id, kind, label, value, detail, quote, source_url, source_kind, confirmed,
    num, num_max, num_qual, unit, unit_qty, period, currency, price_role, valid_from, last_confirmed_on)
  select f.id, f.entry_id, f.kind, f.label, f.value, f.detail, f.quote, f.source_url, f.source_kind, f.confirmed,
         f.num, f.num_max, f.num_qual, f.unit, f.unit_qty, f.period, f.currency, f.price_role, p_on,
         case when f.confirmed then f.confirmed_on end
  from directory_facts f
  where not exists (select 1 from directory_fact_history h where h.fact_id = f.id and h.valid_to is null);
  get diagnostics v_of = row_count;

  -- 4) разобранные числа и последнее подтверждение — в открытой версии на месте
  update directory_fact_history h set
    num = f.num, num_max = f.num_max, num_qual = f.num_qual, unit = f.unit, unit_qty = f.unit_qty,
    period = f.period, currency = f.currency, price_role = f.price_role,
    last_confirmed_on = greatest(h.last_confirmed_on, case when f.confirmed then f.confirmed_on end)
  from directory_facts f
  where h.valid_to is null and h.fact_id = f.id
    and ((h.num, h.num_max, h.num_qual, h.unit, h.unit_qty, h.period, h.currency, h.price_role)
         is distinct from (f.num, f.num_max, f.num_qual, f.unit, f.unit_qty, f.period, f.currency, f.price_role)
         or (f.confirmed and f.confirmed_on > coalesce(h.last_confirmed_on, '-infinity'::date)));

  -- ── записи ──
  update directory_entry_history h set
    slug = e.slug, category = e.category, subcategory = e.subcategory, state = e.state, tier = e.tier,
    title = e.title, vendor = e.vendor, url = e.url, hq_country = e.hq_country, also_in = e.also_in, tags = e.tags,
    pricing_url = e.pricing_url, terms_kind = e.terms_kind, terms_doc_url = e.terms_doc_url,
    terms_dated = e.terms_dated, closed_on = e.closed_on, successor = e.successor
  from directory_entries e
  where h.valid_to is null and h.entry_id = e.id and h.valid_from = p_on
    and (h.slug, h.category, h.subcategory, h.state, h.tier, h.title, h.vendor, h.url, h.hq_country, h.also_in,
         h.tags, h.pricing_url, h.terms_kind, h.terms_doc_url, h.terms_dated, h.closed_on, h.successor)
        is distinct from
        (e.slug, e.category, e.subcategory, e.state, e.tier, e.title, e.vendor, e.url, e.hq_country, e.also_in,
         e.tags, e.pricing_url, e.terms_kind, e.terms_doc_url, e.terms_dated, e.closed_on, e.successor);
  get diagnostics v_ce = row_count;

  update directory_entry_history h set
    valid_to = p_on,
    end_reason = case when x.eid is null then 'removed' else 'changed' end
  from (
    select h2.id as hid, e.id as eid
    from directory_entry_history h2
    left join directory_entries e on e.id = h2.entry_id
    where h2.valid_to is null
      and (e.id is null
           or (h2.slug, h2.category, h2.subcategory, h2.state, h2.tier, h2.title, h2.vendor, h2.url, h2.hq_country,
               h2.also_in, h2.tags, h2.pricing_url, h2.terms_kind, h2.terms_doc_url, h2.terms_dated, h2.closed_on,
               h2.successor)
              is distinct from
              (e.slug, e.category, e.subcategory, e.state, e.tier, e.title, e.vendor, e.url, e.hq_country,
               e.also_in, e.tags, e.pricing_url, e.terms_kind, e.terms_doc_url, e.terms_dated, e.closed_on,
               e.successor))
  ) x
  where h.id = x.hid;
  get diagnostics v_xe = row_count;

  insert into directory_entry_history (
    entry_id, slug, category, subcategory, state, tier, title, vendor, url, hq_country, also_in, tags,
    pricing_url, terms_kind, terms_doc_url, terms_dated, closed_on, successor, valid_from)
  select e.id, e.slug, e.category, e.subcategory, e.state, e.tier, e.title, e.vendor, e.url, e.hq_country,
         e.also_in, e.tags, e.pricing_url, e.terms_kind, e.terms_doc_url, e.terms_dated, e.closed_on, e.successor, p_on
  from directory_entries e
  where not exists (select 1 from directory_entry_history h where h.entry_id = e.id and h.valid_to is null);
  get diagnostics v_oe = row_count;

  return query select v_of, v_cf, v_xf,
    (select count(*)::integer from directory_fact_history where valid_to is null),
    v_oe, v_ce, v_xe;
end;
$fn$;

revoke all on function public.directory_snapshot(date, boolean) from public, anon, authenticated;
grant execute on function public.directory_snapshot(date, boolean) to service_role;
