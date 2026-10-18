-- 123: directory data-collection vocabulary v2 (2026-10-17).
-- APPLIED 2026-10-17 via Supabase MCP as three migrations: s112_directory_vocab_v2_schema (sections 1-7, kinds of 8, 9, 11),
-- s112_directory_vocab_v2_codes (codes of 8), s112_directory_snapshot_status_basket (10). Verified against a local
-- dry run: kinds md5 8994d9a2c1e937a323d384b448c2c07d, codes md5 878176895a11a7c6a08486031bb06433 (ORDER BY ... COLLATE "C"),
-- function prosrc md5 42faaf9b8e887884a15b38a6a60ddeb2. Do not re-run.
-- Spec: claude/directory-vocab-v2-2026-10-17.md (project docs). Codes: src/lib/directoryVocab.ts — the single source;
-- the INSERTs in section 8 are generated from that file and import:directory keeps the tables in step with it.
--
-- Additive. No existing fact or entry row is changed or deleted:
--   * new columns on directory_facts and directory_fact_history get defaults that equal today's meaning
--     (status 'yes', basket NULL), so the next directory_snapshot() opens no new versions;
--   * the CHECK on directory_facts.kind is replaced by a foreign key to directory_fact_kinds, which lists
--     every kind in use today plus the new ones.
--
-- Two stores, enforced by the database:
--   public  — directory_facts (anon may read, cards print confirmed facts with status 'yes');
--   private — directory_research_facts (service role only; report aggregates, never printed).
-- A fact row carries a constant fact_store column; the foreign key (kind, fact_store) → directory_fact_kinds
-- (kind, store) rejects a private kind in the public table and a public kind in the private one.

BEGIN;

-- 1. Kind registry
CREATE TABLE public.directory_fact_kinds (
  kind            text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9_]*$'),
  store           text NOT NULL CHECK (store IN ('public', 'private')),
  tier            text NOT NULL CHECK (tier IN ('T1', 'T2', 'T3')),
  scope           text[] NOT NULL,
  codes_in        text NOT NULL CHECK (codes_in IN ('label', 'value', 'none')),
  is_numeric      boolean NOT NULL,
  has_status      boolean NOT NULL,
  country_detail  boolean NOT NULL,
  language_detail boolean NOT NULL,
  retired_on      date,
  replaced_by     text REFERENCES public.directory_fact_kinds (kind),
  note            text NOT NULL,
  vocab_version   text NOT NULL,
  UNIQUE (kind, store)
);

-- 2. Codes. vocab = a kind or a kind with a sub-field ('price.basket', 'hosting.region').
CREATE TABLE public.directory_vocab (
  vocab         text NOT NULL,
  code          text NOT NULL,
  label         text NOT NULL,
  sort          smallint NOT NULL,
  legacy        text[] NOT NULL DEFAULT '{}',
  retired_on    date,
  vocab_version text NOT NULL,
  PRIMARY KEY (vocab, code)
);

-- 3. Regulatory instruments for the Regulatory Currency index. Created empty: rows go in only after each
--    date is read on EUR-Lex / eCFR / Canada Gazette / UNECE (project rule: regulatory facts from primary sources).
CREATE TABLE public.regulatory_instruments (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
  regime        text NOT NULL CHECK (regime IN ('eu_sds_format', 'eu_clp_revision', 'us_hcs', 'ca_whmis', 'ghs_revision')),
  jurisdiction  text NOT NULL,
  name          text NOT NULL UNIQUE,
  in_force_from date,
  applies_from  date,
  superseded_on date,
  successor     text REFERENCES public.regulatory_instruments (code),
  source_url    text NOT NULL CHECK (source_url ~ '^https://'),
  checked_on    date NOT NULL,
  note          text
);

-- 4. Public facts: explicit status, basket item, store tag
ALTER TABLE public.directory_facts
  ADD COLUMN status text NOT NULL DEFAULT 'yes',
  ADD COLUMN basket text,
  ADD COLUMN fact_store text NOT NULL DEFAULT 'public';
ALTER TABLE public.directory_facts
  ADD CONSTRAINT directory_facts_status_chk CHECK (status IN ('yes', 'no', 'not_stated')),
  ADD CONSTRAINT directory_facts_basket_chk CHECK (basket IS NULL OR kind = 'price'),
  ADD CONSTRAINT directory_facts_store_chk CHECK (fact_store = 'public');

-- numbers: the six kinds of today plus the new numeric public kinds
ALTER TABLE public.directory_facts DROP CONSTRAINT directory_facts_num_kind_chk;
ALTER TABLE public.directory_facts ADD CONSTRAINT directory_facts_num_kind_chk CHECK (
  (num IS NULL AND unit IS NULL)
  OR kind = ANY (ARRAY['price', 'language', 'free_trial', 'turnaround', 'founded', 'contract_term',
                       'liability_cap', 'security', 'min_order', 'duration', 'cpd_points', 'hotline']));

-- currency: prices as before, plus a fixed-sum liability cap
ALTER TABLE public.directory_facts DROP CONSTRAINT directory_facts_price_cols_chk;
ALTER TABLE public.directory_facts ADD CONSTRAINT directory_facts_price_cols_chk CHECK (
  ((period IS NULL AND price_role IS NULL) OR kind = 'price')
  AND (currency IS NULL OR kind IN ('price', 'liability_cap')));

-- 5. History keeps status and basket (a status change is a new version; a basket tag is updated in place)
ALTER TABLE public.directory_fact_history
  ADD COLUMN status text NOT NULL DEFAULT 'yes',
  ADD COLUMN basket text;

-- 6. Private research facts. A change closes the current row (valid_to) and opens a new one, so the table is
--    its own time series. No policies: with RLS on, anon and authenticated see nothing.
CREATE TABLE public.directory_research_facts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id    integer NOT NULL REFERENCES public.directory_entries (id),
  kind        text NOT NULL,
  fact_store  text NOT NULL DEFAULT 'private' CHECK (fact_store = 'private'),
  label       text,
  value       text NOT NULL,
  detail      text,
  num         numeric,
  num_max     numeric CHECK (num_max IS NULL OR num_max > num),
  unit        text CHECK (unit IS NULL OR unit ~ '^[a-z][a-z_]*$'),
  currency    text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  status      text NOT NULL DEFAULT 'yes' CHECK (status IN ('yes', 'no', 'not_stated')),
  source_url  text NOT NULL CHECK (source_url ~ '^https?://'),
  evidence    text,
  checked_on  date NOT NULL,
  valid_from  date NOT NULL,
  valid_to    date CHECK (valid_to IS NULL OR valid_to >= valid_from),
  provided_by text NOT NULL DEFAULT 'editor' CHECK (provided_by IN ('editor', 'owner')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directory_research_facts_kind_fk FOREIGN KEY (kind, fact_store)
    REFERENCES public.directory_fact_kinds (kind, store)
);
CREATE INDEX directory_research_facts_current_idx
  ON public.directory_research_facts (entry_id, kind) WHERE valid_to IS NULL;

