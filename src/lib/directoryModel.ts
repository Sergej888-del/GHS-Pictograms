// src/lib/directoryModel.ts — GHS Tools & Services Directory (№148, s92, CLAUDE.md §18).
//
// ЧИСТЫЙ модуль: ни Supabase, ни import.meta.env. Его читают страницы /directory/, sitemap,
// scripts/check-dist.ts и scripts/check-directory.ts — поэтому правила печати живут ЗДЕСЬ,
// а не во фронтматтере страницы (вторая копия правила в сторожe = правило, которое разойдётся молча).
//
// ⭐⭐⭐ ШЕСТЬ ПРАВИЛ ЗАПИСИ (§18.2) — то, что этот модуль обязан держать:
//   1. Факты из открытых источников + «Last verified». Ни оценок, ни звёзд, ни «best for».
//   2. Без логотипов — только имена (чужие знаки не трогаем, пока владелец их не дал).
//   3. listed → claimed → featured; ⛔ ПОРЯДОК В РЕДАКЦИОННОМ СПИСКЕ НЕ ПРОДАЁТСЯ:
//      claimed первыми, внутри — алфавит (`orderEntries`). featured — только отдельный блок
//      Sponsored, не больше двух на категорию, и список под ним не меняет.
//   4. Партнёрство раскрыто на карточке (`AFFILIATE_NOTE`), партнёрская ссылка —
//      rel="sponsored nofollow noopener", как везде (§8).
//   5. Ничего не удаляется: мёртвое → state 'closed' с датой и источником.
//   6. Страница записи индексируется, когда в ней есть что читать (`entryIndexable`): живая запись
//      с ≥ ENTRY_INDEX_MIN_FACTS печатаемых фактов — или заявленная владельцем. Тонкие и закрытые —
//      noindex. ⚠ Решение Сергея s92 (05.10): «noindex до заявки» не давал ни данных о спросе
//      (GSC молчит о закрытых страницах), ни цифр, которые можно показать вендору в письме.
//
// ⭐⭐ ЦЕНЫ И ЦИТАТЫ ПЕЧАТАЮТСЯ ТОЛЬКО ПОДТВЕРЖДЁННЫМИ (`printable`). Обе собраны инструментом,
// который пропускает страницу через суммаризатор: он может исказить число ($9,293 вместо
// $9,299 — живой случай s92) или обрезать цитату. scripts/check-directory.ts заново читает
// страницу-источник и ищет на ней `evidence`; только после этого `confirmed = true`.
//
// ⭐⭐⭐ ЦИТАТА ОБ ОТВЕТСТВЕННОСТИ — ТОЛЬКО ИЗ ЮРИДИЧЕСКОГО ДОКУМЕНТА (`LEGAL_SOURCE_KINDS`, решение
// Сергея s93, 05.10). Повод: у Avery печаталась оговорка «the contents of this article… are not a
// legal opinion» — дословная, подтверждённая, и при этом о СТАТЬЕ БЛОГА, а не об этикетках.
// «Дословно» ≠ «про то, что мы утверждаем». Поэтому у каждой цитаты `source_kind` — тип
// документа-источника, и блок «What the vendor says it is responsible for» печатает только
// terms / legal_notice / policy. Оговорка на странице продукта (`inline_disclaimer`) и
// блог / FAQ / маркетинг / пересказ закона (`other`) остаются в базе как след проверки, но не
// печатаются — даже подтверждённые. Под цитатой читатель видит, из какого документа она.

export const DIRECTORY_BASE = '/directory/'
export const SITE = 'https://ghspictograms.com'

export type CategorySlug =
  | 'sds-authoring-software'
  | 'sds-management'
  | 'label-design-printing'
  | 'regulatory-databases'
  | 'authoring-services-consultants'
  | 'training'
  | 'closed'

export type Category = {
  slug: CategorySlug
  /** <title> целиком (без суффикса сайта) — ≤ 60 знаков, по замеренному спросу (§18.3, s91). */
  title: string
  h1: string
  eyebrow: string
  /** meta description, 70–165 знаков. */
  description: string
  /** Первый абзац под hero. `{n}` подставляется числом записей. */
  lead: string
  /** Короткое имя для карточек хаба и хлебных крошек. */
  short: string
  /** Показывать ли блок «Who is responsible for an SDS» (документы с юридической силой). */
  responsibility: boolean
}

