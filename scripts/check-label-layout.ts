/**
 * scripts/check-label-layout.ts — проверка ДВИЖКА ЭТИКЕТКИ прогоном самой функции.
 *
 * Запуск из корня ghspictograms, сборка НЕ нужна:
 *   npm run check:label-layout
 *   npm run check:label-layout -- --only marks
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ЗАЧЕМ ОНА ВООБЩЕ. Этикетка конструктора рисуется В БРАУЗЕРЕ, поэтому её не
 * видит ни одна из 97 проверок `check:dist` — те смотрят собранный HTML. За
 * session 48 в движке нашлось ТРИ дефекта, и все три нашлись ОТРИСОВКОЙ, а не
 * чтением кода:
 *   • рамка была алой ВСЕГДА, даже у пустой заготовки и при «Warning»;
 *   • степень опасности выводилась из напечатанного слова, и немецкое «Gefahr»
 *     разбиралось как warning — этикетка уровня Danger печаталась янтарной;
 *   • комбинированные P-коды («P305+P351+P338», четырнадцать знаков) НАЛЕЗАЛИ
 *     на текст фразы — в цифрах ширина колонки выглядела безобидно.
 * В session 49 к ним добавилось четвёртое: на этикетку попадали указания
 * поставщику — «<Expositionsweg angeben…>» и «Keep wetted with …».
 *
 * Этот файл ловит все четыре класса разом, потому что гоняет НАСТОЯЩУЮ
 * `layoutLabel` на НАСТОЯЩИХ текстах из базы и смотрит на то, что она выдала.
 *
 * ⚠⚠ ТЕКСТЫ БЕРУТСЯ ИЗ БАЗЫ, А НЕ ПРИДУМЫВАЮТСЯ. Пропуски «<…>» и «…» видны
 * только на настоящем тексте: в session 49 я сначала прогонял движок на своих
 * строках и не видел ничего.
 *
 * Код возврата: 0 — всё сошлось; 1 — есть провал или сломалась сама проверка.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ⚠⚠ Всё берётся ИЗ ТЕХ ЖЕ модулей, что стоят в конструкторе. Списать сюда
// формулу ширины или правило пропусков — значит завести вторую копию, которая
// разойдётся молча и начнёт подтверждать не то, что печатается.
import {
  layoutLabel, textWidthMm,
  type LabelInput, type LabelLayout, type DrawText, type DrawRect, type Statement,
  type SignalLevel,
} from '../src/lib/labelEngine'
import { JURISDICTIONS, type JurisdictionKey, type LabelPurpose } from '../src/lib/jurisdictions'
import { renderStatement } from '../src/lib/statementPlaceholders'
import { renderPStatement } from '../src/lib/pStatementSlots'

config({ path: resolve(process.cwd(), '.env.local') })
config()

const ARGV = process.argv.slice(2)
function argValue(name: string): string | null {
  const i = ARGV.indexOf(`--${name}`)
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : null
}
const ONLY = argValue('only')

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? ''
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY ?? ''
if (!supabaseUrl || !supabaseKey) {
  console.error('Нет PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY в .env.local')
  process.exit(1)
}
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey)

/** ⚠ Ошибку запроса НЕ глотаем: пустой ответ и закрытый доступ выглядят одинаково. */
async function rows<T>(table: string, columns: string, tweak: (q: any) => any = (q) => q): Promise<T[]> {
  const { data, error } = await tweak(supabase.from(table).select(columns))
  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []) as T[]
}

// ─────────────────────────── цвета движка ───────────────────────────
// ⚠ Значения повторены здесь СОЗНАТЕЛЬНО и с проверкой: движок держит их
// приватными константами, а проверка обязана утверждать конкретный цвет, иначе
// она согласится с любым. Разойдутся — упадёт цветовая проверка, а не молча.
const RULE = '#d1d5db'
const DANGER = '#dc2626'
// ⚠ WARNING (#b45309) убран: с session 62 рамка алая при любой степени.

// ─────────────────────────── утверждения ───────────────────────────

type Fail = { case: string; what: string }

const texts = (l: LabelLayout): DrawText[] => l.items.filter((i): i is DrawText => i.t === 'text')

