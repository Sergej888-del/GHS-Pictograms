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
 */

import { parseMarket } from './directoryGeo'

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

export const NUMERIC_FACT_COLS = ['num', 'num_max', 'num_qual', 'unit', 'unit_qty', 'period', 'currency', 'price_role'] as const
export const TERMS_ENTRY_COLS = ['terms_kind', 'terms_doc_url', 'terms_dated'] as const

type Loose = Record<string, unknown>

/** Все числа текста: «EUR 1,249 per month» → [1249]; «USD 0.09–0.19 per word» → [0.09, 0.19]. */
export function numbersInText(s: string): number[] {
  return (s.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, '')))
}

const has = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Брак числовых полей одного факта; пустой массив — всё в порядке. */
export function factNumberProblems(f: Loose): string[] {
  const p: string[] = []
  const kind = String(f.kind)
  const value = String(f.value ?? '')
  const set = (k: string) => f[k] !== undefined && f[k] !== null
  const priceOnly = ['period', 'currency', 'price_role'].filter(set)
  if (kind !== 'price' && priceOnly.length) p.push(`${priceOnly.join(', ')} — только у цены`)
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
  } else if (set('num') || set('unit') || set('unit_qty')) {
    p.push(`числа — только у price / language / free_trial / turnaround / founded, не у ${kind}`)
  }

  // s104: словари значений у видов без чисел
  if (kind === 'regulation') {
    const label = String(f.label ?? '')
    if (!has(REGULATION_LABELS, label)) p.push(`label обязателен: ${REGULATION_LABELS.join(' | ')}`)
    else if (label === 'ghs_revision' ? !GHS_REV_RE.test(value) : !REGULATION_VALUES[label as (typeof REGULATION_LABELS)[number]].includes(value))
      p.push(`value «${value}» вне словаря актов для ${label}`)
    if (!set('evidence')) p.push('у акта обязателен evidence (номер как напечатан)')
  } else if (kind === 'format') {
    if (!has(FORMAT_VALUES, value)) p.push(`формат «${value}» вне словаря: ${FORMAT_VALUES.join(' | ')}`)
  } else if (kind === 'market' || kind === 'hosting') {
    if (!REGION_DETAIL_RE.test(String(f.detail ?? ''))) p.push(`detail «${f.detail ?? ''}» — коды ISO 3166-1 alpha-2 / EU / EEA / worldwide через запятую, либо unspecified`)
    // s108 (A1): код должен быть в таблице directoryGeo.GEO — иначе фильтр «Operates in» молча потеряет эту страну.
    else for (const u of parseMarket(String(f.detail ?? '')).unknown) p.push(`код «${u}» нет в таблице directoryGeo.GEO (src/lib/directoryGeo.ts) — добавить страну или исправить detail`)
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
