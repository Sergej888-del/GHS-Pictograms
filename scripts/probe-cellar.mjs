// scripts/probe-cellar.mjs
//
// Разведчик CELLAR: какие ВИДЫ файла вообще существуют у данного акта на данном
// языке. Нужен потому, что `download-clp-act.mjs` получил 404 на 32018R0669 при
// обоих запрошенных видах (html и pdf), хотя на 32020R1182 тот же адрес отдал
// PDF без единого возражения.
//
// ⚠⚠ 404 ОТ CELLAR — ЭТО НЕ «ДОКУМЕНТА НЕТ». Это «нет ТАКОГО ПРЕДСТАВЛЕНИЯ
// документа». CELLAR отдаёт по согласованию содержимого: один и тот же акт
// лежит там как PDF, как Formex XML, как XHTML — и набор видов у разных актов
// РАЗНЫЙ. Спрашивать надо не «дай PDF», а сперва «что у тебя есть».
//
// ⚠ Тело не скачиваем: смотрим только заголовки ответа и обрываем поток. Иначе
// разведка сама выкачает те самые сотни мегабайт, ради экономии которых
// затевалась.
//
//     node --use-system-ca scripts/probe-cellar.mjs 32018R0669 it
//     node --use-system-ca scripts/probe-cellar.mjs 32020R1182 bg   ← контроль
//
// ⚠⚠ ФЛАГ --use-system-ca ОБЯЗАТЕЛЕН НА ЭТОЙ МАШИНЕ.

import { mkdir, writeFile } from 'node:fs/promises'

const ISO3 = {
  bg: 'bul', cs: 'ces', da: 'dan', de: 'deu', el: 'ell', en: 'eng', es: 'spa',
  et: 'est', fi: 'fin', fr: 'fra', ga: 'gle', hr: 'hrv', hu: 'hun', it: 'ita',
  lt: 'lit', lv: 'lav', mt: 'mlt', nl: 'nld', pl: 'pol', pt: 'por', ro: 'ron',
  sk: 'slk', sl: 'slv', sv: 'swe',
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

/**
 * ⭐ Первым идёт НЕ файл, а опись: `notice=branch` возвращает метаданные, где
 * перечислены все представления акта. Если она придёт — гадать не придётся.
 */
const ACCEPTS = [
  'application/xml;notice=branch',
  'application/xml;notice=object',
  'application/pdf',
  'application/pdf;type=pdf1x',
  'application/pdfa1a',
  'application/pdfa1b',
  'application/zip',
  'application/xml;type=fmx4',
  'application/xhtml+xml',
  'text/html',
  'text/html;type=simplified',
]

const [celex, lang = 'en'] = process.argv.slice(2)
if (!celex) {
  console.log('node --use-system-ca scripts/probe-cellar.mjs <CELEX> <язык>')
  process.exit(1)
}

const enc = celex.replace(/\(/g, '%28').replace(/\)/g, '%29')
const url = `https://publications.europa.eu/resource/celex/${enc}`
console.log(`${url}\nязык: ${lang} (${ISO3[lang]})\n`)
console.log('вид, который просим'.padEnd(34), 'ответ'.padEnd(6), 'размер'.padEnd(12), 'что пришло')
console.log('-'.repeat(100))

let notice = null
for (const accept of ACCEPTS) {
  const headers = { 'User-Agent': UA, Accept: accept, 'Accept-Language': ISO3[lang] }
  try {
    const res = await fetch(url, { headers, redirect: 'follow' })
    const len = res.headers.get('content-length')
    const ctype = (res.headers.get('content-type') || '—').split(';')[0]
    const size = len ? `${(Number(len) / 1024 / 1024).toFixed(2)} МБ` : 'не сказан'
    console.log(accept.padEnd(34), String(res.status).padEnd(6), size.padEnd(12), ctype)
    // ⚠ опись маленькая — её единственную читаем целиком И СОХРАНЯЕМ.
    // ⭐ Сохраняем потому, что разбирать её отсюда бесполезно: помощник её не
    // видит. Файл кладём в .tmp-eurlex, он прочитает оттуда.
    if (res.ok && accept.startsWith('application/xml;notice') && !notice) {
      notice = await res.text()
      const kind = accept.split('notice=')[1]
      const out = `.tmp-eurlex/notice-${celex.replace(/[()]/g, '')}-${lang}-${kind}.xml`
      await mkdir('.tmp-eurlex', { recursive: true })
      await writeFile(out, notice, 'utf8')
      console.log(`   ↳ опись сохранена: ${out} (${notice.length} байт)`)
    } else {
      res.body?.cancel().catch(() => {})
    }
  } catch (e) {
    console.log(accept.padEnd(34), 'ошибка'.padEnd(6), ''.padEnd(12), e.message.slice(0, 50))
  }
  await new Promise((r) => setTimeout(r, 900))
}

if (notice) {
  console.log('\n=== ЧТО ПЕРЕЧИСЛЕНО В ОПИСИ ===')
  const types = [...new Set([...notice.matchAll(/<(?:TYPE|type)>([^<]+)</g)].map((m) => m[1]))]
  const uris = [...new Set([...notice.matchAll(/(cellar:[0-9a-f-]{36}\.\d+\.\d+[^"'<\s]*)/g)].map((m) => m[1]))]
  console.log('типы:', types.slice(0, 40).join(', ') || '—')
  console.log('первые представления:')
  for (const u of uris.slice(0, 25)) console.log('   ', u)
  console.log(`всего представлений в описи: ${uris.length}`)
} else {
  console.log('\n⚠ Опись не пришла. Тогда ориентируйся на строки выше: тот вид, где ответ 200,')
  console.log('  и есть рабочий — его надо прописать в download-clp-act.mjs.')
}
