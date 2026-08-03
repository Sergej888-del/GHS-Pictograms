// The 16-section SDS spine — /sds-sections/ (session 31).
//
// One source of truth for: the hub table, the 16 section pages, the section rail,
// prev/next, breadcrumbs, the sitemap and the "which section is it in?" finder.
//
// ⚠ Headings are quoted from three DIFFERENT legal texts and they are NOT
// identical. The numbering is, the wording is not:
//   UN  — GHS Rev. 11, Annex 4, A4.2.3.1  ("Hazard identification")
//   EU  — REACH Annex II as amended by Commission Regulation (EU) 2020/878
//         ("SECTION 2: Hazards identification" — note the plural)
//   US  — OSHA 29 CFR 1910.1200 Appendix D ("Hazard(s) identification")
// Never "harmonise" them into one string: the difference is the point of the
// jurisdiction switch, and readers arrive here holding one of the three texts.
//
// ⚠ Under OSHA HCS, sections 12–15 are NOT mandatory (they fall to EPA and DOT).
// Under REACH Annex II all 16 are. `usMandatory` carries that, nothing else.

export type SdsGroup = 'response' | 'workplace' | 'technical' | 'lifecycle' | 'admin'

export interface SdsSectionMeta {
  n: number
  slug: string
  /** Plain-English name used in prose, rails and links. */
  short: string
  /** UN GHS Rev. 11 Annex 4 heading. */
  un: string
  /** REACH Annex II (Regulation (EU) 2020/878) heading. */
  eu: string
  /** OSHA 29 CFR 1910.1200 Appendix D heading. */
  us: string
  /** Mandatory under OSHA HCS? False for 12–15. */
  usMandatory: boolean
  group: SdsGroup
  /** One-sentence answer to "what is in section N". Used on the hub and by the finder. */
  answer: string
  /**
   * Anchor for this section on a substance page (`/sds/<slug>/#sN`), or null
   * where the substance template renders no such block and the link must open
   * the page itself.
   * ⚠ Measured 2026-08-03 by grepping the 109 built pages in dist/, not guessed.
   * §1 lives in the page hero, §3 has no meaning for a single substance, §12
   * waits on the eco import and §15 on the Step-4 regulatory import. §11 exists
   * on 5 pages out of 109 — too few to promise, so it is null too.
   */
  anchor: string | null
  /** How many of the 109 live substance pages carry that anchor (2026-08-03). */
  anchorCoverage: number
}

export const SDS_GROUPS: Record<SdsGroup, { label: string; who: string }> = {
  response: { label: 'Rapid response', who: 'Anyone, in the first 30 seconds' },
  workplace: { label: 'Workplace handling', who: 'EHS, line operators, store keepers' },
  technical: { label: 'Technical data', who: 'Toxicologists, formulators, engineers' },
  lifecycle: { label: 'Environment, waste, transport, law', who: 'Regulators, logistics, waste contractors' },
  admin: { label: 'Document control', who: 'Compliance auditors' },
}

