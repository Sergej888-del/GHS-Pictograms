-- 104 — каталог /directory/, шаг C (s104, 2026-10-11): шесть новых видов фактов.
--
-- Решение Сергея (s104, 11.10): при перепроверке 171 коммерческой записи собрать, помимо прежних видов,
--   regulation  — какой акт о формате SDS / hazard communication вендор НАЗЫВАЕТ на своих страницах
--                 (label = режим: eu_sds_format · eu_clp_revision · us_hcs · ca_whmis · ghs_revision;
--                  value = имя акта из словаря src/lib/directoryNumbers.ts; evidence = номер как напечатан).
--                 ⚠ Статус акта (действует / заменён) в факте НЕ хранится — факт = только то, что сказал вендор.
--   market      — страны и регионы, которые вендор называет обслуживаемыми (detail = коды ISO 3166-1 alpha-2
--                 через запятую, либо EU / EEA / worldwide / unspecified);
--   turnaround  — названный срок изготовления SDS / перевода / этикетки (num, num_max, num_qual, unit =
--                 working_days · days · hours · weeks; label = standard · express · translation · label);
--   founded     — год основания (num = год, unit = year, num_qual = exact);
--   hosting     — где хранятся данные (только софт; detail = код страны / EU / EEA / worldwide / unspecified);
--   format      — форматы обмена SDS (только софт; value из словаря: SDScomXML, PDF, Word (DOCX), XML, JSON,
--                 Excel / CSV, IUCLID, SAP EH&S, HTML).
--
-- Печатаются ТОЛЬКО ПОДТВЕРЖДЁННЫМИ (directoryModel.PHASE_C_KINDS ⊂ GATED_KINDS; решение Сергея s104 вечером),
-- как цены: неподтверждённый факт в базе есть, на карточке его нет и в порог индексации он не идёт.
-- История (directory_fact_history) вид фактов не ограничивает — правок там нет.
--
-- Откат:
--   alter table public.directory_facts drop constraint directory_facts_kind_chk;
--   alter table public.directory_facts add constraint directory_facts_kind_chk check (kind in (
--     'jurisdiction', 'jurisdiction_claim', 'language', 'deployment', 'platform', 'free_trial', 'api',
--     'iso17100', 'ufi_pcn', 'pricing_model', 'price', 'pricing_note', 'pricing_statement', 'feature',
--     'certification', 'integration', 'responsibility'));
--   alter table public.directory_facts drop constraint directory_facts_num_kind_chk;
--   alter table public.directory_facts add constraint directory_facts_num_kind_chk check (
--     (num is null and unit is null) or kind in ('price', 'language', 'free_trial'));
--   alter table public.directory_facts drop constraint directory_facts_regulation_label_chk;
--   (перед откатом удалить факты новых видов: delete from public.directory_facts where kind in (...)).

alter table public.directory_facts drop constraint directory_facts_kind_chk;
alter table public.directory_facts add constraint directory_facts_kind_chk check (kind in (
  'jurisdiction', 'jurisdiction_claim', 'language', 'deployment', 'platform', 'free_trial', 'api',
  'iso17100', 'ufi_pcn', 'pricing_model', 'price', 'pricing_note', 'pricing_statement', 'feature',
  'certification', 'integration', 'responsibility',
  -- s104
  'regulation', 'market', 'turnaround', 'founded', 'hosting', 'format'));

alter table public.directory_facts drop constraint directory_facts_num_kind_chk;
alter table public.directory_facts add constraint directory_facts_num_kind_chk check (
  (num is null and unit is null) or kind in ('price', 'language', 'free_trial', 'turnaround', 'founded'));

-- У regulation подпись обязательна и из словаря режимов; у прочих видов этот check не действует.
alter table public.directory_facts add constraint directory_facts_regulation_label_chk check (
  kind <> 'regulation' or label in ('eu_sds_format', 'eu_clp_revision', 'us_hcs', 'ca_whmis', 'ghs_revision'));

comment on constraint directory_facts_kind_chk on public.directory_facts is
  'Виды фактов каталога; словари значений — src/lib/directoryNumbers.ts (s103 числа, s104 regulation/market/turnaround/founded/hosting/format).';
