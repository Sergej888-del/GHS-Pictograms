-- ============================================================================
-- Session 78 · A0 (№101) · annex6_classification — архив миграции + правки данных
-- Применено через Supabase MCP как миграция s78_annex6_classification_a0 (2026-08-21)
-- Парсер: src/lib/classifier/annex6Abbrev.ts + annex6Classification.ts
-- Проверка: npm run check:classifier · Заполнение: npm run build:annex6-classification
-- ============================================================================
--
-- ДО: пар «класс + категория» у веществ в готовом виде не было (`hazard_classifications`
--     пуста с s9); класс выводился из H-кода (`hazardClasses.ts`) с неоднозначностями.
-- ПОСЛЕ: две закрытые таблицы (grants только postgres/service_role — default privileges
--     сняты в s78; RLS без политик). Ожидаемое наполнение по снимку s78:
--     annex6_classification 13 513 пар · annex6_classification_row 4 419 строк.
--
-- Найдено обратной сверкой A0 — ТРИ новые ошибки регламента (с акта 2008 г., ▼M16):
--   012-002-00-9  Self-heat. 1 с H252 (надо H251)        → statement-mismatch
--   607-225-00-9  Self-react. C **** с H241 (надо H242)  → statement-mismatch
--   602-091-00-8  H411 без класса; Table 3.2: N; R51-53  → class-omitted (новый вид)
-- Записаны в src/lib/annex6RowErrata.ts (9 записей). База ведётся по классу (s76):

update substances set h_statement_codes = array_replace(h_statement_codes, 'H252', 'H251')
 where index_number = '012-002-00-9' and 'H252' = any(h_statement_codes);   -- было {H228,H252,H261}
update substances set h_statement_codes = array_replace(h_statement_codes, 'H241', 'H242')
 where index_number = '607-225-00-9' and 'H241' = any(h_statement_codes);   -- было {H373,H318,H317,H241}
-- 602-091-00-8: H411 остаётся (class-omitted, решение s78 — см. хендофф); пиктограммы не трогались.

-- ── DDL (как применено) ──────────────────────────────────────────────────────
create table public.annex6_classification (
  index_number   varchar  not null references public.annex6_table3(index_number) on delete cascade,
  seq            smallint not null,
  class_code     varchar  not null references public.hazard_class_catalog(class_code),
  category_code  varchar,
  category_raw   varchar,
  h_code         varchar,
  h_code_full    varchar,
  organs         text,
  h_marker       varchar,
  star           boolean  not null default false,
  test_required  boolean  not null default false,
  raw            text     not null,
  flags          text[]   not null default '{}',
  parser_version varchar  not null,
  updated_at     timestamptz not null default now(),
  primary key (index_number, seq)
);
create index annex6_classification_class_idx on public.annex6_classification (class_code, category_code);
create index annex6_classification_h_idx on public.annex6_classification (h_code);

create table public.annex6_classification_row (
  index_number    varchar  primary key references public.annex6_table3(index_number) on delete cascade,
  n_pairs         smallint not null,
  row_flags       text[]   not null default '{}',
  unparsed        text[]   not null default '{}',
  unmatched_h     text[]   not null default '{}',
  class_cat_norm  text     not null,
  h_norm          text     not null,
  parser_version  varchar  not null,
  updated_at      timestamptz not null default now()
);
alter table public.annex6_classification     enable row level security;
alter table public.annex6_classification_row enable row level security;

-- ── Контроль ─────────────────────────────────────────────────────────────────
-- select count(*) from annex6_classification;            -- 13 513
-- select count(*) from annex6_classification_row;        -- 4 419
-- select class_code, category_code, count(*) from annex6_classification group by 1,2 order by 1,2;
-- select * from annex6_classification_row where cardinality(unparsed) > 0;   -- должно быть пусто
-- select grantee from information_schema.role_table_grants where table_name='annex6_classification'; -- только postgres, service_role

-- ── Откат ────────────────────────────────────────────────────────────────────
-- drop table public.annex6_classification_row; drop table public.annex6_classification;
-- update substances set h_statement_codes = array_replace(h_statement_codes,'H251','H252') where index_number='012-002-00-9';
-- update substances set h_statement_codes = array_replace(h_statement_codes,'H242','H241') where index_number='607-225-00-9';