export const CATEGORIES: Category[] = [
  {
    slug: 'sds-authoring-software',
    title: 'SDS Authoring Software Compared — Prices and Facts',
    h1: 'SDS authoring software',
    eyebrow: 'Directory · Authoring & classification software',
    short: 'SDS authoring software',
    description:
      'Safety data sheet authoring software and GHS/CLP mixture classification tools: published prices, countries, languages and jurisdictions, each with its source.',
    lead:
      'Safety data sheet authoring software and GHS/CLP mixture classification tools — {n} products. Older pages still call this “MSDS software”. Every fact below links to the vendor page it came from; a price appears only where the vendor publishes one.',
    responsibility: true,
  },
  {
    slug: 'sds-management',
    title: 'SDS Management Software and Systems — Prices and Facts',
    h1: 'SDS management software',
    eyebrow: 'Directory · SDS management & chemical inventory',
    short: 'SDS management software',
    description:
      'SDS management software and systems for keeping safety data sheets current and reachable, with chemical inventory: prices, countries and languages, each sourced.',
    lead:
      'SDS management systems keep a library of supplier safety data sheets current and reachable from the floor; many add a chemical inventory. {n} products, each with the facts its vendor publishes and a link to where we read them.',
    responsibility: false,
  },
  {
    slug: 'label-design-printing',
    title: 'GHS Label Software and Labeling Systems Compared',
    h1: 'GHS label software & labeling systems',
    eyebrow: 'Directory · Label design & printing',
    short: 'GHS label software',
    description:
      'GHS label software, GHS labeling systems, printers and label stock for chemical labels: published prices and verifiable facts, listed without ranking.',
    lead:
      'GHS labeling software and the printers and label stock built around it — {n} products. Some print a label from data you enter; some pull it from an SDS; some are hardware. The facts say which.',
    responsibility: false,
  },
  {
    slug: 'regulatory-databases',
    title: 'Free SDS Databases and Chemical Safety Databases',
    h1: 'Chemical safety databases & free SDS sources',
    eyebrow: 'Directory · Databases & regulatory sources',
    short: 'Chemical safety databases',
    description:
      'Free SDS databases, chemical safety databases and official regulatory sources (ECHA, PubChem, CAMEO, GESTIS, NIOSH): what each holds and who runs it.',
    lead:
      'Official registers, public chemical safety databases and free SDS search sites — {n} sources. Where the operator states that its data carries no warranty, the card quotes it.',
    responsibility: false,
  },
  {
    slug: 'authoring-services-consultants',
    title: 'SDS Authoring Services, Consultants and SDS Translation',
    h1: 'SDS authoring services & regulatory consultants',
    eyebrow: 'Directory · Services',
    short: 'SDS authoring services',
    description:
      'SDS authoring services and companies, CLP and REACH consultants, SDS translation services: countries, languages, published prices and stated responsibilities.',
    lead:
      'Companies that write, review or translate safety data sheets, and regulatory consultants for CLP, REACH and HazCom — {n} providers. A service that writes your SDS does not take over your duty to provide it; each card quotes what the provider itself says it is responsible for.',
    responsibility: true,
  },
  {
    slug: 'training',
    title: 'GHS and HazCom Training Resources from Official Sources',
    h1: 'GHS & HazCom training resources',
    eyebrow: 'Directory · Training',
    short: 'Training resources',
    description:
      'GHS, CLP and HazCom training resources from regulators and professional bodies — ECHA, OSHA, ACS, CSB — with what each offers and what it costs.',
    lead: 'Training material and teaching resources from regulators and professional bodies — {n} sources.',
    responsibility: false,
  },
  {
    slug: 'closed',
    title: 'Closed Chemical Safety Databases: Where TOXNET Went',
    h1: 'Closed and moved resources',
    eyebrow: 'Directory · Closed',
    short: 'Closed and moved',
    description:
      'Chemical safety databases and SDS sites that closed or moved — TOXNET, the Household Products Database — with the date, the notice and where the content went.',
    lead:
      'Resources that closed or moved, kept here on purpose: library guides still link to them. {n} entries, each with the closure date where an official notice gives one and where the content went.',
    responsibility: false,
  },
]

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug)
}

export const categoryHref = (slug: string) => `${DIRECTORY_BASE}${slug}/`
export const entryHref = (e: { category: string; slug: string }) => `${DIRECTORY_BASE}${e.category}/${e.slug}/`

// ─────────────────────────── типы строк базы ───────────────────────────

export type EntryState = 'live' | 'closed' | 'not-listed'
export type Tier = 'listed' | 'claimed' | 'featured'

export interface DirectoryEntry {
  id: number
  slug: string
  category: string
  state: EntryState
  tier: Tier
  title: string
  vendor: string | null
  url: string | null
  description: string
  description_source: string | null
  hq_country: string | null
  hq_country_source: string | null
  reason: string | null
  reason_source: string | null
  closed_on: string | null
  closed_source: string | null
  successor: string | null
  affiliate: 'sds_manager' | 'ghslabels' | null
  affiliate_url: string | null
  tags: string[]
  claimed_on: string | null
  last_verified: string
}

