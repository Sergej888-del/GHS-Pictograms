/**
 * Транспортная классификация опасных грузов: две юрисдикции, никогда не слитые.
 *
 * ⚠⚠ ГЛАВНОЕ ПРАВИЛО РАЗДЕЛА (un-pages-and-mw-decisions.md §2).
 * ADR и 49 CFR расходятся по одному и тому же UN-номеру: бывает разная группа
 * упаковки, разные спецположения, разное proper shipping name. Значения двух
 * юрисдикций НИКОГДА не попадают в одну строку и никогда не переводятся одно в
 * другое. Особенно спецположения: 73 числовых кода существуют в обеих системах
 * и означают разное (SP 65 в ADR — растворы перекиси водорода, в 49 CFR —
 * щелочноземельные металлы). Отсюда два раздельных словаря и две константы
 * источника ниже.
 *
 * ⚠ Каждое значение на странице несёт клеймо источника, и клеймо кликабельно —
 * правило Сергея, un-pages-design.md §3. Тексты здесь разобраны из
 * первоисточников, лежащих в _active-docs, а не написаны по памяти (правило s37):
 *   · ADR 2025, ECE/TRANS/352 Vol. I  — 1.1.3.6 (транспортные категории), 2.1.1.1 (классы)
 *   · ADR 2025, ECE/TRANS/352 Vol. II — 5.3.2.3 (номер опасности) → hazardIdNumbers.ts
 *   · 49 CFR 172.101(b) и (k) — символы колонки (1) и размещение на судне,
 *     из title-49.xml редакции eCFR 2026-08-03
 *   · 49 CFR 173.2 — названия классов США
 *
 * ⚠ Corrigendum 1 к ADR 2025 (ECE/TRANS/352/Corr.1, август 2024) сверен:
 * он правит только ссылку в сноске 1.9.4 и строку 9.2.4.4 таблицы 9.2.1.1.
 * Главы 3.2 (Таблица A) и 3.3 (спецположения) он не касается — клеймо
 * «ADR 2025» на наших данных корректно.
 */

import { HIN_MEANING, HIN_DIGIT } from './hazardIdNumbers'

/* ────────────────────────── клейма источников ────────────────────────── */

export interface SourceStamp {
  /** Короткая подпись под таблицей. */
  label: string
  /** Ссылка на первоисточник — клеймо обязано быть кликабельным. */
  href: string
  /** Версия данных, как она лежит в базе. */
  version: string
}

export const ADR_SOURCE: SourceStamp = {
  label: 'ADR 2025, Table A of Chapter 3.2 · ECE/TRANS/352 Vol. I (UNECE)',
  href: 'https://unece.org/adr-2025-files',
  version: 'ADR 2025',
}

export const ADR_SP_SOURCE: SourceStamp = {
  label: 'ADR 2025, Chapter 3.3 special provisions · ECE/TRANS/352 Vol. I (UNECE)',
  href: 'https://unece.org/adr-2025-files',
  version: 'ADR 2025',
}

export const ADR_HIN_SOURCE: SourceStamp = {
  label: 'ADR 2025, 5.3.2.3 · ECE/TRANS/352 Vol. II (UNECE)',
  href: 'https://unece.org/transport/documents/2025/01/standards/adr-2025-volume-2',
  version: 'ADR 2025',
}

export const DOT_SOURCE: SourceStamp = {
  label: '49 CFR 172.101 Hazardous Materials Table · eCFR, revision 2026-08-03',
  href: 'https://www.ecfr.gov/current/title-49/section-172.101',
  version: '49 CFR (2026-08-03)',
}

export const DOT_SP_SOURCE: SourceStamp = {
  label: '49 CFR 172.102 special provisions · eCFR, revision 2026-08-03',
  href: 'https://www.ecfr.gov/current/title-49/section-172.102',
  version: '49 CFR (2026-08-03)',
}

export const DOT_CLASS_SOURCE: SourceStamp = {
  label: '49 CFR 173.2 hazardous materials classes · eCFR',
  href: 'https://www.ecfr.gov/current/title-49/section-173.2',
  version: '49 CFR (2026-08-03)',
}

/* ───────────────────────────── названия классов ───────────────────────────── */

