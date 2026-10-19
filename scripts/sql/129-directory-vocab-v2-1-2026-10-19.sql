-- 129 - vocabulary v2.1 (2026-10-19): AI block, purchase path, support, scale claims, quality process, free offers.
-- Mirrors src/lib/directoryVocab.ts (VOCAB_VERSION 2026-10-19); spec: claude/directory-vocab-v2.1-ai-2026-10-19.md.
-- 12 new kinds, 72 new codes; ai_use widened to all categories; capability.ai_assisted retired,
-- its 38 facts move to ai_status (label listing) with the same id, value, evidence and confirmation.
-- History keeps the old rows (end_reason 'recoded'). At the end the facts must equal the new seed (md5 fb76b5a016cbf69ac1dd4d4f7c0a5a2d).

BEGIN;

-- 1. Kinds.
INSERT INTO public.directory_fact_kinds (kind, store, tier, scope, codes_in, is_numeric, has_status, country_detail, language_detail, retired_on, note, vocab_version) VALUES
  ('ai_status', 'public', 'T1', ARRAY['all'], 'label', false, true, false, false, NULL, 'label = listing (AI in the listed product or service) or vendor_wide (AI claimed elsewhere by the vendor); replaces capability.ai_assisted', '2026-10-19'),
  ('ai_stance', 'public', 'T1', ARRAY['all'], 'label', false, false, false, false, NULL, 'How the vendor presents AI; headline = page title, H1 or hero of the homepage or the listing page', '2026-10-19'),
  ('ai_governance', 'public', 'T1', ARRAY['software', 'databases'], 'label', false, false, false, false, NULL, 'AI governance statements on vendor pages, policies or sub-processor lists', '2026-10-19'),
  ('ai_provider', 'public', 'T2', ARRAY['all'], 'value', false, false, false, false, NULL, 'Model provider, only when the vendor names it', '2026-10-19'),
  ('ai_pricing', 'public', 'T2', ARRAY['software', 'databases'], 'label', false, false, false, false, NULL, 'How AI features are charged', '2026-10-19'),
  ('ai_disclaimer', 'public', 'T1', ARRAY['all'], 'label', false, false, false, false, NULL, 'value = verbatim sentence (max ~25 words) from terms, licence, legal notice or a published AI policy only', '2026-10-19'),
  ('purchase_path', 'public', 'T1', ARRAY['all'], 'value', false, false, false, false, NULL, 'Can the buyer pay online without talking to sales', '2026-10-19'),
  ('support', 'public', 'T2', ARRAY['all'], 'value', false, false, false, false, NULL, 'Support channels and hours as stated; one fact per code', '2026-10-19'),
  ('scale_claim', 'public', 'T2', ARRAY['all'], 'label', true, false, false, false, NULL, 'Numbers the vendor claims; num + unit; languages and countries go to language / coverage_claim', '2026-10-19'),
  ('quality_process', 'public', 'T2', ARRAY['services'], 'value', false, false, false, false, NULL, 'Human quality steps the service states', '2026-10-19'),
  ('free_offer', 'public', 'T2', ARRAY['all'], 'value', false, false, false, false, NULL, 'Free resources the vendor offers (lead generation)', '2026-10-19'),
  ('ai_first_seen', 'private', 'T2', ARRAY['all'], 'none', true, false, false, false, NULL, 'v2.1: num = year of the earliest vendor-published AI announcement; detail = YYYY-MM; source = the announcement', '2026-10-19');
UPDATE public.directory_fact_kinds SET scope = ARRAY['all'], note = 'v2.1: all categories; detail = vendor_wide when the use is claimed for the platform, not for the listing', vocab_version = '2026-10-19' WHERE kind = 'ai_use';