export type FactKind =
  | 'jurisdiction' | 'jurisdiction_claim' | 'language' | 'deployment' | 'platform' | 'free_trial' | 'api'
  | 'iso17100' | 'ufi_pcn' | 'pricing_model' | 'price' | 'pricing_note' | 'pricing_statement' | 'feature'
  | 'certification' | 'integration' | 'responsibility'

/**
 * Тип документа, из которого взята цитата об ответственности (только у kind = 'responsibility').
 *   terms             — Terms & Conditions / Terms of Service / Terms of Use / EULA / licence / AGB / MSA;
 *   legal_notice      — страница Legal notice / Disclaimer / Impressum / policies регулятора;
 *   policy            — формальная политика с датой и разделом об ответственности (EcoOnline «Use of AI»);
 *   inline_disclaimer — оговорка на странице продукта или инструмента (ChemRadar, Cole-Parmer, ILPI);
 *   other             — блог, справка, FAQ, маркетинг, пересказ закона («according to CLP Article 4…»).
 */
export type SourceKind = 'terms' | 'legal_notice' | 'policy' | 'inline_disclaimer' | 'other'

/** Из чего разрешено цитировать ответственность вендора (решение Сергея s93). */
export const LEGAL_SOURCE_KINDS: readonly SourceKind[] = ['terms', 'legal_notice', 'policy']

/** Подпись под цитатой — читатель видит, какого рода документ говорит. */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  terms: 'from the vendor’s terms',
  legal_notice: 'from the legal notice',
  policy: 'from a published policy',
  inline_disclaimer: 'disclaimer on the product page',
  other: 'not a legal document',
}

export interface DirectoryFact {
  id: number
  entry_id: number
  kind: FactKind
  label: string | null
  value: string
  detail: string | null
  quote: string | null
  source_url: string
  evidence: string | null
  sort: number
  checked_on: string
  confirmed: boolean | null
  confirmed_on: string | null
  /** Только у responsibility; у прочих видов null. */
  source_kind: SourceKind | null
}

// ─────────────────────────── правила печати ───────────────────────────

/** Факты, которые печатаются только подтверждёнными (см. шапку файла). */
export const GATED_KINDS: readonly FactKind[] = ['price', 'pricing_note', 'responsibility']

/** Цитата об ответственности взята из юридического документа (а не из блога, FAQ или страницы продукта). */
export function legalSource(f: Pick<DirectoryFact, 'kind' | 'source_kind'>): boolean {
  if (f.kind !== 'responsibility') return true
  return f.source_kind != null && LEGAL_SOURCE_KINDS.includes(f.source_kind)
}

/**
 * Печатается ли факт. ⚠ `pricing_note` (условия: «billed annually», «excl. VAT») идёт вместе с
 * ценами — без подтверждённой цены условия к ней бессмысленны, поэтому гейт тот же.
 * ⚠ `responsibility` проходит два гейта: подтверждена дословность И источник — юридический документ.
 */
export function printable(f: Pick<DirectoryFact, 'kind' | 'confirmed' | 'source_kind'>): boolean {
  if (!GATED_KINDS.includes(f.kind)) return true
  if (f.confirmed !== true) return false
  return legalSource(f)
}

/**
 * Правило 6 (пересмотрено s92, решение Сергея): порог «не тонкая» — столько фактов, сколько
 * карточка реально печатает (`printable`: неподтверждённые цены и цитаты не считаются).
 * 5 отсекает четыре записи s92, где на странице почти ничего нет (GoSDS 0, Chemwatch SDS
 * management 2, Haz-Map 2, eChemPortal 4); медиана живых записей — 11.
 */
export const ENTRY_INDEX_MIN_FACTS = 5

type FactForIndex = Pick<DirectoryFact, 'entry_id' | 'kind' | 'confirmed' | 'source_kind'>

/** Сколько фактов записи печатается на её карточке. */
export function printableFactCount(entryId: number, facts: readonly FactForIndex[]): number {
  let n = 0
  for (const f of facts) if (f.entry_id === entryId && printable(f)) n++
  return n
}

/**
 * Правило 6: индексируется живая запись, в которой есть что читать, и любая заявленная.
 * Закрытые — никогда: их справочную роль несёт индексируемая категория /directory/closed/.
 * ⚠ Одна функция на страницу (noindex), sitemap и сторожа dir-entry-pages / dir-sitemap.
 */