/**
 * ⭐⭐ ГЛАВНОЕ УТВЕРЖДЕНИЕ ВСЕГО ФАЙЛА, И САМОЕ ДЕШЁВОЕ.
 *
 * Ни одна напечатанная строка не несёт указания поставщику. Одна строка кода
 * ловит все 11 H-кодов с угловыми скобками и все 24 P-кода с многоточием —
 * включая латышские две точки и литовское «(kuo)».
 */
const SUPPLIER_MARK = /[<>\[\]]|…|\.\.|\(kuo\)/

function assertNoMarks(name: string, l: LabelLayout, out: Fail[]): void {
  for (const t of texts(l)) {
    if (SUPPLIER_MARK.test(t.s)) out.push({ case: name, what: `указание поставщику на этикетке: ${JSON.stringify(t.s)}` })
  }
}

/**
 * Наложение кода на текст фразы.
 *
 * ⚠ Сравниваются строки НА ОДНОЙ БАЗОВОЙ ЛИНИИ: код печатается от левого края,
 * текст — от края колонки, и оба с одним `y`. Если правый край кода зашёл за
 * начало текста, на бумаге буквы лезут друг на друга.
 * ⚠ Допуск 0,05 мм — на счётные погрешности с плавающей точкой, не на дефект.
 */
function assertNoOverlap(name: string, l: LabelLayout, out: Fail[]): void {
  const byLine = new Map<string, DrawText[]>()
  for (const t of texts(l)) {
    if (t.anchor === 'middle') continue // выключка по центру — свои правила
    const key = t.y.toFixed(3)
    ;(byLine.get(key) ?? byLine.set(key, []).get(key)!).push(t)
  }
  for (const [, line] of byLine) {
    if (line.length < 2) continue
    const sorted = [...line].sort((a, b) => a.x - b.x)
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      const kind = a.mono ? 'mono' : a.bold ? 'bold' : 'regular'
      const right = a.x + textWidthMm(a.s, a.size, kind)
      if (right > b.x + 0.05) {
        out.push({
          case: name,
          what: `налезают на одной строке: ${JSON.stringify(a.s)} кончается на ${right.toFixed(2)} мм, `
            + `${JSON.stringify(b.s)} начинается на ${b.x.toFixed(2)} мм`,
        })
      }
    }
  }
}

/**
 * Цвет рамки — ДАННЫЕ, а не украшение.
 *
 * ⚠⚠ Алая рамка заявляет опасность. У пустой заготовки и у вещества без
 * классификации сигнального слова нет, и рамка обязана быть нейтральной серой.
 *
 * ⛔⛔ ПОПРАВКА SESSION 64: ЭТА ПРОВЕРКА ОТСТАЛА ОТ ДВИЖКА НА ДВА КОММИТА.
 *
 * Она требовала янтарной рамки при степени `warning`, а `frameColor` с коммита
 * `f10e497` («red label frame») возвращает алую при ЛЮБОЙ степени. Это решение
 * Сергея (session 62): этикетка должна узнаваться через комнату независимо от
 * степени, заодно с красной рамкой пиктограммы. Движок был прав, проверка —
 * нет, и падала она на всех 24 случаях со дня того коммита.
 *
 * ⚠ Утверждение при этом НЕ ослаблено: различие «классифицировано / нет»
 * осталось, и именно оно содержательно. Ослабить его — значит разрешить алую
 * рамку на товаре без классификации, то есть ложное заявление об опасности.
 *
 * ⚠ Регламент цвет рамки ЭТИКЕТКИ не задаёт вовсе (проверено по 29 CFR
 * 1910.1200 App. C: красная рамка предписана только пиктограмме). Значит это
 * решение оформления, и менять его можно — но тогда правится `frameColor`
 * в движке И это место, вместе.
 */
function assertFrame(name: string, l: LabelLayout, level: SignalLevel | null, out: Fail[]): void {
  const rects = l.items.filter((i): i is DrawRect => i.t === 'rect' && Boolean(i.stroke))
  if (!rects.length) { out.push({ case: name, what: 'рамки нет вовсе' }); return }
  const frame = rects.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))
  const want = level ? DANGER : RULE
  if (frame.stroke !== want) {
    out.push({ case: name, what: `рамка ${frame.stroke} при степени ${level ?? 'нет'} — ждали ${want}` })
  }
}

