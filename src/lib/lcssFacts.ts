/**
 * Факты из PubChem LCSS: какое число можно печатать СВОИМ голосом — в прозе,
 * в meta description, в ответе FAQ, в JSON-LD.
 *
 * ⚠⚠⚠ Правило (аудит фактов, session 86, найдено Сергеем на кадмии).
 * До s86 проза брала ПЕРВЫЙ источник (`bestNumber`), FAQ — первую строку
 * таблицы. У кадмия первым стоял HSDB с битой строкой «32.0691 °C», а NIOSH и
 * CAMEO давали 321 °C. Страница комплаенс-сайта утверждала, что кадмий плавится
 * при 32 °C — в абзаце, в meta и в FAQ разом. Таких страниц было 160 из 1 380.
 *
 * Теперь число попадает в свою фразу ТОЛЬКО когда его подтверждают
 * **не менее двух разных источников** в пределах допуска; печатается медиана
 * согласной группы. Один источник, разнобой без большинства, три полиморфа
 * серы — всё это остаётся в таблице с условиями и подписью источника, а из
 * прозы уходит. Таблица показывает ВСЁ, проза — только подтверждённое.
 *
 * ⚠ «Разные источники» — по ПРОИСХОЖДЕНИЮ (см. sourceOrigin): две строки HSDB
 * об одном числе — один источник, повторивший сам себя; строка CAMEO с пометкой
 * «(NIOSH, 2024)» — тот же NIOSH, а не второй голос.
 *
 * ⚠ Число здесь берётся уже ОЧИЩЕННЫМ (`sanitizeValue` в lcssProperties.ts):
 * точка вспышки, лежащая в разделе точки плавления, «Bulk density», значение
 * «20», взятое из «20 °C», сюда не доходят вовсе.
 *
 * Сторожа: `check:facts` (данные и фикстуры из живой базы) и
 * `check:dist subs-facts` (напечатанное на страницах против этого модуля).
 */
import { sanitizeValue, shortSource, type FactHints, type LcssRecord, type LcssValue } from './lcssProperties.ts'

/** Версия правила. Печатается сторожами, чтобы смена допусков была видна в отчёте. */
export const LCSS_FACT_RULE = 'consensus-2-sources-1'

export type FactKey = 'bp' | 'mp' | 'fp' | 'density' | 'autoignition'

/** Подтверждённое число: медиана согласной группы и кто в ней. */
export type ConsensusFact = {
  key: FactKey
  /** Медиана согласной группы, в единице `unit`. */
  value: number
  /** C | g/cm3 */
  unit: string
  /** Разные ПРОИСХОЖДЕНИЯ в согласной группе (см. sourceOrigin), ≥ 2: «NIOSH», «NTP via CAMEO». */
  sources: string[]
  /** Все числовые кандидаты, не вошедшие в группу. Для отчёта сторожа. */
  outliers: number[]
  /** Сколько всего числовых кандидатов было. */
  candidates: number
}

/**
 * Допуск согласия. Температуры — 2 °C или 1,5 %: разница между 320,9 и 321,1
 * (°F, пересчитанные разными людьми) — согласие, между 191 и 201 — нет.
 * Плотность — 2 %: 0,7845 против 0,7899 — та же вода при другом стандарте.
 */
export function factTolerance(key: FactKey, value: number): number {
  if (key === 'density') return Math.max(Math.abs(value) * 0.02, 0.005)
  return Math.max(2, Math.abs(value) * 0.015)
}

/**
 * Годится ли значение в кандидаты на подтверждённое число.
 * ⚠ Вакуумная точка кипения, «decomposes», «sublimes», «below/above this
 * value» — в таблице это полноценные строки с условиями, но числом «при
 * котором кипит» они не являются. Диапазон и «≈» годятся: середина диапазона
 * 43–48 °C — честный кандидат, а согласие с другими источниками его проверит.
 */
function isCandidate(val: LcssValue): boolean {
  if (!val.v) return false
  if (val.vac === 1) return false
  if (val.q && val.q !== 'exact' && val.q !== 'approx' && val.q !== 'range') return false
  return Number.isFinite(Number(val.v))
}

/**
 * ⚠⚠ Происхождение числа, а не имя базы, из которой оно пришло.
 *
 * CAMEO Chemicals не измеряет ничего сам: каждая из 3 980 его строк в файле
 * подписана источником — «(NTP, 1992)» 2 021, «(USCG, 1999)» 1 067,
 * «(EPA, 1998)» 612, «(NIOSH, 2024)» 256, «(ICSC)» 6. Строка CAMEO с пометкой
 * NIOSH и строка NIOSH — ОДНО показание, переписанное дважды; считать их двумя
 * согласными источниками значит подтверждать число им же самим. Про CAMEO уже
 * была путаница с записями по общему CAS (s32–s33) — здесь та же осторожность.
 *
 * Поэтому источник считается по ПРОИСХОЖДЕНИЮ: CAMEO/NIOSH схлопывается с
 * NIOSH, CAMEO/ICSC — с ICSC, а NTP, USCG и EPA остаются самостоятельными
 * показаниями (и в подписи так и печатаются: «NTP via CAMEO»).
 */
