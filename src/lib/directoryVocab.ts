/**
 * src/lib/directoryVocab.ts — the data-collection vocabulary of the directory, v2 (2026-10-17).
 *
 * ONE SOURCE. Every coded value a fact may carry is listed here. import:directory (public facts) and
 * import:research (private facts) validate against this file before writing, and copy it into the tables
 * directory_fact_kinds and directory_vocab so the report SQL can read labels. Spec and reasons:
 * claude/directory-vocab-v2-2026-10-17.md (project docs).
 *
 * RULES THAT KEEP THE SERIES COMPARABLE
 *   1. A code is never renamed or reused. To stop using one, set `retired` (date); add the new code beside it.
 *   2. Kinds with `statuses: true` record yes / no / not_stated explicitly, with checked_on. Only `yes` prints.
 *   3. `store` decides where a fact lives:
 *        public  — directory_facts, readable by anyone, may print on a card (only confirmed, only status yes);
 *        private — directory_research_facts, service role only, feeds report aggregates and never prints.
 *      The database enforces it: each table accepts only kinds of its own store (FK on kind + store).
 *   4. `tier`: T1 collected for every vendor in `scope`; T2 recorded when seen on pages already open;
 *      T3 category-specific.
 *   5. `codesIn` says which fact column carries the code (label or value); `detail` carries country or
 *      language code lists where the kind says so.
 */

export const VOCAB_VERSION = '2026-10-17'

export type Store = 'public' | 'private'
export type Tier = 'T1' | 'T2' | 'T3'
export type Scope = 'all' | 'software' | 'services' | 'labels' | 'training' | 'emergency' | 'databases' | 'labs'
export type CodesIn = 'label' | 'value' | 'none'

export interface KindDef {
  kind: string
  store: Store
  tier: Tier
  scope: readonly Scope[]
  /** Which column holds the vocabulary code; 'none' = free value (name, number, date). */
  codesIn: CodesIn
  /** num / unit may be set. */
  numeric: boolean
  /** yes / no / not_stated recorded explicitly. */
  statuses: boolean
  /** detail holds ISO 3166-1 alpha-2 country codes (plus EU, EEA, EAEU, GCC, worldwide). */
  countryDetail?: boolean
  /** detail holds ISO 639-1 language codes. */
  languageDetail?: boolean
  /** Vocabulary of the code column when it is not the kind itself (register_id → 'register_id.register'). */
  codeVocab?: string
  /** A second coded column: the label of size_band names its source. Checked only when the column is set. */
  extraVocab?: { column: 'label' | 'value'; vocab: string }
  /** Kind kept for old rows only; new facts go to `replacedBy`. */
  retired?: string
  replacedBy?: string
  note: string
}

export interface CodeDef {
  /** The vocabulary: a kind ('pricing_model') or a kind with a sub-field ('price.basket', 'hosting.region'). */
  vocab: string
  code: string
  label: string
  /** Existing database values that map to this code (backfill). */
  legacy?: readonly string[]
  note?: string
  retired?: string
}

const ALL: readonly Scope[] = ['all']
/** One legacy platform value names four platforms. */
const RDP = 'Windows, macOS, Linux and mobile devices via RDP client or web browser'
const SW: readonly Scope[] = ['software', 'databases']

// ─────────────────────────────── kinds ───────────────────────────────

