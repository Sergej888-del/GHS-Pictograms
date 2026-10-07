-- Session 97 (2026-10-07) — первая заявка в каталоге: GTS Translation Services (entry 148)
-- Источник: tool_feedback #8 (форма "Claim this listing", 2026-10-07 08:51:16 UTC):
--   [claim:gts-translation-services] role=employee; badge=yes; email sales@gts-translation.com
-- Письмо-ответ David Grunwald (Account Manager, GTS) в ветку письма 07.10: "I claimed the listing and approved it."
-- Домен письма = хост url записи (gts-translation.com) → право подтверждено (tiers-doc §4 п. 2).
-- Применено через MCP 2026-10-07. verified_at — пусто до построчного "OK" владельца по списку фактов (§5.1).
-- Следующие шаги после "OK": посев directory-v3.json (tier=claimed, claimed_on, owner_confirmed_on, logo_path,
-- owner_description, pricing_url, terms_url, provided_by='owner' у присланных фактов) → import:directory →
-- update directory_claims set verified_at = … where id = 1 → check:directory → сборка → check:dist → деплой → письмо §5.2.

insert into directory_claims (entry_id, owner_email, owner_domains, owner_name, owner_role, requested_at, verified_at, note)
values (148, 'sales@gts-translation.com', '{gts-translation.com}', 'David Grunwald', 'Account Manager (form: employee)',
        '2026-10-07 08:51:16+00', null,
        'tool_feedback #8 (claim form, badge=yes); reply by email 07.10 ~11:50 local "I claimed the listing and approved it"; fact list sent 07.10 for line-by-line OK; verified_at set when owner confirms facts');
-- → id 1
-- Дополнение (не применено: UPDATE через MCP дважды ушёл по таймауту 180 с — ждёт подтверждения, как DELETE в s92):
-- Дэвид отвечает с личного адреса davidg@gts-translation.com; форма заявки заполнена с sales@. Внести при следующей заливке:
-- update directory_claims set note = note || '; replies from davidg@gts-translation.com (personal); claim form used sales@' where id = 1;

-- 07.10 ~12:40: владелец подтвердил факты построчно (письмо 11:36 CET, 'I made some revisions': языки 100, цена за слово
-- 0.09–0.19, вывод Word+PDF в формате оригинала, ответственность — 'See terms-of-use'). Посев обновлён, tier=claimed.
-- ВЫПОЛНИТЬ В SQL EDITOR (UPDATE через MCP виснет):
update directory_claims
   set verified_at = '2026-10-07 10:40:00+00',
       note = note || '; owner confirmed line by line 07.10 11:36 CET (davidg@gts-translation.com): languages 100, per-word 0.09-0.19, Word+PDF, see terms-of-use; seed updated, tier=claimed'
 where id = 1;

-- Отчётный SELECT
-- select c.id, e.slug, c.owner_email, c.owner_name, c.requested_at, c.verified_at from directory_claims c join directory_entries e on e.id = c.entry_id order by c.requested_at;
