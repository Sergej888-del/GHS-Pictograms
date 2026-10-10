// src/lib/directoryModel.ts — GHS Tools & Services Directory (№148, s92, CLAUDE.md §18).
//
// ЧИСТЫЙ модуль: ни Supabase, ни import.meta.env. Его читают страницы /directory/, sitemap,
// scripts/check-dist.ts и scripts/check-directory.ts — поэтому правила печати живут ЗДЕСЬ,
// а не во фронтматтере страницы (вторая копия правила в сторожe = правило, которое разойдётся молча).
//
// ⭐⭐⭐ ШЕСТЬ ПРАВИЛ ЗАПИСИ (§18.2) — то, что этот модуль обязан держать:
//   1. Факты из открытых источников + «Last verified». Ни оценок, ни звёзд, ни «best for».
//   2. Логотип — только от владельца: у `listed` ни одного <img>; у `claimed`+ логотип, который
//      прислал владелец (`logo_path`, s96). Чужие знаки не трогаем, пока владелец их не дал.
//   3. listed → claimed → featured; ⛔ ПОРЯДОК В РЕДАКЦИОННОМ СПИСКЕ НЕ ПРОДАЁТСЯ:
//      заявленные первыми, внутри — ПО ДАТЕ ПОДТВЕРЖДЕНИЯ ФАКТОВ ВЛАДЕЛЬЦЕМ, свежие выше
//      (`owner_confirmed_on`, решение Сергея s95: алфавит внутри claimed топил W–Z); внутри listed —
//      алфавит (`orderEntries`, фраза ORDER_NOTE на странице). featured — только отдельный блок
//      Sponsored, не больше двух на категорию, и список под ним не меняет; после `featured_until`
//      карточка печатается как claimed (`effectiveTier`).
//   2c. Запись в нескольких категориях (s95): основная `category` + `also_in[]`; дополнительная
//      категория печатается ТОЛЬКО при подтверждённом факте-основании (`feature`, `confirmed`,
//      `basis_for` = та категория) — `alsoInCategories()`. Страница записи одна (canonical под основной).
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

/** Категории, в которые запись может входить дополнительно (`also_in`): живые разделы, не closed. */
export const ALSO_IN_CATEGORIES: readonly CategorySlug[] = [
  'sds-authoring-software', 'sds-management', 'label-design-printing', 'regulatory-databases',
  'authoring-services-consultants', 'training',
]

export const categoryHref = (slug: string) => `${DIRECTORY_BASE}${slug}/`
export const entryHref = (e: { category: string; slug: string }) => `${DIRECTORY_BASE}${e.category}/${e.slug}/`

// ─────────────────────────── подразделы услуг (s95 §2b, s96) ───────────────────────────
//
// Раздел услуг — 39 записей; в одном алфавитном списке «конец» не читают. Решение Сергея s95: четыре
// подраздела ~8–12 записей. `category` у записи остаётся, добавляется `subcategory`; страница раздела
// остаётся хабом (все записи, по группам), у каждого подраздела своя страница
// /directory/authoring-services-consultants/<sub>/. Слуги записей не меняются — редиректы не нужны.
// ⚠ Слуг подраздела не должен совпадать со слугом записи того же раздела (один путь) — сторож dir-subcategories.

export const SUBCATEGORY_PARENT: CategorySlug = 'authoring-services-consultants'

export type SubcategorySlug = 'sds-translation' | 'sds-authoring-eu' | 'sds-authoring-north-america' | 'regulatory-consulting'

export type Subcategory = {
  slug: SubcategorySlug
  title: string
  h1: string
  short: string
  description: string
  lead: string
  /** Чем подраздел отличается — печатается на хабе раздела под заголовком группы. */
  rule: string
}