-- 2. Codes (sort = position in the vocabulary file).
INSERT INTO public.directory_vocab (vocab, code, label, sort, legacy, vocab_version) VALUES
  ('contract_flag', 'unilateral_price_change', 'Vendor may change prices', 4, '{}', '2026-10-19'),
  ('contract_flag', 'unilateral_terms_change', 'Vendor may change the terms', 5, '{}', '2026-10-19'),
  ('contract_flag', 'data_return_on_exit', 'Data returned or exportable at the end', 6, '{}', '2026-10-19'),
  ('contract_flag', 'data_deletion_on_exit', 'Data deleted after the end', 7, '{}', '2026-10-19'),
  ('contract_flag', 'sla_credits', 'Service credits for downtime', 8, '{}', '2026-10-19'),
  ('contract_flag', 'written_amendment_only', 'Changes only by written agreement', 9, '{}', '2026-10-19'),
  ('certification', 'iso_42001', 'ISO/IEC 42001 (AI management system)', 16, '{}', '2026-10-19'),
  ('certification', 'iso_18587', 'ISO 18587 (machine translation post-editing)', 17, '{}', '2026-10-19'),
  ('security', 'status_page_public', 'Public status page', 7, '{}', '2026-10-19'),
  ('ai_use', 'sds_review_check', 'Checking SDSs for errors or gaps', 6, '{}', '2026-10-19'),
  ('ai_use', 'search_qa', 'Questions over the customer''s SDS data', 7, '{}', '2026-10-19'),
  ('ai_use', 'regulatory_qa', 'Regulatory question assistant', 8, '{}', '2026-10-19'),
  ('ai_use', 'agent_connector', 'Connector for AI agents (MCP or similar)', 9, '{}', '2026-10-19'),
  ('ai_use', 'document_generation', 'Generating compliance documents', 10, '{}', '2026-10-19'),
  ('ai_use', 'label_generation', 'Generating labels', 11, '{}', '2026-10-19'),
  ('ai_use', 'container_scanning', 'Recognising containers or labels from photos', 12, '{}', '2026-10-19'),
  ('ai_use', 'data_enrichment', 'Filling in substance data', 13, '{}', '2026-10-19'),
  ('ai_use', 'risk_assessment', 'Risk assessment', 14, '{}', '2026-10-19'),
  ('ai_use', 'other', 'Other AI use', 15, '{}', '2026-10-19'),
  ('ai_status', 'listing', 'AI in the listed product or service', 0, '{}', '2026-10-19'),
  ('ai_status', 'vendor_wide', 'AI claimed elsewhere by the vendor', 1, '{}', '2026-10-19'),
  ('ai_stance', 'ai_in_headline', 'AI in the headline', 0, '{}', '2026-10-19'),
  ('ai_stance', 'human_review_vendor', 'AI output reviewed by the vendor''s experts', 1, '{}', '2026-10-19'),
  ('ai_stance', 'human_review_customer', 'AI output reviewed by the customer', 2, '{}', '2026-10-19'),
  ('ai_stance', 'human_only_stated', 'Work done by people, without AI', 3, '{}', '2026-10-19'),
  ('ai_stance', 'ai_optional', 'AI features can be switched off', 4, '{}', '2026-10-19'),
  ('ai_governance', 'no_training_on_customer_data', 'Customer data not used to train AI', 0, '{}', '2026-10-19'),
  ('ai_governance', 'ai_policy_published', 'AI policy published', 1, '{}', '2026-10-19'),
  ('ai_governance', 'ai_policy_on_request', 'AI policy on request', 2, '{}', '2026-10-19'),
  ('ai_governance', 'ai_subprocessor_named', 'AI provider in the sub-processor list', 3, '{}', '2026-10-19'),
  ('ai_governance', 'eu_ai_act_mentioned', 'EU AI Act mentioned', 4, '{}', '2026-10-19'),
  ('ai_provider', 'openai', 'OpenAI', 0, '{}', '2026-10-19'),
  ('ai_provider', 'azure_openai', 'Azure OpenAI', 1, '{}', '2026-10-19'),
  ('ai_provider', 'anthropic', 'Anthropic', 2, '{}', '2026-10-19'),
  ('ai_provider', 'google', 'Google (Gemini)', 3, '{}', '2026-10-19'),
  ('ai_provider', 'aws_bedrock', 'AWS Bedrock', 4, '{}', '2026-10-19'),
  ('ai_provider', 'mistral', 'Mistral', 5, '{}', '2026-10-19'),
  ('ai_provider', 'own_model', 'Own model', 6, '{}', '2026-10-19'),
  ('ai_provider', 'other', 'Other provider', 7, '{}', '2026-10-19'),
  ('ai_pricing', 'included', 'Included in the plan', 0, '{}', '2026-10-19'),
  ('ai_pricing', 'paid_add_on', 'Paid add-on', 1, '{}', '2026-10-19'),
  ('ai_pricing', 'separate_product', 'Separate product', 2, '{}', '2026-10-19'),
  ('ai_pricing', 'usage_credits', 'Charged per use', 3, '{}', '2026-10-19'),
  ('ai_disclaimer', 'verify_output', 'Customer must verify AI output', 0, '{}', '2026-10-19'),
  ('ai_disclaimer', 'no_accuracy_warranty', 'No warranty on AI output', 1, '{}', '2026-10-19'),
  ('ai_disclaimer', 'liability_excluded', 'No liability for AI output', 2, '{}', '2026-10-19'),
  ('purchase_path', 'self_serve_checkout', 'Buy online', 0, '{}', '2026-10-19'),
  ('purchase_path', 'quote_only', 'Quote or sales contact only', 1, '{}', '2026-10-19'),
  ('purchase_path', 'both', 'Online purchase and quotes', 2, '{}', '2026-10-19'),
  ('support', 'phone', 'Phone', 0, '{}', '2026-10-19'),
  ('support', 'email', 'Email', 1, '{}', '2026-10-19'),
  ('support', 'chat', 'Chat', 2, '{}', '2026-10-19'),
  ('support', 'ticket', 'Ticket portal', 3, '{}', '2026-10-19'),
  ('support', 'community', 'Community forum', 4, '{}', '2026-10-19'),
  ('support', 'hours_24_7', 'Support 24/7', 5, '{}', '2026-10-19'),
  ('support', 'business_hours', 'Support in business hours', 6, '{}', '2026-10-19'),
  ('scale_claim', 'sds_count', 'SDSs in the library', 0, '{}', '2026-10-19'),
  ('scale_claim', 'substance_count', 'Substances in the database', 1, '{}', '2026-10-19'),
  ('scale_claim', 'regulatory_lists_count', 'Regulatory lists', 2, '{}', '2026-10-19'),
  ('scale_claim', 'customer_count', 'Customers', 3, '{}', '2026-10-19'),
  ('scale_claim', 'expert_count', 'In-house experts', 4, '{}', '2026-10-19'),
  ('scale_claim', 'phrase_count', 'Standard phrases', 5, '{}', '2026-10-19'),
  ('scale_claim', 'sds_per_year', 'SDSs produced per year', 6, '{}', '2026-10-19'),
  ('quality_process', 'two_person_review', 'Second-person review', 0, '{}', '2026-10-19'),
  ('quality_process', 'subject_expert_review', 'Review by a chemical-safety expert', 1, '{}', '2026-10-19'),
  ('quality_process', 'template_free', 'Written without templates or software', 2, '{}', '2026-10-19'),
  ('quality_process', 'iso17100_process', 'ISO 17100 translation process', 3, '{}', '2026-10-19'),
  ('free_offer', 'free_sds_search', 'Free SDS search', 0, '{}', '2026-10-19'),
  ('free_offer', 'free_calculator', 'Free calculator or tool', 1, '{}', '2026-10-19'),
  ('free_offer', 'free_templates', 'Free templates', 2, '{}', '2026-10-19'),
  ('free_offer', 'free_webinars', 'Free webinars', 3, '{}', '2026-10-19'),
  ('free_offer', 'free_newsletter', 'Regulatory newsletter', 4, '{}', '2026-10-19');
