-- 122: SQ Label (entry 113) owner corrections of 2026-10-16, verified on sqlabel.com the same day.
-- Applied via Supabase SQL Editor on 2026-10-16. Do not re-run.
-- Also realigns directory_facts_id_seq, which the import left at 1 while max(id) was 3379.

BEGIN;

-- 0. Realign the id sequence: facts were imported with explicit ids, the sequence was never advanced
SELECT setval('public.directory_facts_id_seq', (SELECT max(id) FROM public.directory_facts));

-- 1. Four price tiles, one per edition, ordered as the owner listed them
UPDATE directory_facts SET
  label = 'SQ Label Original', value = 'EUR 397–4,797', num = 397, num_max = 4797,
  unit = 'flat', unit_qty = NULL, num_qual = 'range', sort = 0,
  detail = 'From 1 workstation key to 20 workstations in network; perpetual licence, before VAT',
  source_url = 'https://www.sqlabel.com/sq-label-original-en-license/',
  checked_on = '2026-10-16', confirmed = true, confirmed_on = '2026-10-16'
WHERE id = 1331;

UPDATE directory_facts SET
  label = 'SQ Label Original Plus', value = 'EUR 697–8,397', num = 697, num_max = 8397,
  unit = 'flat', unit_qty = NULL, num_qual = 'range', sort = 1,
  detail = 'From 1 workstation key to 20 workstations in network; perpetual licence, before VAT',
  source_url = 'https://www.sqlabel.com/sq-label-original-plus-en-license/',
  checked_on = '2026-10-16', confirmed = true, confirmed_on = '2026-10-16'
WHERE id = 3168;

UPDATE directory_facts SET
  sort = 2,
  detail = 'From 1 workstation key to 20 workstations in network; perpetual licence, before VAT',
  source_url = 'https://www.sqlabel.com/sq-label-professional-en-license/',
  checked_on = '2026-10-16', confirmed = true, confirmed_on = '2026-10-16'
WHERE id = 1333;

UPDATE directory_facts SET
  sort = 3,
  detail = 'From 1 workstation key to 20 workstations in network; perpetual licence, before VAT',
  source_url = 'https://www.sqlabel.com/sq-label-professional-plus-en-license/',
  checked_on = '2026-10-16', confirmed = true, confirmed_on = '2026-10-16'
WHERE id = 3169;

-- The separate "network 20 workstations" tile is now covered by the Original range
DELETE FROM directory_facts WHERE id = 1332;

-- 2. Free trial: source page confirms a full-feature trial; the 30-day duration is the owner's statement
UPDATE directory_facts SET
  value = '30-day free trial', num = 30, unit = 'days', num_qual = 'exact',
  detail = 'All features; registration required. Duration stated by the owner (2026-10-16); the trial page does not state it.',
  source_url = 'https://www.sqlabel.com/free-trial/',
  provided_by = 'owner', checked_on = '2026-10-16', confirmed = true, confirmed_on = '2026-10-16'
WHERE id = 1329;

-- 3. VAT note extended with the owner's statement on non-Slovenian buyers
UPDATE directory_facts SET
  value = 'Design editions: one-time perpetual licence, priced per workstation, no ongoing licensing costs. Prices are shown before VAT; VAT (22%) is added at checkout for Slovenian buyers; buyers outside Slovenia check out without VAT (owner statement, 2026-10-16).',
  checked_on = '2026-10-16'
WHERE id = 1336;

-- 4. Support and upgrade policy (support page confirms the 4 years; paid upgrade is the owner's statement)
INSERT INTO directory_facts (entry_id, kind, label, value, detail, source_url, sort, checked_on, confirmed, confirmed_on, provided_by)
VALUES (113, 'pricing_note', 'upgrade_policy',
        'Each major version receives full technical support for 4 years from release; moving to a newer major version is a paid upgrade.',
        'Current major version released 2023/2024; no newer major version yet, so no end-of-support date is set (owner statement, 2026-10-16).',
        'https://www.sqlabel.com/support/', 1, '2026-10-16', true, '2026-10-16', 'owner');

-- 5. Entry: pricing URL requested by the owner
UPDATE directory_entries SET pricing_url = 'https://www.sqlabel.com/', updated_at = now() WHERE id = 113;

-- 6. Fact history: close the changed/removed versions, open the new ones
UPDATE directory_fact_history SET valid_to = '2026-10-16', end_reason = 'changed'
WHERE fact_id IN (1331, 3168, 1333, 3169, 1329, 1336) AND valid_to IS NULL;
UPDATE directory_fact_history SET valid_to = '2026-10-16', end_reason = 'removed'
WHERE fact_id = 1332 AND valid_to IS NULL;

INSERT INTO directory_fact_history (fact_id, entry_id, kind, label, value, detail, quote, source_url, source_kind, confirmed, num, num_max, num_qual, unit, unit_qty, period, currency, price_role, valid_from, last_confirmed_on)
SELECT id, entry_id, kind, label, value, detail, quote, source_url, source_kind, confirmed, num, num_max, num_qual, unit, unit_qty, period, currency, price_role, '2026-10-16', confirmed_on
FROM directory_facts WHERE entry_id = 113 AND kind IN ('price','free_trial','pricing_note') AND checked_on = '2026-10-16';

COMMIT;

-- 7. Cosmetic follow-up (applied separately): en dash in the two older range tiles
UPDATE directory_facts SET value = replace(value, '-', '–') WHERE id IN (1333, 3169);