export const KINDS: readonly KindDef[] = [
  // existing kinds (s92–s109), kept as they are unless retired
  { kind: 'jurisdiction', store: 'public', tier: 'T1', scope: ALL, codesIn: 'label', numeric: false, statuses: false, countryDetail: true, note: 'Countries the vendor names for SDS / labels; label = what is done for them (jurisdiction.role)' },
  { kind: 'jurisdiction_claim', store: 'public', tier: 'T2', scope: ALL, codesIn: 'none', numeric: false, statuses: false, retired: VOCAB_VERSION, replacedBy: 'jurisdiction', note: 'Free-text list; parsed into jurisdiction (named countries) and coverage_claim (unnamed)' },
  { kind: 'language', store: 'public', tier: 'T1', scope: ALL, codesIn: 'label', numeric: true, statuses: false, languageDetail: true, note: 'label = role (language.role); num/unit as directoryNumbers.LANGUAGE_UNITS' },
  { kind: 'deployment', store: 'public', tier: 'T1', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'One fact per deployment mode' },
  { kind: 'platform', store: 'public', tier: 'T1', scope: SW, codesIn: 'value', numeric: false, statuses: false, note: 'One fact per platform' },
  { kind: 'free_trial', store: 'public', tier: 'T1', scope: SW, codesIn: 'label', numeric: true, statuses: false, note: 'trial_days carries num' },
  { kind: 'api', store: 'public', tier: 'T1', scope: SW, codesIn: 'none', numeric: false, statuses: false, retired: VOCAB_VERSION, replacedBy: 'capability', note: 'Now capability.api' },
  { kind: 'iso17100', store: 'public', tier: 'T2', scope: ['services'], codesIn: 'none', numeric: false, statuses: false, retired: VOCAB_VERSION, replacedBy: 'certification', note: 'Now certification.iso_17100' },
  { kind: 'ufi_pcn', store: 'public', tier: 'T1', scope: ALL, codesIn: 'none', numeric: false, statuses: false, retired: VOCAB_VERSION, replacedBy: 'capability', note: 'Ambiguous; re-checked into capability.ufi_generation / pcn_submission or service_scope' },
  { kind: 'pricing_model', store: 'public', tier: 'T1', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'One fact per model' },
  { kind: 'price', store: 'public', tier: 'T1', scope: ALL, codesIn: 'none', numeric: true, statuses: false, note: 'Plan name in label; basket column = price.basket code when the price fits a basket item' },
  { kind: 'pricing_note', store: 'public', tier: 'T2', scope: ALL, codesIn: 'label', numeric: false, statuses: false, note: 'label = code; value = vendor wording' },
  { kind: 'pricing_statement', store: 'public', tier: 'T1', scope: ALL, codesIn: 'none', numeric: false, statuses: false, note: 'Fixed sentence for vendors without public prices' },
  { kind: 'feature', store: 'public', tier: 'T2', scope: ALL, codesIn: 'none', numeric: false, statuses: false, note: 'Free text; kept only as basis for also_in and for what the matrix cannot hold' },
  { kind: 'certification', store: 'public', tier: 'T1', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'detail = certifying body or scope' },
  { kind: 'integration', store: 'public', tier: 'T2', scope: SW, codesIn: 'value', numeric: false, statuses: false, note: 'One fact per named integration target' },
  { kind: 'responsibility', store: 'public', tier: 'T1', scope: ALL, codesIn: 'label', numeric: false, statuses: false, note: 'Quote from a legal document only (s93)' },
  { kind: 'regulation', store: 'public', tier: 'T1', scope: ALL, codesIn: 'label', numeric: false, statuses: false, note: 'Joined to regulatory_instruments for Regulatory Currency' },
  { kind: 'market', store: 'public', tier: 'T2', scope: ALL, codesIn: 'none', numeric: false, statuses: false, countryDetail: true, note: 'Markets the vendor says it serves' },
  { kind: 'turnaround', store: 'public', tier: 'T1', scope: ['services'], codesIn: 'label', numeric: true, statuses: false, note: 'directoryNumbers.TURNAROUND_*' },
  { kind: 'founded', store: 'public', tier: 'T1', scope: ALL, codesIn: 'label', numeric: true, statuses: false, note: 'label = founded.source; num = year' },
  { kind: 'hosting', store: 'public', tier: 'T1', scope: SW, codesIn: 'label', numeric: false, statuses: false, countryDetail: true, note: 'label = hosting.region' },
  { kind: 'format', store: 'public', tier: 'T1', scope: SW, codesIn: 'value', numeric: false, statuses: false, note: 'label = format.direction' },
  { kind: 'service_scope', store: 'public', tier: 'T1', scope: ['services'], codesIn: 'value', numeric: false, statuses: false, note: 'detail = regime codes (directoryNumbers.SERVICE_REGIMES)' },
  { kind: 'sector', store: 'public', tier: 'T2', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'Sectors the vendor names' },
  { kind: 'billing_model', store: 'public', tier: 'T1', scope: ['services', 'emergency', 'labs'], codesIn: 'value', numeric: false, statuses: false, note: 'Unit a service is charged by' },
  { kind: 'contract_term', store: 'public', tier: 'T2', scope: ALL, codesIn: 'label', numeric: true, statuses: false, note: 'directoryNumbers.CONTRACT_TERM_*' },
  { kind: 'accreditation', store: 'public', tier: 'T3', scope: ['labs', 'training'], codesIn: 'value', numeric: false, statuses: false, note: 'Register page only' },

  // new public kinds (print only when confirmed and status = yes)
  { kind: 'legal_entity', store: 'public', tier: 'T1', scope: ALL, codesIn: 'none', numeric: false, statuses: false, countryDetail: true, note: 'value = legal name as registered; detail = country of the legal entity' },
  { kind: 'offices', store: 'public', tier: 'T2', scope: ALL, codesIn: 'none', numeric: false, statuses: false, countryDetail: true, note: 'detail = countries with an office' },
  { kind: 'contract_flag', store: 'public', tier: 'T2', scope: ALL, codesIn: 'label', numeric: false, statuses: true, note: 'Contract conditions stated by the vendor' },
  { kind: 'governing_law', store: 'public', tier: 'T1', scope: ALL, codesIn: 'none', numeric: false, statuses: false, countryDetail: true, note: 'Only when terms exist; detail = country of the governing law' },
  { kind: 'liability_cap', store: 'public', tier: 'T1', scope: ALL, codesIn: 'label', numeric: true, statuses: false, note: 'fees_paid: num = months; fixed_sum: num + currency' },
  { kind: 'data_protection', store: 'public', tier: 'T1', scope: SW, codesIn: 'label', numeric: false, statuses: true, note: 'GDPR / processing documents' },
  { kind: 'security', store: 'public', tier: 'T1', scope: SW, codesIn: 'label', numeric: true, statuses: true, note: 'uptime_sla carries num (%)' },
  { kind: 'hosting_provider', store: 'public', tier: 'T1', scope: SW, codesIn: 'value', numeric: false, statuses: false, note: 'Infrastructure provider named by the vendor' },
  { kind: 'capability', store: 'public', tier: 'T1', scope: SW, codesIn: 'label', numeric: false, statuses: true, note: 'The 30-point matrix; detail = plan where available' },
  { kind: 'ai_use', store: 'public', tier: 'T1', scope: SW, codesIn: 'label', numeric: false, statuses: false, note: 'Only when capability.ai_assisted = yes' },
  { kind: 'label_standard', store: 'public', tier: 'T3', scope: ['labels'], codesIn: 'value', numeric: false, statuses: false, note: 'Material standards the labels are certified to' },
  { kind: 'print_tech', store: 'public', tier: 'T3', scope: ['labels'], codesIn: 'value', numeric: false, statuses: false, note: 'Printing technology' },
  { kind: 'min_order', store: 'public', tier: 'T3', scope: ['labels'], codesIn: 'none', numeric: true, statuses: false, note: 'num + unit (labels, rolls, sheets)' },
  { kind: 'training_mode', store: 'public', tier: 'T3', scope: ['training'], codesIn: 'value', numeric: false, statuses: false, note: 'Delivery mode' },
  { kind: 'training_level', store: 'public', tier: 'T3', scope: ['training'], codesIn: 'value', numeric: false, statuses: false, note: 'Course level' },
  { kind: 'duration', store: 'public', tier: 'T3', scope: ['training'], codesIn: 'none', numeric: true, statuses: false, note: 'num = hours; label = course name' },
  { kind: 'certificate', store: 'public', tier: 'T3', scope: ['training'], codesIn: 'none', numeric: false, statuses: true, note: 'Certificate of completion issued' },
  { kind: 'cpd_points', store: 'public', tier: 'T3', scope: ['training'], codesIn: 'none', numeric: true, statuses: false, note: 'num = points; detail = awarding body' },
  { kind: 'hotline', store: 'public', tier: 'T3', scope: ['emergency'], codesIn: 'label', numeric: true, statuses: true, countryDetail: true, note: 'Commercial 24/7 lines; countries_covered uses detail, languages_count uses num' },
  { kind: 'data_scope', store: 'public', tier: 'T3', scope: ['databases'], codesIn: 'value', numeric: false, statuses: false, note: 'What the database contains' },
  { kind: 'update_frequency', store: 'public', tier: 'T3', scope: ['databases'], codesIn: 'value', numeric: false, statuses: false, note: 'How often the vendor says it updates' },

  // private kinds: report analysis only, never on a card
  { kind: 'register_id', store: 'private', tier: 'T1', scope: ALL, codesIn: 'label', codeVocab: 'register_id.register', numeric: false, statuses: false, note: 'label = register_id.register; value = the number' },
  { kind: 'entity_type', store: 'private', tier: 'T1', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'What kind of organisation' },
  { kind: 'size_band', store: 'private', tier: 'T1', scope: ALL, codesIn: 'value', extraVocab: { column: 'label', vocab: 'size_band.source' }, numeric: false, statuses: false, note: 'Headcount band (EU Recommendation 2003/361); label = size_band.source' },
  { kind: 'employees', store: 'private', tier: 'T2', scope: ALL, codesIn: 'none', numeric: true, statuses: false, note: 'num = headcount; detail = reporting year' },
  { kind: 'revenue_band', store: 'private', tier: 'T2', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'EUR bands; detail = reporting year' },
  { kind: 'ownership', store: 'private', tier: 'T2', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'detail = parent company' },
  { kind: 'deal', store: 'private', tier: 'T2', scope: ALL, codesIn: 'label', numeric: false, statuses: false, note: 'value = counterparty; detail = date YYYY-MM' },
  { kind: 'membership', store: 'private', tier: 'T2', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'Association membership; source = association list first' },
  { kind: 'target_segment', store: 'private', tier: 'T2', scope: ALL, codesIn: 'value', numeric: false, statuses: false, note: 'Customer segment the vendor addresses' },
  { kind: 'coverage_claim', store: 'private', tier: 'T2', scope: ALL, codesIn: 'none', numeric: true, statuses: false, note: 'Unnamed coverage («80+ markets»); never counted as named countries' },
  { kind: 'staff_credential', store: 'private', tier: 'T3', scope: ['services'], codesIn: 'value', numeric: false, statuses: false, note: 'Named professional credentials of staff' },
  { kind: 'release', store: 'private', tier: 'T2', scope: SW, codesIn: 'none', numeric: false, statuses: false, note: 'value = version; detail = release date' },
  { kind: 'last_content_date', store: 'private', tier: 'T1', scope: ALL, codesIn: 'none', numeric: false, statuses: false, note: 'detail = date of the latest dated news / blog item' },
  { kind: 'job_postings', store: 'private', tier: 'T1', scope: ALL, codesIn: 'none', numeric: true, statuses: false, note: 'num = open positions on the vendor careers page on checked_on' },
]