UPDATE public.directory_vocab SET retired_on = '2026-10-19' WHERE vocab = 'capability' AND code = 'ai_assisted';

-- 3. scale_claim carries num + unit.
ALTER TABLE public.directory_facts DROP CONSTRAINT directory_facts_num_kind_chk;
ALTER TABLE public.directory_facts ADD CONSTRAINT directory_facts_num_kind_chk CHECK (((num IS NULL) AND (unit IS NULL)) OR (kind = ANY (ARRAY[
  'price', 'language', 'free_trial', 'turnaround', 'founded', 'contract_term', 'liability_cap', 'security', 'min_order', 'duration',
  'cpd_points', 'hotline', 'scale_claim'])));

-- 4. capability.ai_assisted -> ai_status.listing (same fact ids).
DO $$
DECLARE n integer; h text;
BEGIN
  UPDATE public.directory_facts SET kind = 'ai_status', label = 'listing' WHERE kind = 'capability' AND label = 'ai_assisted';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 38 THEN RAISE EXCEPTION 'v2.1: % ai_assisted facts moved, expected 38', n; END IF;

  SELECT count(*), md5(string_agg(id || '|' || kind || '|' || coalesce(label, '') || '|' || value || '|' || coalesce(detail, ''), E'\n' ORDER BY id))
    INTO n, h FROM public.directory_facts;
  IF n <> 8504 OR h <> 'fb76b5a016cbf69ac1dd4d4f7c0a5a2d' THEN
    RAISE EXCEPTION 'v2.1: database (% facts, md5 %) differs from the new seed (8504 facts, md5 fb76b5a016cbf69ac1dd4d4f7c0a5a2d)', n, h;
  END IF;
END $$;

-- 5. Version the move and tag it as a recode (history matched the facts before this script: SQL 128 snapshot).
SELECT * FROM public.directory_snapshot('2026-10-19');
UPDATE public.directory_fact_history SET end_reason = 'recoded'
 WHERE valid_to = '2026-10-19' AND end_reason IN ('changed', 'removed') AND kind = 'capability' AND label = 'ai_assisted';

COMMIT;
