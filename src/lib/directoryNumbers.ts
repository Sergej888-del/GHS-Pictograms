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
 * ⚠ Источник правды — посев (scripts/data/directory-v3.json). Здесь — словари и сверка, которые
 * scripts/import-directory.ts прогоняет до любой записи: число цены обязано стоять в её тексте, иначе
 * отчёт посчитал бы то, чего на карточке нет. База держит только формат (словари расширяются здесь,
 * без миграции).
 *
 * Сайт эти поля пока не читает (directoryData.ts их не выбирает) — карточки от них не меняются.
 */

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
  } else if (set('num') || set('unit') || set('unit_qty')) {
    p.push(`числа — только у price / language / free_trial, не у ${kind}`)
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
