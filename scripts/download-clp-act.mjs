// scripts/download-clp-act.mjs
//
// Качает ОТДЕЛЬНЫЙ акт Официального журнала (а не консолидацию) в нужных
// языковых версиях — в двух видах сразу: HTML (для машинной сверки) и PDF
// (факсимиле электронного ОЖ, для цитирования со страницей).
//
// ⚠⚠ ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ. Консолидированный текст на EUR-Lex юридической
// силы НЕ имеет: его собирает Бюро публикаций из исходного акта и поправок
// (оговорка стоит в шапке самого файла). Session 57 нашла 29 ошибок в языковых
// редакциях Annex VI, сверив их с консолидацией, — и этого мало, чтобы сказать
// «ошибка в законе». Юридически аутентичен только текст в электронном
// Official Journal (Reg. 216/2013, Art. 1(2)).
//
// ⚠⚠ ПОЭТОМУ КАЧАЕМ И PDF. HTML отдельного акта — тоже сборка Бюро публикаций
// из того же XML, что и консолидация. Если сверять только HTML, возражение
// «оба файла делает одна и та же машина» останется без ответа. PDF — факсимиле
// печатной полосы ОЖ, у него есть номер страницы, на который можно сослаться.
//
// ⚠ Запускать ТОЛЬКО с машины: из облака сети до EUR-Lex нет, и у device_bash
// её тоже нет.
//
//     node --use-system-ca scripts/download-clp-act.mjs errata
//     node --use-system-ca scripts/download-clp-act.mjs 32018R0669 it fr mt
//     node --use-system-ca scripts/download-clp-act.mjs 32018R0669 it --pdf-only
//
// ⚠⚠ ФЛАГ --use-system-ca ОБЯЗАТЕЛЕН НА ЭТОЙ МАШИНЕ — см. шапку
// download-clp-annexes.mjs: трафик перехватывает антивирус, Node отвергает
// подменённый сертификат.
//
// ЛИЦЕНЗИЯ ИСТОЧНИКА: Commission Decision 2011/833/EU — повторное использование
// документов EUR-Lex разрешено с указанием источника.
// ⚠ ECHA скрейпить нельзя: её Legal notice это прямо запрещает.

import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const OUT_DIR = '.tmp-eurlex'

/**
 * ⭐⭐ НАБОР SESSION 57/58: какой акт и на каком языке нужен под какую находку.
 *
 * Определено по меткам ▼M в консолидации: у EUR-Lex каждая метка — это ссылка
 * <p class="modref"><a href=".../celex/32018R0669" title="…: REPLACED">▼M16</a>,
 * то есть CELEX акта-источника лежит прямо в разметке строки. Ближайшая
 * предшествующая метка говорит, из какого акта взят текущий текст строки.
 *
 * Разложение всех 29 находок (session 58, проверено по 13 файлам):
 *   M16 = 32018R0669 — 27 находок (it 5, fr 3, mt 4, lt 3, pl 3, et 2, sv 2,
 *                                  lv 2, da 1, sk 1, nl 1)
 *   M23 = 32020R1182 —  1 находка (bg, азотная кислота 007-004-00-1)
 *   M31 = 32022R0692 —  1 находка (cs, 615-050-00-4)
 *
 * ⚠⚠ ЭТО НЕ ЗНАЧИТ, ЧТО ВИНОВАТ ИМЕННО ЭТОТ АКТ. Замер: на M16 (2018/669)
 * приходится 90,3 % ВСЕХ строк таблицы, поэтому 27 находок из 29 в нём — ровно
 * то, что даёт случайность (ожидание 26,2). Совпадение пустое, и вывода
 * «виноват 2018/669» из него делать нельзя. Акт нужен по другой причине:
 * это тот текст ОЖ, откуда строка пришла, и значит именно его надо сверять.
 */
