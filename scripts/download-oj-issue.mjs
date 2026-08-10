// scripts/download-oj-issue.mjs
//
// Качает ВЫПУСК Официального журнала целиком, а не отдельный акт.
//
// ⚠⚠ ЗАЧЕМ, если акт уже скачан. У 32018R0669 в CELLAR НЕТ PDF-представления
// (проверено разведкой: `application/pdf` → 404 у всех 11 языков), а есть
// только XHTML. XHTML годится, чтобы прочитать текст, но в нём нет НОМЕРА
// ПОЛОСЫ — а без него обращение не составить: корриджендум Бюро публикаций
// устроен как «Page 42, à l'annexe, dans le tableau, à la ligne 015-011-00-6,
// dans la colonne (2): au lieu de … lire …». Номер полосы там первым словом.
//
// ⭐ Выпуск, который нужен под 27 находок: L 115 от 4.5.2018 → JOL_2018_115_R.
//
// ⚠ Запускать ТОЛЬКО с машины: из облака сети до EUR-Lex нет.
//
//     node --use-system-ca scripts/download-oj-issue.mjs JOL_2018_115_R it
//     node --use-system-ca scripts/download-oj-issue.mjs JOL_2018_115_R it fr mt sv lt lv et da sk pl nl
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
 * ⚠ Форма адреса у выпуска ОЖ другая, чем у акта: не `/resource/celex/`, а
 * `/resource/oj/`. Пробуем несколько написаний — какое из них живое, заранее
 * неизвестно, а разведка на выпусках ещё не ставилась.
 */
function targets(oj, lang) {
  const L = lang.toUpperCase()
  const year = oj.match(/_(\d{4})_/)?.[1]
  const num = oj.match(/_(\d+)_R/)?.[1]
  return [
    `https://publications.europa.eu/resource/oj/${oj}`,
    `https://publications.europa.eu/resource/oj/${oj}.${ISO3[lang]}`,
    year && num ? `https://eur-lex.europa.eu/legal-content/${L}/TXT/PDF/?uri=OJ:L:${year}:${num}:FULL` : null,
  ].filter(Boolean)
}

const [oj, ...langs] = process.argv.slice(2)
if (!oj || !langs.length) {
  console.log('node --use-system-ca scripts/download-oj-issue.mjs JOL_2018_115_R it fr …')
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })
console.log(`Выпуск ${oj}, языков ${langs.length}.`)
console.log('⚠ Полос около 750 — файлы будут крупные, это надолго.\n')

let ok = 0, fail = 0
for (const lang of langs) {
  const out = join(OUT_DIR, `oj-${oj}-${lang}.pdf`)
  try {
    const st = await stat(out)
    if (st.size > 100000) {
      console.log(`  ${lang}: уже лежит (${(st.size / 1024 / 1024).toFixed(1)} МБ) — пропускаю`)
      ok++
      continue
    }
  } catch { /* качаем */ }

  let done = false
  for (const url of targets(oj, lang)) {
    const headers = assertAscii({
      'User-Agent': UA, Accept: 'application/pdf', 'Accept-Language': ISO3[lang],
    })
    console.log(`  ${lang}: ${url.slice(0, 92)}…`)
    try {
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (!res.ok) { console.log(`     ответ ${res.status}`); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      // ⚠ 200 и ноль байт — обычный ответ eur-lex боту. Это не успех.
      if (buf.length < 100000) { console.log(`     тело ${buf.length} байт — мало`); continue }
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.log('     не PDF'); continue }
      await writeFile(out, buf)
      console.log(`     ✓ ${out} — ${(buf.length / 1024 / 1024).toFixed(1)} МБ`)
      done = true
      break
    } catch (e) {
      console.log(`     ошибка: ${e.message.slice(0, 70)}`)
    }
  }
  if (done) ok++; else { fail++; console.log(`  ⚠ ${lang}: не удалось`) }
  await new Promise((r) => setTimeout(r, 1500))
}
console.log(`\nГотово: ${ok} получено, ${fail} нет.`)
