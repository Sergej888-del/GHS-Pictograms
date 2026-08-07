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
const OUT_FILE = join(OUT_DIR, 'clp-consolidated.html')

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
function urlsFor(version) {
  const iso = `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}`
  return [
    { url: `https://publications.europa.eu/resource/celex/02008R1272-${version}`, cellar: true },
    { url: `http://publications.europa.eu/resource/celex/02008R1272-${version}`, cellar: true },
    { url: `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02008R1272-${version}` },
    { url: `https://eur-lex.europa.eu/eli/reg/2008/1272/${iso}/eng` },
    { url: `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A02008R1272-${version}&from=EN` },
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

function looksRight(html) {
  const checks = [
    ['ANNEX III', /ANNEX\s+III/i],
    ['ANNEX IV', /ANNEX\s+IV/i],
    ['H200', /\bH200\b/],
    ['H319', /\bH319\b/],
    ['P501', /\bP501\b/],
    ['текст Annex III', /Unstable\s+explosive/i],
  ]
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

  const headers = cellar
    ? { ...HEADERS, Accept: 'text/html, application/xhtml+xml', 'Accept-Language': 'eng' }
    : HEADERS

  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) {
    process.stdout.write(`    → HTTP ${res.status} ${res.statusText}\n`)
    return null
  }
  const html = await res.text()
  const bytes = Buffer.byteLength(html)
  const size = bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`
  const verdict = looksRight(html)
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  try {
    const st = await stat(OUT_FILE)
    if (st.size > 1_000_000) {
      console.log(`Файл уже есть: ${OUT_FILE} (${(st.size / 1024 / 1024).toFixed(1)} МБ).`)
      console.log('Чтобы скачать заново — удали его и запусти снова.')
      return
    }
  } catch {
    /* файла нет — качаем */
  }

  if (!HAS_SYSTEM_CA) {
    console.log('⚠ Флага --use-system-ca нет. Если увидишь «fetch failed» — дело почти наверняка в нём.\n')
  }

  // ⚠ Без этой проверки скрипт двадцать минут перебирает пятнадцать адресов,
  // хотя ответ известен на первом же запросе.
  if (!(await preflight())) {
    process.exitCode = 1
    return
  }

  const MAX_ROUNDS = 6
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n── круг ${round} из ${MAX_ROUNDS} ───────────────────────────────`)
    for (const version of VERSIONS) {
      console.log(`редакция ${version}:`)
      for (const target of urlsFor(version)) {
        try {
          const html = await tryUrl(target, round)
          if (html) {
            await writeFile(OUT_FILE, html, 'utf8')
            console.log(`\n✔ Готово: ${OUT_FILE}`)
            console.log(`  редакция 02008R1272-${version}`)
            console.log('  Скажи Клоду «скачал» — он разберёт приложения и зальёт переводы.')
            return
          }
        } catch (e) {
          const { code, msg, hint } = explain(e)
          console.log(`    → сеть: ${code ?? ''} ${msg}`)
          if (hint) console.log(`      ⚠ ${hint}`)
        }
        await sleep(3000) // ⚠ пауза между адресами: EUR-Lex считает частоту
      }
    }
    if (round < MAX_ROUNDS) {
      const wait = round * 30
      console.log(`\nВсе адреса молчат. Жду ${wait} с и пробую снова…`)
      await sleep(wait * 1000)
    }
  }

  console.error('\n✖ Не удалось скачать за шесть кругов.')
  console.error('  Запусти скрипт позже — он ничего не ломает и его можно гонять сколько угодно.')
  process.exitCode = 1
}

main()