const ERRATA_SET = [
  { celex: '32018R0669', langs: ['it', 'fr', 'mt', 'sv', 'lt', 'lv', 'et', 'da', 'sk', 'pl', 'nl'] },
  { celex: '32020R1182', langs: ['bg'] }, // азотная кислота 007-004-00-1
  { celex: '32022R0692', langs: ['cs'] }, // 615-050-00-4
]

/**
 * ⭐⭐⭐ ПРЕЦЕДЕНТЫ: корриджендумы к ТЕМ ЖЕ актам, уже выпущенные.
 *
 * Найдены session 58 в шапках консолидаций — раздел «Изменён следующими актами»
 * перечисляет и поправки, и исправления, с номером ОЖ и страницей.
 *
 *   32018R0669R(01) · FR · JO L 233, 10.9.2019, p. 26
 *       ⭐⭐ ИСПРАВЛЯЕТ ИМЕННО ЗАПИСЬ 015-011-00-6 (фосфорная кислота) — ту
 *       самую, где в польской редакции по сей день стоит «kwas ortofosorowy»
 *       без буквы f. Во французской строке консолидации теперь ►C11.
 *   32018R0669R(02) · DE · ABl. L 018, 27.1.2022, S. 130
 *       Исправляет заголовок столбца, не запись.
 *   32022R0692R(01) · все 23 языка · OJ L 146, 25.5.2022, p. 150
 *       ⚠ Чешская находка 615-050-00-4 ЭТОТ корриджендум пережила: ►C у строки
 *       нет. Качаем, чтобы сказать это утвердительно, а не по умолчанию.
 *
 * ⚠ Зачем они нужны: они доказывают, что механизм исправления к этому самому
 * акту уже применялся, и что ошибку такого же рода Бюро публикаций уже
 * признавало. Без них обращение выглядит как «нам кажется»; с ними — как
 * «вот ещё 27 случаев того, что вы уже трижды исправляли».
 */
const PRECEDENT_SET = [
  { celex: '32018R0669R(01)', langs: ['fr'] },
  { celex: '32018R0669R(02)', langs: ['de'] },
  { celex: '32022R0692R(01)', langs: ['cs'] },
]

const ISO3 = {
  bg: 'bul', cs: 'ces', da: 'dan', de: 'deu', el: 'ell', en: 'eng', es: 'spa',
  et: 'est', fi: 'fin', fr: 'fra', ga: 'gle', hr: 'hrv', hu: 'hun', it: 'ita',
  lt: 'lit', lv: 'lav', mt: 'mlt', nl: 'nld', pl: 'pol', pt: 'por', ro: 'ron',
  sk: 'slk', sl: 'slv', sv: 'swe',
}

// ⚠⚠ ТОЛЬКО ASCII. Заголовки HTTP — ByteString: любой символ выше 255 роняет
// fetch ещё ДО обращения к сети, с сообщением «character at index N». Длинное
// тире в честной подписи положило все 32 закачки session 58 разом.
//
// ⚠⚠ И ЭТО НЕ ЕДИНСТВЕННАЯ ПРИЧИНА ВЗЯТЬ БРАУЗЕРНУЮ СТРОКУ. Session 43 уже
// выяснила: со своим User-Agent EUR-Lex отдаёт 403 заметно чаще. Ставим ровно
// ту же строку, что в `download-clp-annexes.mjs`, — она проверена на 23 файлах.
// Указание источника, которого требует Decision 2011/833/EU, живёт на сайте
// рядом с данными, а не в заголовке запроса.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

/** ⚠ Ловим не-ASCII в ЛЮБОМ заголовке, а не только в UA: ошибка была именно такой. */
function assertAscii(headers) {
  for (const [k, v] of Object.entries(headers)) {
    if (/[^\x00-\xFF]/.test(String(v))) {
      throw new Error(`заголовок ${k} содержит не-ASCII — fetch упадёт: ${v}`)
    }
  }
  return headers
}

/** CELEX корриджендума содержит скобки — в адресе они обязаны быть закодированы. */
const enc = (celex) => celex.replace(/\(/g, '%28').replace(/\)/g, '%29')
/** …а в имени файла скобок быть не должно. */
const safe = (celex) => celex.replace(/[()]/g, '')

