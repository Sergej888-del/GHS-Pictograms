-- 109 - directory step A2 (s109, 2026-10-14): five new fact kinds, a services subsection for
-- Only Representative / registration / PCN, and the 24/7 emergency-response category.
--
-- Only CHECK constraints change. No row of directory_entries / directory_facts is touched, and the
-- history tables and directory_snapshot() need no change (they copy columns, they do not list kinds).
-- Run the WHOLE file in the Supabase SQL Editor in one go. Rollback is at the end of the file.
--
-- New fact kinds (value vocabularies live in src/lib/directoryNumbers.ts, as in step C - the database
-- holds the format only, so a new service or sector value never needs a migration):
--   service_scope  - what a service provider offers, one fact per service (only_representative, registration,
--                    pcn_ufi, scip, emergency_phone ...); detail = comma-separated regime codes (eu_reach, uk_reach,
--                    tr_kkdik, kr_kreach ...), checked in code.
--   sector         - industry the vendor says it serves (cosmetics, paints and coatings, agrochemicals ...).
--   billing_model  - the unit a service is charged by (per substance, per dossier, per call, annual retainer ...).
--                    Not the same as pricing_model, which describes how software is licensed.
--   contract_term  - the only new numeric kind: num = length, unit = days | months | years,
--                    label = minimum_term | notice_period | renewal (checked in code).
--   accreditation  - a recognition that can be looked up in a public register (ISO/IEC 17025, GLP, an approved
--                    training provider ...). source_url is the register page, evidence is the register line
--                    (required in code). Self-declared management-system certificates stay in 'certification'.
-- All five print only when confirmed (same gate as the step C kinds); see directoryModel.ts.
--
-- New category: emergency-response (group Logistics & Emergency). It is also allowed in also_in / basis_for,
-- so an SDS authoring service that sells the SDS section 1.4 emergency number can appear there too.
-- New subcategory of authoring-services-consultants: registration-or-pcn.
begin;

alter table public.directory_facts drop constraint directory_facts_kind_chk;
alter table public.directory_facts add constraint directory_facts_kind_chk check (kind in (
  'jurisdiction', 'jurisdiction_claim', 'language', 'deployment', 'platform', 'free_trial', 'api',
  'iso17100', 'ufi_pcn', 'pricing_model', 'price', 'pricing_note', 'pricing_statement', 'feature',
  'certification', 'integration', 'responsibility',
  -- s104
  'regulation', 'market', 'turnaround', 'founded', 'hosting', 'format',
  -- s109
  'service_scope', 'sector', 'billing_model', 'contract_term', 'accreditation'));

alter table public.directory_facts drop constraint directory_facts_num_kind_chk;
alter table public.directory_facts add constraint directory_facts_num_kind_chk check (
  (num is null and unit is null) or kind in ('price', 'language', 'free_trial', 'turnaround', 'founded', 'contract_term'));

alter table public.directory_entries drop constraint directory_entries_category_chk;
alter table public.directory_entries add constraint directory_entries_category_chk check (category = any (array[
  'sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
  'authoring-services-consultants', 'training', 'emergency-response', 'closed', 'not-listed']));

alter table public.directory_entries drop constraint directory_entries_also_in_chk;
alter table public.directory_entries add constraint directory_entries_also_in_chk check (
  also_in <@ array['sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
                   'authoring-services-consultants', 'training', 'emergency-response']
  and not (category = any (also_in)));

alter table public.directory_facts drop constraint directory_facts_basis_for_chk;
alter table public.directory_facts add constraint directory_facts_basis_for_chk check (
  basis_for is null or (kind = 'feature' and basis_for = any (array[
    'sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
    'authoring-services-consultants', 'training', 'emergency-response'])));

alter table public.directory_entries drop constraint directory_entries_subcategory_chk;
alter table public.directory_entries add constraint directory_entries_subcategory_chk check (
  subcategory is null or (category = 'authoring-services-consultants' and subcategory = any (array[
    'sds-translation', 'sds-authoring-eu', 'sds-authoring-north-america', 'regulatory-consulting',
    'registration-or-pcn'])));

comment on constraint directory_facts_kind_chk on public.directory_facts is
  'Fact kinds of the directory; value vocabularies are in src/lib/directoryNumbers.ts (s103 numbers, s104 regulation/market/turnaround/founded/hosting/format, s109 service_scope/sector/billing_model/contract_term/accreditation).';

commit;

-- Check 1: the five constraints now name the new values; nothing else changed.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid in ('public.directory_entries'::regclass, 'public.directory_facts'::regclass)
  and conname in ('directory_facts_kind_chk', 'directory_facts_num_kind_chk', 'directory_entries_category_chk',
                  'directory_entries_also_in_chk', 'directory_facts_basis_for_chk', 'directory_entries_subcategory_chk')
order by conname;

-- Check 2: row counts are untouched (expected today: 225 entries, 3129 facts).
select (select count(*) from public.directory_entries) as entries, (select count(*) from public.directory_facts) as facts;

-- Rollback (only if you need to undo; delete rows that use the new values first):
-- begin;
-- delete from public.directory_facts where kind in ('service_scope', 'sector', 'billing_model', 'contract_term', 'accreditation') or basis_for = 'emergency-response';
-- update public.directory_entries set subcategory = 'regulatory-consulting' where subcategory = 'registration-or-pcn';
-- update public.directory_entries set also_in = array_remove(also_in, 'emergency-response') where 'emergency-response' = any (also_in);
-- delete from public.directory_entries where category = 'emergency-response';   -- only if you also remove the entries
-- alter table public.directory_facts drop constraint directory_facts_kind_chk;
-- alter table public.directory_facts add constraint directory_facts_kind_chk check (kind in (
--   'jurisdiction', 'jurisdiction_claim', 'language', 'deployment', 'platform', 'free_trial', 'api',
--   'iso17100', 'ufi_pcn', 'pricing_model', 'price', 'pricing_note', 'pricing_statement', 'feature',
--   'certification', 'integration', 'responsibility', 'regulation', 'market', 'turnaround', 'founded', 'hosting', 'format'));
-- alter table public.directory_facts drop constraint directory_facts_num_kind_chk;
-- alter table public.directory_facts add constraint directory_facts_num_kind_chk check (
--   (num is null and unit is null) or kind in ('price', 'language', 'free_trial', 'turnaround', 'founded'));
-- alter table public.directory_entries drop constraint directory_entries_category_chk;
-- alter table public.directory_entries add constraint directory_entries_category_chk check (category = any (array[
--   'sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
--   'authoring-services-consultants', 'training', 'closed', 'not-listed']));
-- alter table public.directory_entries drop constraint directory_entries_also_in_chk;
-- alter table public.directory_entries add constraint directory_entries_also_in_chk check (
--   also_in <@ array['sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
--                    'authoring-services-consultants', 'training'] and not (category = any (also_in)));
-- alter table public.directory_facts drop constraint directory_facts_basis_for_chk;
-- alter table public.directory_facts add constraint directory_facts_basis_for_chk check (
--   basis_for is null or (kind = 'feature' and basis_for = any (array[
--     'sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
--     'authoring-services-consultants', 'training'])));
-- alter table public.directory_entries drop constraint directory_entries_subcategory_chk;
-- alter table public.directory_entries add constraint directory_entries_subcategory_chk check (
--   subcategory is null or (category = 'authoring-services-consultants' and subcategory = any (array[
--     'sds-translation', 'sds-authoring-eu', 'sds-authoring-north-america', 'regulatory-consulting'])));
-- commit;
