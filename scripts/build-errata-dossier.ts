// scripts/build-errata-dossier.ts
//
// Собирает досье по 29 ошибкам Annex VI: по каждой — акт-источник, ссылка на
// выпуск ОЖ, дословная цитата акта, идентификаторы той же строки, английская
// редакция и запись, которой имя принадлежит на самом деле.
//
//     node --use-system-ca --import tsx scripts/build-errata-dossier.ts
//     → .tmp-eurlex/errata-dossier.md
//
// ⚠⚠ ПОЧЕМУ TypeScript, А НЕ PYTHON, КАК СВЕРЯЛКА. Свидетельства обязаны
// приходить ИЗ `annex6Errata.ts`, а не переписываться сюда: правило session 57 —
// «два текста об одном и том же неизбежно разойдутся». Из TS модуль
// импортируется как есть, из Python его пришлось бы разбирать регулярками.
//
// ⚠⚠ И НИ ОДНОГО СПИСКА, ВПИСАННОГО РУКАМИ. Ни CELEX актов, ни номера выпусков
// ОЖ, ни парные записи здесь не заданы — всё выводится из скачанных файлов:
//   — CELEX акта → ссылка внутри метки ▼M у самой строки консолидации;
//   — выпуск и дата ОЖ → шапка консолидации, там таблица «Изменён:»;
//   — «имя принадлежит записи X» → поиск того же имени у другой записи.
// Иначе досье пришлось бы править вручную при каждой новой консолидации, а оно
// и существует ради того, чтобы этого не делать.
//
// ⚠⚠ ЗАПУСК В ОБЛАКЕ: `--import tsx` НЕ РАБОТАЕТ. У `device_bash` Linux, а
// `node_modules` в репозитории поставлен под Windows: esbuild внутри tsx —
// нативный двоичный файл, и он там win32-x64. Поэтому импорт указывает файл
// с расширением `.ts`, и скрипт идёт встроенным срезанием типов Node 22:
//
//     node --experimental-strip-types scripts/build-errata-dossier.ts
//
// ⭐ На машине Сергея обычный `--import tsx` тоже сработает — расширение `.ts`
// в импорте ему не мешает.
//
// Досье — общий вход для двух вещей: обращения в Бюро публикаций и страницы
// `/compliance/clp-translation-errors/`.

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  ERRATA_INDEX_NUMBERS,
  ERRATUM_LEAD,
  erratumCitation,
  erratumFor,
  erratumLanguages,
  type ErratumKind,
} from '../src/lib/annex6Errata.ts'

const TMP = '.tmp-eurlex'

