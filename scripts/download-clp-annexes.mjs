// scripts/download-clp-annexes.mjs
//
// Скачивает консолидированный текст CLP (Regulation (EC) No 1272/2008) с EUR-Lex
// и кладёт в .tmp-eurlex/clp-consolidated.html.
//
// ⚠⚠ ЗАЧЕМ ОДИН ФАЙЛ, А НЕ ДВАДЦАТЬ ЧЕТЫРЕ.
// Annex III (H-фразы) и Annex IV (P-фразы) устроены так, что КАЖДАЯ фраза внутри
// документа приведена сразу на всех 24 официальных языках ЕС — BG, ES, CS, DA, DE,
// ET, EL, EN, FR, GA, HR, IT, LV, LT, HU, MT, NL, PL, PT, RO, SK, SL, FI, SV. То
// есть английская версия консолидированного текста УЖЕ содержит все переводы, и
// качать языковые версии по отдельности не нужно.
//
// ⚠ Запускать ТОЛЬКО локально, с машины Сергея: из облачного контейнера сети до
// EUR-Lex нет.
//
//     node --use-system-ca scripts/download-clp-annexes.mjs
//
// ⚠⚠ ФЛАГ --use-system-ca ОБЯЗАТЕЛЕН НА ЭТОЙ МАШИНЕ. Без него все адреса подряд
// падают с «fetch failed», хотя те же ссылки открываются в браузере: трафик
// перехватывает антивирус или корпоративный прокси, подменяя сертификат, а Node
// доверяет только своему вшитому списку корней и такую подмену отвергает. Тот же
// флаг стоит в package.json у `dev` и у `check:dist` — грабли известные.
// Скрипт сам определяет, что флага нет, и напоминает.
//
// ЛИЦЕНЗИЯ ИСТОЧНИКА: Commission Decision 2011/833/EU — повторное использование
// документов EUR-Lex разрешено, в том числе коммерческое, бесплатно и без заявки,
// при указании источника. Юридически аутентичен только текст в электронном
// Official Journal (Reg. 216/2013, Art. 1(2)) — эта оговорка обязана стоять на
// странице инструмента.
//
// ⚠ ECHA скрейпить НЕЛЬЗЯ: её Legal notice прямо запрещает «scraping, data mining
// and extraction». Единственный законный источник переводов — EUR-Lex.

import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const OUT_DIR = '.tmp-eurlex'

/**
 * ⭐⭐ ЯЗЫКОВЫЕ ВЕРСИИ: ОДНА ЗАГРУЗКА НА ЯЗЫК ЗАКРЫВАЕТ ДВЕ РАБОТЫ.
 *
 * Annex III и IV многоязычны ВНУТРИ документа — для H- и P-фраз хватило одного
 * английского файла (session 43). А вот Annex I (сигнальные слова «Danger» и
 * «Warning») и Annex VI Part 3 (имена веществ) одноязычны: в английской версии
 * они по-английски. Значит нужны языковые версии — но НЕ два раза по двадцать
 * три: оба приложения лежат в ОДНОМ И ТОМ ЖЕ документе. Двадцать три загрузки
 * по ~27 МБ, два разных парсера над одними файлами.
 *
 * ⚠ В хендоффе это записано двумя работами (пп. 3 и 5). Это одна.
 *
 *   node --use-system-ca scripts/download-clp-annexes.mjs           → en (как раньше)
 *   node --use-system-ca scripts/download-clp-annexes.mjs de         → только немецкий
 *   node --use-system-ca scripts/download-clp-annexes.mjs all        → все 24
 *
 * ⚠ Файлы НЕ удаляются после разбора: перекачивать 620 МБ ради правки регулярки
 * — худшая из возможных причин ходить в сеть. Папка в .gitignore.
 */

/**
 * Двухбуквенный код → код, которым CELLAR просит язык.
 *
 * ⚠⚠ CELLAR понимает ISO 639-2/B (три буквы), а НЕ два знака. На `Accept-Language: de`
 * он молча отдаёт английскую версию — то есть скрипт «успешно скачает» не тот
 * документ, парсер найдёт английские имена, и в базу уедут 4 015 «переводов»,
 * совпадающих с оригиналом. Тихий отказ ровно того сорта, что в
 * claude/silent-supabase-failures.md.
 */
