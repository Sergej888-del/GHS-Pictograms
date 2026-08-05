/**
 * Сборка src/data/lcss-text.json из выгрузки PubChem LCSS.
 *
 * Запуск (путь к выгрузке — обязательный аргумент):
 *   node scripts/build-lcss-text.mjs "C:\\Projects\\GHS Ecosystem\\_pubchem\\lcss-text.tsv"
 *
 * ⚠⚠ ЗАЧЕМ ЭТОТ ФАЙЛ ПОЯВИЛСЯ. До session 38 lcss-text.json собирался вручную
 * разовой командой, нигде не записанной. Итог: из 25 разделов выгрузки в JSON
 * доехали 14, и никто этого не заметил полгода — недостающие разделы не ломали
 * сборку и не были видны на странице. Это ровно тот отказ, про который сказано
 * в хендоффе session 37: «что не проверяется, ломается молча и надолго».
 * Теперь правило отбора лежит в репозитории и читается глазами.
 *
 * ⚠⚠⚠ СТАРЫЕ КЛЮЧИ НЕ ПЕРЕСОБИРАЮТСЯ. Скрипт читает существующий JSON и
 * ДОПИСЫВАЕТ в него новые ключи. Причина: правило выбора строки у старой
 * сборки восстановлено не полностью (10 983 значения из 11 762 — первая строка
 * раздела, 746 — какая-то другая). Пересборка сдвинула бы вводную прозу и
 * meta description у сотен страниц ради нуля пользы. Ключ, который уже есть,
 * не трогаем.
 *
 * ⛔ ЗАПРЕТНОЕ СОДЕРЖИМОЕ вырезается СТРОКОЙ, а не разделом. В разрешённых
 * разделах оно встречается вкраплениями:
 *   · 28 строк «Hazards Summary» несут TLV с числом — это ACGIH, запрещено;
 *   · 84 строки там же несут LD50/LC50 — летальные дозы, запрещено;
 *   · 293 строки «Evidence for Carcinogenicity» — обозначения ACGIH A1–A5.
 * Отбор ПО БЕЛОМУ СПИСКУ разделов и ПО ЧЁРНОМУ списку строк внутри них.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'data', 'lcss-text.json')

const src = process.argv[2]
if (!src) {
  console.error('Нужен путь к lcss-text.tsv первым аргументом.')
  process.exit(1)
}

/**
 * ⛔ Чёрный список СТРОК. Проверяется в каждом разделе без исключений.
 * ⚠ `\bTLV\b` ловит и «TLV Basis», и «TLV\u0096TWA of 1 ppm» — строка целиком
 * уходит, а не чистится: вырезать число из середины чужого предложения значит
 * оставить предложение, утверждающее не то, что писал автор.
 */
const BANNED_ROW = /\bTLV\b|\bLD50\b|\bLC50\b|\bLDLo\b|\bLCLo\b|\bTDLo\b|\bNFPA\b|\bAEGL/i
/** ⛔ Обозначения канцерогенности ACGIH: «A3; Confirmed animal carcinogen…». */
const ACGIH_DESIGNATION = /^A[1-5]\b/
/** Навигационная заглушка PubChem, а не данные. */
const NAV_STUB = /^See:?\s|please visit the/i
/**
 * ⛔ T3DB (Toxin and Toxin Target Database) — академическая база лаборатории
 * Wishart, коммерческое использование по отдельной лицензии. 665 строк в
 * разделе канцерогенности, и все они дублируют IARC. Не берём.
 */
const BANNED_SOURCE = /Toxin and Toxin Target/i

const text = readFileSync(src, 'utf8')
const lines = text.split(/\r?\n/)
const header = lines.shift()
if (!header || !header.startsWith('cas\tcid\ttoc_heading')) {
  console.error(`Не та выгрузка: первая строка «${String(header).slice(0, 60)}»`)
  process.exit(1)
}

