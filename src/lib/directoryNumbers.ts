/**
 * src/lib/directoryNumbers.ts — числа рядом с текстом факта каталога (s103, scripts/sql/103-directory-numbers-history.sql).
 *
 * Сайт печатает `value` («EUR 1,249 per month»), сторож ищет на странице `evidence`. Для отчётов по каталогу
 * («сколько стоит SDS», «сколько языков», «у кого условия только в PDF») рядом лежат разобранные поля:
 *   num / num_max / num_qual — число, верх диапазона, характер числа;
 *   unit / unit_qty          — за что цена и сколько единиц она покрывает; у языков — что считали;
 *   period                   — month | year | one_off; null — период не назван;
 *   currency                 — ISO 4217; null у бесплатного и где страница валюту не называет («$1,299»);
 *   price_role               — что это за цена (тариф, услуга, обучение, надбавка…).
 * У записи: terms_kind / terms_doc_url / terms_dated — в каком виде вендор публикует условия.
 *
 * s104 (104-directory-phase-c-kinds.sql) — шесть видов, собранных при перепроверке 171 коммерческой записи:
 *   regulation — какой акт о формате SDS / hazard communication вендор НАЗЫВАЕТ (label = режим из
 *                REGULATION_LABELS, value из REGULATION_VALUES или «GHS Rev. N»; evidence = номер как напечатан).
 *                ⚠ Статус акта (действует / заменён) в факте не хранится — факт есть только то, что сказал вендор;
 *                статус появится словарём при печати, после проверки по первоисточникам (EUR-Lex, eCFR).
 *   market     — страны и регионы, названные обслуживаемыми; detail = коды ISO 3166-1 alpha-2 через запятую
 *                и/или EU · EEA · worldwide; unspecified — «over 80 countries» без имён.
 *   turnaround — названный срок (num, num_max, num_qual, unit из TURNAROUND_UNITS; label — к чему срок).
 *   founded    — год основания (num = год, unit = year, num_qual = exact).
 *   hosting    — где хранятся данные (только софт); detail как у market.
 *   format     — форматы обмена SDS (только софт); value из FORMAT_VALUES.
 * ⚠ Печатаются только подтверждёнными (directoryModel.GATED_KINDS, PHASE_C_KINDS) — решение Сергея s104 (вечер).
 *
 * ⚠ Источник правды — посев (scripts/data/directory-v3.json). Здесь — словари и сверка, которые
 * scripts/import-directory.ts прогоняет до любой записи: число цены обязано стоять в её тексте, иначе
 * отчёт посчитал бы то, чего на карточке нет. База держит только формат (словари расширяются здесь,
 * без миграции).
 *
 * Сайт эти поля пока не читает (directoryData.ts их не выбирает) — карточки от них не меняются.
 *
 * s109 (109-directory-a2-kinds-or-emergency.sql) - five kinds for service providers (Only Representative / registration /
 * PCN now, emergency numbers and laboratories later). Same rules as step C: the database holds the format only, the
 * vocabularies below are the source of truth, and the kinds print only when confirmed (directoryModel.SERVICE_KINDS).
 *   service_scope - value from SERVICE_SCOPE_VALUES; detail = comma-separated regime codes from SERVICE_REGIMES
 *                   (mandatory for Only Representative, OR appointment support and Registration dossiers);
 *                   evidence = the phrase as printed on the vendor page.
 *   sector        - industry the vendor says it serves; value from SECTOR_VALUES.
 *   billing_model - the unit a service is charged by; value from BILLING_MODEL_VALUES. Not pricing_model (software licensing).
 *   contract_term - numeric only: num = length, unit from CONTRACT_TERM_UNITS, label from CONTRACT_TERM_LABELS.
 *   accreditation - recognition that can be looked up in a public register; value from ACCREDITATION_VALUES, detail = the
 *                   accrediting body and scope or number, source_url = the register page, evidence = the register line.
 * Every one of them needs `evidence`: check:directory confirms a fact only by finding its evidence on the source page,
 * so a fact without it could never be confirmed and would never print.
 */