/**
 * ⭐⭐ ВИД ФАЙЛА У РАЗНЫХ АКТОВ РАЗНЫЙ — это выяснила разведка session 58.
 *
 *   32020R1182 · bg → `application/pdf` = 200
 *   32018R0669 · it → `application/pdf` = 404, а `application/xhtml+xml` = 200
 *
 * ⚠⚠ 404 ОТ CELLAR ЗНАЧИТ «НЕТ ТАКОГО ПРЕДСТАВЛЕНИЯ», А НЕ «НЕТ ДОКУМЕНТА».
 * Поэтому просим не один вид, а по очереди все, какие бывают. У 2018/669 PDF
 * нет, похоже, из-за размера: акт занимает 750 полос ОЖ.
 *
 * ⚠ Адреса самого eur-lex.europa.eu оставлены последними и, скорее всего,
 * бесполезны: они отвечают 200 и НУЛЬ БАЙТ — ровно то же, обо что споткнулась
 * session 57 на консолидации. Пусть остаются как последняя попытка.
 */
const ACCEPTS = {
  pdf: ['application/pdf', 'application/pdf;type=pdf1x', 'application/pdfa2a'],
  html: ['application/xhtml+xml', 'text/html', 'application/xml;type=fmx4'],
}

/**
 * ⭐⭐⭐ ПРЕДСТАВЛЕНИЕ МОЖНО НАЗВАТЬ ПРЯМО В АДРЕСЕ — суффиксом `.ISO3.тип`.
 *
 * Это выяснилось из описи `notice=branch` (session 58). У 32018R0669 согласование
 * содержимого на `application/pdf` отвечает 404, хотя PDF существует: в описи он
 * записан как `32018R0669.ITA.pdfa1a`, а файл внутри —
 * `l_11520180504it00010755.pdf`, где в имени зашиты выпуск, дата и полосы 1–755.
 *
 * ⚠⚠ ЗНАЧИТ «404 НА application/pdf» НЕ ОЗНАЧАЕТ ДАЖЕ «НЕТ ТАКОГО ВИДА». Оно
 * означает только, что согласование содержимого его не отдаёт. Спрашивать надо
 * адресом, а не заголовком.
 *
 * ⭐ Типы разные у разных лет: у 2018/669 это `pdfa1a`, у 2020/1182 — `pdfa2a`.
 * Поэтому перебираем оба.
 */
const SUFFIX = { pdf: ['pdfa1a', 'pdfa2a'], html: ['xhtml', 'fmx4'] }

function targets(celex, lang, kind) {
  const L = lang.toUpperCase()
  const e = enc(celex)
  const iso3 = ISO3[lang].toUpperCase()
  const direct = SUFFIX[kind].map((sfx) => ({
    url: `https://publications.europa.eu/resource/celex/${e}.${iso3}.${sfx}`,
    accept: kind === 'pdf' ? 'application/pdf' : 'application/xhtml+xml',
  }))
  const cellar = ACCEPTS[kind].map((accept) => ({
    url: `https://publications.europa.eu/resource/celex/${e}`, cellar: true, accept,
  }))
  return [
    ...direct,
    ...cellar,
    { url: `https://eur-lex.europa.eu/legal-content/${L}/TXT/${kind.toUpperCase()}/?uri=CELEX%3A${e}` },
    { url: `https://eur-lex.europa.eu/legal-content/${L}/TXT/${kind.toUpperCase()}/?uri=CELEX%3A${e}&from=${L}` },
  ]
}

/**
 * ⚠⚠ ПУСТОЕ ИЛИ КРОШЕЧНОЕ ТЕЛО — ЭТО НЕ УСПЕХ. Консолидация в session 57
 * отдавалась именно так: ответ 200 и ноль содержания. Порог разный по видам:
 * HTML акта — сотни килобайт, PDF корриджендума — законно может быть 60 КБ.
 */
