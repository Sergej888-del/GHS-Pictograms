// scripts/download-oj-pdf.mjs
//
// Качает PDF-факсимиле полосы ОЖ, спрашивая у CELLAR ОПИСЬ, а не угадывая адрес.
//
// ⚠⚠⚠ ПОЧЕМУ ПОНАДОБИЛСЯ ТРЕТИЙ ПОДХОД. Session 58 дважды ошиблась об одно и то
// же место:
//
//   1. `Accept: application/pdf` на /resource/celex/32018R0669 → 404.
//      Вывод «PDF-представления нет» оказался НЕВЕРЕН.
//   2. Опись показала имя `32018R0669.ITA.pdfa1a`, и я подставил его суффиксом
//      в адрес: /resource/celex/32018R0669.ITA.pdfa1a → тоже 404.
//      Вывод «значит адресом просить можно» оказался НЕВЕРЕН ТОЖЕ.
//
// ⭐⭐⭐ Правда в том, что `32018R0669.ITA.pdfa1a` — это ИМЯ (identifier), а не
// адрес. Адрес лежит рядом с ним в описи, в поле VALUE, и выглядит иначе:
//
//   http://publications.europa.eu/resource/cellar/<uuid>.0012.01/DOC_1
//
// Номер `0012` — внутренний индекс языковой версии. Он РАЗНЫЙ у разных языков и
// из кода языка не выводится. ⚠⚠ Поэтому угадать адрес нельзя в принципе:
// опись надо спрашивать для КАЖДОГО языка отдельно.
//
// ⭐ Урок общий: у CELLAR имя ресурса и адрес ресурса — разные вещи. Когда
// согласование содержимого отказывает, спрашивать надо опись, а не изобретать
// адрес из имени.
//
//     node --use-system-ca scripts/download-oj-pdf.mjs 32018R0669 it fr mt sv lt lv et da sk pl nl
//
// ⚠⚠ ФЛАГ --use-system-ca ОБЯЗАТЕЛЕН НА ЭТОЙ МАШИНЕ.

import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const OUT_DIR = '.tmp-eurlex'

const ISO3 = {
  bg: 'bul', cs: 'ces', da: 'dan', de: 'deu', el: 'ell', en: 'eng', es: 'spa',
  et: 'est', fi: 'fin', fr: 'fra', ga: 'gle', hr: 'hrv', hu: 'hun', it: 'ita',
  lt: 'lit', lv: 'lav', mt: 'mlt', nl: 'nld', pl: 'pol', pt: 'por', ro: 'ron',
  sk: 'slk', sl: 'slv', sv: 'swe',
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

function assertAscii(h) {
  for (const [k, v] of Object.entries(h)) {
    if (/[^\x00-\xFF]/.test(String(v))) throw new Error(`заголовок ${k} не ASCII: ${v}`)
  }
  return h
}

/**
 * Из описи достаём адрес файла PDF/A.
 *
 * ⚠ Берём представление УРОВНЯ АКТА (`JOL_..._R_0001`), а не всего выпуска
 * (`JOL_..._R`): выпуск толще, а нужен именно акт.
 * ⭐ Заодно возвращаем номер ПЕРВОЙ ПОЛОСЫ — ради него всё и затевалось.
 */
function parseNotice(xml, celex, iso3) {
  const items = [...xml.matchAll(/<MANIFESTATION_HAS_ITEM>([\s\S]*?)<\/MANIFESTATION_HAS_ITEM>/g)]
  let actLevel = null
  let issueLevel = null
  for (const [, body] of items) {
    if (!/\.pdfa\da\b/.test(body)) continue
    const url = /<VALUE>(http:\/\/publications\.europa\.eu\/resource\/cellar\/[^<]+DOC_\d+)<\/VALUE>/.exec(body)
    if (!url) continue
    if (/_R_\d{4}\.[A-Z]{3}\.pdfa/.test(body)) actLevel ??= url[1]
    else issueLevel ??= url[1]
  }
  const page = /<MANIFESTATION_OFFICIAL-JOURNAL_PART_PAGE_FIRST[^>]*>\s*<VALUE>(\d+)<\/VALUE>/.exec(xml)
  const total = /<PAGES_TOTAL[^>]*>\s*<VALUE>(\d+)<\/VALUE>/.exec(xml)
  return {
    url: actLevel ?? issueLevel,
    level: actLevel ? 'акт' : issueLevel ? 'весь выпуск' : '—',
    pageFirst: page?.[1] ?? null,
    pagesTotal: total?.[1] ?? null,
  }
}

const [celex, ...langs] = process.argv.slice(2)
if (!celex || !langs.length) {
  console.log('node --use-system-ca scripts/download-oj-pdf.mjs 32018R0669 it fr …')
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })
const base = `https://publications.europa.eu/resource/celex/${celex.replace(/\(/g, '%28').replace(/\)/g, '%29')}`
console.log(`${celex} — ${langs.length} языков. Сперва опись, потом файл по её адресу.\n`)