export const SUBCATEGORIES: Subcategory[] = [
  {
    slug: 'sds-translation',
    title: 'SDS Translation Services — Languages, ISO 17100 and Prices',
    h1: 'SDS translation services',
    short: 'SDS translation',
    description:
      'SDS translation services and agencies: languages offered, ISO 17100 certification, published per-document prices and what each says it is responsible for.',
    lead:
      'Translation companies that specialise in safety data sheets — {n} providers. A translation does not re-classify the mixture; where the provider also adapts the SDS to the target country, its card says so with the source.',
    rule: 'Providers whose SDS offer is translation of an existing sheet.',
  },
  {
    slug: 'sds-authoring-eu',
    title: 'SDS Authoring Services in Europe — REACH and CLP',
    h1: 'SDS authoring services — Europe',
    short: 'SDS authoring · Europe',
    description:
      'Companies in Europe that write and update safety data sheets under REACH Annex II and CLP, with eSDS, UFI/PCN and EU languages: facts, prices and stated responsibilities.',
    lead:
      'Providers based in the EU or UK whose core service is writing and updating safety data sheets under REACH and CLP — {n} providers. Each card quotes what the provider itself says it is responsible for.',
    rule: 'Based in the EU or UK; writes and updates SDSs under REACH and CLP as a core service.',
  },
  {
    slug: 'sds-authoring-north-america',
    title: 'SDS Authoring Services in the US and Canada — HazCom and WHMIS',
    h1: 'SDS authoring services — North America',
    short: 'SDS authoring · North America',
    description:
      'US and Canadian SDS authoring services for OSHA HazCom 2012 and WHMIS 2015, with GHS labels and translations: facts, prices and stated responsibilities.',
    lead:
      'Providers based in the United States or Canada whose core service is writing and updating safety data sheets for OSHA HazCom and WHMIS — {n} providers. Each card quotes what the provider itself says it is responsible for.',
    rule: 'Based in the United States or Canada; writes and updates SDSs for HazCom and WHMIS as a core service.',
  },
  {
    slug: 'regulatory-consulting',
    title: 'CLP and REACH Consultants — Chemical Regulatory Consulting',
    h1: 'Regulatory consultants — CLP, REACH and GHS',
    short: 'Regulatory consulting',
    description:
      'Chemical regulatory consultancies for CLP classification, REACH registration, poison centre notification and global GHS, where SDS preparation is one service among several.',
    lead:
      'Consultancies whose main business is chemical regulatory work — REACH and other registrations, classification, notifications — and that prepare safety data sheets as part of it. {n} providers.',
    rule: 'Regulatory consultancy first; SDS preparation is one service among registrations, dossiers and notifications.',
  },
]

export function subcategoryBySlug(slug: string | null | undefined): Subcategory | undefined {
  return slug ? SUBCATEGORIES.find((s) => s.slug === slug) : undefined
}

export const subcategoryHref = (sub: string) => `${DIRECTORY_BASE}${SUBCATEGORY_PARENT}/${sub}/`

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
  // ── s96: профиль заявленной записи (миграция s96_directory_claim; что печатается — §2 tiers-doc s95).
  //    ⚠ Адрес, имя и роль заявителя сюда НЕ входят: они в закрытой таблице directory_claims (service_role).
  /** Дата, когда владелец последний раз подтвердил факты (ответом). Порядок внутри claimed. */
  owner_confirmed_on: string | null
  /** Файл логотипа в public/directory-logos/ (только от владельца, tier ≥ claimed). */
  logo_path: string | null
  /** Описание владельца ≤ 60 слов, без превосходных степеней (check:directory). tier ≥ claimed. */
  owner_description: string | null
  pricing_url: string | null
  terms_url: string | null
  /** Один скриншот продукта — только featured. */
  screenshot_path: string | null
  /** Кнопка «Contact vendor» — только featured. */
  contact_url: string | null
  rfq_opt_in: boolean
  featured_from: string | null
  featured_until: string | null
  featured_slots: string[]
  /** Дополнительные категории; печатаются только при подтверждённом факте-основании (alsoInCategories). */
  also_in: string[]
  /** Подраздел — только у authoring-services-consultants. */
  subcategory: string | null
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
  /** Кто дал факт: редакция или владелец (s96). Факт владельца печатается с подписью «stated by the vendor». */
  provided_by: 'editor' | 'owner'
  /** Этот факт — основание для дополнительной категории (`also_in`); только у kind = 'feature'. */
  basis_for: string | null
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
export function printable(f: Pick<DirectoryFact, 'kind' | 'confirmed' | 'source_kind'> & { provided_by?: 'editor' | 'owner' }): boolean {
  if (!GATED_KINDS.includes(f.kind)) return true
  // s96: цену, которую назвал сам владелец, печатаем и до подтверждения — это его цифра о себе, с подписью
  // «stated by the vendor» (ownerStated). Цитата об ответственности — без исключений: оба гейта.
  if (f.provided_by === 'owner' && f.kind !== 'responsibility') return true
  if (f.confirmed !== true) return false
  return legalSource(f)
}

