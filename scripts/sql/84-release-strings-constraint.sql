-- scripts/sql/84-release-strings-constraint.sql
-- Архив миграции session 84, третья. Применяется ПОСЛЕ
-- `84-release-strings-for-readers.sql`.
--
-- ЗАЧЕМ. Строки релиза печатаются в аудиторском отчёте, и в двух из них жила наша
-- внутренняя бухгалтерия («sessions 76-79», «s79: class-omitted retired»).
-- Значения исправлены предыдущей миграцией — эта не даёт им вернуться.
--
-- ⚠⚠ ПОЧЕМУ ОГРАНИЧЕНИЕ В БАЗЕ, А НЕ ПРОВЕРКА В `check:dist`. Первая попытка
-- сторожа читала `data_release` из `check-dist.ts` и упала: `permission denied`.
-- И правильно упала — таблица ЗАКРЫТА для anon с session 78 (§15.1), а
-- `check-dist.ts` ходит именно anon-ключом. Проверка, которая не может прочитать
-- то, что сторожит, не сторож. Правило переехало туда, где живут сами данные:
-- строку с внутренней пометкой база просто НЕ ПРИМЕТ — ни из миграции, ни из
-- SQL Editor, ни из скрипта.
--
-- ДО:    ограничения нет, в печатаемые поля можно записать что угодно.
-- ПОСЛЕ: `data_release_no_internal_marks` на четырёх печатаемых колонках.
--        Данные не меняются: текущие значения ему уже удовлетворяют (проверено
--        pre-check-ом ниже, иначе ALTER упал бы).
--
-- ОТКАТ:
--   alter table public.data_release drop constraint data_release_no_internal_marks;

begin;

-- ── 1. проверка до: текущая строка обязана проходить будущее ограничение ────
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad from public.data_release
   where release_key ~* '(session|\ms[0-9]{2}\M)'
      or atp ~* '(session|\ms[0-9]{2}\M)'
      or parser_version ~* '(session|\ms[0-9]{2}\M)'
      or engine_version ~* '(session|\ms[0-9]{2}\M)';
  if v_bad > 0 then
    raise exception 'в % строках релиза есть внутренние пометки — сначала 84-release-strings-for-readers.sql', v_bad;
  end if;
end $$;

-- ── 2. ограничение ──────────────────────────────────────────────────────────
-- ⛔ Только те колонки, которые ПЕЧАТАЮТСЯ в штампе отчёта. `note` намеренно
--    не ограничена: её читаем мы, а не посетитель.
alter table public.data_release
  add constraint data_release_no_internal_marks check (
    release_key    !~* '(session|\ms[0-9]{2}\M)'
    and atp        !~* '(session|\ms[0-9]{2}\M)'
    and parser_version !~* '(session|\ms[0-9]{2}\M)'
    and engine_version !~* '(session|\ms[0-9]{2}\M)'
  );

comment on constraint data_release_no_internal_marks on public.data_release is
  'These four columns are printed in the audit report shown to inspectors. Session numbers and other internal bookkeeping do not belong there: a version string must identify the parse, and what changed in it lives in our own notes.';

-- ── 3. проверка после: ограничение существует и действительно ловит ─────────
do $$
declare
  v_exists int;
  v_caught boolean := false;
begin
  select count(*) into v_exists from pg_constraint
   where conname = 'data_release_no_internal_marks'
     and conrelid = 'public.data_release'::regclass;
  if v_exists <> 1 then
    raise exception 'ограничение не создалось';
  end if;

  -- ⭐ Сторож, который ни разу не сработал, ничего не доказывает: пробуем
  --    записать заведомо плохое значение и ждём отказа.
  -- ⚠⚠ Внутренний `begin … exception … end` — это и ЕСТЬ подтранзакция PL/pgSQL:
  --    при исключении всё, что блок успел изменить, откатывается. ⛔ Явные
  --    `savepoint` / `rollback to savepoint` в PL/pgSQL запрещены (первая версия
  --    этого файла упала на них: «syntax error at or near "to"»).
  begin
    update public.data_release set atp = atp || ' (documented in sessions 76-79)' where is_current;
    -- Досюда доходить не должны: значит ограничение промолчало. Исключение
    -- нужно и чтобы это заметить, и чтобы откатить только что сделанный UPDATE.
    raise exception using errcode = 'triggered_action_exception', message = 'probe survived';
  exception
    when check_violation then v_caught := true;
    when triggered_action_exception then v_caught := false;
  end;
  if not v_caught then
    raise exception 'ограничение НЕ ловит внутреннюю пометку — проверьте регулярное выражение';
  end if;
end $$;

commit;

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ───────────────────────────────────────────────
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.data_release'::regclass and contype = 'c';
--   → data_release_no_internal_marks | CHECK (…)
-- update public.data_release set parser_version = 'a0-parser 1.2 (s90: test)' where is_current;
--   → ERROR: new row for relation "data_release" violates check constraint