/** Обещал `fits` — значит всё внутри поля этикетки. */
function assertInside(name: string, l: LabelLayout, out: Fail[]): void {
  if (!l.fit.fits) return
  for (const t of texts(l)) {
    const kind = t.mono ? 'mono' : t.bold ? 'bold' : 'regular'
    const right = t.x + (t.anchor === 'middle' ? 0 : textWidthMm(t.s, t.size, kind))
    if (t.x < -0.01 || right > l.widthMm + 0.05 || t.y < -0.01 || t.y > l.heightMm + 0.05) {
      out.push({
        case: name,
        what: `при fits=true строка вышла за поле ${l.widthMm}×${l.heightMm}: `
          + `${JSON.stringify(t.s)} на x=${t.x.toFixed(2)}..${right.toFixed(2)} y=${t.y.toFixed(2)}`,
      })
    }
  }
}

// ─────────────────────────── сборка входа ───────────────────────────

type Row = { code: string; text_en: string }
type Tr = { code: string; lang: string; text: string }

/**
 * Фразы, прошедшие ТОТ ЖЕ путь, что и в конструкторе.
 *
 * ⚠⚠ Значения пропусков ПУСТЫЕ — это худший случай и он же самый частый:
 * поставщик открыл инструмент и ничего не вписал. Фраза с незаполненным
 * обязательным пропуском тут же выбрасывается, как и в конструкторе.
 */
function renderH(list: Row[], lang: string, pick: (r: Row) => string): Statement[] {
  return list
    .map((r) => renderStatement(pick(r), r.code, lang, {}))
    .filter((r) => !r.suppressed)
    .map((r) => ({ code: r.code, text: r.text }))
}

function renderP(list: Row[], lang: string, pick: (r: Row) => string): Statement[] {
  return list
    .map((r) => ({ code: r.code, r: renderPStatement(pick(r), r.code, lang, [], false) }))
    .filter((x) => !x.r.suppressed)
    .map((x) => ({ code: x.code, text: x.r.text }))
}

function baseInput(over: Partial<LabelInput> = {}): LabelInput {
  return {
    productName: 'Aniline',
    casNumber: '62-53-3',
    ecNumber: '200-539-3',
    signalWord: null,
    signalLevel: null,
    pictograms: [],
    hStatements: [],
    pStatements: [],
    pFormat: 'codes',
    supplier: { name: 'ACME Chemicals', address: '1 Industrial Rd, Houston, TX', phone: '+1 800 000 0000' },
    notes: [],
    ...over,
  }
}

const SIZES: [number, number][] = [[52, 74], [40, 25], [100, 70], [210, 297]]
// ⚠ Канада берётся не для полноты: там второй язык ОБЯЗАТЕЛЕН, и подача
// второго блока там равноправная — другая ветка кода.
const JURIS: JurisdictionKey[] = ['clp', 'osha', 'whmis']

// ─────────────────────────── проверки ───────────────────────────

type Result = { id: string; group: string; ok: boolean; headline: string; detail: string[] }
type Check = { id: string; group: string; title: string; run: () => Promise<Result> }

const CHECKS: Check[] = []

/** Общий прогон: один вход × все размеры × обе юрисдикции. */
function sweep(name: string, input: LabelInput, level: SignalLevel | null, out: Fail[]): number {
  let n = 0
  for (const j of JURIS) {
    for (const [w, h] of SIZES) {
      for (const purpose of ['supplier', 'workplace'] as LabelPurpose[]) {
        const l = layoutLabel(input, { jurisdiction: j, purpose, widthMm: w, heightMm: h })
        const tag = `${name} · ${JURISDICTIONS[j].tag} · ${w}×${h} · ${purpose}`
        assertNoMarks(tag, l, out)
        assertNoOverlap(tag, l, out)
        assertFrame(tag, l, level, out)
        assertInside(tag, l, out)
        n++
      }
    }
  }
  return n
}