/**
 * Классы ADR — ADR 2025, 2.1.1.1, слово в слово.
 * ⚠ Это НЕ названия классов США. Для них отдельный словарь ниже: у 49 CFR
 * своя формулировка («Dangerous when wet material» против «Substances which,
 * in contact with water, emit flammable gases»), и подменять одно другим —
 * ровно тот сценарий, ради которого две юрисдикции разведены.
 */
export const ADR_CLASS_NAME: Record<string, string> = {
  '1': 'Explosive substances and articles',
  '2': 'Gases',
  '3': 'Flammable liquids',
  '4.1': 'Flammable solids, self-reactive substances, polymerizing substances and solid desensitized explosives',
  '4.2': 'Substances liable to spontaneous combustion',
  '4.3': 'Substances which, in contact with water, emit flammable gases',
  '5.1': 'Oxidizing substances',
  '5.2': 'Organic peroxides',
  '6.1': 'Toxic substances',
  '6.2': 'Infectious substances',
  '7': 'Radioactive material',
  '8': 'Corrosive substances',
  '9': 'Miscellaneous dangerous substances and articles',
}

/** Классы и подразделения США — 49 CFR 173.2, слово в слово (капитализация приведена к обычной). */
export const DOT_CLASS_NAME: Record<string, string> = {
  '1.1': 'Explosives (with a mass explosion hazard)',
  '1.2': 'Explosives (with a projection hazard)',
  '1.3': 'Explosives (with predominately a fire hazard)',
  '1.4': 'Explosives (with no significant blast hazard)',
  '1.5': 'Very insensitive explosives; blasting agents',
  '1.6': 'Extremely insensitive detonating substances',
  '2.1': 'Flammable gas',
  '2.2': 'Non-flammable compressed gas',
  '2.3': 'Poisonous gas',
  '3': 'Flammable and combustible liquid',
  '4.1': 'Flammable solid',
  '4.2': 'Spontaneously combustible material',
  '4.3': 'Dangerous when wet material',
  '5.1': 'Oxidizer',
  '5.2': 'Organic peroxide',
  '6.1': 'Poisonous materials',
  '6.2': 'Infectious substance (etiologic agent)',
  '7': 'Radioactive material',
  '8': 'Corrosive material',
  '9': 'Miscellaneous hazardous material',
}

/**
 * Название подразделения США по значению колонки (3).
 * ⚠ У Класса 1 в колонке стоит подразделение вместе с группой совместимости
 * («1.4S», «1.1D»): имя даёт подразделение, буква — группа совместимости, и её
 * значение здесь НЕ расшифровывается (таблица 49 CFR 173.52 не импортирована).
 * `Comb liq` — не класс, а пометка «combustible liquid» из 172.101(d)(4).
 */
export function dotClassName(code: string | null): string | null {
  if (!code) return null
  if (code === 'Comb liq') return 'Combustible liquid'
  if (DOT_CLASS_NAME[code]) return DOT_CLASS_NAME[code]
  const division = /^(1\.[1-6])[A-Z]$/.exec(code)
  return division ? DOT_CLASS_NAME[division[1]] ?? null : null
}

/** Группа совместимости Класса 1 из кода вида «1.4S» — показываем буквой, без выдуманного текста. */
export function dotCompatibilityGroup(code: string | null): string | null {
  if (!code) return null
  const m = /^1\.[1-6]([A-Z])$/.exec(code)
  return m ? m[1] : null
}

/* ───────────────────── символы колонки (1) 49 CFR ───────────────────── */

/**
 * 49 CFR 172.101(b). ⚠⚠ Показывать обязательно: именно символы различают два
 * класса у UN1005 (`I` — международный, `D` — только внутри США) и у UN3318.
 * Тексты сокращены до одного предложения, полная формулировка — по ссылке.
 */
