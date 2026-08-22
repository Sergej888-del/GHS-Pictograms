-- 79-602-091-class-missing.sql — session 79 (2026-08-22)
-- Миграция `s79_602_091_00_8_class_missing` (применена через MCP; этот файл — архив).
--
-- РЕШЕНИЕ СЕРГЕЯ (s79): 602-091-00-8 (1,3-dichloro-4-fluorobenzene, CAS 1435-48-9) —
-- СТРОГО ПО КЛАССУ, как 649-175/176/315. Annex VI печатает H411 без класса
-- Aquatic Chronic; вид errata `class-omitted` (s78: «выводим класс из кода,
-- потому что Table 3.2 подтверждает N; R51-53») снят, запись переведена в
-- `class-missing` (`src/lib/annex6RowErrata.ts`). Довод Table 3.2 остаётся в
-- свидетельстве для корриджендума.
--
-- ДО:   substances.h_statement_codes = {H302,H373,H315,H411}; ghs_pictogram_codes = {GHS08,GHS07}
--       annex6_classification: 4 пары, seq 4 = AQUATIC_CHRONIC/2 H411 [ERRATA_ROW]
--       annex6_classification_row: n_pairs 4, unmatched_h {}
-- ПОСЛЕ: h_statement_codes = {H302,H373,H315}; пиктограммы без изменений (GHS09 и не было)
--       annex6_classification: 3 пары (всего 13 513 → 13 512)
--       annex6_classification_row: n_pairs 3, unmatched_h {H411}, parser_version a0-parser 1.1
-- ОТКАТ: update substances set h_statement_codes = array_append(h_statement_codes,'H411') where index_number='602-091-00-8';
--       insert into annex6_classification(index_number,seq,class_code,category_code,category_raw,h_code,h_code_full,star,test_required,raw,flags)
--         values ('602-091-00-8',4,'AQUATIC_CHRONIC','2','2','H411','H411',false,false,'Aquatic Chronic 2','{ERRATA_ROW}');
--       update annex6_classification_row set n_pairs=4, unmatched_h='{}' where index_number='602-091-00-8';
--       (или просто `npm run build:annex6-classification` на коде s78)

begin;

do $$
declare v_h text[]; v_pairs int;
begin
  select h_statement_codes into v_h from substances where index_number = '602-091-00-8';
  if v_h is null or not ('H411' = any(v_h)) then raise exception 'pre-check: H411 not present on 602-091-00-8 (%)', v_h; end if;
  select count(*) into v_pairs from annex6_classification where index_number = '602-091-00-8';
  if v_pairs <> 4 then raise exception 'pre-check: expected 4 A0 pairs, got %', v_pairs; end if;
  if not exists (select 1 from annex6_classification where index_number='602-091-00-8' and seq=4 and class_code='AQUATIC_CHRONIC' and h_code='H411')
    then raise exception 'pre-check: seq 4 is not AQUATIC_CHRONIC/H411'; end if;
end $$;

update substances
   set h_statement_codes = array_remove(h_statement_codes, 'H411')
 where index_number = '602-091-00-8';

delete from annex6_classification
 where index_number = '602-091-00-8' and seq = 4 and class_code = 'AQUATIC_CHRONIC';

update annex6_classification_row
   set n_pairs = 3,
       unmatched_h = array['H411'],
       parser_version = 'a0-parser 1.1 (s79: class-omitted retired)',
       updated_at = now()
 where index_number = '602-091-00-8';

do $$
declare v_h text[]; v_pairs int; v_total int;
begin
  select h_statement_codes into v_h from substances where index_number = '602-091-00-8';
  if v_h <> array['H302','H373','H315'] then raise exception 'post-check: h_statement_codes = %', v_h; end if;
  select count(*) into v_pairs from annex6_classification where index_number = '602-091-00-8';
  if v_pairs <> 3 then raise exception 'post-check: expected 3 pairs, got %', v_pairs; end if;
  select count(*) into v_total from annex6_classification;
  if v_total <> 13512 then raise exception 'post-check: expected 13512 pairs total, got %', v_total; end if;
end $$;

commit;

-- VERIFICATION
-- select h_statement_codes, ghs_pictogram_codes from substances where index_number='602-091-00-8';  -- {H302,H373,H315} · {GHS08,GHS07}
-- select count(*) from annex6_classification;                                                       -- 13512
-- select n_pairs, unmatched_h, parser_version from annex6_classification_row where index_number='602-091-00-8';
