-- 2026-10-12 (вечер), check:directory после заливки правок шестой волны (s105): обещания из писем №51–60.
-- Документ: claude/directory-outreach-wave6-2026-10-12.md. Отчёт: directory-check-2026-10-12.json.
--
-- Найдены сторожем (страница ok, evidence найден) и ещё не были подтверждены — 12 фактов:
--   правки волны 6: Donesafe #482 (ISO 27001 — FAQ), #3119 (хостинг EU/US/AU/Asia — FAQ); Chemservice #2010 (SDS в 22 из 24 языков),
--   #2830 (GmbH — 2008, группа — 2007); Sevron #2058 («Free plan»); SDS-FullService #2220; Chemeter #3164 (Monthly rental),
--   #3167 (ISO 27001:2022 — /es/iso-27001);
--   попутно (сторож нашёл впервые): CIRS #1437–1439 (inline_disclaimer, не печатаются), MySDS #3093 (market worldwide).
-- НЕ подтверждены: Chemeter #3165 ISO 9001 и #3166 ISO 14001 — на /en/company/quality это логотипы-картинки, текст только в alt
--   (сторож strip-ит HTML и не видит); certification не в GATED_KINDS, печатаются и без подтверждения.
-- Остальные факты правок (#1915 ADSL, #2252/#2253 Chemeter) подтверждение сохранили — значение, evidence и источник не менялись.
-- «Были подтверждены, а теперь не найдены» — 18 цен, подтверждённых вручную в браузере (JS), оставлены как есть (см. 104).

update directory_facts set confirmed=true, confirmed_on='2026-10-12' where confirmed is distinct from true and id in (
  482, 1437, 1438, 1439, 2010, 2058, 2220, 2830, 3093, 3119, 3164, 3167
);

-- снимок в историю (s103): подтверждения попадают в directory_fact_history с датой проверки
select * from directory_snapshot('2026-10-12');
