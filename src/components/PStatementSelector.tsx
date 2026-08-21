/**
 * Инструмент отбора P-фраз — остров страницы `/p-statements/selector/`.
 *
 * ⚠⚠ ОТБОР ЖИВЁТ НЕ ЗДЕСЬ. Здесь только сбор входа (классификация, аудитория,
 * объём тары, чужие коды) и показ результата. Решает `pPrecedence.ts`, а
 * показывает `PStatementProtocol.tsx` — тот же компонент, что и в
 * конструкторе. Два места, решающих одно и то же, расходятся молча.
 *
 * ⭐⭐ ЧЕТЫРЕ ВХОДА, И ТОЛЬКО ОДИН ИЗ НИХ ОБЯЗАТЕЛЬНЫЙ.
 * Классификация обязательна — без неё отбирать нечего. Аудитория, объём тары и
 * чужие коды меняют ответ, но у каждого есть разумное умолчание, и требовать их
 * до первого ответа значит не показать ответ вовсе.
 *
 * ⚠ Аудитория — НЕ косметика. От неё зависят закреп ст. 28(2) (фраза про
 * утилизацию у населения обязательна), появление раздела Annex IV «Consumer
 * products» и уровни ECHA, у которых своя колонка на каждую группу. Поэтому
 * переключатель стоит НАД результатом, а не в «дополнительных настройках».
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePPrecedence } from '../lib/usePPrecedence'
import PStatementProtocol from './PStatementProtocol'
import { labelMakerHref, resolveStatementCodes, parseLabelMakerParams } from '../lib/labelMakerLink'
import { casForDisplay } from '../lib/substanceIdentifiers'
import type { Audience } from '../lib/pPrecedence'

interface HStatement { code: string; text_en: string }
interface Substance {
  cas_number: string
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  signal_word: string | null
  h_statement_codes: string[] | null
}

/** Ходовые объёмы тары — те же пороги, что у послаблений Annex I §1.5.2. */
const CAPACITIES: { ml: number; label: string }[] = [
  { ml: 10, label: '10 mL' },
  { ml: 25, label: '25 mL' },
  { ml: 100, label: '100 mL' },
  { ml: 125, label: '125 mL' },
  { ml: 500, label: '500 mL' },
  { ml: 1000, label: '1 L' },
  { ml: 5000, label: '5 L' },
  { ml: 20000, label: '20 L' },
  { ml: 200000, label: '200 L' },
]

const byCode = (a: HStatement, b: HStatement) => {
  const ea = a.code.startsWith('EUH'), eb = b.code.startsWith('EUH')
  if (ea !== eb) return ea ? 1 : -1
  return a.code.localeCompare(b.code, 'en', { numeric: true })
}