import { parseMarket } from './directoryGeo'
import { displayValue, isCode } from './directoryVocab'

export const NUM_QUALS = ['exact', 'from', 'at_least', 'up_to', 'approx', 'range'] as const

/**
 * За что цена. flat — цена тарифа или продукта целиком; остальные — за единицу (× unit_qty):
 * sds, user (пользователь, место), site (площадка, location), workstation, licence, word, translation
 * (перевод этикетки), label (этикетка), package, language_option, document_block (блок документов SAP).
 */
export const PRICE_UNITS = [
  'flat', 'sds', 'user', 'site', 'workstation', 'licence', 'word', 'translation', 'label', 'package',
  'language_option', 'document_block',
] as const

/**
 * Языки: languages — число названо («39 languages»); eu_official — «все языки ЕС» (num = 24 или больше,
 * если названы и другие); named — языки перечислены, num = их число; unspecified — числа нет.
 */
export const LANGUAGE_UNITS = ['languages', 'eu_official', 'named', 'unspecified'] as const

export const PERIODS = ['month', 'year', 'one_off'] as const

/** plan — тариф или продукт; прочие в «from»-цену и сравнение тарифов не идут. */
export const PRICE_ROLES = [
  'plan', 'service', 'training', 'add_on', 'upgrade', 'hardware', 'consumable', 'membership',
] as const

/** html — условия сделки страницей; pdf — только файлом; website_only — только условия пользования сайтом; none — не нашли. */
export const TERMS_KINDS = ['html', 'pdf', 'website_only', 'none'] as const

/** Срок: unit — в чём он назван. */
export const TURNAROUND_UNITS = ['working_days', 'days', 'hours', 'weeks'] as const
export const TURNAROUND_LABELS = ['standard', 'express', 'translation', 'label'] as const

/** Режимы, к которым относится названный акт. */
export const REGULATION_LABELS = ['eu_sds_format', 'eu_clp_revision', 'us_hcs', 'ca_whmis', 'ghs_revision'] as const
/** Имена актов так, как их печатает каталог (evidence — как напечатал вендор). «GHS Rev. N» — по образцу GHS_REV_RE. */
export const REGULATION_VALUES: Record<(typeof REGULATION_LABELS)[number], readonly string[]> = {
  eu_sds_format: ['Regulation (EU) 2020/878', 'Regulation (EU) 2015/830', 'Regulation (EU) No 453/2010'],
  eu_clp_revision: ['Regulation (EU) 2024/2865'],
  us_hcs: ['OSHA HCS 2024', 'OSHA HCS 2012', '29 CFR 1910.1200'],
  ca_whmis: ['WHMIS 2015', 'WHMIS 2023', 'Hazardous Products Regulations'],
  ghs_revision: [],
}
export const GHS_REV_RE = /^GHS Rev\. \d{1,2}$/

/** Форматы обмена SDS. */
export const FORMAT_VALUES = ['SDScomXML', 'PDF', 'Word (DOCX)', 'XML', 'JSON', 'Excel / CSV', 'IUCLID', 'SAP EH&S', 'HTML'] as const

/** detail у market / hosting: коды стран ISO 3166-1 alpha-2 и/или EU · EEA · worldwide, либо unspecified. */
export const REGION_DETAIL_RE = /^(unspecified|(?:[A-Z]{2}|EU|EEA|worldwide)(?:,(?:[A-Z]{2}|EU|EEA|worldwide))*)$/

/** s109: kinds for service providers. directoryModel.SERVICE_KINDS and GATED_KINDS are built from this list. */
export const SERVICE_FACT_KINDS = ['service_scope', 'sector', 'billing_model', 'contract_term', 'accreditation'] as const

/**
 * service_scope values. «Only Representative» means the vendor acts as the OR; «OR appointment support» means it helps
 * the customer appoint one (the two are not the same, measure doc 2026-10-13 section 4).
 */