export const SDS_SECTIONS: SdsSectionMeta[] = [
  {
    n: 1,
    slug: 'section-1-identification',
    short: 'Identification',
    un: 'Identification',
    eu: 'Identification of the substance/mixture and of the company/undertaking',
    us: 'Identification',
    usMandatory: true,
    group: 'response',
    answer:
      'Who made the product, what it is called, what it may and may not be used for, and the emergency telephone number.',
    anchor: null,
    anchorCoverage: 0,
  },
  {
    n: 2,
    slug: 'section-2-hazards-identification',
    short: 'Hazards identification',
    un: 'Hazard identification',
    eu: 'Hazards identification',
    us: 'Hazard(s) identification',
    usMandatory: true,
    group: 'response',
    answer:
      'How the product is classified, and the exact label elements that follow from that classification — signal word, pictograms, H-statements and P-statements.',
    anchor: '#s2',
    anchorCoverage: 78,
  },
  {
    n: 3,
    slug: 'section-3-composition',
    short: 'Composition / information on ingredients',
    un: 'Composition/information on ingredients',
    eu: 'Composition/information on ingredients',
    us: 'Composition/information on ingredients',
    usMandatory: true,
    group: 'response',
    answer:
      'What is actually in the product: the hazardous ingredients, their chemical identifiers, and their concentration or concentration range.',
    anchor: null,
    anchorCoverage: 0,
  },
  {
    n: 4,
    slug: 'section-4-first-aid-measures',
    short: 'First aid measures',
    un: 'First-aid measures',
    eu: 'First aid measures',
    us: 'First-aid measures',
    usMandatory: true,
    group: 'response',
    answer:
      'What an untrained bystander should do in the first minutes after eye, skin, inhalation or ingestion exposure — and what a doctor needs to know.',
    anchor: '#s4',
    // 99 -> 98 (session 33): у оксида железа §4/§5/§6 сняты. Единственная запись
    // CAMEO за CAS 1309-37-1 — IRON OXIDE, SPENT, самовозгорающаяся масса
    // очистки газа; к пигментному Fe2O3 не относится.
    anchorCoverage: 98,
  },
  {
    n: 5,
    slug: 'section-5-fire-fighting-measures',
    short: 'Firefighting measures',
    un: 'Fire-fighting measures',
    eu: 'Firefighting measures',
    us: 'Fire-fighting measures',
    usMandatory: true,
    group: 'workplace',
    answer:
      'What to extinguish the fire with, what must never be used, what the fire itself releases, and what protection firefighters need.',
    anchor: '#s5',
    // 93 -> 91 (session 33): минус оксид железа и минус никель. У курируемой
    // записи 17434 NICKEL нет текстов тушения — раньше сюда попадали тексты
    // RANEY NICKEL, пирофорного катализатора.
    anchorCoverage: 91,
  },
  {
    n: 6,
    slug: 'section-6-accidental-release-measures',
    short: 'Accidental release measures',
    un: 'Accidental release measures',
    eu: 'Accidental release measures',
    us: 'Accidental release measures',
    usMandatory: true,
    group: 'workplace',
    answer:
      'How to contain and clean up a spill without making it worse — separately for people who happen to be there and for trained responders.',
    anchor: '#s6',
    // 91 -> 89 (session 33): те же два вещества, что и у §5.
    anchorCoverage: 89,
  },
  {
    n: 7,
    slug: 'section-7-handling-and-storage',
    short: 'Handling and storage',
    un: 'Handling and storage',
    eu: 'Handling and storage',
    us: 'Handling and storage',
    usMandatory: true,
    group: 'workplace',
    answer:
      'How to handle the product day to day, the conditions it must be stored under, and the materials it must never share a store with.',
    anchor: '#s7',
    anchorCoverage: 78,
  },
  {
    n: 8,
    slug: 'section-8-exposure-controls',
    short: 'Exposure controls / personal protection',
    un: 'Exposure controls/personal protection',
    eu: 'Exposure controls/personal protection',
    us: 'Exposure controls/personal protection',
    usMandatory: true,
    group: 'workplace',
    answer:
      'The occupational exposure limits that apply, and the engineering controls and personal protective equipment that keep workers under them.',
    anchor: '#s8',
    // 76 -> 75 (session 33): у оксида железа вместе со строкой substance_response
    // ушёл и niosh_pgd_file (npgd0344), а §8 держится именно на нём.
    anchorCoverage: 75,
  },
  {
    n: 9,
    slug: 'section-9-physical-and-chemical-properties',
    short: 'Physical and chemical properties',
    un: 'Physical and chemical properties',
    eu: 'Physical and chemical properties',
    us: 'Physical and chemical properties',
    usMandatory: true,
    group: 'technical',
    answer:
      'The measured physical data — physical state, flash point, boiling point, explosion limits, vapour pressure, pH, solubility and the rest of the eighteen basic properties.',
    anchor: '#s9',
    anchorCoverage: 78,
  },
  {
    n: 10,
    slug: 'section-10-stability-and-reactivity',
    short: 'Stability and reactivity',
    un: 'Stability and reactivity',
    eu: 'Stability and reactivity',
    us: 'Stability and reactivity',
    usMandatory: true,
    group: 'technical',
    answer:
      'What makes the product decompose or react, which materials are incompatible with it, and what hazardous products the decomposition creates.',
    anchor: '#s10',
    anchorCoverage: 77,
  },
  {
    n: 11,
    slug: 'section-11-toxicological-information',
    short: 'Toxicological information',
    un: 'Toxicological information',
    eu: 'Toxicological information',
    us: 'Toxicological information',
    usMandatory: true,
    group: 'technical',
    answer:
      'What exposure does to a human body — by route, by dose and by duration — and the data behind each health hazard class in the classification.',
    anchor: null,
    anchorCoverage: 5,
  },
  {
    n: 12,
    slug: 'section-12-ecological-information',
    short: 'Ecological information',
    un: 'Ecological information',
    eu: 'Ecological information',
    us: 'Ecological information',
    usMandatory: false,
    group: 'lifecycle',
    answer:
      'What the product does to water, soil and living organisms once it escapes — aquatic toxicity, degradability, bioaccumulation, mobility, PBT/vPvB and endocrine disruption.',
    anchor: null,
    anchorCoverage: 0,
  },
  {
    n: 13,
    slug: 'section-13-disposal-considerations',
    short: 'Disposal considerations',
    un: 'Disposal considerations',
    eu: 'Disposal considerations',
    us: 'Disposal considerations',
    usMandatory: false,
    group: 'lifecycle',
    answer:
      'How to dispose of the product, its residues and its contaminated packaging — and which waste legislation governs that.',
    anchor: '#s13',
    anchorCoverage: 78,
  },
  {
    n: 14,
    slug: 'section-14-transport-information',
    short: 'Transport information',
    un: 'Transport information',
    eu: 'Transport information',
    us: 'Transport information',
    usMandatory: false,
    group: 'lifecycle',
    answer:
      'How the product is regulated in transport: UN number, proper shipping name, transport hazard class, packing group and environmental hazard status.',
    anchor: '#s14',
    anchorCoverage: 53,
  },
  {
    n: 15,
    slug: 'section-15-regulatory-information',
    short: 'Regulatory information',
    un: 'Regulatory information',
    eu: 'Regulatory information',
    us: 'Regulatory information',
    usMandatory: false,
    group: 'lifecycle',
    answer:
      'Which chemical laws apply to the product beyond classification — authorisation, restriction, SVHC status, major-accident thresholds, national inventories.',
    anchor: null,
    anchorCoverage: 0,
  },
  {
    n: 16,
    slug: 'section-16-other-information',
    short: 'Other information',
    un: 'Other information',
    eu: 'Other information',
    us: 'Other information, including date of preparation or last revision',
    usMandatory: true,
    group: 'admin',
    answer:
      'When the sheet was written or revised, what changed since the last version, what the abbreviations mean, and which sources the data came from.',
    anchor: '#s16',
    anchorCoverage: 109,
  },
]