function sourceOrigin(val: LcssValue): { key: string; label: string } {
  const short = shortSource(val.src)
  if (short !== 'CAMEO') return { key: short, label: short }
  const m = /\((NTP|USCG|NIOSH|EPA|ICSC|DOT)[,\s]+\d{4}\)/.exec(val.raw)
  if (!m) return { key: 'CAMEO', label: 'CAMEO' }
  const agency = m[1]
  return agency === 'NIOSH' || agency === 'ICSC'
    ? { key: agency, label: agency }
    : { key: agency, label: `${agency} via CAMEO` }
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Подтверждённое число свойства или null.
 *
 * Алгоритм: очистить строки → оставить кандидатов → для каждого кандидата
 * собрать группу значений в пределах допуска от него → взять группу с
 * наибольшим числом РАЗНЫХ источников → если их ≥ 2, вернуть медиану.
 *
 * ⚠ При равенстве групп побеждает та, где больше государственных источников
 * (`r2` не стоит), затем та, что ближе к медиане всех кандидатов. Никакой
 * «первый источник» больше ничего не решает.
 */
export function consensusFact(record: LcssRecord | undefined, key: FactKey): ConsensusFact | null {
  const raw = record?.[key]
  if (!raw?.length) return null

  const cands = raw
    .map((v) => sanitizeValue(key, v))
    .filter((v): v is LcssValue => v !== null && isCandidate(v))
    .map((v) => {
      const origin = sourceOrigin(v)
      return { n: Number(v.v), src: origin.key, label: origin.label, primary: v.r2 !== 1, unit: v.u ?? '' }
    })
  if (cands.length < 2) return null

  const all = median(cands.map((c) => c.n))
  let best: { members: typeof cands; sources: Set<string>; primaries: number; center: number } | null = null
  for (const c of cands) {
    const tol = factTolerance(key, c.n)
    const members = cands.filter((o) => Math.abs(o.n - c.n) <= tol)
    const sources = new Set(members.map((m) => m.src))
    if (sources.size < 2) continue
    const primaries = members.filter((m) => m.primary).length
    const center = median(members.map((m) => m.n))
    const better =
      !best ||
      sources.size > best.sources.size ||
      (sources.size === best.sources.size && primaries > best.primaries) ||
      (sources.size === best.sources.size && primaries === best.primaries &&
        Math.abs(center - all) < Math.abs(best.center - all))
    if (better) best = { members, sources, primaries, center }
  }
  if (!best) return null

  const memberSet = new Set(best.members)
  const labels = [...new Map(best.members.map((m) => [m.src, m.label])).values()]
  return {
    key,
    value: best.center,
    unit: best.members[0].unit,
    sources: labels,
    outliers: cands.filter((c) => !memberSet.has(c)).map((c) => c.n),
    candidates: cands.length,
  }
}

/** Число к виду для фразы: «321 °C», «0.79 g/cm³». Точность не выдумываем. */
export function formatFact(fact: ConsensusFact): string {
  const n = fact.value
  // Плотность — два знака (0.79, 8.65): один знак превращал 0.998 в «1 g/cm³».
  const rounded =
    fact.unit === 'g/cm3' ? Math.round(n * 100) / 100 : Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10
  const unit = fact.unit === 'C' ? '°C' : fact.unit === 'g/cm3' ? 'g/cm³' : fact.unit
  return unit ? `${rounded} ${unit}` : String(rounded)
}

/** °F для ответа FAQ — половина аудитории в США. Округление до целого: точность не создаём. */
export function formatFactF(fact: ConsensusFact): string | null {
  if (fact.unit !== 'C') return null
  return `${Math.round(fact.value * 9 / 5 + 32)} °F`
}

/** «HSDB and NIOSH», «HSDB, NIOSH and CAMEO». */
export function factSources(fact: ConsensusFact): string {
  const s = fact.sources
  if (s.length <= 1) return s[0] ?? ''
  if (s.length === 2) return `${s[0]} and ${s[1]}`
  return `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`
}

export const FACT_KEYS: FactKey[] = ['bp', 'mp', 'fp', 'density', 'autoignition']

export type Facts = Record<FactKey, ConsensusFact | null>

/** Все подтверждённые числа вещества за один проход — страница считает их один раз. */
export function buildFacts(record: LcssRecord | undefined): Facts {
  const out = {} as Facts
  for (const key of FACT_KEYS) out[key] = consensusFact(record, key)
  return out
}

/** Подсказки порядку таблицы: согласная с фактом строка встаёт первой (lcssProperties.ts). */
export function factHints(facts: Facts): FactHints {
  const hints: FactHints = {}
  for (const key of FACT_KEYS) {
    const f = facts[key]
    hints[key] = f ? { value: f.value, tolerance: factTolerance(key, f.value) } : null
  }
  return hints
}