// ─────────────────────────────── codes ───────────────────────────────

const c = (vocab: string, rows: readonly (readonly [string, string, (readonly string[])?])[]): CodeDef[] =>
  rows.map(([code, label, legacy]) => (legacy ? { vocab, code, label, legacy } : { vocab, code, label }))

export const CODES: readonly CodeDef[] = [
  // statuses for kinds with statuses: true
  ...c('status', [['yes', 'Yes'], ['no', 'No'], ['not_stated', 'Not stated']]),

  // 1. company
  ...c('founded.source', [['incorporated', 'Incorporated (register)'], ['stated', 'Stated by the vendor']]),
  ...c('entity_type', [
    ['private_company', 'Private company'], ['listed_company', 'Listed company'], ['public_body', 'Public body'],
    ['university_research', 'University or research institute'], ['association_nonprofit', 'Association or non-profit'],
    ['sole_trader', 'Sole trader'],
  ]),
  ...c('size_band', [['micro', 'Micro (under 10)'], ['small', 'Small (10–49)'], ['medium', 'Medium (50–249)'], ['large', 'Large (250+)']]),
  ...c('size_band.source', [['register', 'Company register'], ['vendor_site', 'Vendor site'], ['third_party', 'Third party']]),
  ...c('revenue_band', [['lt_2m', 'Under EUR 2 m'], ['2_10m', 'EUR 2–10 m'], ['10_50m', 'EUR 10–50 m'], ['gt_50m', 'Over EUR 50 m']]),
  ...c('ownership', [
    ['independent', 'Independent'], ['family_owned', 'Family-owned'], ['subsidiary', 'Part of a group'],
    ['pe_vc_backed', 'Private equity or venture backed'], ['listed', 'Publicly listed'], ['public_owned', 'Publicly owned'],
  ]),
  ...c('deal', [['acquired', 'Acquired'], ['merged', 'Merged'], ['renamed', 'Renamed'], ['spun_off', 'Spun off'], ['invested', 'Investment received']]),
  ...c('register_id.register', [
    ['gb_ch', 'Companies House (UK)'], ['de_hr', 'Handelsregister (DE)'], ['fr_siren', 'SIREN (FR)'], ['it_rea', 'REA / Registro Imprese (IT)'],
    ['es_nif', 'NIF / Registro Mercantil (ES)'], ['pl_krs', 'KRS (PL)'], ['nl_kvk', 'KvK (NL)'], ['be_kbo', 'KBO / BCE (BE)'],
    ['fi_ytj', 'YTJ / PRH (FI)'], ['se_orgnr', 'Bolagsverket (SE)'], ['no_brreg', 'Brønnøysundregistrene (NO)'], ['dk_cvr', 'CVR (DK)'],
    ['ee_rik', 'e-Business Register (EE)'], ['lv_ur', 'Uzņēmumu reģistrs (LV)'], ['lt_rc', 'Registrų centras (LT)'], ['at_fn', 'Firmenbuch (AT)'],
    ['ch_uid', 'UID / Zefix (CH)'], ['cz_ico', 'ARES (CZ)'], ['sk_orsr', 'ORSR (SK)'], ['si_ajpes', 'AJPES (SI)'],
    ['hu_cegj', 'Cégjegyzék (HU)'], ['pt_nipc', 'NIPC (PT)'], ['ie_cro', 'CRO (IE)'], ['us_state', 'US state register'],
    ['us_cik', 'SEC CIK (US)'], ['ca_corp', 'Corporations Canada'], ['eu_vat', 'EU VAT number (VIES)'],
  ]),
  ...c('membership', [
    ['oro', 'Only Representative Organisation (ORO)'], ['cefic', 'Cefic'], ['vci', 'VCI'], ['federchimica', 'Federchimica'],
    ['feique', 'FEIQUE'], ['pipc', 'PIPC'], ['vnci', 'VNCI'], ['essenscia', 'essenscia'], ['france_chimie', 'France Chimie'],
    ['cia_uk', 'Chemical Industries Association'], ['acc_us', 'American Chemistry Council'], ['schc', 'SCHC'],
    ['cosmetics_europe', 'Cosmetics Europe'], ['aise', 'A.I.S.E.'], ['cepe', 'CEPE'], ['elia', 'ELIA'], ['ata', 'ATA'], ['iti', 'ITI'],
    ['other', 'Other association'],
  ]),

  // 2. offer
  ...c('service_scope', [
    ['only_representative', 'Only Representative', ['Only Representative']],
    ['or_appointment_support', 'OR appointment support', ['OR appointment support']],
    ['registration_dossiers', 'Registration dossiers', ['Registration dossiers']],
    ['pcn_notification', 'Poison centre notification (PCN)', ['Poison centre notification (PCN)']],
    ['ufi_generation', 'UFI generation', ['UFI generation']],
    ['scip_notification', 'SCIP notification', ['SCIP notification']],
    ['cl_inventory_notification', 'C&L Inventory notification', ['C&L Inventory notification']],
    ['product_notifications', 'Product notifications (cosmetics, biocides, detergents)', ['Product notifications (cosmetics, biocides, detergents)']],
    ['emergency_telephone', 'Emergency telephone service', ['Emergency telephone service']],
    ['sds_authoring', 'SDS authoring'], ['sds_review', 'SDS review and check'], ['sds_translation', 'SDS translation'],
    ['esds_exposure_scenarios', 'Extended SDS and exposure scenarios'], ['classification', 'Hazard classification'],
    ['label_artwork', 'Label content and artwork'], ['regulatory_monitoring', 'Regulatory monitoring'],
    ['compliance_audit', 'Compliance audit'], ['toxicology_assessment', 'Toxicology assessment'],
    ['dg_classification', 'Dangerous goods classification'], ['testing', 'Testing'], ['training_delivery', 'Training'],
  ]),
  ...c('target_segment', [
    ['sme', 'Small and medium businesses'], ['enterprise', 'Enterprises'], ['distributors', 'Distributors'],
    ['laboratories', 'Laboratories'], ['education', 'Education'], ['public_sector', 'Public sector'],
  ]),
  ...c('sector', [
    ['cosmetics_personal_care', 'Cosmetics and personal care', ['Cosmetics and personal care']],
    ['fragrances_perfumes', 'Fragrances and perfumes', ['Fragrances and perfumes']],
    ['paints_coatings_inks', 'Paints, coatings and inks', ['Paints, coatings and inks']],
    ['adhesives_sealants', 'Adhesives and sealants', ['Adhesives and sealants']],
    ['cleaning_detergents', 'Cleaning products and detergents', ['Cleaning products and detergents']],
    ['biocides', 'Biocides', ['Biocides']],
    ['agrochemicals', 'Agrochemicals', ['Agrochemicals']],
    ['pharma_medical', 'Pharmaceuticals and medical', ['Pharmaceuticals and medical']],
    ['industrial_specialty', 'Industrial and specialty chemicals', ['Industrial and specialty chemicals']],
    ['electronics_batteries', 'Electronics and batteries', ['Electronics and batteries']],
    ['fuels_lubricants', 'Fuels and lubricants', ['Fuels and lubricants']],
    ['food_flavourings', 'Food and flavourings', ['Food and flavourings']],
    ['aerosols', 'Aerosols', ['Aerosols']],
    ['plastics_polymers', 'Plastics and polymers', ['Plastics and polymers']],
    ['laboratories_research', 'Laboratories and research'], ['automotive_aerospace', 'Automotive and aerospace'],
    ['construction_products', 'Construction products'], ['metals_mining', 'Metals and mining'], ['oil_gas', 'Oil and gas'],
    ['retail_distribution', 'Retail and distribution'], ['textiles_leather', 'Textiles and leather'],
    ['toys_consumer_articles', 'Toys and consumer articles'], ['water_treatment', 'Water treatment'],
    ['explosives_pyrotechnics', 'Explosives and pyrotechnics'],
  ]),

  // 3. money
  ...c('pricing_model', [
    ['on_request', 'On request', ['On request']],
    ['subscription', 'Subscription', ['Subscription', 'Monthly rental, annual subscription or licence']],
    ['perpetual_licence', 'Perpetual licence', ['Licence', 'One-off licence', 'Purchase', 'Purchase (online store)']],
    ['pay_per_unit', 'Pay per document or unit', ['Per document']],
    ['freemium', 'Free tier and paid plans', ['Free tier + paid plans', 'Free plan; paid plans by proposal']],
    ['free', 'Free', ['Free', 'Free public resource']],
    ['membership', 'Membership', []],
  ]),
  ...c('price.basket', [
    ['sds_author_1', 'One SDS authored, one language'], ['sds_translate_1', 'One SDS translated into one language'],
    ['sds_review_1', 'One SDS reviewed'], ['sds_manage_year', 'Managing one SDS for a year'],
    ['plan_entry_month', 'Cheapest paid plan per month'], ['label_design_1', 'One label designed'],
    ['training_seat_day', 'One training seat per day'],
  ]),
  ...c('pricing_note', [
    ['vat_excluded', 'Prices exclude VAT'], ['vat_included', 'Prices include VAT'], ['volume_discount', 'Volume discount'],
    ['academic_discount', 'Academic discount'], ['nonprofit_discount', 'Non-profit discount'], ['minimum_order', 'Minimum order'],
    ['setup_fee', 'Set-up fee'], ['upgrade_policy', 'Upgrade policy'], ['price_list_dated', 'Price list is dated'],
  ]),
  ...c('free_trial', [
    ['trial_days', 'Free trial (days)', ['14-day free trial', '30-day free trial']],
    ['demo_on_request', 'Demo on request', ['Demo on request', 'Free demo version on request']],
    ['free_sample', 'Free sample document', ['Free test drive: one SDS in a language of your choice']],
    ['free_tier', 'Free tier', []],
    ['trial_unspecified', 'Free trial, length not stated', ['Yes', 'Free trial, free of charge and without any obligation']],
  ]),
  ...c('billing_model', [
    ['per_substance', 'Per substance', ['Per substance']], ['per_dossier', 'Per dossier', ['Per dossier']],
    ['per_product', 'Per product', ['Per product']], ['per_sds', 'Per SDS', ['Per SDS']],
    ['per_call_incident', 'Per call or incident', ['Per call or incident']], ['annual_fee', 'Annual fee', ['Annual fee']],
    ['monthly_fee', 'Monthly fee', ['Monthly fee']], ['fixed_project_fee', 'Fixed fee per project', ['Fixed fee per project']],
    ['hourly_rate', 'Hourly rate', ['Hourly rate']],
  ]),
  // Codes below were defined in directoryNumbers.ts (s103–s109); when wiring, directoryNumbers derives its lists from here.
  ...c('contract_term', [['minimum_term', 'Minimum term'], ['notice_period', 'Notice period'], ['renewal_period', 'Renewal period']]),
  ...c('turnaround', [['standard', 'Standard'], ['express', 'Express'], ['translation', 'Translation'], ['label', 'Label']]),
  ...c('contract_flag', [
    ['auto_renewal', 'Renews automatically'], ['cancel_anytime', 'Cancel any time'], ['annual_prepay', 'Paid annually in advance'],
    ['no_contract', 'No contract required'],
  ]),

  // 4. trust and law
  ...c('liability_cap', [
    ['fees_paid', 'Capped at fees paid'], ['fixed_sum', 'Capped at a fixed sum'], ['full_exclusion', 'Liability fully excluded'],
    ['none_stated', 'Terms state no cap'], ['no_terms', 'No terms published'],
    ['insurance_cover', 'Capped at the insurance payout'],
  ]),
  ...c('responsibility', [
    ['data_disclaimer', 'Data disclaimer'], ['liability_cap', 'Liability cap'], ['customer_responsible', 'Customer responsible'],
    ['compliance_guarantee', 'Compliance guarantee'], ['insurance', 'Insurance'],
  ]),
  ...c('certification', [
    ['iso_9001', 'ISO 9001', ['ISO 9001']], ['iso_14001', 'ISO 14001', ['ISO 14001']], ['iso_45001', 'ISO 45001'],
    ['iso_27001', 'ISO/IEC 27001', ['ISO 27001', 'ISO 27001:2022', 'ISO/IEC 27001:2022 (information security management system)']],
    ['iso_27701', 'ISO/IEC 27701'], ['iso_17100', 'ISO 17100', ['ISO 17100']], ['soc2_type1', 'SOC 2 Type I'],
    ['soc2_type2', 'SOC 2 Type II'], ['soc2_unspecified', 'SOC 2 (type not stated)', ['SOC 2']],
    ['cyber_essentials', 'Cyber Essentials'], ['cyber_essentials_plus', 'Cyber Essentials Plus'], ['tisax', 'TISAX'],
    ['iso_27017', 'ISO/IEC 27017'], ['iso_27018', 'ISO/IEC 27018'], ['iso_22301', 'ISO 22301'], ['tx_ramp', 'TX-RAMP'],
  ]),
  ...c('accreditation', [
    ['iso_17025', 'ISO/IEC 17025 accredited', ['ISO/IEC 17025 accredited', 'ISO/IEC 17025 (testing laboratory accreditation)']],
    ['oecd_glp', 'OECD GLP test facility', ['OECD GLP test facility']],
    ['approved_training_provider', 'Approved training provider', ['Approved training provider']],
  ]),
  ...c('data_protection', [
    ['dpa_published', 'Data processing agreement published'], ['subprocessors_listed', 'Subprocessors listed'],
    ['privacy_policy_dated', 'Privacy policy is dated'], ['dpo_named', 'Data protection officer named'],
  ]),
  ...c('security', [
    ['trust_center', 'Trust or security centre page'], ['pen_test_stated', 'Penetration testing stated'],
    ['encryption_at_rest', 'Encryption at rest'], ['encryption_in_transit', 'Encryption in transit'], ['mfa', 'Multi-factor sign-in'],
    ['backups_stated', 'Backups stated'], ['uptime_sla', 'Uptime commitment (%)'],
  ]),

  // 5. technology
  ...c('deployment', [
    ['saas', 'Cloud (SaaS)', ['Cloud (SaaS)', 'Cloud (web)']], ['desktop', 'Desktop', ['Desktop']],
    ['on_premise', 'On-premises', ['On-premise']], ['hybrid', 'Cloud and on-premises or desktop', ['Cloud and desktop', 'Cloud or on-premises']],
    ['managed_service', 'Managed service', ['Managed service']], ['web_resource', 'Web resource', ['Web resource']],
    ['hardware_bundle', 'Printer and software', ['Printer and software']], ['service', 'Service', ['Service']],
  ]),
  ...c('platform', [
    ['web', 'Web browser', ['web', 'Web browser', RDP, 'Web browser (site portal)', 'Web browser (internet-based application)', 'Any device', 'Computers and phones', 'Web browser (responsive interface for desktop and mobile); kiosk mode']],
    ['windows', 'Windows', ['Windows', 'Windows (32-bit and 64-bit)', RDP]], ['macos', 'macOS', ['macOS', RDP]], ['linux', 'Linux', [RDP]],
    ['ios', 'iOS', ['iOS', 'iOS and Android app with offline use']], ['android', 'Android', ['Android', 'iOS and Android app with offline use']],
  ]),
  ...c('hosting.region', [
    ['eu', 'EU'], ['eea', 'EEA'], ['us', 'United States'], ['ca', 'Canada'], ['gb', 'United Kingdom'], ['au', 'Australia'],
    ['multi_region', 'Several regions'], ['customer_choice', 'Region chosen by the customer'],
    ['customer_premises', 'On the customer’s own servers'], ['undisclosed', 'Region not stated'],
  ]),
  ...c('hosting_provider', [
    ['aws', 'Amazon Web Services'], ['azure', 'Microsoft Azure'], ['gcp', 'Google Cloud'], ['ovh', 'OVHcloud'],
    ['hetzner', 'Hetzner'], ['ionos', 'IONOS'], ['own_datacenter', 'Own data centre'], ['other', 'Other provider'],
    ['not_stated', 'Provider not stated'],
  ]),
  ...c('capability', [
    ['sds_authoring', 'SDS authoring'], ['sds_import', 'Import and data extraction from SDS'], ['sds_library', 'SDS library search'],
    ['sds_update_tracking', 'Supplier SDS update tracking'], ['sds_distribution', 'SDS distribution or portal'],
    ['classification_calc', 'Mixture classification'], ['label_output', 'Label output'], ['ufi_generation', 'UFI generation'],
    ['pcn_submission', 'PCN submission'], ['scip_notification', 'SCIP notification'], ['esds_exposure_scenarios', 'Extended SDS'],
    ['chemical_inventory', 'Chemical inventory'], ['risk_assessment', 'Risk assessment'],
    ['workplace_instructions', 'Workplace instructions'], ['exposure_register', 'Exposure register'],
    ['regulatory_list_screening', 'Regulatory list screening'], ['dangerous_goods', 'Dangerous goods (SDS section 14)'],
    ['multilingual_output', 'Multilingual output'], ['machine_translation', 'Machine translation'], ['qr_access', 'QR code access'],
    ['barcode_rfid', 'Barcode or RFID'], ['mobile_app', 'Mobile app'], ['offline_mode', 'Offline mode'], ['sso', 'Single sign-on'],
    ['audit_trail', 'Audit trail'], ['approval_workflow', 'Approval workflow'], ['erp_integration', 'ERP integration'],
    ['api', 'API'], ['api_docs_public', 'Public API documentation'], ['ai_assisted', 'AI-assisted features'],
  ]),
  ...c('ai_use', [
    ['sds_extraction', 'Data extraction from SDS'], ['authoring_drafting', 'Drafting SDS content'], ['translation', 'Translation'],
    ['classification', 'Classification'], ['regulatory_monitoring', 'Regulatory monitoring'], ['support_chatbot', 'Support assistant'],
  ]),
  ...c('integration', [
    ['sap', 'SAP'], ['oracle', 'Oracle'], ['ms_dynamics', 'Microsoft Dynamics'], ['other_erp', 'Other ERP'],
    ['microsoft_365', 'Microsoft 365'], ['salesforce', 'Salesforce'], ['lims', 'LIMS'], ['plm', 'PLM'],
    ['echa_iuclid', 'ECHA IUCLID'], ['echa_pcn_s2s', 'ECHA PCN system-to-system'], ['label_printer', 'Label printers'],
    ['other', 'Other integration'],
  ]),
  ...c('format', [
    ['sdscom_xml', 'SDScomXML', ['SDScomXML']], ['pdf', 'PDF', ['PDF']], ['docx', 'Word (DOCX)', ['Word (DOCX)']],
    ['xml', 'XML', ['XML']], ['json', 'JSON', ['JSON']], ['excel_csv', 'Excel / CSV', ['Excel / CSV']],
    ['iuclid', 'IUCLID', ['IUCLID']], ['sap_ehs', 'SAP EH&S', ['SAP EH&S']], ['html', 'HTML', ['HTML']],
  ]),
  ...c('format.direction', [['import', 'Import'], ['export', 'Export'], ['both', 'Import and export']]),

  // 6. reach
  ...c('regulation', [
    ['eu_sds_format', 'EU SDS format'], ['eu_clp_revision', 'CLP revision'], ['us_hcs', 'US HazCom'],
    ['ca_whmis', 'Canada WHMIS'], ['ghs_revision', 'UN GHS'],
  ]),
  ...c('jurisdiction.role', [
    ['sds_format', 'SDS format', ['EU CLP', 'GB CLP', 'US OSHA HCS', 'Canada WHMIS', 'other GHS countries']],
    ['classification', 'Classification'], ['label', 'Label'], ['registration', 'Registration'],
  ]),
  ...c('jurisdiction.bloc', [['EU', 'European Union'], ['EEA', 'European Economic Area'], ['EAEU', 'Eurasian Economic Union'], ['GCC', 'Gulf Cooperation Council']]),
  ...c('language.role', [['documents', 'Documents'], ['interface', 'Interface'], ['support', 'Customer support'], ['training', 'Training']]),

  // 7. category-specific
  ...c('label_standard', [['bs5609_s2', 'BS 5609 Section 2'], ['bs5609_s3', 'BS 5609 Section 3'], ['ul969', 'UL 969'], ['other', 'Other standard']]),
  ...c('print_tech', [['thermal_transfer', 'Thermal transfer'], ['colour_inkjet', 'Colour inkjet'], ['laser', 'Laser'], ['preprinted', 'Pre-printed stock']]),
  ...c('training_mode', [['online_live', 'Online, live'], ['self_paced', 'Online, self-paced'], ['in_person', 'In person'], ['blended', 'Blended'], ['in_house', 'In-house at the customer']]),
  ...c('training_level', [['awareness', 'Awareness'], ['practitioner', 'Practitioner'], ['expert', 'Expert']]),
  ...c('hotline', [
    ['countries_covered', 'Countries covered'], ['languages_count', 'Languages'], ['hours_24_7', '24/7'],
    ['price_published', 'Price published'], ['sds_registration_required', 'SDS registration required'], ['incident_fee', 'Fee per incident'],
  ]),
  ...c('data_scope', [
    ['substance_lists', 'Substance lists'], ['regulatory_texts', 'Regulatory texts'], ['sds_library', 'SDS library'],
    ['classification_data', 'Classification data'], ['exposure_limits', 'Occupational exposure limits'],
  ]),
  ...c('update_frequency', [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['not_stated', 'Not stated']]),
  ...c('staff_credential', [['ert', 'European Registered Toxicologist'], ['dabt', 'DABT'], ['cih', 'Certified Industrial Hygienist'], ['chmm', 'CHMM'], ['other', 'Other credential']]),
]