export default function PStatementSelector() {
  const [allH, setAllH] = useState<HStatement[]>([])
  const [refLoading, setRefLoading] = useState(true)
  const [refError, setRefError] = useState<string | null>(null)

  const [pickedH, setPickedH] = useState<string[]>([])
  const [signalWord, setSignalWord] = useState<string | null>('Danger')
  const [audience, setAudience] = useState<Audience>('professional')
  const [capacityMl, setCapacityMl] = useState(1000)
  const [hQuery, setHQuery] = useState('')

  const [supplied, setSupplied] = useState('')
  const [diffOpen, setDiffOpen] = useState(false)

  // ── Вещество из перечня ───────────────────────────────────────────────────
  const [casQuery, setCasQuery] = useState('')
  const [substance, setSubstance] = useState<Substance | null>(null)
  const [subLoading, setSubLoading] = useState(false)
  /**
   * ⚠⚠ ТРИ РАЗНЫХ ИСХОДА, А НЕ ДВА (правка после живого прогона session 65).
   *
   * Первая редакция знала только «нашлось» и «не нашлось» и писала при пустом
   * ответе «No harmonised CLP Annex VI entry». Но пустой ответ бывает по двум
   * совершенно разным причинам, и одна из них — ОТКАЗ ЗАПРОСА. Тогда сообщение
   * про Annex VI — прямая ложь: оно утверждает факт о регламенте там, где на
   * самом деле сломалась сеть. Ровно тот молчаливый отказ, из-за которого в
   * session 31 успешная сборка выкатила 15 страниц веществ без §10.
   * См. claude/silent-supabase-failures.md.
   */
  const [subState, setSubState] = useState<
    | { kind: 'idle' }
    | { kind: 'miss'; q: string; byName: boolean }
    | { kind: 'error'; message: string }
    | { kind: 'no-hazards'; name: string }
    /** Поиск по имени дал несколько кандидатов — выбирает человек, не мы. */
    | { kind: 'matches'; q: string; list: Substance[]; more: boolean }
  >({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.from('h_statements').select('code, text_en').order('code')
      if (cancelled) return
      // ⚠ Отказ ПОКАЗЫВАЕТСЯ. Пустой список опасностей выглядит как «опасностей
      // нет», и человек уйдёт с пустым ответом, не поняв, что справочник не
      // загрузился. См. claude/silent-supabase-failures.md.
      if (error) setRefError(error.message)
      else setAllH((data ?? []) as HStatement[])
      setRefLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  /**
   * ⚠ Классификация из адреса. Инструмент открывается ссылкой из конструктора
   * и со страниц кодов — и должен открываться уже заполненным, иначе переход
   * туда-обратно теряет набранное.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || allH.length === 0) return
    const p = parseLabelMakerParams(window.location.search)
    const h = resolveStatementCodes(p.h ?? [], allH.map((x) => x.code))
    if (h.length) setPickedH(h)
    if (p.signal === 'danger') setSignalWord('Danger')
    else if (p.signal === 'warning') setSignalWord('Warning')
    else if (p.signal === 'none') setSignalWord(null)
    if (p.cas) { setCasQuery(p.cas); void pickSubstance(p.cas) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allH])

  /**
   * Приведение введённого номера к тому виду, в каком CAS лежит в базе.
   *
   * ⚠ Люди вставляют номер из паспорта безопасности целой строкой: «CAS
   * 98-95-3», «CAS No. 98-95-3», иногда с неразрывным пробелом или с длинным
   * тире вместо дефиса. Точное сравнение такую строку не находит, и инструмент
   * отвечает «нет в Annex VI» — про вещество, которое там есть.
   * ⚠⚠ Чистим ТОЛЬКО обрамление: сам номер не трогаем и цифры не переставляем.
   */
  function normalizeCas(raw: string): string {
    return raw
      .replace(/ /g, ' ')          // неразрывный пробел
      .replace(/[‐-―]/g, '-') // все виды тире → дефис
      .replace(/^\s*cas\b[\s.:№#-]*(no\.?)?[\s.:]*/i, '')
      .replace(/\s+/g, '')
      .trim()
  }

  /**
   * Похоже ли введённое на номер CAS.
   *
   * ⚠ Форма номера жёсткая: 2–7 цифр, дефис, две цифры, дефис, контрольная
   * цифра. Поэтому одно поле обслуживает оба пути без переключателя: по номеру
   * ищем точно, по всему остальному — по имени. Гадать не приходится.
   */
  const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/

  /** Поля `substances`, которые тянем и при точном поиске, и при поиске по имени. */
  const SUB_COLS = 'cas_number, iupac_name, common_name, display_name_short, signal_word, h_statement_codes'

  /** Сколько совпадений по имени показываем. Больше — список перестают читать. */
  const NAME_LIMIT = 10

  /**
   * ⚠⚠ ЧИСТКА СТРОКИ ПЕРЕД `.or()` — ЭТО НЕ КОСМЕТИКА.
   * PostgREST разбирает выражение `.or()` САМ, и запятая, скобка или звёздочка
   * внутри значения ломают разбор — запрос уедет не туда или отвалится с
   * ошибкой. А запятые в химических именах — норма жизни: «benzene, 1,2-dimethyl-».
   * Поэтому разделители выражения из значения убираются, а `%` (шаблон LIKE)
   * убирается, чтобы человек не мог случайно попросить всю таблицу.
   */
  function safeForOr(raw: string): string {
    return raw.replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim()
  }

  /** Применить найденное вещество: классификация, слово, отметки. */
  function applySubstance(s: Substance) {
    setSubstance(s)
    setSignalWord(s.signal_word)
    // ⚠⚠ Коды сверяются со справочником, а НЕ приводятся к верхнему регистру:
    // в перечне живут H360D, H360Df, H360FD, H361d — регистр суффикса несёт
    // смысл, и toUpperCase() поставил бы чужую фразу о вреде для потомства.
    const codes = resolveStatementCodes(s.h_statement_codes ?? [], allH.map((x) => x.code))
    setPickedH(codes)
    /**
     * ⚠ Запись в Annex VI есть, а H-кодов у неё нет — так бывает, и это НЕ
     * отказ. Молчать нельзя: справа останется «Nothing to select from yet», и
     * человек решит, что сломалась кнопка, а не что отбирать не из чего.
     */
    setSubState(codes.length === 0
      ? { kind: 'no-hazards', name: s.display_name_short || s.common_name || s.iupac_name }
      : { kind: 'idle' })
  }

  /**
   * Один вход на оба пути: точный номер CAS или имя вещества.
   *
   * ⚠⚠ ПОИСК ПО ИМЕНИ ИДЁТ НА СЕРВЕР, А НЕ ГРУЗИТ СПРАВОЧНИК В БРАУЗЕР.
   * `SubstancePicker` на своей странице тянет ВСЕ 4 178 записей и ищет по ним
   * через Fuse.js — там это оправдано, страница ровно для перебора. Здесь поиск
   * побочный: платить полумегабайтом трафика с каждого посетителя ради одного
   * запроса нельзя. Цена решения названа честно: `ilike` находит подстроку и не
   * прощает опечаток, тогда как Fuse прощает. Кому нужен перебор — ссылка на
   * страницу подбора стоит рядом.
   */
  async function pickSubstance(raw: string) {
    const typed = raw.trim()
    if (!typed) return
    const cas = normalizeCas(typed)
    setSubLoading(true); setSubState({ kind: 'idle' })

    // ── Путь 1: точный номер ────────────────────────────────────────────────
    if (CAS_SHAPE.test(cas)) {
      /**
       * ⚠⚠ ПОИСК — ПО `cas_primary` (№79, session 74): `cas_number` испорчен
       * импортом (склейка форм, обрезка 20 знаков), и точный `.eq()` по нему не
       * находил спасённый номер. И НЕ `.single()`: один CAS может дать ДВЕ
       * записи Annex VI (кадмий `7440-43-9`), а `.single()` при двух строках
       * отвечает тем же `PGRST116`, что и при нуле, — «нет гармонизированной
       * записи» стало бы ложью. Предпочитаем строку с точным совпадением сырой
       * колонки — ровно её находил старый запрос, поведение сохраняется.
       *
       * ⚠⚠ ОТКАЗ ПО-ПРЕЖНЕМУ ОТДЕЛЯЕТСЯ ОТ ОТСУТСТВИЯ, И ЭТО НЕ ПРИДИРКА.
       * Без `.single()` пустой результат — это `data: []` БЕЗ ошибки, факт о
       * данных, он законно превращается в «нет гармонизированной записи».
       * А любой `error` — факт о СЕТИ, и выдавать его за факт о регламенте
       * нельзя.
       */
      const { data, error } = await supabase.from('substances').select(SUB_COLS)
        .eq('cas_primary', cas).order('index_number').limit(2)
      setSubLoading(false)
      if (error) {
        setSubState({ kind: 'error', message: error.message }); return
      }
      const casRows = (data ?? []) as Substance[]
      const hit = casRows.find((r) => (r.cas_number ?? '').trim() === cas) ?? casRows[0]
      if (!hit) { setSubState({ kind: 'miss', q: cas, byName: false }); return }
      applySubstance(hit)
      return
    }

    // ── Путь 2: имя ─────────────────────────────────────────────────────────
    const name = safeForOr(typed)
    if (name.length < 2) {
      setSubLoading(false)
      setSubState({ kind: 'miss', q: typed, byName: true })
      return
    }
    /**
     * ⛔⛔ ДВА ЗАПРОСА, А НЕ ОДИН, И ЭТО НЕ ПЕРЕСТРАХОВКА.
     *
     * Первая редакция искала одной подстрокой `%name%` с пределом в десять
     * строк. Замер по базе показал, чем это кончается: у «nitrobenzene» 18
     * совпадений, и точное среди них НЕ ПЕРВОЕ — раньше идёт `Quintozene`, у
     * которой «nitrobenzene» сидит внутри имени `pentachloronitrobenzene`.
     * У «benzene» совпадений 206, и первым идёт `Phenol`. То есть человек
     * набирает имя вещества, получает десять чужих и своего не находит.
     *
     * PostgREST не умеет сортировать по выражению, только по колонке. Поэтому
     * совпадения с НАЧАЛА имени спрашиваются отдельным запросом и встают выше
     * подстрочных. Внутри каждой группы точное совпадение поднимается вручную.
     */
    const cols = ['display_name_short', 'common_name', 'iupac_name']
    /**
     * ⛔ ТОЧНОЕ СОВПАДЕНИЕ СПРАШИВАЕТСЯ ОТДЕЛЬНО, И БЕЗ ЭТОГО ОНО ТЕРЯЕТСЯ.
     * Имён, начинающихся с «benzene», в перечне десятки. Запрос с пределом в
     * одиннадцать строк вернёт ПРОИЗВОЛЬНЫЕ одиннадцать — PostgREST без
     * `order` порядка не обещает, — и самого «Benzene» среди них может не
     * оказаться. Предел превращает попадание в лотерею; отдельный запрос
     * делает его гарантией.
     */
    const exact = cols.map((c) => `${c}.ilike.${name}`).join(',')
    const prefix = cols.map((c) => `${c}.ilike.${name}%`).join(',')
    const anywhere = cols.map((c) => `${c}.ilike.%${name}%`).join(',')

    // ⚠ У двух нижних просим на строку больше предела — так видно, что список
    // обрезан, и об этом можно сказать вслух, а не молча показать первые десять.
    const [exa, pref, any] = await Promise.all([
      supabase.from('substances').select(SUB_COLS).or(exact).limit(3),
      supabase.from('substances').select(SUB_COLS).or(prefix).limit(NAME_LIMIT + 1),
      supabase.from('substances').select(SUB_COLS).or(anywhere).limit(NAME_LIMIT + 1),
    ])
    setSubLoading(false)

    const error = exa.error ?? pref.error ?? any.error
    if (error) { setSubState({ kind: 'error', message: error.message }); return }

    const nameOf = (s: Substance) => s.display_name_short || s.common_name || s.iupac_name || ''
    const lower = name.toLowerCase()
    /** Точное совпадение имени — выше всех, каким бы длинным ни был список. */
    const exactFirst = (rows: Substance[]) => rows.slice().sort((a, b) => {
      const ea = nameOf(a).toLowerCase() === lower ? 0 : 1
      const eb = nameOf(b).toLowerCase() === lower ? 0 : 1
      if (ea !== eb) return ea - eb
      // Дальше — по длине имени: короткое имя почти всегда и есть искомое
      // вещество, длинное — производное, в имени которого оно сидит.
      return nameOf(a).length - nameOf(b).length
    })

    const seen = new Set<string>()
    const list: Substance[] = []
    for (const s of [...exactFirst((exa.data ?? []) as Substance[]),
                     ...exactFirst((pref.data ?? []) as Substance[]),
                     ...exactFirst((any.data ?? []) as Substance[])]) {
      if (seen.has(s.cas_number)) continue
      seen.add(s.cas_number)
      list.push(s)
    }
    if (list.length === 0) { setSubState({ kind: 'miss', q: typed, byName: true }); return }
    /**
     * ⚠⚠ ЕДИНСТВЕННОЕ СОВПАДЕНИЕ ПРИМЕНЯЕТСЯ САМО, НЕСКОЛЬКО — ВЫБИРАЕТ ЧЕЛОВЕК.
     * Взять первое из списка было бы удобнее и опаснее: «acetone» и «acetone
     * cyanohydrin» — разные вещества с разной классификацией, и подставить
     * второе вместо первого значит напечатать чужую этикетку.
     */
    if (list.length === 1) { applySubstance(list[0]); return }
    setSubState({
      kind: 'matches',
      q: typed,
      list: list.slice(0, NAME_LIMIT),
      more: list.length > NAME_LIMIT,
    })
  }

  function clearAll() {
    setPickedH([]); setSubstance(null); setCasQuery(''); setSubState({ kind: 'idle' })
    setSignalWord('Danger'); setSupplied(''); setHQuery('')
  }

  // ── Вход движка ───────────────────────────────────────────────────────────
  const suppliedCodes = useMemo(
    () => supplied.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    [supplied],
  )

  const input = useMemo(
    () => ({
      hCodes: pickedH,
      signalWord,
      audience,
      containerMl: capacityMl,
      suppliedCodes: suppliedCodes.length ? suppliedCodes : undefined,
    }),
    [pickedH, signalWord, audience, capacityMl, suppliedCodes],
  )

  const { result, loading, error, idle } = usePPrecedence(input, pickedH.length > 0)

  const hFiltered = useMemo(() => {
    const q = hQuery.trim().toLowerCase()
    const list = q ? allH.filter((h) => (h.code + ' ' + h.text_en).toLowerCase().includes(q)) : allH
    // Отмеченные всегда наверху: иначе выбранная опасность уезжает вниз, и
    // человек не видит, что именно он уже набрал.
    const on = list.filter((h) => pickedH.includes(h.code)).sort(byCode)
    const off = list.filter((h) => !pickedH.includes(h.code)).sort(byCode)
    return [...on, ...off]
  }, [allH, hQuery, pickedH])

  /**
   * Открыть тот же набор в конструкторе этикетки.
   *
   * ⚠⚠ `cas` ИДЁТ ЧЕРЕЗ РАЗБОР ФОРМ (session 73). У групповых записей Annex VI в
   * `cas_number` лежит склейка идентификаторов всех форм, обрезанная шириной
   * колонки (`71-41-0[1]584-02-1[2`). До session 73 она уезжала в живой
   * `<a href>` ниже как есть, и конструктор открывался пустым: тогда он искал
   * `.eq('cas_number', …)` и не находил ничего. С session 74 поиск идёт по
   * `cas_primary`, но разбор форм здесь всё равно обязателен: в адрес должен
   * уехать номер, а не склейка.
   *
   * ⭐ `casForDisplay` отдаёт номер ПЕРВОЙ формы — той же, чьё имя показано в
   * карточке вещества, — так что человек попадает на то вещество, которое видел.
   * Замер `check:dist`: разбор спасает CAS у 144 записей из 159. У оставшихся 15
   * функция вернёт пустую строку, и `|| null` уберёт параметр целиком.
   *
   * ⚠ Проверять форму ПОВТОРНО здесь не нужно: `casForDisplay` возвращает либо
   * номер, уже прошедший `CAS_SHAPE`, либо пустую строку. Третьего нет.
   *
   * ⭐ Отобранные H- и P-коды при этом НЕ теряются — они уходят своими
   * параметрами. Человек получает тот же набор фраз, просто без предзаполненного
   * идентификатора вещества.
   */
  const toLabelMaker = useMemo(() => labelMakerHref({
    cas: casForDisplay(substance?.cas_number) || null,
    h: substance ? undefined : pickedH,
    p: result ? result.selected.map((u) => u.code) : undefined,
    signal: signalWord === 'Danger' ? 'danger' : signalWord === 'Warning' ? 'warning' : 'none',
    jurisdiction: 'clp',
  }) + '#build', [substance, pickedH, result, signalWord])

  const chip = (on: boolean) =>
    `cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
      on ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
    }`

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">

      {/* ══ ЛЕВАЯ КОЛОНКА — ВХОД ══════════════════════════════════════════ */}
      <div className="space-y-4">

        {/* ── Вещество из перечня ──────────────────────────────────────── */}
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-[#062A78]">1 · Classification</p>
          <p className="text-xs leading-relaxed text-gray-600">
            Either pull a harmonised classification from CLP Annex VI — by <b>name</b> or by
            <b> CAS number</b> — or tick the hazard statements for your own mixture below.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); void pickSubstance(casQuery) }}
            role="search"
          >
            {/* ⚠ Подсказка написана «e.g.», а НЕ «CAS number — 98-95-3».
                Прежний вариант читался как ЗАПОЛНЕННОЕ поле: серый текст с
                тире выглядит как подставленное значение, и первый же живой
                прогон кончился тем, что кнопку нажали по пустому полю и
                решили, что она сломана. Пример должен быть подписан примером. */}
            <input
              type="search"
              value={casQuery}
              onChange={(e) => setCasQuery(e.target.value)}
              placeholder="acetone, or 98-95-3"
              aria-label="Look up a substance by name or CAS number"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            {/* ⚠⚠ ПРИ ПУСТОМ ПОЛЕ КНОПКА ВЫКЛЮЧЕНА, А НЕ МОЛЧА НИЧЕГО НЕ ДЕЛАЕТ.
                Обработчик и раньше выходил на пустой строке — правильно по сути
                и невыносимо на вид: нажатие без единого признака жизни читается
                как поломка инструмента, а не как «вводить нечего». */}
            <button
              type="submit"
              disabled={!casQuery.trim() || subLoading}
              className="cursor-pointer rounded bg-[#062A78] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {subLoading ? 'Looking…' : 'Look up'}
            </button>
          </form>
          {subLoading && <p className="text-xs text-gray-500">Looking it up…</p>}

          {/* ── ⭐⭐ НЕСКОЛЬКО СОВПАДЕНИЙ ПО ИМЕНИ — ВЫБИРАЕТ ЧЕЛОВЕК ─────────
              «acetone» и «acetone cyanohydrin» — разные вещества с разной
              классификацией. Подставить первое молча значит однажды напечатать
              чужую этикетку. */}
          {subState.kind === 'matches' && (
            <div className="rounded border border-slate-300 bg-white">
              <p className="border-b border-slate-200 px-2 py-1.5 text-[11px] text-gray-600">
                {subState.more ? `More than ${subState.list.length}` : subState.list.length} match
                {subState.list.length === 1 ? '' : 'es'} for “<b>{subState.q}</b>”
                {subState.more ? ' — the closest are shown. Narrow the wording, or ' : ' — pick one.'}
                {subState.more && <a href="/ghs-label-maker/pick/" className="underline">browse the full list →</a>}
              </p>
              <ul className="max-h-56 overflow-y-auto">
                {subState.list.map((s) => (
                  <li key={s.cas_number}>
                    <button
                      type="button"
                      onClick={() => applySubstance(s)}
                      className="w-full cursor-pointer border-b border-slate-100 px-2 py-1.5 text-left text-[12px] leading-snug last:border-0 hover:bg-blue-50"
                    >
                      <b>{s.display_name_short || s.common_name || s.iupac_name}</b>
                      <span className="ml-1.5 font-mono text-[11px] text-slate-500">CAS {s.cas_number}</span>
                      {(s.h_statement_codes ?? []).length > 0 && (
                        <span className="ml-1.5 text-[11px] text-slate-400">
                          {(s.h_statement_codes ?? []).length} hazard statements
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ⚠ Промах ничего не стирает — прежняя классификация остаётся на
              месте. Неудачный поиск не должен наказывать за опечатку потерей
              набранного, и человеку об этом надо сказать: иначе он видит старое
              вещество рядом с новым запросом и не понимает, что перед ним. */}
          {subState.kind === 'miss' && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
              {subState.byName ? (
                <>
                  Nothing in CLP Annex VI matches “<b>{subState.q}</b>”. The search looks for the
                  exact wording inside a name and does not forgive typos — try a shorter fragment,
                  a CAS number, or <a href="/ghs-label-maker/pick/" className="underline">browse the full list</a>.
                </>
              ) : (
                <>
                  <b>{subState.q}</b> has no harmonised CLP Annex VI entry. Tick the hazard
                  statements yourself below — most mixtures are not in Annex VI and never will be.
                </>
              )}
              {substance && ' Nothing was changed — the classification below is still the previous one.'}
            </p>
          )}

          {/* ⛔ ОТКАЗ СЕТИ НЕ ВЫДАЁТСЯ ЗА ФАКТ О РЕГЛАМЕНТЕ. */}
          {subState.kind === 'error' && (
            <p className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs leading-relaxed text-rose-700">
              The lookup failed — <span className="font-mono">{subState.message}</span>. This says
              nothing about whether the substance is in Annex VI; the request itself did not go
              through. Try again, or tick the hazard statements yourself below.
            </p>
          )}

          {subState.kind === 'no-hazards' && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
              <b>{subState.name}</b> is in the list, but its entry carries no hazard statements — so
              there is nothing for the selector to work from. Tick the classification yourself below.
            </p>
          )}
          {substance && (
            <p className="rounded border border-[#062A78]/30 bg-blue-50 px-2 py-1.5 text-xs text-[#062A78]">
              <b>{substance.display_name_short || substance.common_name || substance.iupac_name}</b>
              {' — '}CAS {substance.cas_number}, classification from Annex VI.
            </p>
          )}

          {/* ── Сигнальное слово ─────────────────────────────────────── */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Signal word</p>
            <div className="flex flex-wrap gap-2">
              {[{ v: 'Danger' as const }, { v: 'Warning' as const }, { v: null }].map((o) => (
                <button key={String(o.v)} type="button" onClick={() => setSignalWord(o.v)} className={chip(signalWord === o.v)}>
                  {o.v ?? 'None'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Used to disambiguate hazard codes that read as more than one category — H240, H241,
              H242, H250 and H280 are the five where the resulting set of statements actually differs.
            </p>
          </div>

          {/* ── H-фразы ──────────────────────────────────────────────── */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Hazard statements</p>
              <span className="text-[11px] text-gray-500">{pickedH.length} of {allH.length} ticked</span>
            </div>
            {refError && (
              <p className="mb-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                The hazard statement list did not load ({refError}). Reload the page — an empty list
                here is not “no hazards”, it is a failed request.
              </p>
            )}
            <input
              type="search" value={hQuery} onChange={(e) => setHQuery(e.target.value)}
              placeholder="Search: flammable, H225…"
              aria-label="Search hazard statements"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-1.5 max-h-72 overflow-y-auto rounded border border-gray-200 bg-white">
              {refLoading && <p className="px-2 py-2 text-xs text-gray-500">Loading…</p>}
              {hFiltered.map((h) => {
                const on = pickedH.includes(h.code)
                return (
                  <label
                    key={h.code}
                    className={`flex cursor-pointer gap-2 border-b border-gray-100 px-2 py-1.5 text-[12px] leading-snug last:border-0 ${on ? 'bg-blue-50' : ''}`}
                  >
                    <input
                      type="checkbox" checked={on} className="mt-0.5"
                      onChange={() => {
                        // ⚠ Ручная правка снимает вещество: смешивать
                        // гармонизированную классификацию Annex VI с набранной
                        // от руки — значит показать отбор, которого нет ни в
                        // одном регламенте.
                        setSubstance(null)
                        setPickedH((prev) => on ? prev.filter((c) => c !== h.code) : [...prev, h.code])
                      }}
                    />
                    <span><b className="font-mono">{h.code}</b> {h.text_en}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Аудитория и тара ─────────────────────────────────────────── */}
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-[#062A78]">2 · Who gets it, and in what</p>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Supplied to</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAudience('professional')} className={chip(audience === 'professional')}>
                Industrial / professional
              </button>
              <button type="button" onClick={() => setAudience('general_public')} className={chip(audience === 'general_public')}>
                General public
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              This changes the answer, not just the wording. Supplying the general public makes a
              disposal statement compulsory under Art. 28(2), brings in the “Consumer products”
              section of Annex IV, and moves ECHA’s importance levels to their own column.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Package capacity</p>
            <div className="flex flex-wrap gap-1.5">
              {CAPACITIES.map((c) => (
                <button key={c.ml} type="button" onClick={() => setCapacityMl(c.ml)}
                  className={`cursor-pointer rounded border px-2 py-1 text-xs ${capacityMl === c.ml ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Only used to check the small-package derogations of Annex I §1.5.2 — at 125 mL and
              below, some classes let you leave statements off the label altogether.
            </p>
          </div>
        </section>

        {/* ── Сверка с чужим SDS ───────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <button
            type="button"
            onClick={() => setDiffOpen((v) => !v)}
            className="flex w-full cursor-pointer items-baseline justify-between text-left"
            aria-expanded={diffOpen}
          >
            <span className="font-semibold text-[#062A78]">3 · Compare with a supplier’s SDS</span>
            <span className="text-slate-400">{diffOpen ? '−' : '+'}</span>
          </button>
          {diffOpen && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs leading-relaxed text-gray-600">
                Paste the P-codes from section 2 of a safety data sheet. You get a difference, not a
                replacement — the tool never adopts someone else’s set silently.
              </p>
              <textarea
                value={supplied}
                onChange={(e) => setSupplied(e.target.value)}
                rows={3}
                placeholder="P280, P305+P351+P338, P310, P264"
                aria-label="Precautionary codes from a supplier SDS"
                className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs"
              />
            </div>
          )}
        </section>

        <button type="button" onClick={clearAll}
          className="w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:border-[#062A78]">
          ↺ Start over
        </button>
      </div>

      {/* ══ ПРАВАЯ КОЛОНКА — ОТВЕТ ════════════════════════════════════════ */}
      <div className="space-y-4">
        {idle ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
            <p className="text-sm font-medium text-slate-600">Nothing to select from yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-500">
              Look up a CAS number or tick the hazard statements on the left. The tool reads the
              hazard classes out of them, then works through Annex IV, ECHA’s importance scale and
              Article 28 — showing its reasoning for every statement it keeps and every one it drops.
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-semibold text-rose-800">The precedence data did not load</p>
            <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{error}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-rose-600">
              Reload the page. The tool deliberately shows nothing rather than falling back to the
              first six codes in alphabetical order — a plausible-looking wrong answer on a safety
              label is worse than no answer.
            </p>
          </div>
        ) : loading || !result ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Working through Annex IV and the ECHA tables…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#062A78]/25 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-[#062A78]">
                {result.selected.length} statement{result.selected.length === 1 ? '' : 's'} for the label
              </p>
              <a href={toLabelMaker} className="ml-auto cursor-pointer rounded-md bg-[#062A78] px-3 py-1.5 text-sm text-white">
                Build the label with these →
              </a>
            </div>
            <PStatementProtocol result={result} />
          </>
        )}
      </div>
    </div>
  )
}