export const DOT_SYMBOL: Record<string, { short: string; text: string }> = {
  '+': {
    short: 'Fixed entry',
    text: 'The plus sign fixes the proper shipping name, hazard class and packing group for that entry without regard to whether the material meets the definition of that class, packing group or any other hazard class definition.',
  },
  A: {
    short: 'Air only',
    text: 'Subject to the requirements of this subchapter only when offered or intended for transportation by aircraft, unless the material is a hazardous substance or a hazardous waste.',
  },
  D: {
    short: 'Domestic only',
    text: 'A proper shipping name appropriate for describing materials for domestic transportation but which may be inappropriate for international transportation under IMO or ICAO provisions.',
  },
  G: {
    short: 'Technical name required',
    text: 'A proper shipping name for which one or more technical names of the hazardous material must be entered in parentheses, in association with the basic description (see § 172.203(k)).',
  },
  I: {
    short: 'International',
    text: 'A proper shipping name appropriate for describing materials in international transportation. An alternate proper shipping name may be selected when only domestic transportation is involved.',
  },
  W: {
    short: 'Vessel only',
    text: 'Subject to the requirements of this subchapter only when offered or intended for transportation by vessel, unless the material is a hazardous substance or a hazardous waste.',
  },
}

/** Префикс номера, колонка (4) 49 CFR — UN / NA / ID. */
export const DOT_ID_PREFIX: Record<string, string> = {
  UN: 'Appropriate for international as well as domestic transportation.',
  NA: 'Not recognized for transportation outside of the United States.',
  ID: 'Recognized by the ICAO Technical Instructions.',
}

/* ──────────────── размещение на судне, колонка 10A 49 CFR ──────────────── */

/** 49 CFR 172.101(k). Тексты сокращены до сути; полная формулировка — по ссылке. */
export const DOT_STOWAGE: Record<string, string> = {
  A: 'May be stowed “on deck” or “under deck” on a cargo vessel or on a passenger vessel.',
  B: 'May be stowed “on deck” or “under deck” on a cargo vessel and on a passenger vessel carrying not more than 25 passengers (or one per 3 m of vessel length); “on deck only” on passenger vessels above that limit.',
  C: 'Must be stowed “on deck only” on a cargo vessel or on a passenger vessel.',
  D: 'Must be stowed “on deck only” on a cargo vessel or on a passenger vessel within the 25-passenger limit; prohibited on a passenger vessel above that limit.',
  E: 'May be stowed “on deck” or “under deck” on a cargo vessel or on a passenger vessel within the 25-passenger limit; prohibited on a passenger vessel above that limit.',
  '01': 'May be stowed “on deck” in closed cargo transport units or “under deck” on a cargo vessel (up to 12 passengers) or on a passenger vessel.',
  '02': 'May be stowed “on deck” in closed cargo transport units or “under deck” on a cargo vessel (up to 12 passengers), or in closed cargo transport units on a passenger vessel.',
  '03': 'May be stowed “on deck” in closed cargo transport units or “under deck” on a cargo vessel (up to 12 passengers); prohibited on a passenger vessel.',
  '04': 'May be stowed “on deck” or “under deck” in closed cargo transport units on a cargo vessel (up to 12 passengers); prohibited on a passenger vessel.',
  '05': 'May be stowed “on deck” in closed cargo transport units on a cargo vessel (up to 12 passengers); prohibited on a passenger vessel.',
}

/**
 * ⚠ Колонка 10B — коды обработки. Их значения живут в 49 CFR 176.84, который у
 * нас НЕ импортирован. Показываем номера как есть и говорим об этом прямо;
 * подставлять текст нельзя (правило: пустая секция честнее чужого текста).
 */
export const DOT_STOWAGE_OTHER_NOTE =
  'Handling codes in column 10B are defined in 49 CFR 176.84, which is not part of our import — the numbers are shown as printed in the table.'

/* ─────────────────── транспортная категория ADR 1.1.3.6 ─────────────────── */

/**
 * ADR 1.1.3.6.3 — максимальное количество на транспортную единицу, и 1.1.3.6.4 —
 * множитель при смешанной загрузке. Порог расчёта: 1 000.
 *
 * ⚠ Категория 0 значит «освобождения нет вообще», а не «ноль килограммов груза».
 * ⚠ У множителя категории 1 есть исключение (сноска a к таблице 1.1.3.6.3):
 * для UN 0081, 0082, 0084, 0241, 0331, 0332, 0482, 1005 и 1017 предел 50 кг,
 * а множитель 20. Проверяем номером, а не категорией.
 */
