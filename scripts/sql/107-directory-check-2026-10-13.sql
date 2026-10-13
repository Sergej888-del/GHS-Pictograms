-- 2026-10-13 (вечер), check:directory после заявки SQ Label (#113, s107): отчёт directory-check-2026-10-13.json.
-- Документ: claude/directory-claim-sq-label-2026-10-13.md.
--
-- Найдены сторожем (страница ok, evidence найден) и ещё не были подтверждены — 7 фактов:
--   SQ Label: #1329 (free_trial — страница редакций, «free trial»), #1341 (30-day fully functional free trial — та же страница),
--   #1334 / #1335 / #3171 — годовые цены SQ Label Automation (Professional EUR 597, Server EUR 797, Original EUR 397;
--   страница /sq-label-automation/, прочитана вручную в браузере 13.10: список-цена EUR 697/897/497 зачёркнута).
--   Прежние #1334/#1335 (EUR 117 / 137) на странице Professional больше не найдены и ни на одной странице SQ Label не подтверждались — заменены.
--   Правки волны 6 (в seed лежали несохранёнными): Chemeter #2252 (Monthly rental, annual subscription or licence),
--   #3167 (ISO 27001:2022) — значение изменилось после прошлого импорта, подтверждение сбрасывалось.
-- НЕ подтверждены намеренно: владельческие факты SQ Label #1330, #1336, #3168, #3169, #3170 (evidence нет → печатаются «stated by the vendor»).
-- «Были подтверждены, а теперь не найдены» — 15 цен/пометок (ExactSDS #13–15, SDS Manager #345–347 и #2278/#2279, ChemiusExpert #1974,
--   EKOS #2134, SAP #2291–2295): подтверждены вручную в браузере ранее, оставлены как есть (см. 104, 105).
--   SDS Manager 13.10 показывает те же суммы помесячно («$19 / $39 / $59 per month, billed annually» = 228 / 468 / 708 в год) — решение за Сергеем.

update directory_facts set confirmed=true, confirmed_on='2026-10-13' where confirmed is distinct from true and id in (
  1329, 1334, 1335, 1341, 2252, 3167, 3171
);

-- снимок в историю (s103): подтверждения попадают в directory_fact_history с датой проверки
select * from directory_snapshot('2026-10-13');