CHECKS.push({
  id: 'marks',
  group: 'Указания поставщику',
  title: 'Ни одна напечатанная строка не несёт указания поставщику',
  async run() {
    const h = await rows<Row>('h_statements', 'code, text_en', (q) => q.like('text_en', '%<%'))
    // ⚠⚠ КОМБИНИРОВАННЫЕ ФРАЗЫ ЛЕЖАТ В ОТДЕЛЬНОЙ ТАБЛИЦЕ. Первая версия этой
    // проверки искала их как `code like '%+%'` в `p_statements` и не находила
    // НИЧЕГО — то есть уверенно подтверждала пустоту. Именно так и выглядит
    // проверка, которая ошибается молча.
    const pSingle = await rows<Row>('p_statements', 'code, text_en', (q) => q.or('text_en.like.%…%,text_en.like.%...%,text_en.like.%[%'))
    const pCombo = await rows<Row>('p_statement_combinations', 'code, text_en', (q) => q.or('text_en.like.%…%,text_en.like.%...%,text_en.like.%[%'))
    const p = [...pSingle, ...pCombo]
    const tr = await rows<Tr>('statement_translations', 'code, lang, text', (q) =>
      q.in('lang', ['DE', 'HU', 'LV', 'LT', 'IT']).in('code', [...h.map((x) => x.code), ...p.map((x) => x.code)]))

    const fails: Fail[] = []
    let runs = 0

    // Английский блок: ВСЕ коды с пропусками сразу, значения пустые.
    runs += sweep('EN, все коды с пропусками', baseInput({
      signalWord: 'Danger', signalLevel: 'danger',
      hStatements: renderH(h, 'EN', (r) => r.text_en),
      pStatements: renderP(p, 'EN', (r) => r.text_en),
    }), 'danger', fails)

    // ⚠ Второй язык — по одному прогону на язык. Венгерский и латышский тут не
    // для полноты: у HU другой ПОРЯДОК слотов, у LV знак напечатан двумя точками.
    for (const lang of ['DE', 'HU', 'LV', 'LT', 'IT']) {
      const byCode = new Map(tr.filter((t) => t.lang === lang).map((t) => [t.code, t.text]))
      const hh = h.filter((x) => byCode.has(x.code))
      const pp = p.filter((x) => byCode.has(x.code))
      runs += sweep(`второй язык ${lang}`, baseInput({
        signalWord: 'Danger', signalLevel: 'danger',
        hStatements: renderH(h, 'EN', (r) => r.text_en),
        pStatements: renderP(p, 'EN', (r) => r.text_en),
        second: {
          langTag: lang,
          signalWord: 'GEFAHR',
          equal: true,
          hStatements: renderH(hh, lang, (r) => byCode.get(r.code)!),
          pStatements: renderP(pp, lang, (r) => byCode.get(r.code)!),
        },
      }), 'danger', fails)
    }

    return {
      id: 'marks', group: 'Указания поставщику', ok: fails.length === 0,
      headline: fails.length === 0
        ? `${runs} раскладок, ни одного знака на этикетке`
        : `${fails.length} строк с указанием поставщику`,
      detail: fails.length === 0
        ? [
            `кодов H с угловыми скобками: ${h.length}, кодов P со знаком: ${p.length}`,
            'ловится всё разом: < > [ ] … .. (kuo) — знак пропуска бывает четырёх видов',
          ]
        : fails.slice(0, 12).map((f) => `${f.case}: ${f.what}`),
    }
  },
})

