-- Session 97 (2026-10-07), второй прогон check:directory после заявки Kallik (#116).
-- Подтверждения: #1872 Kallik «US OSHA HCS» — найдено на https://www.kallik.com/industries/simplify-osha-compliance;
--   #1331 (€397) и #1332 (€4 797) SQ Label Original — найдены третьим прогоном (страница рисует цены скриптом и отдаёт разный
--   текст от раза к разу: утром было €117, не было Original; теперь наоборот). Что найдено сегодня — подтверждаем.
-- НЕ подтверждаем #1791 GTS «USD 0.09–0.19 per word»: страница GTS к 14:00 уже показывает «$0.09 to $0.25» (Дэвид правил
--   после нашего письма), верхняя граница не совпадает → остаётся «stated by the vendor»; evidence в посеве уточнён до «0.09 to $0.19».
-- НЕ снимаем #1334 SQ Label «from EUR 117 / year»: найдено утром тем же сторожем; пустой ответ один из трёх — мигание, не смена цены.
-- ВЫПОЛНИТЬ В SQL EDITOR.

update directory_facts
   set confirmed = true, confirmed_on = '2026-10-07'
 where id in (1331, 1332, 1872)
   and confirmed is distinct from true;

-- select id, entry_id, kind, value, confirmed, confirmed_on from directory_facts where id in (1331, 1332, 1334, 1872, 1791);