type Row = { name: string; ec: string; cas: string }
type Finding = {
  index: string
  lang: string
  kind: ErratumKind
  note: string
  celex: string
  mark: string
  oj: string
  page: number | null
  act: string
  actPair: string | null
  pairIndex: string | null
  row: Row | null
  en: string
  sourceEntry: string[]
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

/** ⚠ Мягкий перенос и неразрывный пробел у EUR-Lex меняются от файла к файлу и
 * смысла не несут. Не убрать их — утонуть в ложных расхождениях. */
function norm(s: string): string {
  return decode(stripTags(s)).normalize('NFC')
    .replace(/\u00AD/g, '').replace(/\u00A0|\u2009/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

/**
 * Ячейки строки таблицы, в которой стоит этот index-номер.
 *
 * ⚠⚠ ДВЕ ГРАБЛИ, ОБЕ ВСКРЫЛИСЬ НА ГОТОВОМ ДОСЬЕ.
 *
 * 1. **Первое вхождение номера — не обязательно строка таблицы.** У малых актов
 *    номера перечислены ещё и в тексте статьи («вписванията, съответстващи на
 *    поредни номера 007-004-00-1; 014-018-00-1; …»), и наивный поиск вытащил
 *    оттуда весь абзац вместо имени вещества. Поэтому проверяем: номер обязан
 *    стоять ПЕРВОЙ ячейкой строки, иначе ищем дальше.
 * 2. **Резать надо по `<td>`, а не по `<p>`.** В одной ячейке бывает несколько
 *    абзацев: имя и примечание §1.1.1.4 отдельными `<p>`. Резка по `<p>` их
 *    разводила по разным «ячейкам» и сдвигала всё вправо — EC оказывался в
 *    колонке CAS. ⚠ Пустые ячейки НЕ выбрасываем: без них съезжает нумерация
 *    у записей без номера EC.
 */
function rowOf(blob: string, index: string): { cells: string[]; at: number } | null {
  const re = new RegExp(index.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(blob))) {
    const a = blob.lastIndexOf('<tr', m.index)
    const b = blob.indexOf('</tr>', m.index)
    if (a < 0 || b < 0) continue
    const cells = [...blob.slice(a, b).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((c) => norm(c[1].replace(/<\/p>/g, '</p> ')))
    // ⚠ В первой ячейке рядом с номером бывает метка правки (►C11 … ◄), а в
    // тексте АКТА строка таблицы вдобавок открывается кавычкой: „007-004-00-1.
    // Кавычка там потому, что акт цитирует новую редакцию строки.
    const first = (cells[0] ?? '')
      .replace(/[►◄▼]\s*[BMC]?\d*/g, '')
      .replace(/^[„"“«\s]+|[”“"»\s]+$/g, '')
      .trim()
    if (first === index) return { cells, at: m.index }
  }
  return null
}

/** Акт-источник строки: ближайшая предшествующая метка правки. ⭐ CELEX лежит
 * прямо в её разметке — ни шапку разбирать, ни угадывать не нужно. */
function markerBefore(blob: string, at: number): { mark: string; celex: string } {
  const re = /<p class="modref">([\s\S]*?)<\/p>/g
  let best = { mark: 'B', celex: '' }
  let m: RegExpExecArray | null
  while ((m = re.exec(blob))) {
    if (m.index >= at) break
    const tag = /[▼►]([BMC]\d*)/.exec(m[1])
    const cel = /celex\/([^"']+)/.exec(m[1])
    if (tag) best = { mark: tag[1], celex: cel ? decodeURIComponent(cel[1]) : '' }
  }
  return best
}

/** Выпуск и дата ОЖ — из таблицы «Изменён:» в шапке консолидации. */
function ojRefFor(blob: string, mark: string): string {
  const head = stripTags(blob.slice(0, 400_000)).split('\n')
    .map((l) => l.trim()).filter(Boolean)
  const i = head.findIndex((l) => l === `►${mark}` || l === mark)
  if (i < 0) return ''
  const win = head.slice(i, i + 9)
  const oj = win.find((l) => /^L\s*\d+$/.test(l))
  const date = win.find((l) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(l))
  const title = win.find((l) => /\d{4}\/\d+|\bN[oº°]?\s*\d+\/\d{4}/.test(l)) ?? ''
  return [title, oj && `ОЖ ${oj}`, date].filter(Boolean).join(', ')
}

/**
 * Запись, которой имя принадлежит на самом деле: то же имя у другого номера
 * внутри той же редакции. ⭐ Тот самый признак, которым находки и были найдены
 * (`GROUP BY lang, name`), поэтому он же годится, чтобы назвать источник.
 */
function sameNameElsewhere(blob: string, index: string, name: string): string[] {
  if (!name) return []
  const re = new RegExp(`<p[^>]*>${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`, 'g')
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(blob))) {
    const a = blob.lastIndexOf('<tr', m.index)
    const idx = /(\d{3}-\d{3}-\d{2}-[\dX])/.exec(stripTags(blob.slice(a, m.index)))
    if (idx && idx[1] !== index && !found.includes(idx[1])) found.push(idx[1])
  }
  return found
}

/** Номер полосы в PDF-факсимиле — там, где PDF-представление вообще есть. */
function pdfPage(celex: string, lang: string, index: string): number | null {
  const pdf = join(TMP, `act-${celex.replace(/[()]/g, '')}-${lang.toLowerCase()}.pdf`)
  if (!existsSync(pdf)) return null
  const txt = pdf.replace(/\.pdf$/, '.txt')
  if (!existsSync(txt) || statSync(txt).mtimeMs < statSync(pdf).mtimeMs) {
    execFileSync('pdftotext', ['-layout', pdf, txt])
  }
  const pages = readFileSync(txt, 'utf8').split('\f')
  const n = pages.findIndex((p) => p.includes(index))
  return n < 0 ? null : n + 1
}

function actBlob(celex: string, lang: string): string | null {
  const h = join(TMP, `act-${celex.replace(/[()]/g, '')}-${lang.toLowerCase()}.html`)
  return existsSync(h) ? readFileSync(h, 'utf8') : null
}

// ── сбор ────────────────────────────────────────────────────────────────────

// ⚠ Английские имена вынимаем ОДНИМ проходом и файл отпускаем: держать 13
// консолидаций по 29 МБ разом — под гигабайт в памяти на пустом месте.
const enNames = new Map<string, string>()
{
  const en = readFileSync(join(TMP, 'clp-consolidated.html'), 'utf8')
  for (const index of ERRATA_INDEX_NUMBERS) {
    const r = rowOf(en, index)
    enNames.set(index, r && r.cells.length > 1 ? r.cells[1] : '')
  }
}

const byLang = new Map<string, string[]>()
for (const index of ERRATA_INDEX_NUMBERS) {
  for (const lang of erratumLanguages(index)) {
    byLang.set(lang, [...(byLang.get(lang) ?? []), index])
  }
}

const findings: Finding[] = []
const srcMismatch: string[] = []
for (const [lang, indexes] of [...byLang].sort()) {
  const consPath = join(TMP, `clp-consolidated-${lang.toLowerCase()}.html`)
  if (!existsSync(consPath)) {
    console.error(`⚠ нет консолидации ${lang}`)
    continue
  }
  const cons = readFileSync(consPath, 'utf8')
  const actCache = new Map<string, string | null>()

  for (const index of indexes) {
    const e = erratumFor(index, lang)!
    const r = rowOf(cons, index)
    if (!r) { console.error(`⚠ ${lang} ${index}: строки нет в консолидации`); continue }
    const { mark, celex } = markerBefore(cons, r.at)
    if (!actCache.has(celex)) actCache.set(celex, actBlob(celex, lang))
    const act = actCache.get(celex)!

    const name = r.cells[1] ?? ''
    const actRow = act ? rowOf(act, index) : null
    const actName = actRow && actRow.cells.length > 1 ? actRow.cells[1] : ''

    // ⚠⚠ ПАРНУЮ ЗАПИСЬ БЕРЁМ ИЗ СВИДЕТЕЛЬСТВА, А НЕ ИЗ НОМЕРА. Первая попытка
    // выводила её из «той же серии с другим суффиксом» (603-221-00-6 ↔
    // 603-221-01-3) — и молча промахнулась там, где пара устроена иначе:
    // 007-004-00-1 ↔ 007-030-00-3, 615-050-00-4 ↔ 615-049-00-9. Серия у них
    // разная, и признак не сработал БЕЗ ОШИБКИ — просто дал пусто.
    // ⭐ В свидетельстве парная запись названа номером, и это единственный
    // источник, который знает про неё правду.
    const noted = (e.note.match(/\d{3}-\d{3}-\d{2}-[\dX]/g) ?? []).find((x) => x !== index) ?? null
    const pairIndex = e.kind === 'wrong-qualifier' ? noted : null
    const pairRow = pairIndex && act ? rowOf(act, pairIndex) : null

    findings.push({
      index, lang, kind: e.kind, note: e.note, celex, mark,
      oj: ojRefFor(cons, mark),
      page: pdfPage(celex, lang, index),
      act: actName,
      actPair: pairRow && pairRow.cells.length > 1 ? pairRow.cells[1] : null,
      pairIndex,
      row: { name, ec: r.cells[2] ?? '', cas: r.cells[3] ?? '' },
      en: enNames.get(index) ?? '',
      sourceEntry: e.kind === 'foreign-name' ? sameNameElsewhere(cons, index, name) : [],
    })

    // ⭐⭐⭐ СТОРОЖ ССЫЛКИ НА ОЖ. Акт, выпуск и полоса лежат в `annex6Errata.ts`
    // и печатаются на живых страницах. Здесь они выводятся ЗАНОВО из файлов, и
    // расхождение обязано быть громким: страница обвиняет официальный текст и
    // зовёт читателя проверить по указанной полосе. Неверная полоса хуже
    // отсутствующей — она подрывает доверие именно там, где оно нужно.
    const want = findings[findings.length - 1]
    const bad: string[] = []
    if (e.source.act !== want.celex) bad.push(`акт ${e.source.act} против ${want.celex}`)
    // ⚠ Выпуск ОЖ в шапке консолидации локализован (ОЖ / JO / ABl.), поэтому
    // сверяются АКТ и ПОЛОСА — они языконезависимы.
    if (want.page !== null && e.source.page !== want.page) {
      bad.push(`полоса ${e.source.page} против ${want.page}`)
    }
    if (bad.length) {
      srcMismatch.push(`${lang} ${index}: ${bad.join(', ')}`)
    }

    // ⭐⭐ ПЕРЕКРЁСТНАЯ ПРОВЕРКА: запись, выведенная механически по совпадению
    // имени, обязана совпасть с той, что названа в свидетельстве вручную.
    // Расходятся — значит либо курирование session 57 ошиблось, либо мой вывод.
    // Молчать об этом нельзя: досье пойдёт в обращение.
    // ⚠ Сравнивать надо со ВСЕМ набором совпадений, а не с первым. У цирама
    // одно имя стоит у ТРЁХ записей, и «первое совпадение» естественно
    // расходилось со свидетельством, не означая ошибки. Тревога — только когда
    // названной записи среди совпадений нет вовсе.
    const last = findings[findings.length - 1]
    if (last.kind === 'foreign-name' && noted && last.sourceEntry.length
        && !last.sourceEntry.includes(noted)) {
      console.error(`⚠⚠ ${lang} ${index}: свидетельство называет ${noted}, ` +
        `а то же имя стоит у ${last.sourceEntry.join(', ')}`)
    }
  }
}

// ── вывод ───────────────────────────────────────────────────────────────────

const KIND_RU: Record<ErratumKind, string> = {
  'foreign-name': 'имя другой записи',
  'foreign-designation': 'чужая составляющая составного имени',
  'wrong-qualifier': 'перевёрнутое примечание §1.1.1.4',
  typo: 'опечатка набора',
}

const out: string[] = []
out.push('# Досье: 29 ошибок в языковых редакциях Annex VI CLP')
out.push('')
out.push('Собрано `scripts/build-errata-dossier.ts` из скачанных актов ОЖ.')
out.push('⚠ Ни один список здесь не вписан руками: CELEX акта, выпуск ОЖ, парная')
out.push('запись и «имя принадлежит записи X» выводятся из самих файлов.')
out.push('')
out.push(`Находок: **${findings.length}**. Актов: **${new Set(findings.map((f) => f.celex)).size}**.`)
out.push('')

for (const kind of ['foreign-name', 'foreign-designation', 'wrong-qualifier', 'typo'] as ErratumKind[]) {
  const group = findings.filter((f) => f.kind === kind)
  out.push(`## ${KIND_RU[kind]} — ${group.length}`)
  out.push('')
  out.push(`Заголовок пометки на сайте: «${ERRATUM_LEAD[kind]}»`)
  out.push('')
  for (const f of group) {
    out.push(`### ${f.index} · ${f.lang}`)
    out.push('')
    out.push(`**Акт:** ${f.celex} (метка ${f.mark})${f.oj ? ` — ${f.oj}` : ''}` +
      `${f.page ? `, полоса ${f.page}` : ''}`)
    out.push('')
    out.push(`**Цитата для обращения:** ${erratumCitation(erratumFor(f.index, f.lang)!)}`)
    out.push('')
    out.push('**Напечатано в акте:**')
    out.push('')
    out.push('```')
    out.push(f.act || '⚠ акт не скачан — цитата из консолидации: ' + f.row?.name)
    out.push('```')
    out.push('')
    if (f.act && f.row && f.act !== f.row.name) {
      out.push(`⚠ **Консолидация печатает иначе:** \`${f.row.name}\``)
      out.push('')
    }
    out.push(`**Идентификаторы той же строки:** EC \`${f.row?.ec || '—'}\` · CAS \`${f.row?.cas || '—'}\``)
    out.push('')
    out.push(`**Английская редакция:** ${f.en || '—'}`)
    out.push('')
    if (f.sourceEntry.length) {
      out.push(`**То же имя стоит у ${f.sourceEntry.length > 1 ? 'записей' : 'записи'}:** `
        + f.sourceEntry.map((x) => `\`${x}\``).join(', '))
      out.push('')
    }
    if (f.pairIndex) {
      const same = f.actPair && f.actPair === f.act
      out.push(`**Парная запись \`${f.pairIndex}\`:** ${same ? '⚠ в акте напечатано ТО ЖЕ САМОЕ' : 'печатает иначе'}`)
      if (f.actPair) {
        out.push('')
        out.push('```')
        out.push(f.actPair)
        out.push('```')
      }
      out.push('')
    }
    out.push('**Свидетельство (annex6Errata.ts):** ' + f.note)
    out.push('')
  }
}

if (srcMismatch.length) {
  console.error(`\n⚠⚠ ССЫЛКА НА ОЖ В МОДУЛЕ РАСХОДИТСЯ С ФАЙЛАМИ — ${srcMismatch.length}:`)
  for (const m of srcMismatch) console.error('   ' + m)
  console.error('   Досье НЕ записано: чинить надо модуль или скачанные акты, а не отчёт.')
  process.exit(1)
}

// ⭐ Тот же материал машиночитаемо — из него собирается подача в ECHA.
// ⚠ Отдельного генератора для неё НЕТ намеренно: подача, письмо и страницы
// обязаны говорить одно и то же, а для этого им нужен один источник.
writeFileSync(join(TMP, 'errata-dossier.json'), JSON.stringify(findings.map((f) => ({
  index: f.index,
  lang: f.lang,
  kind: f.kind,
  note: f.note,
  citation: erratumCitation(erratumFor(f.index, f.lang)!),
  act: f.celex,
  oj: f.oj,
  page: f.page,
  publishedName: f.act || f.row?.name || '',
  ec: f.row?.ec ?? '',
  cas: f.row?.cas ?? '',
  en: f.en,
  pairIndex: f.pairIndex,
  pairName: f.actPair,
  sourceEntry: f.sourceEntry,
})), null, 1), 'utf8')

const dest = join(TMP, 'errata-dossier.md')
writeFileSync(dest, out.join('\n'), 'utf8')
console.log(`✓ ${dest} — ${findings.length} находок, ${out.length} строк`)
const noAct = findings.filter((f) => !f.act)
if (noAct.length) {
  console.log(`⚠ без текста акта: ${noAct.length} — ${noAct.map((f) => `${f.lang} ${f.index}`).join(', ')}`)
}
const noPage = findings.filter((f) => f.page === null)
if (noPage.length) {
  console.log(`⚠ без номера полосы: ${noPage.length} из ${findings.length} — ` +
    noPage.map((f) => `${f.lang} ${f.index}`).join(', '))
  console.log('  ⭐ Полоса берётся из PDF акта. Нет PDF — скачать его умеет')
  console.log('     scripts/download-oj-pdf.mjs: он спрашивает адрес у описи CELLAR.')
} else {
  console.log(`⭐ полоса ОЖ есть у всех ${findings.length} находок`)
}