// ─────────────────────────────── lookups ───────────────────────────────

const KIND_BY_NAME = new Map(KINDS.map((k) => [k.kind, k]))
export const kindDef = (kind: string): KindDef | undefined => KIND_BY_NAME.get(kind)
export const PUBLIC_KINDS: readonly string[] = KINDS.filter((k) => k.store === 'public').map((k) => k.kind)
export const PRIVATE_KINDS: readonly string[] = KINDS.filter((k) => k.store === 'private').map((k) => k.kind)

/** The 28 kinds that existed before v2 (directory_facts_kind_chk until migration 123). Their values keep the old wording
 * until the backfill rewrites them to codes; new kinds are validated against CODES from the first fact. */
export const LEGACY_KINDS: readonly string[] = [
  'jurisdiction', 'jurisdiction_claim', 'language', 'deployment', 'platform', 'free_trial', 'api', 'iso17100', 'ufi_pcn',
  'pricing_model', 'price', 'pricing_note', 'pricing_statement', 'feature', 'certification', 'integration', 'responsibility',
  'regulation', 'market', 'turnaround', 'founded', 'hosting', 'format', 'service_scope', 'sector', 'billing_model',
  'contract_term', 'accreditation',
]
/** Public kinds added by v2. The card does not print them yet (directoryModel.UNPRINTED_KINDS). */
export const V2_NEW_PUBLIC_KINDS: readonly string[] = PUBLIC_KINDS.filter((k) => !LEGACY_KINDS.includes(k))