/** cas → toc → [{ s, t }] в порядке файла. */
const byCas = new Map()
let skippedBanned = 0
let skippedSource = 0
for (const line of lines) {
  if (!line) continue
  const parts = line.split('\t')
  if (parts.length < 5) continue
  const [cas, , toc, source] = parts
  // ⚠ Текст может содержать табуляцию — склеиваем хвост обратно, а не берём [4].
  const body = parts.slice(4).join('\t').trim()
  if (!body) continue
  if (BANNED_SOURCE.test(source)) { skippedSource++; continue }
  if (BANNED_ROW.test(body)) { skippedBanned++; continue }
  if (NAV_STUB.test(body)) continue
  if (!byCas.has(cas)) byCas.set(cas, new Map())
  const m = byCas.get(cas)
  if (!m.has(toc)) m.set(toc, [])
  m.get(toc).push({ s: source, t: body })
}

/** Первая строка раздела — то же правило, что у старых 14 ключей. */
const first = (rows) => (rows && rows.length ? { s: rows[0].s, t: rows[0].t } : undefined)

/**
 * Канцерогенность: три разных источника в одном разделе, и склеивать их в один
 * абзац нельзя — они отвечают на разные вопросы.
 *
 * ⚠ IARC даёт готовую группу («Group 2B: Possibly carcinogenic to humans») —
 * это самый ценный факт раздела и единственный, который читается без контекста.
 * ⚠ NTP даёт номер отчёта и ОТДЕЛЬНО голые вердикты «Clear Evidence» / «No
 * Evidence» — по одному на вид и пол животного, но без указания вида и пола.
 * Печатать «No Evidence» без «у кого» — значит соврать: у того же этилбензола
 * рядом стоят и «Clear Evidence», и три «Some Evidence». Поэтому голые вердикты
 * НЕ БЕРЁМ, берём только итоговую фразу отчёта («Under the conditions of these
 * 2-year inhalation studies, there was clear evidence…»), в которой вид и пол
 * названы. Она есть у 160 CAS из 205; у остальных остаётся только ссылка на отчёт.
 */
function carcinogenicity(m) {
  const rows = m.get('Carcinogen Classification') ?? []
  const evid = (m.get('Evidence for Carcinogenicity') ?? []).filter((r) => !ACGIH_DESIGNATION.test(r.t))

  const iarcRows = rows.filter((r) => /International Agency/i.test(r.s))
  const groupRow = iarcRows.find((r) => /^Group /.test(r.t))
  const volumes = iarcRows.filter((r) => /^Volume \d+:/.test(r.t)).map((r) => r.t)

  const ntpRows = rows.filter((r) => /NTP/i.test(r.s))
  const report = ntpRows.find((r) => /^TR-\d+/.test(r.t))?.t
  const verdict = ntpRows.find((r) => /^Under the conditions/i.test(r.t))?.t

  const out = {}
  if (groupRow) {
    const [g, ...rest] = groupRow.t.split(':')
    out.iarc = { group: g.trim(), label: rest.join(':').trim(), volumes: volumes.slice(0, 2) }
  }
  if (report || verdict) out.ntp = { report, verdict }
  // ⚠ Оценки US EPA IRIS и разборы HSDB — оставляем две самые длинные: короткие
  // строки этого раздела почти всегда обрывки классификации без обоснования.
  const notes = evid
    .filter((r) => r.t.length >= 40 && r.t.length <= 600)
    .slice(0, 2)
    .map((r) => ({ s: r.s, t: r.t }))
  if (notes.length) out.notes = notes
  return Object.keys(out).length ? out : undefined
}

/**
 * Пределы воздействия. ⚠ Ровно три показателя, все — государственные США:
 * PEL (OSHA, обязателен), REL (NIOSH, рекомендация), IDLH (NIOSH, порог
 * немедленной опасности). ACGIH TLV в этот блок не попадает по построению:
 * своего раздела у него в выгрузке нет, а вкрапления вырезаны BANNED_ROW.
 * ⚠ Длинные строки — это «Excerpts from Documentation for IDLHs», то есть
 * обоснование, а не значение. 207 таких. В блок значений они не идут.
 */
function exposureLimits(m) {
  const pick = (toc) => {
    const rows = (m.get(toc) ?? []).filter((r) => r.t.length <= 200)
    if (!rows.length) return undefined
    const seen = new Set()
    const out = []
    for (const r of rows) {
      const key = r.t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ s: r.s, t: r.t })
      if (out.length === 3) break
    }
    return out
  }
  const pel = pick('Permissible Exposure Limit (PEL)')
  const rel = pick('Recommended Exposure Limit (REL)')
  const idlh = pick('Immediately Dangerous to Life or Health (IDLH)')
  if (!pel && !rel && !idlh) return undefined
  return { ...(pel ? { pel } : {}), ...(rel ? { rel } : {}), ...(idlh ? { idlh } : {}) }
}

