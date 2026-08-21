-- ============================================================================
-- Session 78 · №99 шаги 1–2 · ревизия anon-доступа (архив миграции)
-- Применено через Supabase MCP как миграция
--   s78_anon_revoke_write_grants_close_engine_tables   (2026-08-21)
-- План: claude/mixture-classifier-design.md §3.2
-- ============================================================================
--
-- ДО миграции (замер s77/s78):
--   anon / authenticated имели полный набор table-grants
--   (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)
--   на всех 71 таблицах public; от записи держала ТОЛЬКО RLS-политика.
--   default privileges роли postgres раздавали то же самое каждой новой таблице.
--   annex6_limits / annex6_table3 / clp_generic_limits были открыты на чтение
--   политикой "public read" (SELECT using (true)).
--
-- Инвентаризация ключей (шаг 0, s78):
--   anon-ключ:    scripts/check-dist.ts (чтение, 20+ таблиц, движка нет),
--                 scripts/check-label-layout.ts (h/p_statements, translations),
--                 scripts/generate-pictogram-redirects.mjs (substances),
--                 functions/api/leads.ts (INSERT leads, Prefer: return=minimal)
--   service-ключ: scripts/import-*.ts, rebuild-name-forms.ts,
--                 import-annex6-table3.mjs (единственный писатель annex6_table3)
--   Три таблицы движка не читает никто на anon-ключе → закрыть можно без правки кода.
--
-- ПОСЛЕ миграции:
--   anon / authenticated: SELECT на 68 таблицах (71 − 3 движка), INSERT на 4
--   (leads, rfq_requests, selector_calculations, mixtures); ничего больше.
--   Новые таблицы и последовательности (владелец postgres) — БЕЗ grants для
--   anon/authenticated: нужен явный GRANT + политика, либо RPC/Function.
--   ⚠ default privileges роли supabase_admin не изменены (postgres не член
--   этой роли); таблицы из SQL-редактора/MCP создаёт postgres — на них
--   правило действует.
--
-- Проверено под `set local role anon` (s78): SELECT из трёх таблиц движка →
-- 42501 permission denied; SELECT substances / view clp_matrix_full / RPC
-- get_storage_verdict → OK; INSERT в четыре формы → OK; UPDATE/DELETE/TRUNCATE
-- leads, INSERT substances, UPDATE h_statements → 42501. Тестовые строки удалены.
-- get_advisors(security): новых WARN нет; INFO «RLS enabled, no policy» на трёх
-- таблицах движка — намеренно.
-- ============================================================================

-- ── Шаг 1: второй замок — table-level grants ─────────────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- чтение остаётся как было (RLS-политики не трогаем)
grant select on all tables in schema public to anon, authenticated;

-- запись — только там, где есть INSERT-политика (формы: лид, RFQ, share-link, смесь)
grant insert on public.leads, public.rfq_requests, public.selector_calculations, public.mixtures
  to anon, authenticated;

-- новые таблицы/последовательности по умолчанию закрыты для anon/authenticated
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ── Шаг 2: таблицы движка классификатора — закрыть для anon/authenticated ────
-- Читать будет только Pages Function /api/classify с service-ключом
-- (service_role обходит RLS — политика ему не нужна).
drop policy if exists "public read" on public.annex6_limits;
drop policy if exists "public read" on public.annex6_table3;
drop policy if exists "public read" on public.clp_generic_limits;

revoke select on public.annex6_limits, public.annex6_table3, public.clp_generic_limits
  from anon, authenticated;

-- ── Контроль ─────────────────────────────────────────────────────────────────
-- select grantee, privilege_type, count(*)
--   from information_schema.role_table_grants
--  where table_schema='public' and grantee in ('anon','authenticated')
--  group by 1,2 order by 1,2;
-- ожидание: anon/authenticated — SELECT 68, INSERT 4; других строк нет.

-- ── Откат (вручную, при необходимости) ───────────────────────────────────────
-- grant all on all tables    in schema public to anon, authenticated;
-- grant all on all sequences in schema public to anon, authenticated;
-- alter default privileges in schema public grant all on tables    to anon, authenticated;
-- alter default privileges in schema public grant all on sequences to anon, authenticated;
-- create policy "public read" on public.annex6_limits      for select using (true);
-- create policy "public read" on public.annex6_table3      for select using (true);
-- create policy "public read" on public.clp_generic_limits for select using (true);
