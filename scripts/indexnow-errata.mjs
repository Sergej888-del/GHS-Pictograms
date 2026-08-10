// scripts/indexnow-errata.mjs
//
// Собирает список адресов для IndexNow ПО СОБРАННОМУ `dist`, а не по догадке.
//
// ⚠⚠ ЗАЧЕМ НЕ СПИСКОМ ИЗ БАЗЫ. Адрес страницы вещества считается из имени и
// CAS (`substanceSlug`), а имя берётся не из одной колонки. Составить список
// «руками по index-номерам» значит угадывать слаг — и отправить в IndexNow
// несуществующие адреса. ⭐ Собранный `dist` знает правду: страница либо есть,
// либо её нет.
//
// ⭐ Признак отбора точный: правка session 59 меняет разметку ТОЛЬКО внутри
// пометки `name-erratum` и подписи под таблицей. Значит затронуты ровно те
// страницы, где эта пометка стоит.
//
//     node scripts/indexnow-errata.mjs            → indexnow-errata.txt
//
// ⚠ Кэш Cloudflare чистить всё равно полностью: менялся hub.css, у него новый
// хеш в имени, и старый HTML сошлётся на несуществующий файл.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const ORIGIN = 'https://ghspictograms.com'
const MARK = 'name-erratum'

if (!existsSync(join(DIST, 'substances'))) {
  console.error('⚠ Нет dist/substances — сперва `npm run build`.')
  process.exit(1)
}

const urls = []
for (const slug of readdirSync(join(DIST, 'substances'), { withFileTypes: true })) {
  if (!slug.isDirectory()) continue
  const file = join(DIST, 'substances', slug.name, 'index.html')
  if (!existsSync(file)) continue
  if (readFileSync(file, 'utf8').includes(MARK)) urls.push(`${ORIGIN}/substances/${slug.name}/`)
}

urls.sort()
writeFileSync('indexnow-errata.txt', urls.join('\n') + '\n', 'utf8')
console.log(`Адресов с пометкой: ${urls.length} → indexnow-errata.txt`)
for (const u of urls) console.log('  ' + u)
