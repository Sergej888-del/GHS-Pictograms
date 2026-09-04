/**
 * check:facts — аудит фактов страниц веществ на уровне ДАННЫХ (session 86).
 *
 *   npm run check:facts
 *
 * Что сторожит:
 *   1. Правило консенсуса (src/lib/lcssFacts.ts): каждое число, которое проза,
 *      meta и FAQ печатают своим голосом, подтверждено ≥ 2 РАЗНЫМИ источниками
 *      в допуске; все члены согласной группы — в допуске от медианы.
 *   2. Очистку (sanitizeValue в src/lib/lcssProperties.ts): после неё ни одна
 *      строка не подписана чужим свойством, ни одно число не за границами
 *      правдоподобия, «Bulk density» и «No autoflammability» — не числа,
 *      «decomp/sublimes» — не `exact`.
 *   3. Фикстуры из живых данных — те самые вещества, на которых дефекты
 *      нашлись чтением (кадмий 32 °C, водород с перепутанными bp/mp, сера с
 *      тремя полиморфами, плотность «20» из «20 °C», «FP:» в точке плавления,
 *      1559 °C у 109-83-1). Фикстура — не «ожидаемое из головы», а снятое
 *      с данных и проверенное по внешним справочникам показание.
 *
 * ⚠ Сторож проверен снятием того, что он сторожит: подмени в lcssFacts.ts
 * порог «≥ 2 источника» на «≥ 1» — падают фикстуры кадмия и водорода.
 *
 * Напечатанное на страницах против этого же правила проверяет
 * `check:dist subs-facts` — там читается dist/, здесь только данные.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildFacts, consensusFact, factTolerance, FACT_KEYS, LCSS_FACT_RULE, type FactKey,
} from '../src/lib/lcssFacts.ts'
import { sanitizeValue, type LcssRecord } from '../src/lib/lcssProperties.ts'

const data = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'src', 'data', 'lcss-values.json'), 'utf8'),
) as Record<string, LcssRecord>

let failed = 0
let total = 0
function check(name: string, cond: boolean, detail = '') {
  total++
  if (!cond) { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
  else console.log(`  ✓ ${name}`)
}
const near = (a: number | null | undefined, b: number, eps: number) => a != null && Math.abs(a - b) <= eps

console.log(`check:facts — правило ${LCSS_FACT_RULE}, веществ в lcss-values.json: ${Object.keys(data).length}\n`)

// ─────────────── 1. Инварианты правила на ВСЕХ данных ───────────────
console.log('1. Консенсус на всех данных')
const perKey: Record<string, { withData: number; confirmed: number; single: number; disagree: number }> = {}
const badGroups: string[] = []
const fewSources: string[] = []
for (const [cas, rec] of Object.entries(data)) {
  const facts = buildFacts(rec)
  for (const key of FACT_KEYS) {
    if (!rec[key]) continue
    const s = (perKey[key] ??= { withData: 0, confirmed: 0, single: 0, disagree: 0 })
    s.withData++
    const f = facts[key]
    if (!f) {
      const numeric = rec[key].map((v) => sanitizeValue(key, v)).filter((v) => v?.v).length
      if (numeric < 2) s.single++
      else s.disagree++
      continue
    }
    s.confirmed++
    if (new Set(f.sources).size < 2) fewSources.push(`${cas}/${key}`)
    // Все члены группы в допуске от медианы — иначе «группа» склеена цепочкой.
    const tol = factTolerance(key, f.value)
    const members = rec[key]
      .map((v) => sanitizeValue(key, v))
      .filter((v) => v?.v && v.vac !== 1 && (!v.q || ['exact', 'approx', 'range'].includes(v.q)))
      .map((v) => Number(v!.v))
      .filter((n) => !f.outliers.includes(n))
    if (members.some((n) => Math.abs(n - f.value) > tol)) badGroups.push(`${cas}/${key}`)
  }
}
check('у каждого подтверждённого числа ≥ 2 разных источника', fewSources.length === 0, fewSources.slice(0, 8).join(', '))
check('все члены согласной группы — в допуске от медианы', badGroups.length === 0, badGroups.slice(0, 8).join(', '))
for (const key of FACT_KEYS) {
  const s = perKey[key]
  console.log(
    `     ${key.padEnd(13)} с данными ${String(s.withData).padStart(5)} · подтверждено ${String(s.confirmed).padStart(4)} · ` +
      `один источник ${String(s.single).padStart(4)} · разнобой ${String(s.disagree).padStart(4)}`,
  )
}

// ─────────────── 2. Очистка ───────────────
console.log('\n2. Очистка строк (sanitizeValue)')
const LABEL: Record<string, RegExp> = {
  fp: /^\s*(FP|flash)/i, bp: /^\s*(BP|boiling)/i, mp: /^\s*(MP|melting)/i,
  vapor_pressure: /^\s*(VP|vapou?r\s*pressure)/i, density: /^\s*(density|specific\s*gravity)/i,
}
const PLAUSIBLE: Record<string, [number, number]> = {
  bp: [-273.15, 6000], mp: [-273.15, 4000], fp: [-150, 700], autoignition: [50, 1500],
  density: [0.00005, 25], vapor_density: [0.05, 30], lel: [0, 100], uel: [0, 100],
}
let foreign = 0, implausible = 0, bulk = 0, noAuto = 0, decompExact = 0, dropped = 0, stripped = 0, requalified = 0
for (const rec of Object.values(data)) {
  for (const [key, vals] of Object.entries(rec)) {
    for (const v of vals) {
      const s = sanitizeValue(key, v)
      if (!s) { dropped++; continue }
      if (v.v && !s.v) stripped++
      if (s.q !== v.q) requalified++
      for (const [prop, re] of Object.entries(LABEL)) if (prop !== key && key in LABEL && re.test(s.raw)) foreign++
      if (s.v) {
        const n = Number(s.v)
        const r = PLAUSIBLE[key]
        if (!Number.isFinite(n) || (r && (n < r[0] || n > r[1]))) implausible++
        if (key === 'density' && /\b(bulk|apparent|critical|tap)\s+density/i.test(s.raw)) bulk++
        if (key === 'autoignition' && /no autoflammab/i.test(s.raw)) noAuto++
        if ((key === 'bp' || key === 'mp') && (!s.q || s.q === 'exact') && /decompos|\bdecomp\b|sublim|explode/i.test(s.raw)) decompExact++
      }
    }
  }
}
check('после очистки нет строк, подписанных чужим свойством', foreign === 0, String(foreign))
check('после очистки нет чисел за границами правдоподобия', implausible === 0, String(implausible))
check('«Bulk/Apparent/Critical density» — не число плотности', bulk === 0, String(bulk))
check('«No autoflammability up to…» — не температура самовоспламенения', noAuto === 0, String(noAuto))
check('«decomposes/sublimes/explodes» не стоят со статусом exact', decompExact === 0, String(decompExact))
console.log(`     выброшено строк ${dropped} · снято чисел ${stripped} · исправлен статус ${requalified}`)
// ⚠ Очистка не должна тихо расти: число строк, которые она трогает, названо.
check('очистка трогает десятки строк, а не сотни (выброшено ≤ 40, снято ≤ 150)', dropped <= 40 && stripped <= 150, `${dropped}/${stripped}`)
let nfpa = 0
for (const rec of Object.values(data)) for (const [key, vals] of Object.entries(rec)) for (const v of vals) if (/\(NFPA[,\s]/.test(v.raw) && sanitizeValue(key, v)) nfpa++
check('⛔ строки с пометкой «(NFPA, …)» выброшены целиком (решение D5)', nfpa === 0, String(nfpa))

// ─────────────── 3. Фикстуры из живых данных ───────────────
console.log('\n3. Фикстуры (сняты с данных, сверены с внешними справочниками)')
const fact = (cas: string, key: FactKey) => consensusFact(data[cas], key)

// Кадмий: HSDB 32.0691 °C — битая строка; NIOSH 610 °F и CAMEO 609.6 °F = 321 °C.
check('кадмий 7440-43-9: mp = 321 °C, не 32', near(fact('7440-43-9', 'mp')?.value, 321, 1))
check('кадмий: 32.07 назван выпадающим', (fact('7440-43-9', 'mp')?.outliers ?? []).some((n) => near(n, 32.07, 0.1)))
check('кадмий: bp = 765 °C', near(fact('7440-43-9', 'bp')?.value, 765, 3))
// Водород: HSDB поменял bp и mp местами (−259 как bp, −252.76 как mp), CAMEO
// даёт обратное. Двух согласных источников нет → в прозе числа быть не должно.
check('водород 1333-74-0: bp без консенсуса (источники перепутаны)', fact('1333-74-0', 'bp') === null)
check('водород: mp без консенсуса', fact('1333-74-0', 'mp') === null)
// Сера: 95,3 / 106,8 / 120 °C — три полиморфа, а не разнобой. Единого числа нет.
check('сера 7704-34-9: mp без консенсуса (три полиморфа)', fact('7704-34-9', 'mp') === null)
check('сера: bp = 445 °C', near(fact('7704-34-9', 'bp')?.value, 445, 2))
// 109-83-1: HSDB «1559.24 °C» — битая строка; CAMEO 316 °F и ICSC 156 °C.
check('109-83-1: bp ≈ 157 °C, 1559 выпадает', near(fact('109-83-1', 'bp')?.value, 157, 2) && (fact('109-83-1', 'bp')?.outliers ?? []).includes(1559.24))
// 3244-90-4: «Density at 20 °C/20 °C = 1.119-1.123» → разбор дал 20.
const d3244 = (data['3244-90-4']?.density ?? []).map((v) => sanitizeValue('density', v))
check('3244-90-4: плотность «20» (это температура) снята', d3244.every((v) => !v?.v || Number(v.v) !== 20))
check('3244-90-4: строка плотности осталась текстом, не исчезла', d3244.some((v) => v && /1\.119-1\.123/.test(v.raw)))
// 112-57-2 и ещё 6: «FP: -30 °C» лежит в mp.
const mp112 = (data['112-57-2']?.mp ?? []).map((v) => sanitizeValue('mp', v))
check('112-57-2: строка «FP: -30 °C» выброшена из точки плавления', mp112.every((v) => v === null || !/^FP:/.test(v.raw)))
check('112-57-2: mp = −40 °C по CAMEO и DOE PAC', near(fact('112-57-2', 'mp')?.value, -40, 2))
// 106-46-7: «No autoflammability up to 500 °C» — не 500 °C.
const ai106 = (data['106-46-7']?.autoignition ?? []).map((v) => sanitizeValue('autoignition', v))
check('106-46-7: «No autoflammability up to 500 °C» — без числа', ai106.every((v) => !v?.v || Number(v.v) !== 500))
// 110-17-8: «Sublimes at 200 °C» стояло как exact bp.
const bp110 = (data['110-17-8']?.bp ?? []).map((v) => sanitizeValue('bp', v))
check('110-17-8: «Sublimes at 200 °C» получил статус sublimes', bp110.some((v) => v?.v === '200' && v.q === 'sublimes'))
check('110-17-8: bp без консенсуса (возгонка ≠ кипение)', fact('110-17-8', 'bp') === null)
// Ацетон — контроль, что правило не ломает нормальные данные.
check('ацетон 67-64-1: bp = 56.1 °C по трём источникам', near(fact('67-64-1', 'bp')?.value, 56.1, 0.2) && (fact('67-64-1', 'bp')?.sources.length ?? 0) === 3)
// ⚠ CAMEO ничего не измеряет сам: строка «(NIOSH, 2024)» у CAMEO — тот же NIOSH.
check('кадмий: источники консенсуса — NIOSH и NTP via CAMEO, не «NIOSH и CAMEO»', JSON.stringify(fact('7440-43-9', 'mp')?.sources) === JSON.stringify(['NIOSH', 'NTP via CAMEO']))
check('1303-86-2: NIOSH + CAMEO-по-NIOSH — один голос против HSDB → консенсуса нет', fact('1303-86-2', 'bp') === null)
check('1321-64-8: то же — NIOSH и CAMEO(NIOSH) не подтверждают друг друга', fact('1321-64-8', 'bp') === null)
check('ацетон: три происхождения — HSDB, NIOSH, и CAMEO не совпал с ними', new Set(fact('67-64-1', 'bp')?.sources).size === 3)
// 100-39-0: HSDB 191 против CAMEO 198 и DOE PAC 201 — большинство побеждает.
check('100-39-0: bp ≈ 200 °C (CAMEO + DOE PAC), HSDB 191 выпадает', near(fact('100-39-0', 'bp')?.value, 199.7, 1.5) && (fact('100-39-0', 'bp')?.outliers ?? []).includes(191))

console.log(`\n${failed ? `✗ ПРОВАЛЕНО: ${failed} из ${total}` : `✓ check:facts зелёный — ${total} проверок`}`)
process.exit(failed ? 1 : 0)