/** Факт дал владелец, и check:directory ещё не нашёл его на странице — печатается с подписью OWNER_FACT_NOTE. */
export function ownerStated(f: Pick<DirectoryFact, 'confirmed'> & { provided_by?: 'editor' | 'owner' }): boolean {
  return f.provided_by === 'owner' && f.confirmed !== true
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

/** Дата сборки (UTC) — по ней истекает featured. Одна функция на страницы и сторожа. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Уровень, который печатается: featured с истёкшим `featured_until` печатается как claimed
 * (оплата кончилась — карточка остаётся заявленной, блок Sponsored и платные элементы уходят сами,
 * без правки базы). Сторож dir-claimed сверяет страницы именно с этой функцией.
 */
export function effectiveTier(
  e: Pick<DirectoryEntry, 'tier' | 'featured_until'>,
  today: string = todayIso(),
): Tier {
  if (e.tier === 'featured' && e.featured_until && e.featured_until < today) return 'claimed'
  return e.tier
}

type OrderRow = Pick<DirectoryEntry, 'tier' | 'title' | 'claimed_on' | 'owner_confirmed_on' | 'featured_until'>

/**
 * Правило 3 (s95): заявленные (claimed и featured — он тоже заявлен) первыми; внутри — по дате, когда
 * владелец последний раз подтвердил факты, СВЕЖИЕ ВЫШЕ (`owner_confirmed_on`, запасной ключ —
 * `claimed_on`), при равной дате — алфавит. Внутри listed — алфавит. Подтверждение бесплатно, не чаще
 * раза в квартал, и это единственный способ подняться внутри списка; над списком стоит только Sponsored.
 * ⚠ Алфавит по заголовку карточки, без учёта регистра, английская локаль. Порядок объявлен на
 * странице словами (ORDER_NOTE) — эта функция и есть то, что там обещано.
 */
export function orderEntries<T extends OrderRow>(list: T[]): T[] {
  const rank = (e: OrderRow) => (effectiveTier(e) === 'listed' ? 1 : 0)
  const confirmed = (e: OrderRow) => e.owner_confirmed_on ?? e.claimed_on ?? ''
  const alpha = (a: OrderRow, b: OrderRow) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r) return r
    if (rank(a) === 0) {
      const d = confirmed(b).localeCompare(confirmed(a)) // свежая дата выше
      if (d) return d
    }
    return alpha(a, b)
  })
}

/** Фраза о порядке — на каждой странице категории и подраздела (сторож dir-order ищет её дословно). */
export const ORDER_NOTE =
  'Verified listings first, most recently confirmed at the top; then listed, alphabetical. Order is not for sale.'

/** Sponsored-блок: только featured, не больше двух. Редакционный список под ним не меняется. */
export const SPONSORED_MAX = 2

// ─────────────────────────── несколько категорий (s95 §2c) ───────────────────────────

/** Строки типизированы широко (string, не FactKind/EntryState): сторожа читают их из базы без приведения. */
type BasisFact = { entry_id: number; kind: string; confirmed: boolean | null; basis_for: string | null }
type AlsoInRow = { id: number; category: string; also_in: string[]; state: string }

/**
 * Дополнительные категории, в которых запись ПЕЧАТАЕТСЯ: из `also_in` остаются только те, под которыми
 * есть подтверждённый факт-основание (kind = feature, confirmed = true, basis_for = категория, у факта
 * есть source_url по построению). Нет факта — нет категории: «SDS Manager печатает этикетки» должно
 * стоять на странице вендора, и check:directory должен это найти.
 */
export function alsoInCategories(e: AlsoInRow, facts: readonly BasisFact[]): string[] {
  if (e.state !== 'live') return []
  return e.also_in.filter(
    (c) =>
      c !== e.category &&
      (ALSO_IN_CATEGORIES as readonly string[]).includes(c) &&
      facts.some((f) => f.entry_id === e.id && f.kind === 'feature' && f.confirmed === true && f.basis_for === c),
  )
}

/** Записи страницы категории: основная категория + подтверждённые дополнительные. */
export function entriesInCategory<T extends AlsoInRow>(
  entries: readonly T[],
  slug: string,
  facts: readonly BasisFact[],
): T[] {
  return entries.filter((e) => e.category === slug || alsoInCategories(e, facts).includes(slug))
}

/** Пометка в дополнительной категории: «Also listed under <основная>». */
export const ALSO_IN_NOTE = 'Also listed under'

// ─────────────────────────── профиль владельца (s96) ───────────────────────────