export function entryIndexable(e: Pick<DirectoryEntry, 'id' | 'tier' | 'state'>, facts: readonly FactForIndex[]): boolean {
  if (e.state !== 'live') return false
  if (e.tier === 'claimed' || e.tier === 'featured') return true
  return printableFactCount(e.id, facts) >= ENTRY_INDEX_MIN_FACTS
}

/**
 * Правило 3: claimed (и featured — он тоже заявлен владельцем) первыми, внутри — алфавит.
 * ⚠ Алфавит по заголовку карточки, без учёта регистра, английская локаль. Порядок объявлен на
 * странице словами — эта функция и есть то, что там обещано.
 */
export function orderEntries<T extends Pick<DirectoryEntry, 'tier' | 'title'>>(list: T[]): T[] {
  const rank = (t: Tier) => (t === 'listed' ? 1 : 0)
  return [...list].sort(
    (a, b) => rank(a.tier) - rank(b.tier) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
  )
}

/** Sponsored-блок: только featured, не больше двух. Редакционный список под ним не меняется. */
export const SPONSORED_MAX = 2

export const AFFILIATE_NOTE: Record<'sds_manager' | 'ghslabels', string> = {
  sds_manager: 'Affiliate partner: this site earns a commission if you sign up through the link on this card.',
  ghslabels: 'Affiliate relationship: our sister site ghslabels.com has an affiliate relationship with this vendor.',
}

/**
 * Ссылка на сайт вендора — ОДНА функция для карточки, hero страницы записи и колонки таблицы (s93):
 * партнёрская ссылка SDS Manager вместо обычной, rel по правилу §8 / решению Сергея s92 (nofollow у всех).
 * Сторож dir-entry-pages требует nofollow у каждой такой ссылки; dir-affiliate — fpr=ghs3 + sponsored у партнёра.
 */
export function outboundLink(e: Pick<DirectoryEntry, 'url' | 'affiliate' | 'affiliate_url' | 'tier' | 'state'>): { href: string; rel: string } | null {
  if (e.state === 'closed') return null
  const href = e.affiliate === 'sds_manager' && e.affiliate_url ? e.affiliate_url : e.url
  if (!href) return null
  const rel = e.affiliate === 'sds_manager' || e.tier === 'featured' ? 'sponsored nofollow noopener' : 'nofollow noopener'
  return { href, rel }
}

/** Где стоял клик к вендору — параметр `placement` события directory_outbound (GA4 / Umami). */
export type OutboundPlacement = 'table' | 'card' | 'entry-hero' | 'entry'

export const LISTED_NOTE = 'Listed, not ranked. Not verified by the owner.'
export const CLAIMED_NOTE = 'Verified by owner: the company has confirmed or corrected these facts.'

// ─────────────────────────── подписи ───────────────────────────

const COUNTRY: Record<string, string> = {
  AT: 'Austria', AU: 'Australia', BE: 'Belgium', CA: 'Canada', CH: 'Switzerland', CN: 'China', CZ: 'Czechia',
  DE: 'Germany', DK: 'Denmark', EE: 'Estonia', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom',
  HU: 'Hungary', IE: 'Ireland', IN: 'India', IT: 'Italy', JP: 'Japan', KR: 'South Korea', LU: 'Luxembourg',
  LV: 'Latvia', MY: 'Malaysia', NL: 'Netherlands', NO: 'Norway', NZ: 'New Zealand', PL: 'Poland', PT: 'Portugal',
  SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia', US: 'United States',
}
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null
  return COUNTRY[code] ?? code
}

export const JURISDICTION_ORDER = ['EU CLP', 'GB CLP', 'US OSHA HCS', 'Canada WHMIS', 'other GHS countries'] as const
export const JURISDICTION_SHORT: Record<string, string> = {
  'EU CLP': 'EU CLP',
  'GB CLP': 'GB CLP',
  'US OSHA HCS': 'OSHA',
  'Canada WHMIS': 'WHMIS',
  'other GHS countries': 'Other GHS',
}

export const TAG_LABEL: Record<string, string> = {
  translation: 'SDS translation',
  classification: 'Classification calculator',
  'chemical-inventory': 'Chemical inventory',
}

export const RESPONSIBILITY_ORDER = [
  'customer_responsible',
  'compliance_guarantee',
  'liability_cap',
  'insurance',
  'data_disclaimer',
] as const