const CELLAR_LANG = {
  bg: 'bul', es: 'spa', cs: 'ces', da: 'dan', de: 'deu', et: 'est',
  el: 'ell', en: 'eng', fr: 'fra', ga: 'gle', hr: 'hrv', it: 'ita',
  lv: 'lav', lt: 'lit', hu: 'hun', mt: 'mlt', nl: 'nld', pl: 'pol',
  pt: 'por', ro: 'ron', sk: 'slk', sl: 'slv', fi: 'fin', sv: 'swe',
}
const ALL_LANGS = Object.keys(CELLAR_LANG)

/**
 * ⚠ Английский пишется в СТАРОЕ имя файла. Его уже ждут parse-clp-annexes.py и
 * import-clp-translations.ts; переименование сломало бы работающую цепочку ради
 * симметрии имён.
 */
function outFileFor(lang) {
  return join(OUT_DIR, lang === 'en' ? 'clp-consolidated.html' : `clp-consolidated-${lang}.html`)
}

/**
 * Консолидированные редакции, от новой к старой. Скрипт берёт первую, которая
 * ответит. ⚠ Список именно перебирается: EUR-Lex убирает и добавляет редакции
 * без предупреждения, и жёстко зашитая дата однажды начнёт отдавать 404.
 */
const VERSIONS = ['20260501', '20250901', '20250201', '20250101', '20241210']

/**
 * Адреса одной и той же редакции. Пробуются по очереди.
 *
 * ⚠⚠ CELLAR (publications.europa.eu) — ЭТО ДРУГАЯ СЛУЖБА, а не тот же сайт под
 * другим именем. Витрина eur-lex.europa.eu и репозиторий Publications Office
 * живут на разной инфраструктуре, и когда витрина отдаёт пустую заглушку с кодом
 * 200 («EUR-Lex is temporarily not fully available»), CELLAR обычно работает.
 * Он отдаёт документ по согласованию содержимого: язык просится заголовком
 * Accept-Language, формат — заголовком Accept.
 */
function urlsFor(version, lang = 'en') {
  const iso = `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}`
  const L = lang.toUpperCase()
  const iso3 = CELLAR_LANG[lang]
  return [
    { url: `https://publications.europa.eu/resource/celex/02008R1272-${version}`, cellar: true },
    { url: `http://publications.europa.eu/resource/celex/02008R1272-${version}`, cellar: true },
    { url: `https://eur-lex.europa.eu/legal-content/${L}/TXT/HTML/?uri=CELEX:02008R1272-${version}` },
    { url: `https://eur-lex.europa.eu/eli/reg/2008/1272/${iso}/${iso3}` },
    { url: `https://eur-lex.europa.eu/legal-content/${L}/TXT/HTML/?uri=CELEX%3A02008R1272-${version}&from=${L}` },
  ]
}