-- 7. Vendor outreach for the responsiveness aggregate (never per vendor on a card)
CREATE TABLE public.vendor_outreach (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id   integer NOT NULL REFERENCES public.directory_entries (id),
  wave       text NOT NULL,
  sent_on    date NOT NULL,
  replied_on date CHECK (replied_on IS NULL OR replied_on >= sent_on),
  outcome    text NOT NULL DEFAULT 'no_reply'
             CHECK (outcome IN ('no_reply', 'auto_reply', 'bounced', 'question', 'correction', 'claimed', 'declined', 'removal_request')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Registry and codes, generated from src/lib/directoryVocab.ts (VOCAB_VERSION 2026-10-17)
INSERT INTO public.directory_fact_kinds (kind, store, tier, scope, codes_in, is_numeric, has_status, country_detail, language_detail, retired_on, note, vocab_version)
SELECT k.kind, k.store, k.tier, k.scope, k.codes_in, k.is_numeric, k.has_status, k.country_detail, k.language_detail, k.retired_on::date, k.note, '2026-10-17'
FROM (VALUES
  ('jurisdiction','public','T1',ARRAY['all'],'label',false,false,true,false,NULL,'Countries the vendor names for SDS / labels; label = what is done for them (jurisdiction.role)'),
  ('jurisdiction_claim','public','T2',ARRAY['all'],'none',false,false,false,false,'2026-10-17','Free-text list; parsed into jurisdiction (named countries) and coverage_claim (unnamed)'),
  ('language','public','T1',ARRAY['all'],'label',true,false,false,true,NULL,'label = role (language.role); num/unit as directoryNumbers.LANGUAGE_UNITS'),
  ('deployment','public','T1',ARRAY['all'],'value',false,false,false,false,NULL,'One fact per deployment mode'),
  ('platform','public','T1',ARRAY['software','databases'],'value',false,false,false,false,NULL,'One fact per platform'),
  ('free_trial','public','T1',ARRAY['software','databases'],'label',true,false,false,false,NULL,'trial_days carries num'),
  ('api','public','T1',ARRAY['software','databases'],'none',false,false,false,false,'2026-10-17','Now capability.api'),
  ('iso17100','public','T2',ARRAY['services'],'none',false,false,false,false,'2026-10-17','Now certification.iso_17100'),
  ('ufi_pcn','public','T1',ARRAY['all'],'none',false,false,false,false,'2026-10-17','Ambiguous; re-checked into capability.ufi_generation / pcn_submission or service_scope'),
  ('pricing_model','public','T1',ARRAY['all'],'value',false,false,false,false,NULL,'One fact per model'),
  ('price','public','T1',ARRAY['all'],'none',true,false,false,false,NULL,'Plan name in label; basket column = price.basket code when the price fits a basket item'),
  ('pricing_note','public','T2',ARRAY['all'],'label',false,false,false,false,NULL,'label = code; value = vendor wording'),
  ('pricing_statement','public','T1',ARRAY['all'],'none',false,false,false,false,NULL,'Fixed sentence for vendors without public prices'),
  ('feature','public','T2',ARRAY['all'],'none',false,false,false,false,NULL,'Free text; kept only as basis for also_in and for what the matrix cannot hold'),
  ('certification','public','T1',ARRAY['all'],'value',false,false,false,false,NULL,'detail = certifying body or scope'),
  ('integration','public','T2',ARRAY['software','databases'],'value',false,false,false,false,NULL,'One fact per named integration target'),
  ('responsibility','public','T1',ARRAY['all'],'label',false,false,false,false,NULL,'Quote from a legal document only (s93)'),
  ('regulation','public','T1',ARRAY['all'],'label',false,false,false,false,NULL,'Joined to regulatory_instruments for Regulatory Currency'),
  ('market','public','T2',ARRAY['all'],'none',false,false,true,false,NULL,'Markets the vendor says it serves'),
  ('turnaround','public','T1',ARRAY['services'],'label',true,false,false,false,NULL,'directoryNumbers.TURNAROUND_*'),
  ('founded','public','T1',ARRAY['all'],'label',true,false,false,false,NULL,'label = founded.source; num = year'),
  ('hosting','public','T1',ARRAY['software','databases'],'label',false,false,true,false,NULL,'label = hosting.region'),
  ('format','public','T1',ARRAY['software','databases'],'value',false,false,false,false,NULL,'label = format.direction'),
  ('service_scope','public','T1',ARRAY['services'],'value',false,false,false,false,NULL,'detail = regime codes (directoryNumbers.SERVICE_REGIMES)'),
  ('sector','public','T2',ARRAY['all'],'value',false,false,false,false,NULL,'Sectors the vendor names'),
  ('billing_model','public','T1',ARRAY['services','emergency','labs'],'value',false,false,false,false,NULL,'Unit a service is charged by'),
  ('contract_term','public','T2',ARRAY['all'],'label',true,false,false,false,NULL,'directoryNumbers.CONTRACT_TERM_*'),
  ('accreditation','public','T3',ARRAY['labs','training'],'value',false,false,false,false,NULL,'Register page only'),
  ('legal_entity','public','T1',ARRAY['all'],'none',false,false,true,false,NULL,'value = legal name as registered; detail = country of the legal entity'),
  ('offices','public','T2',ARRAY['all'],'none',false,false,true,false,NULL,'detail = countries with an office'),
  ('contract_flag','public','T2',ARRAY['all'],'label',false,true,false,false,NULL,'Contract conditions stated by the vendor'),
  ('governing_law','public','T1',ARRAY['all'],'none',false,false,true,false,NULL,'Only when terms exist; detail = country of the governing law'),
  ('liability_cap','public','T1',ARRAY['all'],'label',true,false,false,false,NULL,'fees_paid: num = months; fixed_sum: num + currency'),
  ('data_protection','public','T1',ARRAY['software','databases'],'label',false,true,false,false,NULL,'GDPR / processing documents'),
  ('security','public','T1',ARRAY['software','databases'],'label',true,true,false,false,NULL,'uptime_sla carries num (%)'),
  ('hosting_provider','public','T1',ARRAY['software','databases'],'value',false,false,false,false,NULL,'Infrastructure provider named by the vendor'),
  ('capability','public','T1',ARRAY['software','databases'],'label',false,true,false,false,NULL,'The 30-point matrix; detail = plan where available'),
  ('ai_use','public','T1',ARRAY['software','databases'],'label',false,false,false,false,NULL,'Only when capability.ai_assisted = yes'),
  ('label_standard','public','T3',ARRAY['labels'],'value',false,false,false,false,NULL,'Material standards the labels are certified to'),
  ('print_tech','public','T3',ARRAY['labels'],'value',false,false,false,false,NULL,'Printing technology'),
  ('min_order','public','T3',ARRAY['labels'],'none',true,false,false,false,NULL,'num + unit (labels, rolls, sheets)'),
  ('training_mode','public','T3',ARRAY['training'],'value',false,false,false,false,NULL,'Delivery mode'),
  ('training_level','public','T3',ARRAY['training'],'value',false,false,false,false,NULL,'Course level'),
  ('duration','public','T3',ARRAY['training'],'none',true,false,false,false,NULL,'num = hours; label = course name'),
  ('certificate','public','T3',ARRAY['training'],'none',false,true,false,false,NULL,'Certificate of completion issued'),
  ('cpd_points','public','T3',ARRAY['training'],'none',true,false,false,false,NULL,'num = points; detail = awarding body'),
  ('hotline','public','T3',ARRAY['emergency'],'label',true,true,true,false,NULL,'Commercial 24/7 lines; countries_covered uses detail, languages_count uses num'),
  ('data_scope','public','T3',ARRAY['databases'],'value',false,false,false,false,NULL,'What the database contains'),
  ('update_frequency','public','T3',ARRAY['databases'],'value',false,false,false,false,NULL,'How often the vendor says it updates'),
  ('register_id','private','T1',ARRAY['all'],'label',false,false,false,false,NULL,'label = register_id.register; value = the number'),
  ('entity_type','private','T1',ARRAY['all'],'value',false,false,false,false,NULL,'What kind of organisation'),
  ('size_band','private','T1',ARRAY['all'],'value',false,false,false,false,NULL,'Headcount band (EU Recommendation 2003/361); label = size_band.source'),
  ('employees','private','T2',ARRAY['all'],'none',true,false,false,false,NULL,'num = headcount; detail = reporting year'),
  ('revenue_band','private','T2',ARRAY['all'],'value',false,false,false,false,NULL,'EUR bands; detail = reporting year'),
  ('ownership','private','T2',ARRAY['all'],'value',false,false,false,false,NULL,'detail = parent company'),
  ('deal','private','T2',ARRAY['all'],'label',false,false,false,false,NULL,'value = counterparty; detail = date YYYY-MM'),
  ('membership','private','T2',ARRAY['all'],'value',false,false,false,false,NULL,'Association membership; source = association list first'),
  ('target_segment','private','T2',ARRAY['all'],'value',false,false,false,false,NULL,'Customer segment the vendor addresses'),
  ('coverage_claim','private','T2',ARRAY['all'],'none',true,false,false,false,NULL,'Unnamed coverage («80+ markets»); never counted as named countries'),
  ('staff_credential','private','T3',ARRAY['services'],'value',false,false,false,false,NULL,'Named professional credentials of staff'),
  ('release','private','T2',ARRAY['software','databases'],'none',false,false,false,false,NULL,'value = version; detail = release date'),
  ('last_content_date','private','T1',ARRAY['all'],'none',false,false,false,false,NULL,'detail = date of the latest dated news / blog item'),
  ('job_postings','private','T1',ARRAY['all'],'none',true,false,false,false,NULL,'num = open positions on the vendor careers page on checked_on')
) AS k(kind, store, tier, scope, codes_in, is_numeric, has_status, country_detail, language_detail, retired_on, note);
UPDATE public.directory_fact_kinds SET replaced_by = 'jurisdiction' WHERE kind = 'jurisdiction_claim';
UPDATE public.directory_fact_kinds SET replaced_by = 'capability' WHERE kind = 'api';
UPDATE public.directory_fact_kinds SET replaced_by = 'certification' WHERE kind = 'iso17100';
UPDATE public.directory_fact_kinds SET replaced_by = 'capability' WHERE kind = 'ufi_pcn';

INSERT INTO public.directory_vocab (vocab, code, label, sort, legacy, vocab_version)
SELECT v.vocab, v.code, v.label, (row_number() OVER (PARTITION BY v.vocab ORDER BY v.ord) - 1)::smallint, coalesce(v.legacy, '{}'), '2026-10-17'
FROM (VALUES
  (0,'status','yes','Yes',NULL),
  (1,'status','no','No',NULL),
  (2,'status','not_stated','Not stated',NULL),
  (3,'founded.source','incorporated','Incorporated (register)',NULL),
  (4,'founded.source','stated','Stated by the vendor',NULL),
  (5,'entity_type','private_company','Private company',NULL),
  (6,'entity_type','listed_company','Listed company',NULL),
  (7,'entity_type','public_body','Public body',NULL),
  (8,'entity_type','university_research','University or research institute',NULL),
  (9,'entity_type','association_nonprofit','Association or non-profit',NULL),
  (10,'entity_type','sole_trader','Sole trader',NULL),
  (11,'size_band','micro','Micro (under 10)',NULL),
  (12,'size_band','small','Small (10–49)',NULL),
  (13,'size_band','medium','Medium (50–249)',NULL),
  (14,'size_band','large','Large (250+)',NULL),
  (15,'size_band.source','register','Company register',NULL),
  (16,'size_band.source','vendor_site','Vendor site',NULL),
  (17,'size_band.source','third_party','Third party',NULL),
  (18,'revenue_band','lt_2m','Under EUR 2 m',NULL),
  (19,'revenue_band','2_10m','EUR 2–10 m',NULL),
  (20,'revenue_band','10_50m','EUR 10–50 m',NULL),
  (21,'revenue_band','gt_50m','Over EUR 50 m',NULL),
  (22,'ownership','independent','Independent',NULL),
  (23,'ownership','family_owned','Family-owned',NULL),
  (24,'ownership','subsidiary','Part of a group',NULL),
  (25,'ownership','pe_vc_backed','Private equity or venture backed',NULL),
  (26,'ownership','listed','Publicly listed',NULL),
  (27,'ownership','public_owned','Publicly owned',NULL),
  (28,'deal','acquired','Acquired',NULL),
  (29,'deal','merged','Merged',NULL),
  (30,'deal','renamed','Renamed',NULL),
  (31,'deal','spun_off','Spun off',NULL),
  (32,'deal','invested','Investment received',NULL),
  (33,'register_id.register','gb_ch','Companies House (UK)',NULL),
  (34,'register_id.register','de_hr','Handelsregister (DE)',NULL),
  (35,'register_id.register','fr_siren','SIREN (FR)',NULL),
  (36,'register_id.register','it_rea','REA / Registro Imprese (IT)',NULL),
  (37,'register_id.register','es_nif','NIF / Registro Mercantil (ES)',NULL),
  (38,'register_id.register','pl_krs','KRS (PL)',NULL),
  (39,'register_id.register','nl_kvk','KvK (NL)',NULL),
  (40,'register_id.register','be_kbo','KBO / BCE (BE)',NULL),
  (41,'register_id.register','fi_ytj','YTJ / PRH (FI)',NULL),
  (42,'register_id.register','se_orgnr','Bolagsverket (SE)',NULL),
  (43,'register_id.register','no_brreg','Brønnøysundregistrene (NO)',NULL),
  (44,'register_id.register','dk_cvr','CVR (DK)',NULL),
  (45,'register_id.register','ee_rik','e-Business Register (EE)',NULL),
  (46,'register_id.register','lv_ur','Uzņēmumu reģistrs (LV)',NULL),
  (47,'register_id.register','lt_rc','Registrų centras (LT)',NULL),
  (48,'register_id.register','at_fn','Firmenbuch (AT)',NULL),
  (49,'register_id.register','ch_uid','UID / Zefix (CH)',NULL),
  (50,'register_id.register','cz_ico','ARES (CZ)',NULL),
  (51,'register_id.register','sk_orsr','ORSR (SK)',NULL),
  (52,'register_id.register','si_ajpes','AJPES (SI)',NULL),
  (53,'register_id.register','hu_cegj','Cégjegyzék (HU)',NULL),
  (54,'register_id.register','pt_nipc','NIPC (PT)',NULL),
  (55,'register_id.register','ie_cro','CRO (IE)',NULL),
  (56,'register_id.register','us_state','US state register',NULL),
  (57,'register_id.register','us_cik','SEC CIK (US)',NULL),
  (58,'register_id.register','ca_corp','Corporations Canada',NULL),
  (59,'register_id.register','eu_vat','EU VAT number (VIES)',NULL),
  (60,'membership','oro','Only Representative Organisation (ORO)',NULL),
  (61,'membership','cefic','Cefic',NULL),
  (62,'membership','vci','VCI',NULL),
  (63,'membership','federchimica','Federchimica',NULL),
  (64,'membership','feique','FEIQUE',NULL),
  (65,'membership','pipc','PIPC',NULL),
  (66,'membership','vnci','VNCI',NULL),
  (67,'membership','essenscia','essenscia',NULL),
  (68,'membership','france_chimie','France Chimie',NULL),
  (69,'membership','cia_uk','Chemical Industries Association',NULL),
  (70,'membership','acc_us','American Chemistry Council',NULL),
  (71,'membership','schc','SCHC',NULL),
  (72,'membership','cosmetics_europe','Cosmetics Europe',NULL),
  (73,'membership','aise','A.I.S.E.',NULL),
  (74,'membership','cepe','CEPE',NULL),
  (75,'membership','elia','ELIA',NULL),
  (76,'membership','ata','ATA',NULL),
  (77,'membership','iti','ITI',NULL),
  (78,'membership','other','Other association',NULL),
  (79,'service_scope','only_representative','Only Representative',ARRAY['Only Representative']),
  (80,'service_scope','or_appointment_support','OR appointment support',ARRAY['OR appointment support']),
  (81,'service_scope','registration_dossiers','Registration dossiers',ARRAY['Registration dossiers']),
  (82,'service_scope','pcn_notification','Poison centre notification (PCN)',ARRAY['Poison centre notification (PCN)']),
  (83,'service_scope','ufi_generation','UFI generation',ARRAY['UFI generation']),
  (84,'service_scope','scip_notification','SCIP notification',ARRAY['SCIP notification']),
  (85,'service_scope','cl_inventory_notification','C&L Inventory notification',ARRAY['C&L Inventory notification']),
  (86,'service_scope','product_notifications','Product notifications (cosmetics, biocides, detergents)',ARRAY['Product notifications (cosmetics, biocides, detergents)']),
  (87,'service_scope','emergency_telephone','Emergency telephone service',ARRAY['Emergency telephone service']),
  (88,'service_scope','sds_authoring','SDS authoring',NULL),
  (89,'service_scope','sds_review','SDS review and check',NULL),
  (90,'service_scope','sds_translation','SDS translation',NULL),
  (91,'service_scope','esds_exposure_scenarios','Extended SDS and exposure scenarios',NULL),
  (92,'service_scope','classification','Hazard classification',NULL),
  (93,'service_scope','label_artwork','Label content and artwork',NULL),
  (94,'service_scope','regulatory_monitoring','Regulatory monitoring',NULL),
  (95,'service_scope','compliance_audit','Compliance audit',NULL),
  (96,'service_scope','toxicology_assessment','Toxicology assessment',NULL),
  (97,'service_scope','dg_classification','Dangerous goods classification',NULL),
  (98,'service_scope','testing','Testing',NULL),
  (99,'service_scope','training_delivery','Training',NULL),
  (100,'target_segment','sme','Small and medium businesses',NULL),
  (101,'target_segment','enterprise','Enterprises',NULL),
  (102,'target_segment','distributors','Distributors',NULL),
  (103,'target_segment','laboratories','Laboratories',NULL),
  (104,'target_segment','education','Education',NULL),
  (105,'target_segment','public_sector','Public sector',NULL),
  (106,'sector','cosmetics_personal_care','Cosmetics and personal care',ARRAY['Cosmetics and personal care']),
  (107,'sector','fragrances_perfumes','Fragrances and perfumes',ARRAY['Fragrances and perfumes']),
  (108,'sector','paints_coatings_inks','Paints, coatings and inks',ARRAY['Paints, coatings and inks']),
  (109,'sector','adhesives_sealants','Adhesives and sealants',ARRAY['Adhesives and sealants']),
  (110,'sector','cleaning_detergents','Cleaning products and detergents',ARRAY['Cleaning products and detergents']),
  (111,'sector','biocides','Biocides',ARRAY['Biocides']),
  (112,'sector','agrochemicals','Agrochemicals',ARRAY['Agrochemicals']),
  (113,'sector','pharma_medical','Pharmaceuticals and medical',ARRAY['Pharmaceuticals and medical']),
  (114,'sector','industrial_specialty','Industrial and specialty chemicals',ARRAY['Industrial and specialty chemicals']),
  (115,'sector','electronics_batteries','Electronics and batteries',ARRAY['Electronics and batteries']),
  (116,'sector','fuels_lubricants','Fuels and lubricants',ARRAY['Fuels and lubricants']),
  (117,'sector','food_flavourings','Food and flavourings',ARRAY['Food and flavourings']),
  (118,'sector','aerosols','Aerosols',ARRAY['Aerosols']),
  (119,'sector','plastics_polymers','Plastics and polymers',ARRAY['Plastics and polymers']),
  (120,'sector','laboratories_research','Laboratories and research',NULL),
  (121,'sector','automotive_aerospace','Automotive and aerospace',NULL),
  (122,'sector','construction_products','Construction products',NULL),
  (123,'sector','metals_mining','Metals and mining',NULL),
  (124,'sector','oil_gas','Oil and gas',NULL),
  (125,'sector','retail_distribution','Retail and distribution',NULL),
  (126,'sector','textiles_leather','Textiles and leather',NULL),
  (127,'sector','toys_consumer_articles','Toys and consumer articles',NULL),
  (128,'sector','water_treatment','Water treatment',NULL),
  (129,'sector','explosives_pyrotechnics','Explosives and pyrotechnics',NULL),
  (130,'pricing_model','on_request','On request',ARRAY['On request']),
  (131,'pricing_model','subscription','Subscription',ARRAY['Subscription','Monthly rental, annual subscription or licence']),
  (132,'pricing_model','perpetual_licence','Perpetual licence',ARRAY['Licence','One-off licence','Purchase','Purchase (online store)']),
  (133,'pricing_model','pay_per_unit','Pay per document or unit',ARRAY['Per document']),
  (134,'pricing_model','freemium','Free tier and paid plans',ARRAY['Free tier + paid plans','Free plan; paid plans by proposal']),
  (135,'pricing_model','free','Free',ARRAY['Free','Free public resource']),
  (136,'pricing_model','membership','Membership',NULL),
  (137,'price.basket','sds_author_1','One SDS authored, one language',NULL),
  (138,'price.basket','sds_translate_1','One SDS translated into one language',NULL),
  (139,'price.basket','sds_review_1','One SDS reviewed',NULL),
  (140,'price.basket','sds_manage_year','Managing one SDS for a year',NULL),
  (141,'price.basket','plan_entry_month','Cheapest paid plan per month',NULL),
  (142,'price.basket','label_design_1','One label designed',NULL),
  (143,'price.basket','training_seat_day','One training seat per day',NULL),
  (144,'pricing_note','vat_excluded','Prices exclude VAT',NULL),
  (145,'pricing_note','vat_included','Prices include VAT',NULL),
  (146,'pricing_note','volume_discount','Volume discount',NULL),
  (147,'pricing_note','academic_discount','Academic discount',NULL),
  (148,'pricing_note','nonprofit_discount','Non-profit discount',NULL),
  (149,'pricing_note','minimum_order','Minimum order',NULL),
  (150,'pricing_note','setup_fee','Set-up fee',NULL),
  (151,'pricing_note','upgrade_policy','Upgrade policy',NULL),
  (152,'pricing_note','price_list_dated','Price list is dated',NULL),
  (153,'free_trial','trial_days','Free trial (days)',ARRAY['14-day free trial','30-day free trial']),
  (154,'free_trial','demo_on_request','Demo on request',ARRAY['Demo on request','Free demo version on request']),
  (155,'free_trial','free_sample','Free sample document',ARRAY['Free test drive: one SDS in a language of your choice']),
  (156,'free_trial','free_tier','Free tier',NULL),
  (157,'free_trial','trial_unspecified','Free trial, length not stated',ARRAY['Yes','Free trial, free of charge and without any obligation']),
  (158,'billing_model','per_substance','Per substance',ARRAY['Per substance']),
  (159,'billing_model','per_dossier','Per dossier',ARRAY['Per dossier']),
  (160,'billing_model','per_product','Per product',ARRAY['Per product']),
  (161,'billing_model','per_sds','Per SDS',ARRAY['Per SDS']),
  (162,'billing_model','per_call_incident','Per call or incident',ARRAY['Per call or incident']),
  (163,'billing_model','annual_fee','Annual fee',ARRAY['Annual fee']),
  (164,'billing_model','monthly_fee','Monthly fee',ARRAY['Monthly fee']),
  (165,'billing_model','fixed_project_fee','Fixed fee per project',ARRAY['Fixed fee per project']),
  (166,'billing_model','hourly_rate','Hourly rate',ARRAY['Hourly rate']),
  (167,'contract_term','minimum_term','Minimum term',NULL),
  (168,'contract_term','notice_period','Notice period',NULL),
  (169,'contract_term','renewal_period','Renewal period',NULL),
  (170,'turnaround','standard','Standard',NULL),
  (171,'turnaround','express','Express',NULL),
  (172,'turnaround','translation','Translation',NULL),
  (173,'turnaround','label','Label',NULL),
  (174,'contract_flag','auto_renewal','Renews automatically',NULL),
  (175,'contract_flag','cancel_anytime','Cancel any time',NULL),
  (176,'contract_flag','annual_prepay','Paid annually in advance',NULL),
  (177,'contract_flag','no_contract','No contract required',NULL),
  (178,'liability_cap','fees_paid','Capped at fees paid',NULL),
  (179,'liability_cap','fixed_sum','Capped at a fixed sum',NULL),
  (180,'liability_cap','full_exclusion','Liability fully excluded',NULL),
  (181,'liability_cap','none_stated','Terms state no cap',NULL),
  (182,'liability_cap','no_terms','No terms published',NULL),
  (183,'responsibility','data_disclaimer','Data disclaimer',NULL),
  (184,'responsibility','liability_cap','Liability cap',NULL),
  (185,'responsibility','customer_responsible','Customer responsible',NULL),
  (186,'responsibility','compliance_guarantee','Compliance guarantee',NULL),
  (187,'responsibility','insurance','Insurance',NULL),
  (188,'certification','iso_9001','ISO 9001',ARRAY['ISO 9001']),
  (189,'certification','iso_14001','ISO 14001',ARRAY['ISO 14001']),
  (190,'certification','iso_45001','ISO 45001',NULL),
  (191,'certification','iso_27001','ISO/IEC 27001',ARRAY['ISO 27001','ISO 27001:2022','ISO/IEC 27001:2022 (information security management system)']),
  (192,'certification','iso_27701','ISO/IEC 27701',NULL),
  (193,'certification','iso_17100','ISO 17100',ARRAY['ISO 17100']),
  (194,'certification','soc2_type1','SOC 2 Type I',NULL),
  (195,'certification','soc2_type2','SOC 2 Type II',NULL),
  (196,'certification','soc2_unspecified','SOC 2 (type not stated)',ARRAY['SOC 2']),
  (197,'certification','cyber_essentials','Cyber Essentials',NULL),
  (198,'certification','cyber_essentials_plus','Cyber Essentials Plus',NULL),
  (199,'certification','tisax','TISAX',NULL),
  (200,'accreditation','iso_17025','ISO/IEC 17025 accredited',ARRAY['ISO/IEC 17025 accredited','ISO/IEC 17025 (testing laboratory accreditation)']),
  (201,'accreditation','oecd_glp','OECD GLP test facility',ARRAY['OECD GLP test facility']),
  (202,'accreditation','approved_training_provider','Approved training provider',ARRAY['Approved training provider']),
  (203,'data_protection','dpa_published','Data processing agreement published',NULL),
  (204,'data_protection','subprocessors_listed','Subprocessors listed',NULL),
  (205,'data_protection','privacy_policy_dated','Privacy policy is dated',NULL),
  (206,'data_protection','dpo_named','Data protection officer named',NULL),
  (207,'security','trust_center','Trust or security centre page',NULL),
  (208,'security','pen_test_stated','Penetration testing stated',NULL),
  (209,'security','encryption_at_rest','Encryption at rest',NULL),
  (210,'security','encryption_in_transit','Encryption in transit',NULL),
  (211,'security','mfa','Multi-factor sign-in',NULL),
  (212,'security','backups_stated','Backups stated',NULL),
  (213,'security','uptime_sla','Uptime commitment (%)',NULL),
  (214,'deployment','saas','Cloud (SaaS)',ARRAY['Cloud (SaaS)','Cloud (web)']),
  (215,'deployment','desktop','Desktop',ARRAY['Desktop']),
  (216,'deployment','on_premise','On-premises',ARRAY['On-premise']),
  (217,'deployment','hybrid','Cloud and on-premises or desktop',ARRAY['Cloud and desktop','Cloud or on-premises']),
  (218,'deployment','managed_service','Managed service',ARRAY['Managed service']),
  (219,'deployment','web_resource','Web resource',ARRAY['Web resource']),
  (220,'deployment','hardware_bundle','Printer and software',ARRAY['Printer and software']),
  (221,'deployment','service','Service',ARRAY['Service']),
  (222,'platform','web','Web browser',ARRAY['web','Web browser','Windows, macOS, Linux and mobile devices via RDP client or web browser','Web browser (site portal)','Web browser (internet-based application)','Any device','Computers and phones','Web browser (responsive interface for desktop and mobile); kiosk mode']),
  (223,'platform','windows','Windows',ARRAY['Windows','Windows (32-bit and 64-bit)','Windows, macOS, Linux and mobile devices via RDP client or web browser']),
  (224,'platform','macos','macOS',ARRAY['macOS','Windows, macOS, Linux and mobile devices via RDP client or web browser']),
  (225,'platform','linux','Linux',ARRAY['Windows, macOS, Linux and mobile devices via RDP client or web browser']),
  (226,'platform','ios','iOS',ARRAY['iOS','iOS and Android app with offline use']),
  (227,'platform','android','Android',ARRAY['Android','iOS and Android app with offline use']),
  (228,'hosting.region','eu','EU',NULL),
  (229,'hosting.region','eea','EEA',NULL),
  (230,'hosting.region','us','United States',NULL),
  (231,'hosting.region','ca','Canada',NULL),
  (232,'hosting.region','gb','United Kingdom',NULL),
  (233,'hosting.region','au','Australia',NULL),
  (234,'hosting.region','multi_region','Several regions',NULL),
  (235,'hosting.region','customer_choice','Region chosen by the customer',NULL),
  (236,'hosting.region','customer_premises','On the customer’s own servers',NULL),
  (237,'hosting.region','undisclosed','Region not stated',NULL),
  (238,'hosting_provider','aws','Amazon Web Services',NULL),
  (239,'hosting_provider','azure','Microsoft Azure',NULL),
  (240,'hosting_provider','gcp','Google Cloud',NULL),
  (241,'hosting_provider','ovh','OVHcloud',NULL),
  (242,'hosting_provider','hetzner','Hetzner',NULL),
  (243,'hosting_provider','ionos','IONOS',NULL),
  (244,'hosting_provider','own_datacenter','Own data centre',NULL),
  (245,'hosting_provider','other','Other provider',NULL),
  (246,'hosting_provider','not_stated','Provider not stated',NULL),
  (247,'capability','sds_authoring','SDS authoring',NULL),
  (248,'capability','sds_import','Import and data extraction from SDS',NULL),
  (249,'capability','sds_library','SDS library search',NULL),
  (250,'capability','sds_update_tracking','Supplier SDS update tracking',NULL),
  (251,'capability','sds_distribution','SDS distribution or portal',NULL),
  (252,'capability','classification_calc','Mixture classification',NULL),
  (253,'capability','label_output','Label output',NULL),
  (254,'capability','ufi_generation','UFI generation',NULL),
  (255,'capability','pcn_submission','PCN submission',NULL),
  (256,'capability','scip_notification','SCIP notification',NULL),
  (257,'capability','esds_exposure_scenarios','Extended SDS',NULL),
  (258,'capability','chemical_inventory','Chemical inventory',NULL),
  (259,'capability','risk_assessment','Risk assessment',NULL),
  (260,'capability','workplace_instructions','Workplace instructions',NULL),
  (261,'capability','exposure_register','Exposure register',NULL),
  (262,'capability','regulatory_list_screening','Regulatory list screening',NULL),
  (263,'capability','dangerous_goods','Dangerous goods (SDS section 14)',NULL),
  (264,'capability','multilingual_output','Multilingual output',NULL),
  (265,'capability','machine_translation','Machine translation',NULL),
  (266,'capability','qr_access','QR code access',NULL),
  (267,'capability','barcode_rfid','Barcode or RFID',NULL),
  (268,'capability','mobile_app','Mobile app',NULL),
  (269,'capability','offline_mode','Offline mode',NULL),
  (270,'capability','sso','Single sign-on',NULL),
  (271,'capability','audit_trail','Audit trail',NULL),
  (272,'capability','approval_workflow','Approval workflow',NULL),
  (273,'capability','erp_integration','ERP integration',NULL),
  (274,'capability','api','API',NULL),
  (275,'capability','api_docs_public','Public API documentation',NULL),
  (276,'capability','ai_assisted','AI-assisted features',NULL),
  (277,'ai_use','sds_extraction','Data extraction from SDS',NULL),
  (278,'ai_use','authoring_drafting','Drafting SDS content',NULL),
  (279,'ai_use','translation','Translation',NULL),
  (280,'ai_use','classification','Classification',NULL),
  (281,'ai_use','regulatory_monitoring','Regulatory monitoring',NULL),
  (282,'ai_use','support_chatbot','Support assistant',NULL),
  (283,'integration','sap','SAP',NULL),
  (284,'integration','oracle','Oracle',NULL),
  (285,'integration','ms_dynamics','Microsoft Dynamics',NULL),
  (286,'integration','other_erp','Other ERP',NULL),
  (287,'integration','microsoft_365','Microsoft 365',NULL),
  (288,'integration','salesforce','Salesforce',NULL),
  (289,'integration','lims','LIMS',NULL),
  (290,'integration','plm','PLM',NULL),
  (291,'integration','echa_iuclid','ECHA IUCLID',NULL),
  (292,'integration','echa_pcn_s2s','ECHA PCN system-to-system',NULL),
  (293,'integration','label_printer','Label printers',NULL),
  (294,'integration','other','Other integration',NULL),
  (295,'format','sdscom_xml','SDScomXML',ARRAY['SDScomXML']),
  (296,'format','pdf','PDF',ARRAY['PDF']),
  (297,'format','docx','Word (DOCX)',ARRAY['Word (DOCX)']),
  (298,'format','xml','XML',ARRAY['XML']),
  (299,'format','json','JSON',ARRAY['JSON']),
  (300,'format','excel_csv','Excel / CSV',ARRAY['Excel / CSV']),
  (301,'format','iuclid','IUCLID',ARRAY['IUCLID']),
  (302,'format','sap_ehs','SAP EH&S',ARRAY['SAP EH&S']),
  (303,'format','html','HTML',ARRAY['HTML']),
  (304,'format.direction','import','Import',NULL),
  (305,'format.direction','export','Export',NULL),
  (306,'format.direction','both','Import and export',NULL),
  (307,'regulation','eu_sds_format','EU SDS format',NULL),
  (308,'regulation','eu_clp_revision','CLP revision',NULL),
  (309,'regulation','us_hcs','US HazCom',NULL),
  (310,'regulation','ca_whmis','Canada WHMIS',NULL),
  (311,'regulation','ghs_revision','UN GHS',NULL),
  (312,'jurisdiction.role','sds_format','SDS format',ARRAY['EU CLP','GB CLP','US OSHA HCS','Canada WHMIS','other GHS countries']),
  (313,'jurisdiction.role','classification','Classification',NULL),
  (314,'jurisdiction.role','label','Label',NULL),
  (315,'jurisdiction.role','registration','Registration',NULL),
  (316,'jurisdiction.bloc','EU','European Union',NULL),
  (317,'jurisdiction.bloc','EEA','European Economic Area',NULL),
  (318,'jurisdiction.bloc','EAEU','Eurasian Economic Union',NULL),
  (319,'jurisdiction.bloc','GCC','Gulf Cooperation Council',NULL),
  (320,'language.role','documents','Documents',NULL),
  (321,'language.role','interface','Interface',NULL),
  (322,'language.role','support','Customer support',NULL),
  (323,'language.role','training','Training',NULL),
  (324,'label_standard','bs5609_s2','BS 5609 Section 2',NULL),
  (325,'label_standard','bs5609_s3','BS 5609 Section 3',NULL),
  (326,'label_standard','ul969','UL 969',NULL),
  (327,'label_standard','other','Other standard',NULL),
  (328,'print_tech','thermal_transfer','Thermal transfer',NULL),
  (329,'print_tech','colour_inkjet','Colour inkjet',NULL),
  (330,'print_tech','laser','Laser',NULL),
  (331,'print_tech','preprinted','Pre-printed stock',NULL),
  (332,'training_mode','online_live','Online, live',NULL),
  (333,'training_mode','self_paced','Online, self-paced',NULL),
  (334,'training_mode','in_person','In person',NULL),
  (335,'training_mode','blended','Blended',NULL),
  (336,'training_mode','in_house','In-house at the customer',NULL),
  (337,'training_level','awareness','Awareness',NULL),
  (338,'training_level','practitioner','Practitioner',NULL),
  (339,'training_level','expert','Expert',NULL),
  (340,'hotline','countries_covered','Countries covered',NULL),
  (341,'hotline','languages_count','Languages',NULL),
  (342,'hotline','hours_24_7','24/7',NULL),
  (343,'hotline','price_published','Price published',NULL),
  (344,'hotline','sds_registration_required','SDS registration required',NULL),
  (345,'hotline','incident_fee','Fee per incident',NULL),
  (346,'data_scope','substance_lists','Substance lists',NULL),
  (347,'data_scope','regulatory_texts','Regulatory texts',NULL),
  (348,'data_scope','sds_library','SDS library',NULL),
  (349,'data_scope','classification_data','Classification data',NULL),
  (350,'data_scope','exposure_limits','Occupational exposure limits',NULL),
  (351,'update_frequency','daily','Daily',NULL),
  (352,'update_frequency','weekly','Weekly',NULL),
  (353,'update_frequency','monthly','Monthly',NULL),
  (354,'update_frequency','quarterly','Quarterly',NULL),
  (355,'update_frequency','not_stated','Not stated',NULL),
  (356,'staff_credential','ert','European Registered Toxicologist',NULL),
  (357,'staff_credential','dabt','DABT',NULL),
  (358,'staff_credential','cih','Certified Industrial Hygienist',NULL),
  (359,'staff_credential','chmm','CHMM',NULL),
  (360,'staff_credential','other','Other credential',NULL)
) AS v(ord, vocab, code, label, legacy);

-- 9. The kind CHECK becomes a foreign key (every kind in use today is in the registry above)
ALTER TABLE public.directory_facts DROP CONSTRAINT directory_facts_kind_chk;
ALTER TABLE public.directory_facts ADD CONSTRAINT directory_facts_kind_fk
  FOREIGN KEY (kind, fact_store) REFERENCES public.directory_fact_kinds (kind, store);

-- 10. Snapshot function: status joins the tracked columns, basket is kept in place like the parsed numbers
CREATE OR REPLACE FUNCTION public.directory_snapshot(p_on date DEFAULT ((now() AT TIME ZONE 'Europe/Riga'::text))::date, p_force boolean DEFAULT false)
 RETURNS TABLE(opened_facts integer, corrected_facts integer, closed_facts integer, open_fact_versions integer, opened_entries integer, corrected_entries integer, closed_entries integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_open  integer;
  v_now   integer;
  v_last  date;
  v_of    integer; v_cf integer; v_xf integer;
  v_oe    integer; v_ce integer; v_xe integer;
begin
  select count(*), max(valid_from) into v_open, v_last from directory_fact_history where valid_to is null;
  select count(*) into v_now from directory_facts;
  if v_last is not null and p_on < v_last then
    raise exception 'directory_snapshot: date % is earlier than the latest open version (%)', p_on, v_last;
  end if;
  if not p_force and v_open > 0 and v_now < v_open * 0.9 then
    raise exception 'directory_snapshot: % facts in the table vs % open versions — import cut off between clearing and inserting? Re-run the import (or p_force => true if the removal is intended)', v_now, v_open;
  end if;

  -- 1) version opened today and changed today: rewrite in place
  update directory_fact_history h set
    entry_id = f.entry_id, kind = f.kind, label = f.label, value = f.value, detail = f.detail, quote = f.quote,
    source_url = f.source_url, source_kind = f.source_kind, confirmed = f.confirmed, status = f.status
  from directory_facts f
  where h.valid_to is null and h.fact_id = f.id and h.valid_from = p_on
    and (h.entry_id, h.kind, h.label, h.value, h.detail, h.quote, h.source_url, h.source_kind, h.confirmed, h.status)
        is distinct from (f.entry_id, f.kind, f.label, f.value, f.detail, f.quote, f.source_url, f.source_kind, f.confirmed, f.status);
  get diagnostics v_cf = row_count;

  -- 2) close changed versions and versions of facts no longer present
  update directory_fact_history h set
    valid_to = p_on,
    end_reason = case when x.fid is null then 'removed' else 'changed' end
  from (
    select h2.id as hid, f.id as fid
    from directory_fact_history h2
    left join directory_facts f on f.id = h2.fact_id
    where h2.valid_to is null
      and (f.id is null
           or (h2.entry_id, h2.kind, h2.label, h2.value, h2.detail, h2.quote, h2.source_url, h2.source_kind, h2.confirmed, h2.status)
              is distinct from (f.entry_id, f.kind, f.label, f.value, f.detail, f.quote, f.source_url, f.source_kind, f.confirmed, f.status))
  ) x
  where h.id = x.hid;
  get diagnostics v_xf = row_count;

  -- 3) open versions for new and changed facts
  insert into directory_fact_history (
    fact_id, entry_id, kind, label, value, detail, quote, source_url, source_kind, confirmed, status, basket,
    num, num_max, num_qual, unit, unit_qty, period, currency, price_role, valid_from, last_confirmed_on)
  select f.id, f.entry_id, f.kind, f.label, f.value, f.detail, f.quote, f.source_url, f.source_kind, f.confirmed, f.status, f.basket,
         f.num, f.num_max, f.num_qual, f.unit, f.unit_qty, f.period, f.currency, f.price_role, p_on,
         case when f.confirmed then f.confirmed_on end
  from directory_facts f
  where not exists (select 1 from directory_fact_history h where h.fact_id = f.id and h.valid_to is null);
  get diagnostics v_of = row_count;

  -- 4) parsed numbers, basket tag and latest confirmation: in the open version, in place
  update directory_fact_history h set
    num = f.num, num_max = f.num_max, num_qual = f.num_qual, unit = f.unit, unit_qty = f.unit_qty,
    period = f.period, currency = f.currency, price_role = f.price_role, basket = f.basket,
    last_confirmed_on = greatest(h.last_confirmed_on, case when f.confirmed then f.confirmed_on end)
  from directory_facts f
  where h.valid_to is null and h.fact_id = f.id
    and ((h.num, h.num_max, h.num_qual, h.unit, h.unit_qty, h.period, h.currency, h.price_role, h.basket)
         is distinct from (f.num, f.num_max, f.num_qual, f.unit, f.unit_qty, f.period, f.currency, f.price_role, f.basket)
         or (f.confirmed and f.confirmed_on > coalesce(h.last_confirmed_on, '-infinity'::date)));

  -- entries
  update directory_entry_history h set
    slug = e.slug, category = e.category, subcategory = e.subcategory, state = e.state, tier = e.tier,
    title = e.title, vendor = e.vendor, url = e.url, hq_country = e.hq_country, also_in = e.also_in, tags = e.tags,
    pricing_url = e.pricing_url, terms_kind = e.terms_kind, terms_doc_url = e.terms_doc_url,
    terms_dated = e.terms_dated, closed_on = e.closed_on, successor = e.successor
  from directory_entries e
  where h.valid_to is null and h.entry_id = e.id and h.valid_from = p_on
    and (h.slug, h.category, h.subcategory, h.state, h.tier, h.title, h.vendor, h.url, h.hq_country, h.also_in,
         h.tags, h.pricing_url, h.terms_kind, h.terms_doc_url, h.terms_dated, h.closed_on, h.successor)
        is distinct from
        (e.slug, e.category, e.subcategory, e.state, e.tier, e.title, e.vendor, e.url, e.hq_country, e.also_in,
         e.tags, e.pricing_url, e.terms_kind, e.terms_doc_url, e.terms_dated, e.closed_on, e.successor);
  get diagnostics v_ce = row_count;

  update directory_entry_history h set
    valid_to = p_on,
    end_reason = case when x.eid is null then 'removed' else 'changed' end
  from (
    select h2.id as hid, e.id as eid
    from directory_entry_history h2
    left join directory_entries e on e.id = h2.entry_id
    where h2.valid_to is null
      and (e.id is null
           or (h2.slug, h2.category, h2.subcategory, h2.state, h2.tier, h2.title, h2.vendor, h2.url, h2.hq_country,
               h2.also_in, h2.tags, h2.pricing_url, h2.terms_kind, h2.terms_doc_url, h2.terms_dated, h2.closed_on,
               h2.successor)
              is distinct from
              (e.slug, e.category, e.subcategory, e.state, e.tier, e.title, e.vendor, e.url, e.hq_country,
               e.also_in, e.tags, e.pricing_url, e.terms_kind, e.terms_doc_url, e.terms_dated, e.closed_on,
               e.successor))
  ) x
  where h.id = x.hid;
  get diagnostics v_xe = row_count;

  insert into directory_entry_history (
    entry_id, slug, category, subcategory, state, tier, title, vendor, url, hq_country, also_in, tags,
    pricing_url, terms_kind, terms_doc_url, terms_dated, closed_on, successor, valid_from)
  select e.id, e.slug, e.category, e.subcategory, e.state, e.tier, e.title, e.vendor, e.url, e.hq_country,
         e.also_in, e.tags, e.pricing_url, e.terms_kind, e.terms_doc_url, e.terms_dated, e.closed_on, e.successor, p_on
  from directory_entries e
  where not exists (select 1 from directory_entry_history h where h.entry_id = e.id and h.valid_to is null);
  get diagnostics v_oe = row_count;

  return query select v_of, v_cf, v_xf,
    (select count(*)::integer from directory_fact_history where valid_to is null),
    v_oe, v_ce, v_xe;