CHECKS.push({
  id: 'overlap',
  group: 'Раскладка',
  title: 'Код фразы не налезает на её текст',
  async run() {
    // ⚠ Комбинированные коды — главный случай: «P305+P351+P338» это 14 знаков,
    // вдвое шире колонки, рассчитанной на «H225».
    // ⚠⚠ Комбинированные коды живут в СВОИХ таблицах, а не в `p_statements`
    // с плюсом в коде. Проверка, искавшая их с `like '%+%'`, находила ноль строк
    // и «сходилась» ни на чём. ⭐ Самый длинный код в базе — «P370+P372+P380+P373»,
    // девятнадцать знаков: он и есть худший случай для колонки кодов.
    const p = await rows<Row>('p_statement_combinations', 'code, text_en')
    const h = await rows<Row>('h_statement_combinations', 'code, text_en')
    const hPlain = await rows<Row>('h_statements', 'code, text_en', (q) => q.in('code', ['H225', 'H314', 'H360FD']))

    const fails: Fail[] = []
    let runs = 0
    runs += sweep('комбинированные P-коды', baseInput({
      signalWord: 'Danger', signalLevel: 'danger',
      hStatements: renderH([...h, ...hPlain], 'EN', (r) => r.text_en),
      pStatements: renderP(p, 'EN', (r) => r.text_en),
    }), 'danger', fails)

    // Тот же набор со вторым языком: во втором блоке колонка кодов та же.
    if (p.length === 0 || h.length === 0) {
      throw new Error('комбинированных кодов не нашлось — проверка бы «сошлась» ни на чём')
    }
    const tr = await rows<Tr>('statement_translations', 'code, lang, text', (q) =>
      q.eq('lang', 'DE').in('code', [...p.map((x) => x.code), ...h.map((x) => x.code)]))
    const byCode = new Map(tr.map((t) => [t.code, t.text]))
    runs += sweep('комбинированные + второй язык', baseInput({
      signalWord: 'Danger', signalLevel: 'danger',
      hStatements: renderH([...h, ...hPlain], 'EN', (r) => r.text_en),
      pStatements: renderP(p, 'EN', (r) => r.text_en),
      second: {
        langTag: 'DE', signalWord: 'GEFAHR', equal: true,
        hStatements: renderH(h.filter((x) => byCode.has(x.code)), 'DE', (r) => byCode.get(r.code)!),
        pStatements: renderP(p.filter((x) => byCode.has(x.code)), 'DE', (r) => byCode.get(r.code)!),
      },
    }), 'danger', fails)

    return {
      id: 'overlap', group: 'Раскладка', ok: fails.length === 0,
      headline: fails.length === 0
        ? `${runs} раскладок, наложений нет`
        : `${fails.length} наложений`,
      detail: fails.length === 0
        ? [
            `комбинированных P-кодов: ${p.length}, H: ${h.length}; самый длинный — `
            + `${p.concat(h).reduce((a, b) => (a.code.length >= b.code.length ? a : b)).code}`,
            'ширина строки считается ТОЙ ЖЕ мерой, что и переносы в движке (textWidthMm)',
          ]
        : fails.slice(0, 12).map((f) => `${f.case}: ${f.what}`),
    }
  },
})

CHECKS.push({
  id: 'frame',
  group: 'Раскладка',
  title: 'Цвет рамки идёт от степени опасности, а не стоит алым всегда',
  async run() {
    const h = await rows<Row>('h_statements', 'code, text_en', (q) => q.in('code', ['H225', 'H319']))
    const fails: Fail[] = []
    let runs = 0

    // ⚠⚠ Пустая заготовка — тот самый случай, на котором дефект жил: сигнального
    // слова нет, а рамка печаталась алой, то есть заявляла опасность.
    runs += sweep('пустая заготовка', baseInput(), null, fails)
    runs += sweep('Warning', baseInput({
      signalWord: 'Warning', signalLevel: 'warning',
      hStatements: renderH(h, 'EN', (r) => r.text_en),
    }), 'warning', fails)
    runs += sweep('Danger', baseInput({
      signalWord: 'Danger', signalLevel: 'danger',
      hStatements: renderH(h, 'EN', (r) => r.text_en),
    }), 'danger', fails)

    // ⭐⭐ Тот случай, ради которого заведено поле signalLevel: слово НЕ английское.
    // Разбор строки отдал бы для «Gefahr» янтарный, то есть соврал бы цветом.
    runs += sweep('слово Gefahr при степени danger', baseInput({
      signalWord: 'Gefahr', signalLevel: 'danger',
      hStatements: renderH(h, 'EN', (r) => r.text_en),
    }), 'danger', fails)
    runs += sweep('слово Vaara при степени danger', baseInput({
      signalWord: 'Vaara', signalLevel: 'danger',
      hStatements: renderH(h, 'EN', (r) => r.text_en),
    }), 'danger', fails)

    return {
      id: 'frame', group: 'Раскладка', ok: fails.length === 0,
      headline: fails.length === 0 ? `${runs} раскладок, цвет рамки везде по данным` : `${fails.length} расхождений`,
      detail: fails.length === 0
        ? [
            'серая при отсутствии слова, янтарная при Warning, алая при Danger',
            'нерусские слова Gefahr и Vaara проверены отдельно: разбор строки соврал бы',
          ]
        : fails.slice(0, 12).map((f) => `${f.case}: ${f.what}`),
    }
  },
})