/**
 * ⚠ Класс пероксидообразования (A/B/C/D) — единственная извлекаемая строка
 * раздела. Остальные строки — имя вещества, фамилия автора замера и сам замер
 * («2 samples had 6-8 ppm, age >1 yr»), то есть контекст чужой таблицы.
 */
function peroxideClass(m) {
  const rows = m.get('Peroxide Forming Chemical') ?? []
  const row = rows.find((r) => /^[A-D]\*?:/.test(r.t))
  return row ? { s: row.s, t: row.t } : undefined
}

const existing = JSON.parse(readFileSync(OUT, 'utf8'))
const stat = { hazsum: 0, safestore: 0, firepot: 0, peroxide: 0, rgroups: 0, alerts: 0, carc: 0, oel: 0, newCas: 0 }

for (const [cas, m] of byCas) {
  const add = {}
  const put = (key, value) => {
    if (value === undefined) return
    add[key] = value
    stat[key]++
  }

  put('hazsum', first(m.get('Hazards Summary')))
  put('safestore', first(m.get('Safe Storage')))
  put('firepot', first(m.get('Fire Potential')))
  put('peroxide', peroxideClass(m))
  // ⛔⛔ CAMEO ИЗ ЭТОЙ ВЫГРУЗКИ НЕ БЕРЁМ. Не «пока», а по результату сверки.
  //
  // Разделы `Reactive Group` (1 011 веществ) и `Reactivity Alerts` (439)
  // извлекаются исправно, но НЕСУТ УЖЕ ПОЧИНЕННЫЙ ДЕФЕКТ. Это дефект B из
  // claude/cameo-cas-collisions.md §4: реактивные группы в CAMEO собраны
  // объединением по ВСЕМ записям с тем же CAS, поэтому чистому веществу
  // достаются свойства его смесей и растворов. Сверка session 38 показала это
  // буква в букву:
  //
  //   метанол        LCSS: Alcohols · Amines, Phosphines, and Pyridines
  //                  база: Alcohols and Polyols
  //                  ← лишняя группа от записи METHANOL, TALLOW ALKYL IMINOBISETHANOL
  //   едкий натр     LCSS: Bases, Strong · Water and Aqueous Solutions
  //                  база: Bases, Strong
  //   гидразин       LCSS: +Bases, Weak +Water   база: чисто
  //   соляная кислота  alerts: Water-Reactive ← от водного раствора, не от газа
  //
  // ⚠⚠ В базе эти группы УЖЕ ВЫЧИЩЕНЫ через substance_cameo_choice (session 33).
  // Импорт из выгрузки вернул бы починенное обратно, причём молча.
  // Страница берёт реактивную группу ИЗ БАЗЫ — то есть из того же источника, на
  // котором считает матрица совместимости. Разойтись они не могут по построению.
  //
  // ⚠ `Reactivity Alerts` не берутся вообще: курируемого аналога в базе нет,
  // а объединению по CAS доверять нельзя по той же причине.
  // ⚠ Ключи `rgroups`/`alerts` в типе TextRecord оставлены намеренно — тип
  // описывает выгрузку, а не то, что мы из неё берём.
  put('carc', carcinogenicity(m))
  put('oel', exposureLimits(m))

  if (!Object.keys(add).length) continue
  if (!existing[cas]) {
    existing[cas] = {}
    stat.newCas++
  }
  Object.assign(existing[cas], add)
}

writeFileSync(OUT, JSON.stringify(existing) + '\n', 'utf8')

console.log('lcss-text.json пересобран.')
console.log(`  записей в файле: ${Object.keys(existing).length} (новых CAS: ${stat.newCas})`)
console.log(`  строк отброшено чёрным списком: ${skippedBanned}, по источнику: ${skippedSource}`)
for (const key of ['hazsum', 'safestore', 'firepot', 'peroxide', 'rgroups', 'alerts', 'carc', 'oel']) {
  console.log(`  ${key.padEnd(10)} ${stat[key]}`)
}