export const TRANSPORT_CATEGORY: Record<number, { maxQty: string; multiplier: string; meaning: string }> = {
  0: {
    maxQty: '0',
    multiplier: '—',
    meaning: 'No quantity exemption at all: the full ADR regime applies from the first package.',
  },
  1: {
    maxQty: '20',
    multiplier: '× 50',
    meaning: 'Packing group I and the listed classes — the exemption runs out after 20 kg or litres per transport unit.',
  },
  2: {
    maxQty: '333',
    multiplier: '× 3',
    meaning: 'Packing group II and the listed classes.',
  },
  3: {
    maxQty: '1 000',
    multiplier: '× 1',
    meaning: 'Packing group III and the listed classes.',
  },
  4: {
    maxQty: 'unlimited',
    multiplier: '—',
    meaning: 'No quantity limit under 1.1.3.6 for this category.',
  },
}

/** Сноска a к таблице 1.1.3.6.3: у этих номеров предел 50 кг, множитель 20. */
export const TRANSPORT_CATEGORY_1_FOOTNOTE_UN = new Set([
  '0081', '0082', '0084', '0241', '0331', '0332', '0482', '1005', '1017',
])

/* ───────────── идентификационный номер опасности (номер Кемлера) ───────────── */

export interface HinReading {
  /** Код, как он лежит в базе. */
  code: string
  /** Значение из перечня 5.3.2.3.2, если оно там есть. */
  meaning: string | null
  /** Реагирует ли опасно с водой — префикс X. */
  reactsWithWater: boolean
  /** У Класса 1 номером опасности служит код классификации (5.3.2.3.1). */
  isClassOneCode: boolean
  /** Разбор по цифрам, ADR 5.3.2.3.1. Пусто у кодов Класса 1. */
  digits: { figure: string; meaning: string; doubled: boolean }[]
}

/**
 * Разбор номера опасности.
 * ⚠ Никогда не сочиняем значение: если готовой строки в 5.3.2.3.2 нет
 * (в наших данных это ровно `688` у UN 3423), `meaning` остаётся null,
 * и страница показывает разбор по цифрам, честно называя его разбором.
 */
export function readHazardIdNumber(raw: string | null): HinReading | null {
  if (!raw) return null
  const code = raw.trim()
  if (!code) return null

  // Класс 1: в колонке 20 стоит код классификации вида «1.5D».
  if (/^1\.[1-6][A-Z]$/.test(code)) {
    return { code, meaning: null, reactsWithWater: false, isClassOneCode: true, digits: [] }
  }

  const reactsWithWater = code.startsWith('X')
  const figures = (reactsWithWater ? code.slice(1) : code).split('')
  const digits = figures.map((figure, i) => ({
    figure,
    meaning: HIN_DIGIT[figure] ?? '',
    doubled: i > 0 && figure === figures[i - 1],
  }))

  return {
    code,
    meaning: HIN_MEANING[code] ?? null,
    reactsWithWater,
    isClassOneCode: false,
    digits,
  }
}

/* ─────────────────────────────── адреса ─────────────────────────────── */

/** Адрес страницы номера. Всегда с завершающим слэшем — trailingSlash: 'always'. */
export function unHref(unNumber: string): string {
  return `/un/${unNumber}/`
}

/** Подпись номера в тексте: «UN 1203». В заголовках и ссылках только через неё. */
export function unLabel(unNumber: string): string {
  return `UN ${unNumber}`
}

/* ───────────────────────── статус вещества в ADR ───────────────────────── */

/**
 * ⚠ `adr_status` — это факт ПРО ADR и только про ADR. Плашка «not accepted for
 * carriage» не говорит ничего о США: UN 3374 в ЕС возить можно, а в 49 CFR он
 * Forbidden, и зеркально UN 2186. Подпись обязана называть юрисдикцию.
 */
export const ADR_STATUS_TEXT: Record<string, { badge: string; note: string }> = {
  prohibited: {
    badge: 'Not accepted for carriage under ADR',
    note: 'ADR 2.2.2.2.2 — this substance is not accepted for carriage under ADR. This says nothing about the United States: check the 49 CFR panel separately.',
  },
  not_subject: {
    badge: 'Not subject to ADR',
    note: 'The entry falls outside the scope of ADR. This says nothing about the United States: check the 49 CFR panel separately.',
  },
  regulated: {
    badge: 'Regulated under ADR',
    note: '',
  },
}