end;
$function$;

-- 11. Access. Registry, codes and instruments: anyone may read (the method is public). Research facts and
--     outreach: service role only.
ALTER TABLE public.directory_fact_kinds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_vocab          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_instruments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_research_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_outreach          ENABLE ROW LEVEL SECURITY;
CREATE POLICY directory_fact_kinds_public_read   ON public.directory_fact_kinds   FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY directory_vocab_public_read        ON public.directory_vocab        FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY regulatory_instruments_public_read ON public.regulatory_instruments FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.directory_fact_kinds, public.directory_vocab, public.regulatory_instruments FROM anon, authenticated;
GRANT SELECT ON public.directory_fact_kinds, public.directory_vocab, public.regulatory_instruments TO anon, authenticated;
REVOKE ALL ON public.directory_research_facts, public.vendor_outreach FROM anon, authenticated;

COMMIT;

-- Check (run separately, one SELECT at a time):
-- SELECT store, count(*) FROM directory_fact_kinds GROUP BY store;            -- public 49, private 14
-- SELECT count(*) FROM directory_vocab;                                       -- 361
-- SELECT status, count(*) FROM directory_facts GROUP BY status;               -- yes = every fact
-- SELECT count(*) FROM directory_fact_history WHERE valid_to IS NULL AND status <> 'yes';  -- 0