let ok = 0, fail = 0
for (const lang of langs) {
  const out = join(OUT_DIR, `act-${celex}-${lang}.pdf`)
  try {
    const st = await stat(out)
    if (st.size > 100000) { console.log(`  ${lang}: уже лежит (${(st.size / 1024 / 1024).toFixed(1)} МБ)`); ok++; continue }
  } catch { /* качаем */ }

  const iso3 = ISO3[lang]
  process.stdout.write(`  ${lang}: опись… `)
  let notice
  try {
    const res = await fetch(base, {
      headers: assertAscii({ 'User-Agent': UA, Accept: 'application/xml;notice=branch', 'Accept-Language': iso3 }),
      redirect: 'follow',
    })
    if (!res.ok) { console.log(`ответ ${res.status}`); fail++; continue }
    notice = await res.text()
  } catch (e) { console.log(`ошибка: ${e.message.slice(0, 60)}`); fail++; continue }

  await writeFile(join(OUT_DIR, `notice-${celex}-${lang}-branch.xml`), notice, 'utf8')
  const { url, level, pageFirst, pagesTotal } = parseNotice(notice, celex, iso3.toUpperCase())
  if (!url) { console.log('в описи нет PDF/A'); fail++; continue }
  console.log(`есть (${level}, полосы с ${pageFirst}, всего ${pagesTotal})`)

  // ⚠⚠ ITEM — ЭТО УЖЕ ФАЙЛ, А НЕ РЕСУРС ДЛЯ СОГЛАСОВАНИЯ. На `Accept:
  // application/pdf` он отвечает 406 Not Acceptable у всех 11 языков: адрес
  // верный, но требование типа этому концу не нравится. Просим что угодно.
  // ⭐ Ровно та же ошибка, что дважды выше по тексту: я навязывал CELLAR свой
  // способ спросить вместо того, чтобы спросить его способом.
  const ACCEPTS = ['*/*', 'application/octet-stream', 'application/pdf']
  let got = false
  for (const accept of ACCEPTS) {
    process.stdout.write(`     ${accept} … `)
    try {
      const res = await fetch(url, {
        headers: assertAscii({ 'User-Agent': UA, Accept: accept }), redirect: 'follow',
      })
      if (!res.ok) { console.log(`ответ ${res.status}`); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        console.log(`не PDF (${buf.length} байт, ${res.headers.get('content-type') || '—'})`)
        continue
      }
      await writeFile(out, buf)
      console.log(`✓ ${(buf.length / 1024 / 1024).toFixed(1)} МБ`)
      got = true
      break
    } catch (e) { console.log(`ошибка: ${e.message.slice(0, 60)}`) }
    await new Promise((r) => setTimeout(r, 800))
  }
  if (got) ok++; else fail++
  await new Promise((r) => setTimeout(r, 1500))
}
console.log(`\nГотово: ${ok} получено, ${fail} нет.`)
