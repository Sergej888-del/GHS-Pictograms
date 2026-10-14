/**
 * check:directory-geo — география каталога (шаг A1, s108). Читает ТОЛЬКО посев scripts/data/directory-v3.json и модуль
 * src/lib/directoryGeo.ts: ни сети, ни базы.
 *
 *   npm run check:directory-geo
 *
 * Что сторожит:
 *   1. Таблица GEO цельная: у каждой страны есть субрегион, у каждого субрегиона — континент, коды — две заглавные буквы.
 *   2. ЕС — ровно 27 государств, все они в GEO; ЕЭЗ = ЕС + IS, LI, NO.
 *   3. Каждый hq_country и каждый код в market.detail посева известен таблице (иначе фильтр молча потеряет запись).
 *   4. Развёртка рынков: «EU» не включает GB и CH, «EEA» включает NO, «worldwide» — флаг, «unspecified» — пусто.
 *   5. Живые записи без hq_country — список (не ошибка: страна берётся только со страницы вендора).
 *
 * ⚠ Сторож проверен снятием того, что он сторожит: убери из GEO любой код, который есть в рынках посева (например 'TW'),
 *   и пункт 3 падает с именем кода и detail.
 */
import { readFileSync } from 'node:fs'
import {
  CONTINENTS, EEA_EXTRA, EU_MEMBERS, GEO, GEO_ALIASES, SUBREGIONS, geoFilterOptions, geoProblems, geoSearchWords, marketSummary, marketTokens, parseMarket,
} from '../src/lib/directoryGeo.ts'

const problems: string[] = []
const fail = (m: string) => problems.push(m)

// 1 — таблица
const subSlugs = new Set(SUBREGIONS.map((s) => s.slug))
const contSlugs = new Set(CONTINENTS.map((c) => c.slug))
for (const s of SUBREGIONS) if (!contSlugs.has(s.continent)) fail(`субрегион ${s.slug}: нет континента ${s.continent}`)
for (const [code, g] of Object.entries(GEO)) {
  if (!/^[A-Z]{2}$/.test(code)) fail(`код «${code}» не ISO alpha-2`)
  if (!subSlugs.has(g.sub)) fail(`${code}: нет субрегиона ${g.sub}`)
}
for (const s of SUBREGIONS) if (!Object.values(GEO).some((g) => g.sub === s.slug)) fail(`субрегион ${s.slug} пуст`)

// 2 — ЕС / ЕЭЗ
if (EU_MEMBERS.length !== 27 || new Set(EU_MEMBERS).size !== 27) fail(`ЕС: ${EU_MEMBERS.length} государств вместо 27`)
for (const c of EU_MEMBERS) if (!GEO[c]) fail(`член ЕС ${c} не в GEO`)
for (const c of EEA_EXTRA) if (!GEO[c]) fail(`страна ЕЭЗ ${c} не в GEO`)

// 4 — развёртка
const eu = parseMarket('EU')
if (eu.codes.includes('GB') || eu.codes.includes('CH')) fail('«EU» не должна включать GB и CH')
if (eu.codes.length !== 27 || !eu.eu || eu.eea) fail('«EU» → 27 стран, флаг eu без eea')
const eea = parseMarket('EEA')
if (!eea.codes.includes('NO') || eea.codes.length !== 30 || !eea.eea) fail('«EEA» → 30 стран, флаг eea')
if (!parseMarket('worldwide,AU').worldwide || parseMarket('unspecified').codes.length !== 0) fail('worldwide / unspecified разобраны неверно')
if (!marketTokens(['US,CA']).includes('r:northern-america') || !marketTokens(['US,CA']).includes('k:americas')) fail('US,CA → r:northern-america, k:americas')
if (!marketTokens(['EU']).includes('eu') || !marketTokens(['EU']).includes('r:dach')) fail('EU → токены eu и r:dach')

// 4б — поиск и опции (s108, A1b): человек пишет «usa», «uk», «uae», а в таблице стоят «United States» и т. д.
for (const [code, words] of Object.entries(GEO_ALIASES)) {
  if (!GEO[code]) fail(`псевдоним для неизвестной страны ${code}`)
  if (!/^[a-z ]+$/.test(words)) fail(`псевдонимы ${code} должны быть латиницей в нижнем регистре: «${words}»`)
}
const blob = (code: string) => geoSearchWords(code).join(' | ').toLowerCase()
for (const [code, word] of [['US', 'usa'], ['GB', 'uk'], ['AE', 'uae'], ['DE', 'dach'], ['DE', 'europe'], ['FR', 'france']] as const)
  if (!blob(code).includes(word)) fail(`поиск «${word}» не находит ${code}: «${blob(code)}»`)
if (geoSearchWords(null).length !== 0 || geoSearchWords('ZZ').length !== 0) fail('geoSearchWords(null | неизвестный код) должен быть пустым')
const o = geoFilterOptions([['c:DE', 'r:dach', 'k:europe'], ['c:US', 'r:northern-america', 'k:americas'], ['ww']], true)
const deOpt = o.countries.find((x) => x.value === 'c:DE')
if (!deOpt || deOpt.n !== 2 || deOpt.nn !== 1) fail('опция Germany: со «worldwide» 2, прямых 1')
if (!o.extra.some((x) => x.value === 'ww') || o.extra.find((x) => x.value === 'ww')?.n !== 1) fail('опция Worldwide: только вендоры с ww')
if (marketSummary(['EU,GB,US,CA,AU,NZ']) !== 'EU, United Kingdom, United States, Canada +2 more') fail('marketSummary: «EU, United Kingdom, United States, Canada +2 more»')
if (marketSummary(['worldwide', 'unspecified']) !== 'Worldwide' || marketSummary([null]) !== '') fail('marketSummary: worldwide / пусто')

// 3 и 5 — посев
const seed = JSON.parse(readFileSync(new URL('./data/directory-v3.json', import.meta.url), 'utf8')) as {
  entries: { id: number; title: string; state: string; hq_country: string | null }[]
  facts: { kind: string; detail: string | null }[]
}
const marketDetails = seed.facts.filter((f) => f.kind === 'market' || f.kind === 'hosting').map((f) => f.detail)
for (const p of geoProblems(seed.entries.map((e) => e.hq_country), marketDetails)) fail(p)
const noCountry = seed.entries.filter((e) => e.state === 'live' && !e.hq_country)

console.log(`GEO: ${Object.keys(GEO).length} стран, ${SUBREGIONS.length} субрегионов, ${CONTINENTS.length} континентов`)
console.log(`посев: ${seed.entries.length} записей, market/hosting ${marketDetails.length}; живых без hq_country: ${noCountry.length}`)
for (const e of noCountry) console.log(`  без страны: #${e.id} ${e.title}`)
if (problems.length) {
  console.error(`\nПРОБЛЕМ: ${problems.length}`)
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('\nOK — география цельная, все коды посева известны')