CHECKS.push({
  id: 'fit',
  group: 'Раскладка',
  title: 'Обещал fits — значит всё внутри поля этикетки',
  async run() {
    const h = await rows<Row>('h_statements', 'code, text_en', (q) => q.limit(12))
    const p = await rows<Row>('p_statements', 'code, text_en', (q) => q.limit(20))
    const fails: Fail[] = []
    let runs = 0
    let fitted = 0

    for (const [w, hh] of [...SIZES, [30, 20], [25, 15]] as [number, number][]) {
      for (const pFormat of ['codes', 'combined'] as const) {
        const input = baseInput({
          signalWord: 'Danger', signalLevel: 'danger',
          hStatements: renderH(h, 'EN', (r) => r.text_en),
          pStatements: renderP(p, 'EN', (r) => r.text_en),
          pFormat,
          combinedPText: pFormat === 'combined'
            ? renderP(p, 'EN', (r) => r.text_en).map((x) => x.text).join(' ')
            : undefined,
        })
        const l = layoutLabel(input, { jurisdiction: 'clp', purpose: 'supplier', widthMm: w, heightMm: hh })
        assertInside(`${w}×${hh} · ${pFormat}`, l, fails)
        assertNoMarks(`${w}×${hh} · ${pFormat}`, l, fails)
        if (l.fit.fits) fitted++
        runs++
      }
    }

    return {
      id: 'fit', group: 'Раскладка', ok: fails.length === 0,
      headline: fails.length === 0
        ? `${runs} раскладок, из них ${fitted} с fits=true — содержимое внутри поля`
        : `${fails.length} выходов за поле при fits=true`,
      detail: fails.length === 0
        ? ['проверены оба вида подачи P-фраз: колонкой кодов и слитным текстом']
        : fails.slice(0, 12).map((f) => `${f.case}: ${f.what}`),
    }
  },
})