const MIN_BYTES = { html: 20000, pdf: 20000 }

async function grab(celex, lang, kind) {
  const out = join(OUT_DIR, `act-${safe(celex)}-${lang}.${kind}`)
  try {
    const st = await stat(out)
    if (st.size > MIN_BYTES[kind]) {
      process.stdout.write(`  ${lang} ${kind}: уже лежит (${(st.size / 1024 / 1024).toFixed(1)} МБ) — пропускаю\n`)
      return true
    }
  } catch { /* нет файла — качаем */ }

  for (const t of targets(celex, lang, kind)) {
    const headers = assertAscii({
      'User-Agent': UA,
      Accept: t.accept ?? '*/*',
      'Accept-Language': t.cellar ? ISO3[lang] : lang,
    })
    process.stdout.write(`  ${lang} ${kind}: ${t.url.slice(0, 92)}…\n`)
    try {
      const res = await fetch(t.url, { headers, redirect: 'follow' })
      if (!res.ok) { process.stdout.write(`     ответ ${res.status}\n`); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < MIN_BYTES[kind]) {
        process.stdout.write(`     тело ${buf.length} байт — мало, пробую следующий адрес\n`); continue
      }
      // ⚠ Проверка вида: EUR-Lex на запрос PDF умеет отдать страницу-заглушку в HTML.
      if (kind === 'pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        process.stdout.write('     это не PDF (нет сигнатуры %PDF-), пробую следующий адрес\n'); continue
      }
      if (kind === 'html' && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
        process.stdout.write('     вернулся PDF вместо HTML, пробую следующий адрес\n'); continue
      }
      await writeFile(out, buf)
      process.stdout.write(`     ✓ ${out} — ${(buf.length / 1024 / 1024).toFixed(1)} МБ\n`)
      return true
    } catch (e) {
      process.stdout.write(`     ошибка: ${e.message}\n`)
      if (/certificate|self-signed|unable to verify/i.test(e.message)) {
        process.stdout.write('     ⚠⚠ похоже на подменённый сертификат — запусти с --use-system-ca\n')
      }
    }
  }
  process.stdout.write(`  ⚠ ${lang} ${kind}: не удалось\n`)
  return false
}

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const rest = argv.filter((a) => !a.startsWith('--'))

if (!rest.length) {
  console.log('Укажи CELEX и языки, либо слово errata для набора session 57/58.')
  console.log('Флаги: --pdf-only, --html-only, --no-precedents')
  process.exit(1)
}

const kinds = flags.has('--pdf-only') ? ['pdf'] : flags.has('--html-only') ? ['html'] : ['html', 'pdf']

await mkdir(OUT_DIR, { recursive: true })

const jobs = rest[0] === 'errata'
  ? (flags.has('--no-precedents') ? ERRATA_SET : [...ERRATA_SET, ...PRECEDENT_SET])
  : [{ celex: rest[0], langs: rest.slice(1).length ? rest.slice(1) : ['en'] }]

const total = jobs.reduce((n, j) => n + j.langs.length * kinds.length, 0)
console.log(`Всего файлов к скачиванию: ${total} (${kinds.join(' + ')})`)
console.log('⚠ 2018/669 — это акт, переведший ВСЕ имена Annex VI на 24 языка.')
console.log('  Каждый файл — десятки мегабайт. Наберись терпения, паузы намеренные.\n')

let ok = 0, fail = 0
for (const { celex, langs } of jobs) {
  console.log(`\n=== ${celex} — ${langs.length} яз. × ${kinds.length} вид.`)
  for (const lang of langs) {
    for (const kind of kinds) {
      if (await grab(celex, lang, kind)) ok++; else fail++
      await new Promise((r) => setTimeout(r, 1500)) // ⚠ не долбить EUR-Lex
    }
  }
}
console.log(`\nГотово: скачано ${ok}, не вышло ${fail}`)
console.log('Файлы в .tmp-eurlex/ с именами act-<CELEX>-<язык>.html и .pdf')