export const SERVICE_SCOPE_VALUES = [
  'Only Representative',
  'OR appointment support',
  'Registration dossiers',
  'Poison centre notification (PCN)',
  'UFI generation',
  'SCIP notification',
  'C&L Inventory notification',
  'Product notifications (cosmetics, biocides, detergents)',
  'Emergency telephone service',
] as const
/** Values whose regime list is the point of the fact: detail is mandatory. */
export const SCOPE_NEEDS_REGIME: readonly string[] = ['Only Representative', 'OR appointment support', 'Registration dossiers']

/** Regime codes for service_scope.detail and their printed names. Extend here (no migration) when a vendor names another regime. */
export const SERVICE_REGIMES: Record<string, string> = {
  eu_reach: 'EU REACH',
  uk_reach: 'UK REACH',
  ch_chemo: 'Swiss ChemO',
  tr_kkdik: 'Turkey KKDIK',
  kr_kreach: 'Korea K-REACH',
  cn_mee: 'China MEE',
  ua_reach: 'Ukraine REACH',
  eu_clp: 'EU CLP',
  gb_clp: 'GB CLP',
  us_tsca: 'US TSCA',
  au_aicis: 'Australia AICIS',
  jp_cscl: 'Japan CSCL',
  tw_tcca: 'Taiwan TCCA',
  in_bis: 'India BIS',
}
export const REGIME_DETAIL_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:,[a-z][a-z0-9]*(?:_[a-z0-9]+)*)*$/

export const SECTOR_VALUES = [
  'Cosmetics and personal care', 'Fragrances and perfumes', 'Paints, coatings and inks', 'Adhesives and sealants',
  'Cleaning products and detergents', 'Biocides', 'Agrochemicals', 'Pharmaceuticals and medical',
  'Industrial and specialty chemicals', 'Electronics and batteries', 'Fuels and lubricants', 'Food and flavourings',
  'Aerosols', 'Plastics and polymers',
] as const

export const BILLING_MODEL_VALUES = [
  'Per substance', 'Per dossier', 'Per product', 'Per SDS', 'Per call or incident', 'Annual fee', 'Monthly fee',
  'Fixed fee per project', 'Hourly rate',
] as const

export const CONTRACT_TERM_UNITS = ['days', 'months', 'years'] as const
export const CONTRACT_TERM_LABELS = ['minimum_term', 'notice_period', 'renewal_period'] as const

/** accreditation values: only recognitions with a public register. Management-system certificates stay in `certification`. */
export const ACCREDITATION_VALUES = ['ISO/IEC 17025 accredited', 'OECD GLP test facility', 'Approved training provider'] as const

/** s112: units of the numeric public kinds of vocabulary v2 (liability_cap: months for fees_paid, flat + currency for fixed_sum). */
export const V2_NUMERIC_UNITS: Readonly<Record<string, readonly string[]>> = {
  liability_cap: ['months', 'flat'],
  security: ['percent'],
  min_order: ['labels', 'rolls', 'sheets', 'units'],
  duration: ['hours', 'days'],
  cpd_points: ['points'],
  hotline: ['languages'],
}

export const NUMERIC_FACT_COLS = ['num', 'num_max', 'num_qual', 'unit', 'unit_qty', 'period', 'currency', 'price_role'] as const
export const TERMS_ENTRY_COLS = ['terms_kind', 'terms_doc_url', 'terms_dated'] as const

type Loose = Record<string, unknown>

/** Все числа текста: «EUR 1,249 per month» → [1249]; «USD 0.09–0.19 per word» → [0.09, 0.19]. */
export function numbersInText(s: string): number[] {
  return (s.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, '')))
}