/** Problems of one fact against the vocabulary (kind, store, status, basket, codes of v2 kinds). Empty = fine. */
export function vocabProblems(
  f: { kind: string; label?: unknown; value?: unknown; status?: unknown; basket?: unknown },
  store: Store,
): string[] {
  const out: string[] = []
  const k = kindDef(f.kind)
  if (!k) return [`kind «${f.kind}» is not in the vocabulary`]
  if (k.store !== store) out.push(`kind «${f.kind}» belongs to the ${k.store} store, not ${store}`)
  const status = f.status ?? 'yes'
  if (!isCode('status', String(status))) out.push(`status «${String(status)}» is not yes / no / not_stated`)
  if (status !== 'yes' && !k.statuses) out.push(`kind «${f.kind}» records only status yes`)
  if (f.basket != null && (f.kind !== 'price' || !isCode('price.basket', String(f.basket)))) out.push(`basket «${String(f.basket)}» is not a price.basket code on a price`)
  if (!LEGACY_KINDS.includes(f.kind) && k.codesIn !== 'none') {
    const code = String((k.codesIn === 'label' ? f.label : f.value) ?? '')
    const vocab = k.codeVocab ?? f.kind
    if (!isCode(vocab, code)) out.push(`${k.codesIn} «${code}» is not a ${vocab} code`)
  }
  if (k.extraVocab) {
    const extra = (f as Record<string, unknown>)[k.extraVocab.column]
    if (extra != null && !isCode(k.extraVocab.vocab, String(extra))) out.push(`${k.extraVocab.column} «${String(extra)}» is not a ${k.extraVocab.vocab} code`)
  }
  return out
}

const CODE_SET = new Set(CODES.filter((d) => !d.retired).map((d) => `${d.vocab}|${d.code}`))
export const isCode = (vocab: string, code: string): boolean => CODE_SET.has(`${vocab}|${code}`)
export const codeLabel = (vocab: string, code: string): string | undefined =>
  CODES.find((d) => d.vocab === vocab && d.code === code)?.label

/**
 * The text a page prints for a fact value: the vocabulary label when the value is a code of a value-coded kind
 * («saas» → «Cloud (SaaS)»), otherwise the value as stored (old wording, names, numbers). Labels of the old closed
 * lists equal their old wording, so a recoded fact prints exactly what it printed before.
 */
export function displayValue(kind: string, value: string): string {
  const k = kindDef(kind)
  if (!k || k.codesIn !== 'value') return value
  return codeLabel(k.codeVocab ?? kind, value) ?? value
}

/** Old database value → new code, for the one-time backfill. Ambiguous legacy values return every match. */
export function legacyCodes(vocab: string, oldValue: string): string[] {
  return CODES.filter((d) => d.vocab === vocab && d.legacy?.includes(oldValue)).map((d) => d.code)
}