export const SDS_SECTION_BY_SLUG = new Map(SDS_SECTIONS.map((s) => [s.slug, s]))
export const SDS_SECTION_BY_N = new Map(SDS_SECTIONS.map((s) => [s.n, s]))

export const sdsSectionUrl = (n: number): string => {
  const s = SDS_SECTION_BY_N.get(n)
  return s ? `/sds-sections/${s.slug}/` : '/sds-sections/'
}

/** "Section 8" — used in rails, prev/next and anchor text. */
export const sdsSectionLabel = (n: number): string => `Section ${n}`

/**
 * "Which section is it in?" index for the hub finder.
 *
 * ⚠ Terms are what a reader types, not what the regulation calls it: someone
 * looking for the glove material types "gloves", not "individual protection
 * measures". Every entry is answerable from the regulation text — nothing here
 * is a guess about where a supplier chose to put something.
 *
 * A term may legitimately live in more than one section; the first number is
 * the primary home, the rest are cross-references.
 */
export const SDS_FINDER: { term: string; n: number[] }[] = [
  { term: 'product name', n: [1] },
  { term: 'trade name', n: [1] },
  { term: 'product code', n: [1] },
  { term: 'supplier address', n: [1] },
  { term: 'manufacturer', n: [1] },
  { term: 'emergency telephone number', n: [1] },
  { term: 'emergency number', n: [1] },
  { term: 'poison centre', n: [1] },
  { term: 'ufi', n: [1] },
  { term: 'unique formula identifier', n: [1] },
  { term: 'nanoform', n: [1, 9] },
  { term: 'recommended use', n: [1] },
  { term: 'uses advised against', n: [1] },
  { term: 'rei number', n: [1] },

  { term: 'classification', n: [2] },
  { term: 'hazard class', n: [2] },
  { term: 'hazard category', n: [2] },
  { term: 'signal word', n: [2] },
  { term: 'danger', n: [2] },
  { term: 'warning', n: [2] },
  { term: 'pictogram', n: [2] },
  { term: 'hazard symbol', n: [2] },
  { term: 'h statement', n: [2] },
  { term: 'hazard statement', n: [2] },
  { term: 'p statement', n: [2] },
  { term: 'precautionary statement', n: [2] },
  { term: 'euh statement', n: [2] },
  { term: 'label elements', n: [2] },
  { term: 'pbt vpvb statement', n: [2, 12] },
  { term: 'endocrine disruptor', n: [2, 12] },
  { term: 'hazards not otherwise classified', n: [2] },
  { term: 'hnoc', n: [2] },
  { term: 'unknown acute toxicity', n: [2, 3] },

  { term: 'ingredients', n: [3] },
  { term: 'composition', n: [3] },
  { term: 'cas number', n: [3, 1] },
  { term: 'ec number', n: [3, 1] },
  { term: 'einecs', n: [3] },
  { term: 'index number', n: [3] },
  { term: 'reach registration number', n: [3] },
  { term: 'concentration', n: [3] },
  { term: 'concentration range', n: [3] },
  { term: 'impurities', n: [3] },
  { term: 'stabilising additives', n: [3] },
  { term: 'trade secret', n: [3] },
  { term: 'specific concentration limit', n: [3] },
  { term: 'm factor', n: [3] },
  { term: 'ate', n: [3, 11] },
  { term: 'acute toxicity estimate', n: [3, 11] },

  { term: 'first aid', n: [4] },
  { term: 'eye contact', n: [4] },
  { term: 'skin contact', n: [4] },
  { term: 'inhalation', n: [4, 11] },
  { term: 'ingestion', n: [4, 11] },
  { term: 'swallowed', n: [4] },
  { term: 'symptoms', n: [4, 11] },
  { term: 'antidote', n: [4] },
  { term: 'medical attention', n: [4] },
  { term: 'delayed effects', n: [4, 11] },

  { term: 'extinguishing media', n: [5] },
  { term: 'fire extinguisher', n: [5] },
  { term: 'foam', n: [5] },
  { term: 'dry chemical', n: [5] },
  { term: 'combustion products', n: [5] },
  { term: 'firefighter protection', n: [5, 8] },
  { term: 'self contained breathing apparatus', n: [5, 8] },
  { term: 'explosion hazard in fire', n: [5] },

  { term: 'spill', n: [6] },
  { term: 'leak', n: [6] },
  { term: 'containment', n: [6] },
  { term: 'clean up', n: [6] },
  { term: 'absorbent', n: [6] },
  { term: 'evacuation', n: [6] },
  { term: 'environmental precautions', n: [6, 12] },
  { term: 'drain', n: [6, 12, 13] },

  { term: 'handling', n: [7] },
  { term: 'storage', n: [7] },
  { term: 'storage temperature', n: [7, 9] },
  { term: 'incompatible storage', n: [7, 10] },
  { term: 'segregation', n: [7, 10] },
  { term: 'shelf life', n: [7] },
  { term: 'packaging material', n: [7] },
  { term: 'ventilation', n: [7, 8] },
  { term: 'no smoking', n: [7] },
  { term: 'grounding bonding', n: [7] },
  { term: 'static discharge', n: [7, 9] },
  { term: 'specific end use', n: [7] },

  { term: 'exposure limit', n: [8] },
  { term: 'oel', n: [8] },
  { term: 'occupational exposure limit', n: [8] },
  { term: 'pel', n: [8] },
  { term: 'permissible exposure limit', n: [8] },
  { term: 'twa', n: [8] },
  { term: 'stel', n: [8] },
  { term: 'biological limit value', n: [8] },
  { term: 'dnel', n: [8] },
  { term: 'pnec', n: [8, 12] },
  { term: 'monitoring procedure', n: [8] },
  { term: 'control banding', n: [8] },
  { term: 'engineering controls', n: [8] },
  { term: 'local exhaust ventilation', n: [8] },
  { term: 'ppe', n: [8] },
  { term: 'personal protective equipment', n: [8] },
  { term: 'gloves', n: [8] },
  { term: 'glove material', n: [8] },
  { term: 'breakthrough time', n: [8] },
  { term: 'goggles', n: [8] },
  { term: 'face shield', n: [8] },
  { term: 'eye protection', n: [8] },
  { term: 'respirator', n: [8] },
  { term: 'filter cartridge', n: [8] },
  { term: 'protective clothing', n: [8] },
  { term: 'boots', n: [8] },
  { term: 'thermal hazard protection', n: [8] },

  { term: 'physical state', n: [9] },
  { term: 'colour', n: [9] },
  { term: 'odour', n: [9] },
  { term: 'melting point', n: [9] },
  { term: 'freezing point', n: [9] },
  { term: 'boiling point', n: [9] },
  { term: 'flash point', n: [9] },
  { term: 'flammability', n: [9] },
  { term: 'explosion limit', n: [9] },
  { term: 'lel uel', n: [9] },
  { term: 'auto ignition temperature', n: [9] },
  { term: 'decomposition temperature', n: [9, 10] },
  { term: 'ph', n: [9] },
  { term: 'viscosity', n: [9] },
  { term: 'solubility', n: [9] },
  { term: 'log kow', n: [9, 12] },
  { term: 'partition coefficient', n: [9, 12] },
  { term: 'vapour pressure', n: [9] },
  { term: 'density', n: [9] },
  { term: 'relative vapour density', n: [9] },
  { term: 'particle size', n: [9] },
  { term: 'oxidising properties', n: [9, 10] },

  { term: 'reactivity', n: [10] },
  { term: 'chemical stability', n: [10] },
  { term: 'hazardous reactions', n: [10] },
  { term: 'polymerisation', n: [10] },
  { term: 'conditions to avoid', n: [10] },
  { term: 'incompatible materials', n: [10, 7] },
  { term: 'hazardous decomposition products', n: [10] },

  { term: 'ld50', n: [11] },
  { term: 'lc50', n: [11, 12] },
  { term: 'acute toxicity', n: [11] },
  { term: 'skin corrosion', n: [11] },
  { term: 'skin irritation', n: [11] },
  { term: 'eye damage', n: [11] },
  { term: 'sensitisation', n: [11] },
  { term: 'mutagenicity', n: [11] },
  { term: 'carcinogenicity', n: [11] },
  { term: 'iarc', n: [11] },
  { term: 'ntp', n: [11] },
  { term: 'reproductive toxicity', n: [11] },
  { term: 'stot', n: [11] },
  { term: 'aspiration hazard', n: [11] },
  { term: 'route of exposure', n: [11, 4] },

  { term: 'aquatic toxicity', n: [12] },
  { term: 'ec50', n: [12] },
  { term: 'noec', n: [12] },
  { term: 'biodegradability', n: [12] },
  { term: 'persistence', n: [12] },
  { term: 'bioaccumulation', n: [12] },
  { term: 'bcf', n: [12] },
  { term: 'mobility in soil', n: [12] },
  { term: 'pbt vpvb assessment', n: [12] },
  { term: 'ozone depletion', n: [12] },

  { term: 'disposal', n: [13] },
  { term: 'waste code', n: [13] },
  { term: 'ewc low code', n: [13] },
  { term: 'contaminated packaging', n: [13] },
  { term: 'waste water', n: [13, 12] },
  { term: 'incineration', n: [13] },

  { term: 'un number', n: [14] },
  { term: 'proper shipping name', n: [14] },
  { term: 'transport hazard class', n: [14] },
  { term: 'packing group', n: [14] },
  { term: 'marine pollutant', n: [14] },
  { term: 'adr', n: [14] },
  { term: 'imdg', n: [14] },
  { term: 'iata', n: [14] },
  { term: 'tunnel restriction code', n: [14] },
  { term: 'limited quantity', n: [14] },
  { term: 'transport in bulk', n: [14] },

  { term: 'reach', n: [15] },
  { term: 'svhc', n: [15] },
  { term: 'candidate list', n: [15] },
  { term: 'authorisation annex xiv', n: [15] },
  { term: 'restriction annex xvii', n: [15] },
  { term: 'seveso', n: [15] },
  { term: 'tsca', n: [15] },
  { term: 'proposition 65', n: [15] },
  { term: 'sara 313', n: [15] },
  { term: 'chemical safety assessment', n: [15] },
  { term: 'chemical safety report', n: [15, 8] },
  { term: 'national inventory', n: [15] },
  { term: 'vocs', n: [15, 9] },

  { term: 'revision date', n: [16] },
  { term: 'version number', n: [16] },
  { term: 'date of preparation', n: [16] },
  { term: 'abbreviations', n: [16] },
  { term: 'legend', n: [16] },
  { term: 'references', n: [16] },
  { term: 'training advice', n: [16] },
  { term: 'full text of h statements', n: [16, 2] },
  { term: 'classification method', n: [16, 2] },
]
