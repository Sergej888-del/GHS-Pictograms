-- Session 97 (2026-10-07) — вторая заявка в каталоге: Kallik Veraciti (entry 116)
-- Источник: tool_feedback #9 (форма "Claim this listing", 2026-10-07 10:04:56 UTC):
--   [claim:kallik-veraciti] role=employee; name=Nathan Sanders; badge=yes; email nathan.sanders@kallik.com
-- + отдельное письмо Nathan Sanders "Kallik Veraciti™ - GHSPictograms" с правками (владелец сам дал построчные правки,
--   поэтому verified_at ставится сразу): EU CLP + US OSHA HCS (страница /industries/simplify-osha-compliance),
--   «all 24 official EU languages, full Unicode», интеграции ERP/PLM/печать incl. SAP и Oracle, API yes,
--   «terms are agreed contract by contract — no public terms», описание 53 слова, логотип пришлёт.
-- Домен письма = хост url записи (kallik.com) → право подтверждено. INSERT применён через MCP 2026-10-07.
-- Решения: заголовок записи без ™ (стиль каталога, одинаково для всех); фраза про отсутствие публичных Terms — факт kind=feature,
-- provided_by=owner (блок ответственности цитирует только legal-документы и не может напечатать несуществующий документ);
-- 24 языка / SAP / Oracle / API — на публичных страницах не найдены → печатаются «stated by the vendor».
-- Посев: #116 tier=claimed, claimed_on = owner_confirmed_on = 2026-10-07, owner_description; факты 1381, 1392 — owner;
-- новые 1872 (US OSHA HCS, OSHA page, evidence "OSHA"), 1873 (api Yes), 1874 (feature: no public terms).

insert into directory_claims (entry_id, owner_email, owner_domains, owner_name, owner_role, requested_at, verified_at, note)
values (116, 'nathan.sanders@kallik.com', '{kallik.com}', 'Nathan Sanders', 'employee (form)',
        '2026-10-07 10:04:56+00', '2026-10-07 11:30:00+00',
        'tool_feedback #9 (claim form, badge=yes) + separate email with corrections (name ™, EU CLP + US OSHA HCS w/ OSHA page, 24 EU languages/Unicode, ERP/PLM/printing incl. SAP & Oracle, API yes, no public terms — agreed per contract; 53-word description; logo to follow). Seed updated same day; terms line printed as owner-stated feature; title without ™ (directory style).');
-- → id 2

-- Отчётный SELECT
-- select c.id, e.slug, c.owner_email, c.owner_name, c.requested_at, c.verified_at from directory_claims c join directory_entries e on e.id = c.entry_id order by c.requested_at;