const has = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v)
/** s112: a value of an old closed list may be its old wording or its vocabulary v2 code. */
const known = (kind: string, list: readonly string[], v: unknown) => has(list, v) || (typeof v === 'string' && isCode(kind, v))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Брак числовых полей одного факта; пустой массив — всё в порядке. */
export function factNumberProblems(f: Loose): string[] {
  const p: string[] = []
  const kind = String(f.kind)
  const value = String(f.value ?? '')
  const set = (k: string) => f[k] !== undefined && f[k] !== null
  const priceOnly = ['period', 'currency', 'price_role'].filter(set)
  // s112: a fixed-sum liability cap carries a currency (vocabulary v2, liability_cap.fixed_sum)
  const allowed = kind === 'price' ? priceOnly : kind === 'liability_cap' ? priceOnly.filter((k) => k === 'currency') : []
  if (priceOnly.length > allowed.length) p.push(`${priceOnly.filter((k) => !allowed.includes(k)).join(', ')} — только у цены`)
  if (set('num') !== set('num_qual')) p.push('num и num_qual ставятся вместе')
  if (set('num_qual') && !has(NUM_QUALS, f.num_qual)) p.push(`num_qual «${f.num_qual}» вне словаря`)
  if (set('num') && !isNum(f.num)) p.push('num — не число')
  if ((f.num_qual === 'range') !== set('num_max')) p.push('num_max только у диапазона (num_qual = range)')
  if (set('num_max') && !(isNum(f.num_max) && isNum(f.num) && f.num_max > f.num)) p.push('num_max должен быть больше num')
  if (set('unit_qty') && !(isNum(f.unit_qty) && f.unit_qty > 0 && set('unit'))) p.push('unit_qty — положительное число и только с unit')

  if (kind === 'price') {
    if (!has(PRICE_ROLES, f.price_role)) p.push(`price_role обязателен: ${PRICE_ROLES.join(' | ')}`)
    if (set('period') && !has(PERIODS, f.period)) p.push(`period «${f.period}» вне словаря`)
    if (value === 'Custom quote') {
      if (set('num') || set('unit') || set('currency') || set('period')) p.push('«Custom quote» — без чисел, единицы, валюты и периода')
    } else if (value === 'Free') {
      if (f.num !== 0 || f.unit !== 'flat' || set('currency')) p.push('«Free» — num 0, unit flat, без валюты')
    } else {
      if (!isNum(f.num)) p.push('у цены нет num')
      if (!has(PRICE_UNITS, f.unit)) p.push(`unit «${f.unit ?? ''}» вне словаря цен`)
      if (f.unit !== 'flat' && set('unit') && !set('unit_qty')) p.push('у цены за единицу нужен unit_qty')
      if (f.unit === 'flat' && set('unit_qty')) p.push('у flat нет unit_qty')
      const inText = numbersInText(value)
      if (isNum(f.num) && !inText.includes(f.num)) p.push(`num ${f.num} нет в тексте «${value}»`)
      if (isNum(f.num_max) && !inText.includes(f.num_max)) p.push(`num_max ${f.num_max} нет в тексте «${value}»`)
      if (set('currency')) {
        if (!/^[A-Z]{3}$/.test(String(f.currency))) p.push(`currency «${f.currency}» — не код ISO 4217`)
        else if (!new RegExp(`\\b${f.currency}\\b`).test(value)) p.push(`валюты ${f.currency} нет в тексте «${value}»`)
      } else if (/\b(EUR|USD|GBP|PLN|CHF|CAD|AUD|SEK|NOK|DKK|CZK|HUF|RON|JPY|CNY|INR)\b/.test(value)) {
        p.push(`в тексте «${value}» есть валюта, а currency пуст`)
      }
    }
  } else if (kind === 'language') {
    if (!has(LANGUAGE_UNITS, f.unit)) p.push(`unit обязателен: ${LANGUAGE_UNITS.join(' | ')}`)
    if (f.unit === 'unspecified' ? set('num') : !isNum(f.num)) p.push('у языков num есть всегда, кроме unspecified')
    if (f.unit === 'eu_official' && isNum(f.num) && f.num < 24) p.push('eu_official — 24 языка или больше')
    if (set('unit_qty')) p.push('у языков нет unit_qty')
  } else if (kind === 'free_trial') {
    if (set('num') || set('unit')) {
      if (f.unit !== 'days' || !isNum(f.num)) p.push('у пробного периода — num дней и unit days')
      else if (!numbersInText(value).includes(f.num)) p.push(`num ${f.num} нет в тексте «${value}»`)
    }
  } else if (kind === 'turnaround') {
    if (!has(TURNAROUND_UNITS, f.unit)) p.push(`unit обязателен: ${TURNAROUND_UNITS.join(' | ')}`)
    if (!isNum(f.num)) p.push('у срока нет num')
    else if (!numbersInText(value).includes(f.num)) p.push(`num ${f.num} нет в тексте «${value}»`)
    if (isNum(f.num_max) && !numbersInText(value).includes(f.num_max)) p.push(`num_max ${f.num_max} нет в тексте «${value}»`)
    if (set('label') && !has(TURNAROUND_LABELS, f.label)) p.push(`label «${f.label}» вне словаря сроков`)
    if (set('unit_qty')) p.push('у срока нет unit_qty')
  } else if (kind === 'founded') {
    if (f.unit !== 'year' || f.num_qual !== 'exact' || !isNum(f.num)) p.push('у года основания — num = год, unit year, num_qual exact')
    else if (f.num < 1800 || f.num > new Date().getUTCFullYear()) p.push(`год ${f.num} вне диапазона`)
    else if (!numbersInText(value).includes(f.num)) p.push(`год ${f.num} нет в тексте «${value}»`)
    if (set('unit_qty')) p.push('у года нет unit_qty')
  } else if (kind === 'contract_term') {
    if (!has(CONTRACT_TERM_UNITS, f.unit)) p.push(`unit is required: ${CONTRACT_TERM_UNITS.join(' | ')}`)
    if (!isNum(f.num) || f.num <= 0) p.push('contract_term needs a positive num (text-only terms go to feature or pricing_note)')
    else if (!numbersInText(value).includes(f.num)) p.push(`num ${f.num} is not in the text "${value}"`)
    if (isNum(f.num_max) && !numbersInText(value).includes(f.num_max)) p.push(`num_max ${f.num_max} is not in the text "${value}"`)
    if (set('label') && !has(CONTRACT_TERM_LABELS, f.label)) p.push(`label "${f.label}" is outside CONTRACT_TERM_LABELS`)
    if (set('unit_qty')) p.push('contract_term has no unit_qty')
  } else if (kind in V2_NUMERIC_UNITS) {
    // s112: numeric public kinds of vocabulary v2 (directoryVocab.ts). The number must stand in the vendor's text.
    if (set('num') || set('unit')) {
      const units = V2_NUMERIC_UNITS[kind]
      if (!has(units, f.unit)) p.push(`unit «${f.unit ?? ''}» for ${kind}: ${units.join(' | ')}`)
      if (!isNum(f.num)) p.push(`${kind} with a unit needs num`)
      // a cap period is often written in words («one month», «annual fees»); its quote is the proof, not the digit
      else if (!(kind === 'liability_cap' && f.unit === 'months') && !numbersInText(value).includes(f.num)) p.push(`num ${f.num} is not in the text "${value}"`)
      if (isNum(f.num_max) && !numbersInText(value).includes(f.num_max)) p.push(`num_max ${f.num_max} is not in the text "${value}"`)
      if (set('unit_qty')) p.push(`${kind} has no unit_qty`)
    }
    if (kind === 'liability_cap' && set('currency') && f.unit !== 'flat') p.push('liability_cap: a currency goes with unit flat (fixed_sum)')
  } else if (set('num') || set('unit') || set('unit_qty')) {
    p.push(`числа — только у price / language / free_trial / turnaround / founded / contract_term, не у ${kind}`)
  }

  // s104: словари значений у видов без чисел
  if (kind === 'regulation') {
    const label = String(f.label ?? '')
    if (!has(REGULATION_LABELS, label)) p.push(`label обязателен: ${REGULATION_LABELS.join(' | ')}`)
    else if (label === 'ghs_revision' ? !GHS_REV_RE.test(value) : !REGULATION_VALUES[label as (typeof REGULATION_LABELS)[number]].includes(value))
      p.push(`value «${value}» вне словаря актов для ${label}`)
    if (!set('evidence')) p.push('у акта обязателен evidence (номер как напечатан)')
  } else if (kind === 'format') {
    if (!known('format', FORMAT_VALUES, value)) p.push(`формат «${value}» вне словаря: ${FORMAT_VALUES.join(' | ')}`)
  } else if (kind === 'market' || kind === 'hosting') {
    if (!REGION_DETAIL_RE.test(String(f.detail ?? ''))) p.push(`detail «${f.detail ?? ''}» — коды ISO 3166-1 alpha-2 / EU / EEA / worldwide через запятую, либо unspecified`)
    // s108 (A1): код должен быть в таблице directoryGeo.GEO — иначе фильтр «Operates in» молча потеряет эту страну.
    else for (const u of parseMarket(String(f.detail ?? '')).unknown) p.push(`код «${u}» нет в таблице directoryGeo.GEO (src/lib/directoryGeo.ts) — добавить страну или исправить detail`)
  }

  // s109: service-provider kinds. Evidence is mandatory for all five (see the header); vocabularies are above.
  if ((SERVICE_FACT_KINDS as readonly string[]).includes(kind)) {
    if (!set('evidence')) p.push(`${kind} needs evidence (the phrase as printed on the source page): without it the fact can never be confirmed or printed`)
    const detail = String(f.detail ?? '')
    if (kind === 'service_scope') {
      if (!known('service_scope', SERVICE_SCOPE_VALUES, value)) p.push(`value "${value}" is outside SERVICE_SCOPE_VALUES`)
      if (detail) {
        if (!REGIME_DETAIL_RE.test(detail)) p.push(`detail "${detail}" must be comma-separated regime codes (lower case, e.g. eu_reach,uk_reach)`)
        else for (const c of detail.split(',')) if (!Object.prototype.hasOwnProperty.call(SERVICE_REGIMES, c)) p.push(`regime "${c}" is not in SERVICE_REGIMES (src/lib/directoryNumbers.ts)`)
      } else if (SCOPE_NEEDS_REGIME.includes(displayValue('service_scope', value))) p.push(`"${value}" needs detail = the regime codes the vendor names`)
    } else if (kind === 'sector') {
      if (!known('sector', SECTOR_VALUES, value)) p.push(`value "${value}" is outside SECTOR_VALUES`)
    } else if (kind === 'billing_model') {
      if (!known('billing_model', BILLING_MODEL_VALUES, value)) p.push(`value "${value}" is outside BILLING_MODEL_VALUES`)
    } else if (kind === 'accreditation') {
      if (!known('accreditation', ACCREDITATION_VALUES, value)) p.push(`value "${value}" is outside ACCREDITATION_VALUES`)
      if (!detail) p.push('accreditation needs detail = the accrediting body and the scope or register number')
    }
  }
  return p
}

/** Брак полей об условиях вендора у записи. */
export function entryTermsProblems(e: Loose): string[] {
  const p: string[] = []
  const set = (k: string) => e[k] !== undefined && e[k] !== null
  if (set('terms_kind') && !has(TERMS_KINDS, e.terms_kind)) p.push(`terms_kind «${e.terms_kind}» вне словаря`)
  const withDoc = ['html', 'pdf', 'website_only'].includes(String(e.terms_kind))
  if (set('terms_doc_url') && !(withDoc && /^https?:\/\//.test(String(e.terms_doc_url)))) p.push('terms_doc_url — адрес и только при terms_kind html / pdf / website_only')
  if (set('terms_dated') && !(withDoc && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(e.terms_dated)))) p.push('terms_dated — «ГГГГ», «ГГГГ-ММ» или «ГГГГ-ММ-ДД» и только у документа')
  if (set('terms_kind') && e.state !== 'live') p.push('terms_* — только у живых записей')
  return p
}