const HEADERS = {
  // ⚠ С дефолтным UA node EUR-Lex отдаёт 403 заметно чаще.
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Разворачивает «fetch failed» в настоящую причину.
 *
 * ⚠⚠ Undici прячет её в `error.cause`, и без этого разбора все неполадки —
 * подменённый сертификат, мёртвый DNS, закрытый порт — выглядят одной и той же
 * бесполезной строкой «fetch failed». Именно на ней мы и потеряли первый заход.
 */
function explain(err) {
  const chain = []
  for (let e = err; e; e = e.cause) chain.push(e)
  const codes = chain.map((e) => e.code).filter(Boolean)
  const code = codes[codes.length - 1] ?? codes[0] ?? null
  const msg = chain.map((e) => e.message).filter(Boolean).join(' ← ')

  const HINTS = {
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'сертификат подменён (антивирус/прокси) → нужен флаг --use-system-ca',
    SELF_SIGNED_CERT_IN_CHAIN: 'самоподписанный корень в цепочке → нужен флаг --use-system-ca',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'самоподписанный сертификат → нужен флаг --use-system-ca',
    CERT_HAS_EXPIRED: 'сертификат просрочен — проверь дату и время в Windows',
    ENOTFOUND: 'DNS не разрешает имя eur-lex.europa.eu',
    ECONNREFUSED: 'соединение отклонено — файрвол или прокси',
    ECONNRESET: 'соединение оборвано на середине — прокси или рейт-лимит',
    ETIMEDOUT: 'таймаут — сеть до europa.eu не доходит',
    UND_ERR_CONNECT_TIMEOUT: 'таймаут соединения — сеть до europa.eu не доходит',
  }
  return { code, msg, hint: code ? HINTS[code] ?? null : null }
}

/** Стоит ли флаг --use-system-ca. */
const HAS_SYSTEM_CA =
  process.execArgv.some((a) => a.includes('use-system-ca')) ||
  (process.env.NODE_OPTIONS ?? '').includes('use-system-ca')

/**
 * ⚠⚠ МАРКЕРЫ ДЛЯ ЯЗЫКОВОЙ ВЕРСИИ ОБЯЗАНЫ БЫТЬ ЯЗЫКОНЕЗАВИСИМЫМИ. Английские
 * «ANNEX III» и «Unstable explosive» в немецком документе отсутствуют
 * («ANHANG III», «Instabil, explosiv»), и проверка забракует правильный файл.
 * Годятся только коды и номера: H200, P501, номер регламента, индексный номер
 * Annex VI и EC-номер — они одинаковы во всех двадцати четырёх версиях.
 *
 * ⭐ `606-001-00-8` и `200-662-2` (ацетон) стоят здесь НЕ для красоты: это
 * единственная проверка, что в файле есть Annex VI Part 3. Без неё скрипт
 * принял бы документ, в котором приложения с именами веществ нет вовсе, а
 * узнали бы мы об этом уже парсером, на двадцать третьем файле.
 */
function looksRight(html, lang = 'en') {
  const common = [
    ['H200', /\bH200\b/],
    ['H319', /\bH319\b/],
    ['P501', /\bP501\b/],
    ['номер регламента', /1272\s*\/\s*2008/],
    ['Annex VI: индексный номер ацетона', /\b606-001-00-8\b/],
    ['Annex VI: EC-номер ацетона', /\b200-662-2\b/],
  ]
  const english = [
    ['ANNEX III', /ANNEX\s+III/i],
    ['ANNEX IV', /ANNEX\s+IV/i],
    ['текст Annex III', /Unstable\s+explosive/i],
  ]
  const checks = lang === 'en' ? [...english, ...common] : common
  const missing = checks.filter(([, re]) => !re.test(html)).map(([name]) => name)
  return { ok: missing.length === 0, missing }
}

/** Живо ли вообще соединение до europa.eu. Один запрос, до всякого перебора. */
async function preflight() {
  process.stdout.write('Проверяю связь с eur-lex.europa.eu… ')
  try {
    const res = await fetch('https://eur-lex.europa.eu/robots.txt', { headers: HEADERS })
    process.stdout.write(`HTTP ${res.status} — связь есть.\n\n`)
    return true
  } catch (e) {
    const { code, msg, hint } = explain(e)
    process.stdout.write('НЕ ОТВЕЧАЕТ.\n')
    console.error(`  код: ${code ?? '—'}`)
    console.error(`  сообщение: ${msg}`)
    if (hint) console.error(`  ⚠ ${hint}`)
    if (!HAS_SYSTEM_CA) {
      console.error('\n  ⚠⚠ Скрипт запущен БЕЗ флага --use-system-ca. На этой машине он обязателен.')
      console.error('     Запусти так:\n')
      console.error('       node --use-system-ca scripts/download-clp-annexes.mjs\n')
    }
    return false
  }
}

/** Голый текст из куска HTML — чтобы показать, ЧТО именно прислал сервер. */
function peek(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}

async function tryUrl(target, attempt) {
  const { url, cellar } = target
  process.stdout.write(`  попытка ${attempt}${cellar ? ' [cellar]' : ''}: ${url.slice(0, 92)}…\n`)

  const iso3 = CELLAR_LANG[target.lang ?? 'en'] ?? 'eng'
  const headers = cellar
    ? { ...HEADERS, Accept: 'text/html, application/xhtml+xml', 'Accept-Language': iso3 }
    : { ...HEADERS, 'Accept-Language': iso3 }

  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) {
    process.stdout.write(`    → HTTP ${res.status} ${res.statusText}\n`)
    return null
  }
  const html = await res.text()
  const bytes = Buffer.byteLength(html)
  const size = bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`
  const verdict = looksRight(html, target.lang ?? 'en')
  if (!verdict.ok) {
    process.stdout.write(`    → ${size}, не тот документ. Нет: ${verdict.missing.join(', ')}\n`)
    // ⚠ Без этой строки сбой витрины и «не та редакция» выглядят одинаково.
    // Заглушка EUR-Lex приходит с кодом 200, и отличить её можно только по тексту.
    if (bytes < 400_000) process.stdout.write(`      прислали: «${peek(html)}»\n`)
    return null
  }
  process.stdout.write(`    → ${size}, все маркеры на месте ✔\n`)
  return html
}

/** Одна языковая версия: перебор редакций и адресов. Возвращает HTML или null. */
async function fetchOne(lang, maxRounds) {
  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n── ${lang}: круг ${round} из ${maxRounds} ──────────────────────`)
    for (const version of VERSIONS) {
      console.log(`редакция ${version}:`)
      for (const target of urlsFor(version, lang)) {
        try {
          const html = await tryUrl({ ...target, lang }, round)
          if (html) return { html, version }
        } catch (e) {
          const { code, msg, hint } = explain(e)
          console.log(`    → сеть: ${code ?? ''} ${msg}`)
          if (hint) console.log(`      ⚠ ${hint}`)
        }
        await sleep(3000) // ⚠ пауза между адресами: EUR-Lex считает частоту
      }
    }
    if (round < maxRounds) {
      const wait = round * 30
      console.log(`\nВсе адреса молчат. Жду ${wait} с и пробую снова…`)
      await sleep(wait * 1000)
    }
  }
  return null
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const args = process.argv.slice(2).map((a) => a.toLowerCase()).filter(Boolean)
  const langs = args.length === 0 ? ['en'] : args.includes('all') ? ALL_LANGS : args
  const unknown = langs.filter((l) => !CELLAR_LANG[l])
  if (unknown.length) {
    console.error(`✖ Неизвестный язык: ${unknown.join(', ')}`)
    console.error(`  Доступны: ${ALL_LANGS.join(' ')}  (или all)`)
    process.exitCode = 1
    return
  }

  console.log(`Языков в задании: ${langs.length} — ${langs.join(' ')}`)
  console.log(`Ожидаемый объём: ~${Math.round(langs.length * 27)} МБ в ${OUT_DIR}/\n`)

  if (!HAS_SYSTEM_CA) {
    console.log('⚠ Флага --use-system-ca нет. Если увидишь «fetch failed» — дело почти наверняка в нём.\n')
  }

  // ⚠ Без этой проверки скрипт двадцать минут перебирает пятнадцать адресов,
  // хотя ответ известен на первом же запросе.
  if (!(await preflight())) {
    process.exitCode = 1
    return
  }

  // ⚠ На пачке языков кругов меньше: preflight уже доказал, что сеть до europa.eu
  // доходит, и шесть кругов по тридцать секунд ожидания на КАЖДЫЙ из двадцати
  // трёх языков — это часы простоя на одном сбойном языке.
  const maxRounds = langs.length > 1 ? 2 : 6

  const done = []
  const skipped = []
  const failed = []

  for (const lang of langs) {
    const out = outFileFor(lang)
    try {
      const st = await stat(out)
      if (st.size > 1_000_000) {
        console.log(`${lang}: файл уже есть — ${out} (${(st.size / 1024 / 1024).toFixed(1)} МБ), пропускаю.`)
        skipped.push(lang)
        continue
      }
    } catch {
      /* файла нет — качаем */
    }

    const got = await fetchOne(lang, maxRounds)
    if (got) {
      await writeFile(out, got.html, 'utf8')
      const mb = (Buffer.byteLength(got.html) / 1024 / 1024).toFixed(1)
      console.log(`\n✔ ${lang}: ${out} — ${mb} МБ, редакция 02008R1272-${got.version}`)
      done.push(lang)
    } else {
      console.error(`\n✖ ${lang}: не удалось скачать.`)
      failed.push(lang)
    }
  }

  console.log('\n══ итог ══════════════════════════════════════════')
  console.log(`  скачано:   ${done.length ? done.join(' ') : '—'}`)
  console.log(`  было ранее: ${skipped.length ? skipped.join(' ') : '—'}`)
  console.log(`  не вышло:   ${failed.length ? failed.join(' ') : '—'}`)
  if (failed.length) {
    console.log('\n  ⚠ Повторный запуск скачает ТОЛЬКО недостающие — уже лежащие файлы он пропускает.')
    console.log(`     node --use-system-ca scripts/download-clp-annexes.mjs ${failed.join(' ')}`)
    process.exitCode = 1
  } else {
    console.log('\n  Скажи Клоду «скачал» и перечисли языки — он разберёт Annex I и Annex VI.')
  }
}

main()