export const LOGO_BASE = '/directory-logos/'
export const SCREENSHOT_BASE = '/directory-screenshots/'
export const OWNER_DESCRIPTION_MAX_WORDS = 60
export const OWNER_DESCRIPTION_MAX_CHARS = 420

/**
 * Превосходные степени и оценки в описании владельца — запрещены (каталог не ранжирует, и чужое «leading»
 * на нашей странице читается как наше). Одно выражение для check:directory, import:directory и сторожа.
 */
export const SUPERLATIVE_RE =
  /\b(best|leading|leader|#\s?1|no\.?\s?1|number one|world[- ]class|trusted by|most (advanced|popular|trusted|complete|comprehensive)|top[- ]rated|award[- ]winning|unrivalled|unrivaled|premier)\b/i

export function ownerDescriptionProblems(text: string | null | undefined): string[] {
  if (!text) return []
  const p: string[] = []
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words > OWNER_DESCRIPTION_MAX_WORDS) p.push(`${words} words, max ${OWNER_DESCRIPTION_MAX_WORDS}`)
  if (text.length > OWNER_DESCRIPTION_MAX_CHARS) p.push(`${text.length} chars, max ${OWNER_DESCRIPTION_MAX_CHARS}`)
  const m = text.match(SUPERLATIVE_RE)
  if (m) p.push(`superlative “${m[0]}”`)
  if (/https?:\/\/|www\./i.test(text)) p.push('contains a link')
  return p
}

/** Что из профиля владельца печатается на этом уровне (граница бесплатного и платного, tiers-doc s95 §2). */
export function ownerProfileShown(tier: Tier): { logo: boolean; description: boolean; links: boolean; screenshot: boolean; contact: boolean } {
  const claimed = tier === 'claimed' || tier === 'featured'
  return { logo: claimed, description: claimed, links: claimed, screenshot: tier === 'featured', contact: tier === 'featured' }
}

export const AFFILIATE_NOTE: Record<'sds_manager' | 'ghslabels', string> = {
  sds_manager: 'Affiliate partner: this site earns a commission if you sign up through the link on this card.',
  ghslabels: 'Affiliate relationship: our sister site ghslabels.com has an affiliate relationship with this vendor.',
}

/**
 * Ссылка на сайт вендора — ОДНА функция для карточки, hero страницы записи и колонки таблицы (s93):
 * партнёрская ссылка SDS Manager вместо обычной, rel по правилу §8 / решению Сергея s92 (nofollow у всех).
 * Сторож dir-entry-pages требует nofollow у каждой такой ссылки; dir-affiliate — fpr=ghs3 + sponsored у партнёра.
 */
export function outboundLink(
  e: Pick<DirectoryEntry, 'url' | 'affiliate' | 'affiliate_url' | 'tier' | 'state' | 'featured_until'>,
): { href: string; rel: string } | null {
  if (e.state === 'closed') return null
  const href = e.affiliate === 'sds_manager' && e.affiliate_url ? e.affiliate_url : e.url
  if (!href) return null
  const rel = e.affiliate === 'sds_manager' || effectiveTier(e) === 'featured' ? 'sponsored nofollow noopener' : 'nofollow noopener'
  return { href, rel }
}

/** Где стоял клик к вендору — параметр `placement` события directory_outbound (GA4 / Umami). `contact` — кнопка featured. */
export type OutboundPlacement = 'table' | 'card' | 'entry-hero' | 'entry' | 'contact'

export const LISTED_NOTE = 'Listed, not ranked. Not verified by the owner.'
export const CLAIMED_NOTE = 'Verified by owner: the company has confirmed or corrected these facts.'
/** Подпись под фактом, который дал владелец и check:directory ещё не нашёл на его странице. */
export const OWNER_FACT_NOTE = 'stated by the vendor'

// ─────────────────────────── подписи ───────────────────────────

const COUNTRY: Record<string, string> = {
  AT: 'Austria', AU: 'Australia', BE: 'Belgium', CA: 'Canada', CH: 'Switzerland', CN: 'China', CZ: 'Czechia',
  DE: 'Germany', DK: 'Denmark', EE: 'Estonia', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom',
  HU: 'Hungary', IE: 'Ireland', IN: 'India', IT: 'Italy', JP: 'Japan', KR: 'South Korea', LU: 'Luxembourg',
  LV: 'Latvia', MY: 'Malaysia', NL: 'Netherlands', NO: 'Norway', NZ: 'New Zealand', PL: 'Poland', PT: 'Portugal',
  SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', US: 'United States',
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
