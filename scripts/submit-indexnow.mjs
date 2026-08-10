// scripts/submit-indexnow.mjs
//
// Отправляет список адресов в IndexNow одним запросом.
//
//     node --use-system-ca scripts/submit-indexnow.mjs indexnow-errata.txt
//     node --use-system-ca scripts/submit-indexnow.mjs indexnow-errata.txt --dry
//
// ⚠⚠ ФЛАГ --use-system-ca ОБЯЗАТЕЛЕН НА ЭТОЙ МАШИНЕ: трафик перехватывает
// антивирус, и без флага Node отвергает подменённый сертификат.
//
// ⚠⚠ КЛЮЧ НЕ ВПИСАН В КОД. Он читается из имени файла в `public/`: там лежит
// `<ключ>.txt`, и его же содержимое — тот самый ключ. Вписать ключ вторым
// местом значило бы завести два источника правды, которые однажды разойдутся,
// и отправка молча начнёт отбиваться с 403.
//
// ⭐ Отправлять только ИЗМЕНИВШИЕСЯ адреса. Весь справочник — это трата
// краулингового бюджета на страницы, где не поменялось ничего.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const HOST = 'ghspictograms.com'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

const [file, ...flags] = process.argv.slice(2)
if (!file) {
  console.log('node --use-system-ca scripts/submit-indexnow.mjs <файл со списком> [--dry]')
  process.exit(1)
}
const dry = flags.includes('--dry')

// ⚠ Ключ ищем по файлу в public/: имя без .txt обязано совпасть с содержимым.
const keyFile = readdirSync('public').find((f) => /^[0-9a-f]{32}\.txt$/.test(f))
if (!keyFile) {
  console.error('⚠ В public/ нет файла ключа IndexNow (<32 hex>.txt).')
  process.exit(1)
}
const key = keyFile.replace(/\.txt$/, '')
const inside = readFileSync(join('public', keyFile), 'utf8').trim()
if (inside !== key) {
  console.error(`⚠⚠ Имя файла ключа и его содержимое не совпадают:\n   имя ${key}\n   внутри ${inside}`)
  console.error('   IndexNow отобьёт такую заявку. Чинить надо public/, а не скрипт.')
  process.exit(1)
}

const urlList = readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
const foreign = urlList.filter((u) => !u.startsWith(`https://${HOST}/`))
if (foreign.length) {
  console.error(`⚠⚠ ${foreign.length} адресов не с ${HOST} — отправка отменена:`)
  for (const u of foreign.slice(0, 5)) console.error('   ' + u)
  process.exit(1)
}

console.log(`host: ${HOST}`)
console.log(`ключ: ${key} (public/${keyFile})`)
console.log(`адресов: ${urlList.length}`)
for (const u of urlList) console.log('   ' + u)

if (dry) { console.log('\n--dry: ничего не отправлено.'); process.exit(0) }

const body = {
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${keyFile}`,
  urlList,
}
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
})
const text = await res.text()
console.log(`\nответ ${res.status} ${res.statusText}`)
if (text.trim()) console.log(text.slice(0, 400))

// ⭐ Что значат коды: 200 — принято; 202 — принято, ключ проверяется;
// 400 — неверный формат; 403 — ключ не подтверждён по keyLocation;
// 422 — адреса не с того хоста; 429 — слишком часто.
if (res.status === 200 || res.status === 202) console.log('✓ заявка принята')
else console.log('⚠ заявка НЕ принята — смотри код выше')