/** «39+ languages (reports)» → «39+ languages»; без числа — «Multilingual». Для таблицы. */
export function languageShort(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.match(/(\d+\+?)\s*(?:international\s+)?languages/i)
  if (m) return `${m[1]} languages`
  if (/all (24 )?official EU languages/i.test(value)) return 'All EU languages'
  if (/^english$/i.test(value.trim()) || /^english \(us\)$/i.test(value.trim())) return 'English'
  return 'Multilingual'
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso.length === 7 ? `${iso}-01T00:00:00Z` : `${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return iso.length === 7
    ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ─────────────────────────── сборка карточки ───────────────────────────

export interface CardModel {
  entry: DirectoryEntry
  facts: Record<FactKind, DirectoryFact[]>
  /** Цены, которые можно печатать (подтверждены). */
  prices: DirectoryFact[]
  /** У вендора есть опубликованные цены, но проверка их ещё не подтвердила. */
  pricesPending: boolean
  /** Часть тарифов напечатана, часть ещё не подтверждена — карточка обязана об этом сказать. */
  pricesPartial: boolean
  /**
   * Цитаты из юридических документов вендора, подтверждённые и без повторов (один и тот же абзац
   * у PubChem стоял под тремя подписями), в порядке RESPONSIBILITY_ORDER.
   */
  responsibility: DirectoryFact[]
  /**
   * Юридический документ вендора, если цитаты из него есть, но ни одна ещё не подтверждена.
   * ⚠ Только из legal-строк: ссылка «vendor terms» не имеет права вести в блог.
   */
  termsUrl: string | null
  /** Самая низкая подтверждённая ненулевая цена — для колонки «Pricing» таблицы. */
  fromPrice: string | null
  hasFreeTier: boolean
}

export function buildCard(entry: DirectoryEntry, all: DirectoryFact[]): CardModel {
  const facts = {} as Record<FactKind, DirectoryFact[]>
  for (const f of all) {
    if (f.entry_id !== entry.id) continue
    ;(facts[f.kind] ??= []).push(f)
  }
  for (const k of Object.keys(facts) as FactKind[]) facts[k].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const priceRows = facts.price ?? []
  const prices = priceRows.filter(printable)
  const respRows = (facts.responsibility ?? []).filter(legalSource)
  const seenQuotes = new Set<string>()
  const responsibility = respRows
    .filter(printable)
    .sort(
      (a, b) =>
        RESPONSIBILITY_ORDER.indexOf((a.label ?? '') as any) - RESPONSIBILITY_ORDER.indexOf((b.label ?? '') as any),
    )
    .filter((r) => {
      const key = (r.quote ?? '').replace(/\W+/g, ' ').trim().toLowerCase()
      if (seenQuotes.has(key)) return false
      seenQuotes.add(key)
      return true
    })
  // ⚠ «from» — по тарифам самого продукта: обучение, услуги и надбавки («Training», «(service)», «add-on»,
  // «translation pack») в «from» не идут, иначе SBLCore читался бы «from EUR 30» — это цена проверки этикетки.
  const NOT_A_PLAN = /training|service|add-on|certification|translation pack/i
  const paid = prices.filter(
    (p) => p.value !== 'Free' && p.value !== 'Custom quote' && !NOT_A_PLAN.test(p.label ?? ''),
  )
  const amount = (s: string) => {
    const m = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY
  }
  // ⚠ «from …» только у продуктов с тарифной сеткой. У услуг и обучения опубликованные цены —
  // обычно надбавки и курсы (сертификация перевода $5 за страницу, e-learning), и «from USD 5»
  // в колонке читалось бы как цена услуги. На карточке все тарифы всё равно печатаются с именами.
  const cheapest = FROM_PRICE_CATEGORIES.includes(entry.category)
    ? [...paid].sort((a, b) => amount(a.value) - amount(b.value))[0]
    : undefined
  return {
    entry,
    facts,
    prices,
    pricesPending: priceRows.length > 0 && prices.length === 0,
    pricesPartial: prices.length > 0 && prices.length < priceRows.length,
    responsibility,
    termsUrl: responsibility.length === 0 && respRows.length > 0 ? respRows[0].source_url : null,
    fromPrice: cheapest ? cheapest.value.replace(/^from\s+/i, '') : null,
    hasFreeTier: prices.some((p) => p.value === 'Free'),
  }
}

/** Категории, где «from <цена>» в таблице честен: сетка тарифов продукта. */
export const FROM_PRICE_CATEGORIES = ['sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases']

/** Значение одного факта (первый по `sort`) или null. */
export function first(card: CardModel, kind: FactKind): DirectoryFact | null {
  return card.facts[kind]?.[0] ?? null
}

export function jurisdictionsOf(card: CardModel): string[] {
  return (card.facts.jurisdiction ?? []).map((f) => f.value)
}
