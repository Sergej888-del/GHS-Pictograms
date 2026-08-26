-- scripts/sql/84-release-strings-for-readers.sql
-- Архив миграции session 84, вторая (применяется в SQL Editor Сергеем).
-- ⚠ Применять ПОСЛЕ `84-report-stamp-and-counts.sql` и ПЕРЕД деплоем кода.
--
-- ЗАЧЕМ (замечание Сергея). Штамп версии печатается в аудиторском отчёте,
-- который человек показывает инспектору. В двух строках релиза стояла наша
-- внутренняя бухгалтерия:
--   · atp            = «… + Official Journal errata documented in sessions 76-79»
--   · parser_version = «a0-parser 1.1 (s79: class-omitted retired)»
-- Читателю «sessions 76-79» и «s79» не говорят ничего и выглядят как записка
-- разработчика, забытая в паспорте безопасности. Номер сессии — наш способ
-- вести дневник, а не свойство данных.
--
-- ⛔ ПРАВИЛО: строка, которую печатает отчёт, пишется ДЛЯ ЧИТАТЕЛЯ. Что именно
--    поменялось в разборе, живёт в `claude/*.md`; версия обязана лишь
--    идентифицировать разбор.
--
-- ДО:    atp «ATP 21 (2024/2564) + Official Journal errata documented in sessions 76-79»;
--        parser_version «a0-parser 1.1 (s79: class-omitted retired)» — в строке релиза
--        и на 13 512 парах + 4 419 строках A0.
-- ПОСЛЕ: atp «ATP 21 — Commission Regulation (EU) 2024/2564, with documented Official
--        Journal errata applied»; parser_version «a0-parser 1.1» везде.
--        ⚠ Данные НЕ трогаются: меняется только отметка, разбор тот же самый.
--
-- ОТКАТ:
--   update public.data_release
--      set atp = 'ATP 21 (2024/2564) + Official Journal errata documented in sessions 76-79',
--          parser_version = 'a0-parser 1.1 (s79: class-omitted retired)'
--    where is_current;
--   update public.annex6_classification set parser_version = 'a0-parser 1.1 (s79: class-omitted retired)';
--   update public.annex6_classification_row set parser_version = 'a0-parser 1.1 (s79: class-omitted retired)';

begin;

-- ── 1. проверка до ──────────────────────────────────────────────────────────
do $$
declare
  v_pairs int;
  v_rows int;
  v_release int;
begin
  select count(*) into v_pairs from public.annex6_classification;
  select count(*) into v_rows from public.annex6_classification_row;
  select count(*) into v_release from public.data_release where is_current;
  if v_pairs <> 13512 or v_rows <> 4419 then
    raise exception 'ожидалось 13512 пар и 4419 строк A0, найдено % и %', v_pairs, v_rows;
  end if;
  if v_release <> 1 then
    raise exception 'ожидалась ровно одна текущая строка релиза, найдено %', v_release;
  end if;
end $$;

-- ── 2. строки, которые читает человек ───────────────────────────────────────
update public.data_release
   set atp = 'ATP 21 — Commission Regulation (EU) 2024/2564, with documented Official Journal errata applied',
       parser_version = 'a0-parser 1.1'
 where is_current;

-- ── 3. та же отметка на данных: она обязана совпадать со строкой релиза ─────
update public.annex6_classification
   set parser_version = 'a0-parser 1.1'
 where parser_version is distinct from 'a0-parser 1.1';

update public.annex6_classification_row
   set parser_version = 'a0-parser 1.1'
 where parser_version is distinct from 'a0-parser 1.1';

-- ── 4. проверка после ───────────────────────────────────────────────────────
do $$
declare
  r record;
  v_bad int;
  v_pairs int;
  v_rows int;
begin
  select * into r from public.data_release where is_current;
  -- ⛔ Ни в одной печатаемой строке не должно остаться внутренних пометок.
  if r.atp ~* '(session|\ms[0-9]{2}\M)' or r.parser_version ~* '(session|\ms[0-9]{2}\M)'
     or r.engine_version ~* '(session|\ms[0-9]{2}\M)' then
    raise exception 'внутренняя пометка осталась в строке релиза: % / % / %',
      r.atp, r.parser_version, r.engine_version;
  end if;
  if r.parser_version <> 'a0-parser 1.1' then
    raise exception 'версия парсера в релизе не обновилась: %', r.parser_version;
  end if;

  select count(*) into v_bad from public.annex6_classification
   where parser_version is distinct from 'a0-parser 1.1';
  if v_bad <> 0 then
    raise exception 'на % парах осталась старая отметка', v_bad;
  end if;

  -- Ни одна строка не должна была пропасть: это UPDATE, а не пересборка.
  select count(*) into v_pairs from public.annex6_classification;
  select count(*) into v_rows from public.annex6_classification_row;
  if v_pairs <> 13512 or v_rows <> 4419 then
    raise exception 'счётчики поехали: % пар, % строк', v_pairs, v_rows;
  end if;
end $$;

commit;

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ ───────────────────────────────────────────────
-- select atp, parser_version, engine_version from public.data_release where is_current;
--   → 'ATP 21 — Commission Regulation (EU) 2024/2564, with documented Official Journal errata applied'
--     | 'a0-parser 1.1' | 'classifier 1.1'
-- select parser_version, count(*) from public.annex6_classification group by 1;
--   → 'a0-parser 1.1' | 13512