CHECKS.push({
  id: 'selftest',
  group: 'Сама проверка',
  title: 'Каждое утверждение умеет краснеть',
  async run() {
    /**
     * ⭐⭐ ЗЕЛЁНАЯ ПРОВЕРКА, КОТОРАЯ НЕ УМЕЕТ КРАСНЕТЬ, НИЧЕГО НЕ СТОИТ.
     *
     * Урок session 49 записан прямо: «проверка, которая ошибается молча, лучше
     * проверки, которая ошибается уверенно». Здесь она предъявляет себе
     * заведомо дефектные раскладки и обязана поймать КАЖДУЮ. Не поймала — вся
     * группа выше ничего не подтверждает, и это надо знать до деплоя, а не
     * после.
     */
    const opt = { jurisdiction: 'clp' as JurisdictionKey, purpose: 'supplier' as LabelPurpose, widthMm: 100, heightMm: 70 }
    const silent: string[] = []

    const probe = (name: string, run: () => Fail[]) => {
      if (run().length === 0) silent.push(name)
    }

    // Сырые тексты идут МИМО renderStatement — так выглядел бы откат правки.
    for (const [name, code, text] of [
      ['угловые скобки', 'H372', 'Causes damage to organs <or state all organs affected, if known>.'],
      ['многоточие', 'P230', 'Keep wetted with …'],
      ['латышские две точки', 'P352', 'Nomazgat ar lielu udens/.. daudzumu.'],
      ['литовское (kuo)', 'P230', 'Laikyti sudrekinta (kuo)'],
      ['квадратные скобки', 'P334', 'Immerse in cool water [or wrap in wet bandages].'],
    ] as [string, string, string][]) {
      probe(`знак на этикетке: ${name}`, () => {
        const out: Fail[] = []
        const l = layoutLabel(baseInput({
          signalWord: 'Danger', signalLevel: 'danger',
          hStatements: code.startsWith('H') ? [{ code, text }] : [],
          pStatements: code.startsWith('P') ? [{ code, text }] : [],
        }), opt)
        assertNoMarks(name, l, out)
        return out
      })
    }

    /**
     * ⚠ Случай пересобран в session 64. Прежний («danger выдан за warning»)
     * зубы потерял: раз рамка алая при обеих степенях, подмена одной степени на
     * другую больше ничего не ломает, и проба проходила бы всегда. Проверяем
     * теперь ту границу, которая осталась содержательной, и с другой стороны,
     * чем проба ниже: классифицированное выдаём за неклассифицированное.
     */
    probe('рамка: классифицированное выдано за незаклассифицированное', () => {
      const out: Fail[] = []
      assertFrame('x', layoutLabel(baseInput({ signalWord: 'Danger', signalLevel: 'danger' }), opt), null, out)
      return out
    })
    probe('рамка: пустая заготовка выдана за danger', () => {
      const out: Fail[] = []
      assertFrame('x', layoutLabel(baseInput(), opt), 'danger', out)
      return out
    })

    // ⚠ Наложение и выход за поле подсовываются готовой раскладкой: заставить
    // движок промахнуться нарочно нельзя — он как раз починен.
    const fakeOverlap = {
      widthMm: 100, heightMm: 70, pictogramMm: 0,
      fit: { fits: true } as LabelLayout['fit'], issues: [],
      items: [
        { t: 'rect', x: 0, y: 0, w: 100, h: 70, stroke: RULE },
        { t: 'text', x: 4, y: 20, s: 'P370+P380+P375+P378', size: 2, bold: true, color: '#000' },
        { t: 'text', x: 10, y: 20, s: 'In case of fire: Evacuate area.', size: 2, color: '#000' },
      ],
    } as unknown as LabelLayout
    probe('наложение кода на текст', () => { const o: Fail[] = []; assertNoOverlap('x', fakeOverlap, o); return o })

    const fakeOutside = {
      widthMm: 50, heightMm: 30, pictogramMm: 0,
      fit: { fits: true } as LabelLayout['fit'], issues: [],
      items: [
        { t: 'rect', x: 0, y: 0, w: 50, h: 30, stroke: RULE },
        { t: 'text', x: 45, y: 10, s: 'a very long line that runs off the label edge', size: 2, color: '#000' },
      ],
    } as unknown as LabelLayout
    probe('выход за поле при fits=true', () => { const o: Fail[] = []; assertInside('x', fakeOutside, o); return o })

    return {
      id: 'selftest', group: 'Сама проверка', ok: silent.length === 0,
      headline: silent.length === 0
        ? '9 заведомо дефектных раскладок, пойманы все 9'
        : `${silent.length} дефектов проверка НЕ ЗАМЕТИЛА — верхние группы ничего не подтверждают`,
      detail: silent.length === 0
        ? ['знаки всех четырёх видов, оба цвета рамки, наложение, выход за поле']
        : silent.map((s) => `молчит на: ${s}`),
    }
  },
})

// ─────────────────────────── прогон ───────────────────────────

async function main(): Promise<void> {
  const selected = ONLY
    ? CHECKS.filter((c) => c.id.includes(ONLY) || c.group.toLowerCase().includes(ONLY.toLowerCase()))
    : CHECKS

  if (!selected.length) {
    console.error(`Под --only ${ONLY} ничего не подошло. Проверки: ${CHECKS.map((c) => c.id).join(', ')}`)
    process.exit(1)
  }

  console.log('')
  console.log('GHS label layout check (прогон движка, сборка не нужна)')
  console.log(`  база:  ${supabaseUrl}`)
  console.log(`  когда: ${new Date().toISOString()}`)
  console.log('')

  const results: Result[] = []
  let group = ''
  for (const check of selected) {
    if (check.group !== group) { group = check.group; console.log(group) }
    let r: Result
    try {
      r = await check.run()
    } catch (e) {
      r = { id: check.id, group: check.group, ok: false, headline: `проверка упала: ${String(e)}`, detail: [] }
    }
    results.push(r)
    console.log(`  [${r.ok ? ' OK ' : 'FAIL'}] ${check.title}`)
    console.log(`         ${r.headline}`)
    for (const line of r.detail) console.log(`         ${line}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length === 0) {
    console.log(`Итог: ${results.length} проверок движка, все сошлись.`)
    process.exit(0)
  }
  console.log(`Итог: ${results.length - failed.length} из ${results.length} сошлись, провалено ${failed.length}:`)
  for (const f of failed) console.log(`  - ${f.id}: ${f.headline}`)
  console.log('')
  console.log('⚠ Дефект движка живёт на КАЖДОЙ этикетке и невидим check:dist —')
  console.log('  этикетка рисуется в браузере. Чинить до деплоя.')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
