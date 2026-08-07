import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { substanceNameFull } from '../lib/substanceName'
import { productNameVariants, defaultLabelIdentifiers } from '../lib/labelProductName'
import GHSLabelConstructor from './GHSLabelConstructor'
import SubstanceFilterBrowse from './SubstanceFilterBrowse'
import type { JurisdictionKey, LabelPurpose } from '../lib/jurisdictions'
import {
  LABEL_MAKER_BASE,
  labelMakerUrlAfterSelect,
  parseLabelMakerParams,
  resolveStatementCodes,
  signalWordFromParam,
  wantsManualMode,
  type LabelMakerParams,
} from '../lib/labelMakerLink'

/**
 * Адрес, на котором инструмент сейчас стоит.
 *
 * ⚠⚠ БЕРЁТСЯ ИЗ location, А НЕ ЗАШИТ КОНСТАНТОЙ. Раньше здесь был жёсткий
 * `/ghs-label-maker/` — страница инструмента была одна, и вопросов не
 * возникало. Теперь их четырнадцать: хаб, шесть веток и шесть шаблонов. С
 * зашитым адресом выбор вещества на `/ghs-label-maker/whmis-canada/` уводил бы
 * человека на `/ghs-label-maker/?cas=…` — то есть выкидывал бы его из канадского
 * режима ровно в тот момент, когда он наконец выбрал вещество.
 */
function labelBase(): string {
  const p = window.location.pathname
  return p.endsWith('/') ? p : p + '/'
}

/**
 * Хаб ли это или ветка раздела.
 *
 * ⚠⚠ ЗАЧЕМ РАЗЛИЧАТЬ. Ветка `/ghs-label-maker/whmis-canada/` передаёт
 * `jurisdiction="whmis"` пропом, и весь её текст написан про Канаду. Если
 * позволить адресу `?jur=osha` перебить проп, страница станет врать: заголовок,
 * нормы и цитаты — канадские, а инструмент американский. Поэтому `jur`,
 * `purpose` и `stock` действуют ТОЛЬКО на хабе; на ветках и шаблонах побеждает
 * страница. `cas`, `lang` и коды классификации работают везде.
 */
function isHubRoot(base: string): boolean {
  return base === LABEL_MAKER_BASE
}

function setLabelConstructorUrl(cas: string | null) {
  window.history.pushState({}, '', labelMakerUrlAfterSelect(window.location.search, labelBase(), cas))
}

interface Substance {
  id: string
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  cas_number: string
  ec_number: string | null
  signal_word: string | null
  ghs_pictogram_codes: string[] | null
  h_statement_codes: string[] | null
  p_statement_codes: string[] | null
}

interface Pictogram { code: string; name_en: string; svg_content: string | null }
interface HStatement { code: string; text_en: string }
interface PStatement { code: string; text_en: string; category?: string | null }

interface Props {
  /** Юрисдикция, с которой открывается инструмент — задаётся страницей раздела. */
  jurisdiction?: JurisdictionKey
  purpose?: LabelPurpose
  /**
   * Формат наклейки, на котором открывается инструмент — `id` из `labelStock.ts`.
   * Задаётся страницами `/ghs-label-maker/templates/<slug>/`.
   */
  initialStockId?: string
}

/**
 * Что стоит в адресе на ПЕРВОМ рендере.
 *
 * ⚠⚠ ЧИТАЕТСЯ СИНХРОННО, А НЕ В `useEffect`, И ЭТО ПРИНЦИПИАЛЬНО.
 * `GHSLabelConstructor` заводит юрисдикцию, назначение и формат через
 * `useState(initialJurisdiction)` — то есть берёт проп ОДИН РАЗ, при монтаже, и
 * на его последующие изменения не реагирует вовсе. Прочитай мы адрес эффектом,
 * конструктор успел бы смонтироваться с умолчанием `osha`, а `?jur=clp` из
 * ссылки не подействовал бы никогда — и ссылка «европейская этикетка на это
 * вещество» молча открывала бы американскую.
 *
 * ⚠ На сервере `window` нет — там пусто, и это правильно: адресная строка
 * существует только у человека в браузере.
 */
function urlStateNow(): { params: LabelMakerParams | null; hubRoot: boolean } {
  if (typeof window === 'undefined') return { params: null, hubRoot: false }
  return { params: parseLabelMakerParams(window.location.search), hubRoot: isHubRoot(labelBase()) }
}

export default function LabelConstructorLoader({
  jurisdiction = 'osha', purpose = 'supplier', initialStockId,
}: Props) {
  const [cas, setCas] = useState<string | null>(() => urlStateNow().params?.cas ?? null)
  const [substance, setSubstance] = useState<Substance | null>(null)
  const [pictograms, setPictograms] = useState<Pictogram[]>([])
  const [hStatements, setHStatements] = useState<HStatement[]>([])
  const [pStatements, setPStatements] = useState<PStatement[]>([])
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // ── Ручной режим: свой продукт или смесь ──────────────────────────────────
  // ⚠ Без него инструмент бесполезен половине посетителей: они маркируют СВОЮ
  // смесь, которой в гармонизированном перечне CLP Annex VI нет и быть не может.
  const [manual, setManual] = useState(() => {
    const p = urlStateNow().params
    return p ? wantsManualMode(p) : false
  })
  const [mixName, setMixName] = useState('')
  const [mixCas, setMixCas] = useState('')
  const [mixEc, setMixEc] = useState('')
  const [mixSignal, setMixSignal] = useState<string | null>(() => {
    const w = signalWordFromParam(urlStateNow().params?.signal ?? null)
    return w === undefined ? 'Danger' : w
  })
  const [allPics, setAllPics] = useState<Pictogram[]>([])
  const [allH, setAllH] = useState<HStatement[]>([])
  const [allP, setAllP] = useState<PStatement[]>([])
  const [pickedPics, setPickedPics] = useState<string[]>([])
  const [pickedH, setPickedH] = useState<string[]>([])
  const [pickedP, setPickedP] = useState<string[]>([])
  const [hQuery, setHQuery] = useState('')
  const [pQuery, setPQuery] = useState('')
  const [refLoading, setRefLoading] = useState(false)

  // ── Что пришло адресом ────────────────────────────────────────────────────
  // ⚠ Разбор — в `labelMakerLink.ts`, вместе со сборкой ссылок. Один файл на
  // обе стороны контракта: именно расхождение двух сторон стоило session 38
  // калькулятора, открывавшегося пустым с 3 650 страниц.
  const [urlParams, setUrlParams] = useState<LabelMakerParams | null>(() => urlStateNow().params)
  /** Коды из адреса ждут, пока догрузятся справочники ручного режима. */
  const pendingRef = useRef<LabelMakerParams | null>(urlStateNow().params)

  useEffect(() => {
    // ⚠ Первое чтение уже произошло в инициализаторах состояния — здесь только
    // кнопка «назад» в браузере.
    const readFromUrl = () => {
      const p = parseLabelMakerParams(window.location.search)
      setUrlParams(p)
      setCas(p.cas ?? null)
      if (!p.cas) {
        setSubstance(null); setPictograms([]); setHStatements([]); setPStatements([]); setNotFound(false)
      }
      if (wantsManualMode(p)) {
        pendingRef.current = p
        setManual(true)
        const w = signalWordFromParam(p.signal ?? null)
        if (w !== undefined) setMixSignal(w)
      }
    }
    window.addEventListener('popstate', readFromUrl)
    return () => window.removeEventListener('popstate', readFromUrl)
  }, [])

  useEffect(() => {
    if (!cas) return
    async function load() {
      setLoading(true)
      setNotFound(false)
      const { data: sub } = await supabase
        .from('substances')
        .select('id, iupac_name, common_name, display_name_short, cas_number, ec_number, signal_word, ghs_pictogram_codes, h_statement_codes, p_statement_codes')
        .eq('cas_number', cas)
        .single()

      if (!sub) { setNotFound(true); setLoading(false); return }
      setSubstance(sub as Substance)

      const s = sub as Substance
      const picCodes = s.ghs_pictogram_codes ?? []
      const hCodes = s.h_statement_codes ?? []
      const pCodes = s.p_statement_codes ?? []

      const [picRes, hRes, pRes] = await Promise.all([
        picCodes.length > 0
          ? supabase.from('pictograms_signals').select('code, name_en, svg_content').in('code', picCodes)
          : Promise.resolve({ data: [] as Pictogram[] | null }),
        hCodes.length > 0
          ? supabase.from('h_statements').select('code, text_en:text_plain').in('code', hCodes)
          : Promise.resolve({ data: [] as HStatement[] | null }),
        pCodes.length > 0
          // text_plain — читаемая версия; text_en содержит плейсхолдеры регламента
          // («Wash … thoroughly after handling»), и на этикетке им не место.
          ? supabase.from('p_statements').select('code, text_en:text_plain').in('code', pCodes)
          : Promise.resolve({ data: [] as PStatement[] | null }),
      ])

      setPictograms(((picRes.data ?? []) as Pictogram[]).sort((a, b) => a.code.localeCompare(b.code)))
      setHStatements(((hRes.data ?? []) as HStatement[]).sort((a, b) => a.code.localeCompare(b.code)))
      setPStatements(((pRes.data ?? []) as PStatement[]).sort((a, b) => a.code.localeCompare(b.code)))
      setLoading(false)
    }
    load()
  }, [cas])

  // Справочники для ручного режима грузятся один раз и только по требованию:
  // на обычном пути они не нужны и стоили бы трёх лишних запросов каждому.
  useEffect(() => {
    if (!manual || allPics.length > 0) return
    let cancelled = false
    async function loadRefs() {
      setRefLoading(true)
      const [picRes, hRes, pRes] = await Promise.all([
        supabase.from('pictograms_signals').select('code, name_en, svg_content').order('code'),
        supabase.from('h_statements').select('code, text_en:text_plain').order('code'),
        supabase.from('p_statements').select('code, text_en:text_plain, category').order('code'),
      ])
      if (cancelled) return
      setAllPics((picRes.data ?? []) as Pictogram[])
      setAllH((hRes.data ?? []) as HStatement[])
      setAllP((pRes.data ?? []) as PStatement[])
      setRefLoading(false)
    }
    loadRefs()
    return () => { cancelled = true }
  }, [manual])

  /**
   * Коды из адреса отмечаются, КОГДА СПРАВОЧНИКИ УЖЕ ЗАГРУЖЕНЫ.
   *
   * ⚠⚠ Разрешение идёт по загруженному перечню, а не приведением к верхнему
   * регистру. В перечне живут `H360D`, `H360Df`, `H360FD`, `H361d`, `H361fd`,
   * `H350i` — регистр суффикса несёт смысл: прописная буква означает доказанное
   * действие, строчная — предполагаемое. `toUpperCase()` склеил бы `H360Df` и
   * `H360FD` и поставил бы на этикетку чужую фразу о вреде для потомства.
   * Неоднозначные коды `resolveStatementCodes` отбрасывает молча — лучше не
   * напечатать ничего, чем напечатать не ту опасность.
   */
  useEffect(() => {
    const p = pendingRef.current
    if (!p || allH.length === 0) return
    pendingRef.current = null
    const hKnown = allH.map((x) => x.code)
    const pKnown = allP.map((x) => x.code)
    const picKnown = allPics.map((x) => x.code)
    const h = resolveStatementCodes(p.h ?? [], hKnown)
    const ps = resolveStatementCodes(p.p ?? [], pKnown)
    const pics = resolveStatementCodes(p.pictograms ?? [], picKnown)
    if (h.length) setPickedH(h)
    if (ps.length) setPickedP(ps)
    if (pics.length) setPickedPics(pics)
  }, [allH, allP, allPics])

  // ── Умолчания инструмента: страница против адреса ─────────────────────────
  // ⚠ На ветках и шаблонах побеждает страница — разбор в `isHubRoot`.
  const [onHubRoot] = useState(() => urlStateNow().hubRoot)

  const effJurisdiction = useMemo<JurisdictionKey>(
    () => (onHubRoot && urlParams?.jurisdiction ? urlParams.jurisdiction : jurisdiction),
    [onHubRoot, urlParams, jurisdiction],
  )
  const effPurpose = useMemo<LabelPurpose>(
    () => (onHubRoot && urlParams?.purpose ? urlParams.purpose : purpose),
    [onHubRoot, urlParams, purpose],
  )
  const effStockId = useMemo<string | undefined>(
    () => (onHubRoot && urlParams?.stock ? urlParams.stock : initialStockId),
    [onHubRoot, urlParams, initialStockId],
  )
  /** Второй язык работает и на ветках: он ничему на странице не противоречит. */
  const effLang = urlParams?.lang ?? undefined

  // ── Ручной режим ──────────────────────────────────────────────────────────
  if (manual) {
    const picked = allPics.filter((p) => pickedPics.includes(p.code))
    const pickedHList = allH.filter((h) => pickedH.includes(h.code))
    const pickedPList = allP.filter((x) => pickedP.includes(x.code))
    // ⚠ Отмеченные держатся наверху: иначе выбранная фраза уезжает вниз списка
    // из ста семнадцати, и человек не видит, что уже набрал.
    const pMatched = pQuery.trim()
      ? allP.filter((x) => (x.code + ' ' + x.text_en).toLowerCase().includes(pQuery.trim().toLowerCase()))
      : allP
    // ⚠⚠ Список НЕ обрезается. Прежний срез в двенадцать строк выглядел как
    // «в базе всего двенадцать P-фраз»: их 117, и нужная человеку почти
    // наверняка была за срезом. Длину держит прокрутка контейнера.
    //
    // Порядок — как в GHS: общие, предупреждение, реагирование, хранение,
    // утилизация. Внутри каждой группы по коду.
    const P_ORDER: Record<string, number> = { general: 0, prevention: 1, response: 2, storage: 3, disposal: 4 }
    const P_TITLE: Record<string, string> = {
      general: 'General', prevention: 'Prevention', response: 'Response',
      storage: 'Storage', disposal: 'Disposal', other: 'Other',
    }
    const pGroups = Object.entries(
      pMatched.reduce<Record<string, PStatement[]>>((acc, x) => {
        const key = x.category && P_ORDER[x.category] !== undefined ? x.category : 'other'
        ;(acc[key] ??= []).push(x)
        return acc
      }, {}),
    ).sort((a, b) => (P_ORDER[a[0]] ?? 9) - (P_ORDER[b[0]] ?? 9))
    // ⚠ EUH-фразы уходят В КОНЕЦ списка. По алфавиту «EUH001» встаёт впереди
    // «H200», и первым, что видит человек, оказывается «Explosive when dry» —
    // дополнительная европейская фраза, а не обычная H-фраза, которую он ищет.
    const byCode = (a: HStatement, b: HStatement) => {
      const ea = a.code.startsWith('EUH'), eb = b.code.startsWith('EUH')
      if (ea !== eb) return ea ? 1 : -1
      return a.code.localeCompare(b.code, 'en', { numeric: true })
    }
    const hFiltered = (hQuery.trim()
      ? allH.filter((h) => (h.code + ' ' + h.text_en).toLowerCase().includes(hQuery.toLowerCase()))
      : allH
    ).slice().sort(byCode)
    const ready = mixName.trim().length > 0

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Your own product or mixture</p>
            <p className="text-sm text-gray-600">You set the classification — it comes from your safety data sheet, not from our database.</p>
          </div>
          <button type="button" onClick={() => setManual(false)} className="cursor-pointer text-sm text-gray-500 underline hover:text-gray-700">
            ← Back to the substance database
          </button>
        </div>

        {refLoading && <p className="py-6 text-center text-sm text-gray-500">Loading reference data…</p>}

        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                Product name <span className="font-normal text-rose-500">required</span>
              </label>
              <input
                type="text" value={mixName} onChange={(e) => setMixName(e.target.value)}
                placeholder="ACME Degreaser 200"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                CAS <span className="font-normal text-gray-400">optional</span>
              </label>
              <input
                type="text" value={mixCas} onChange={(e) => setMixCas(e.target.value)}
                placeholder="67-64-1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                EC <span className="font-normal text-gray-400">optional</span>
              </label>
              <input
                type="text" value={mixEc} onChange={(e) => setMixEc(e.target.value)}
                placeholder="200-662-2"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]"
              />
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Signal word</p>
            <div className="flex gap-2">
              {[{ v: 'Danger', l: 'Danger' }, { v: 'Warning', l: 'Warning' }, { v: null, l: 'none' }].map((o) => (
                <button
                  key={String(o.v)} type="button" onClick={() => setMixSignal(o.v)}
                  className={`cursor-pointer rounded-lg border-2 px-4 py-1.5 text-sm transition-colors ${
                    mixSignal === o.v ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-800 hover:border-[#062A78]'
                  }`}
                >{o.l}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Pictograms</p>
            <div className="flex flex-wrap gap-2">
              {allPics.map((p) => {
                const on = pickedPics.includes(p.code)
                return (
                  <button
                    key={p.code} type="button" title={p.name_en}
                    onClick={() => setPickedPics((prev) => on ? prev.filter((c) => c !== p.code) : [...prev, p.code])}
                    className={`cursor-pointer rounded-lg border-2 p-1.5 transition-colors ${on ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white opacity-60 hover:opacity-100'}`}
                  >
                    <span className="block h-12 w-12 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: p.svg_content ?? '' }} />
                    <span className="mt-0.5 block text-[10px] font-semibold text-gray-600">{p.code}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Hazard statements</p>
              <span className="text-[11px] text-gray-400">{pickedH.length} of {allH.length} selected</span>
            </div>
            <input
              type="search" value={hQuery} onChange={(e) => setHQuery(e.target.value)}
              placeholder="Search by code or text: flammable, H225…"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {/* ⚠ Тоже без среза: H-фраз 108, и нужная почти всегда была за
                  прежней границей в шестьдесят строк. */}
              {hFiltered.map((h) => {
                const on = pickedH.includes(h.code)
                return (
                  <label key={h.code} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${on ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
                    <input
                      type="checkbox" checked={on} className="mt-0.5 accent-[#062A78]"
                      onChange={() => setPickedH((prev) => on ? prev.filter((c) => c !== h.code) : [...prev, h.code])}
                    />
                    <span><span className="font-semibold">{h.code}</span> {h.text_en}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* ⚠⚠ P-фразы выбираются ЗДЕСЬ, вместе с остальной классификацией.
              Раньше их выбор жил только внутри конструктора, и в ручном режиме
              человек до него не добирался: он задавал пиктограммы и H-фразы и
              не понимал, куда делись предупредительные. */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Precautionary statements</p>
              <span className="text-[11px] text-gray-400">{pickedP.length} of {allP.length} selected</span>
            </div>
            <p className="mb-2 text-[11px] text-gray-500">
              Six is the usual maximum on a label — pick the ones that match how the product is actually used.
            </p>
            <input
              type="search" value={pQuery} onChange={(e) => setPQuery(e.target.value)}
              placeholder="Search by code or text: gloves, P280…"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {pGroups.map(([key, list]) => (
                <div key={key}>
                  <p className="sticky top-0 bg-slate-50 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {P_TITLE[key] ?? key} <span className="font-normal">({list.length})</span>
                  </p>
                  <div className="space-y-1">
                    {list.map((x) => {
                      const on = pickedP.includes(x.code)
                      return (
                        <label key={x.code} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${on ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
                          <input
                            type="checkbox" checked={on} className="mt-0.5 accent-[#062A78]"
                            onChange={() => setPickedP((prev) => on ? prev.filter((c) => c !== x.code) : [...prev, x.code])}
                          />
                          <span><span className="font-semibold">{x.code}</span> {x.text_en}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ⚠⚠ Раньше конструктор просто появлялся ниже, когда заполнялось имя, и
            человек этого не видел: он выбирал пиктограммы и не понимал, где
            этикетка и что делать дальше. Теперь между классификацией и этикеткой
            стоит явный рубеж — либо кнопка, либо объяснение, чего не хватает. */}
        {!ready ? (
          <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white px-5 py-6 text-center">
            <p className="text-sm font-medium text-gray-800">Enter a product name to build the label</p>
            <p className="mt-1 text-xs text-gray-500">
              It is the product identifier — the one element every jurisdiction requires on every label.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-green-700">Your label</p>
                <p className="text-sm text-gray-600">
                  {pickedPics.length} pictogram{pickedPics.length === 1 ? '' : 's'} ·{' '}
                  {mixSignal ?? 'no signal word'} · {pickedH.length} hazard statement{pickedH.length === 1 ? '' : 's'} ·{' '}
                  {pickedP.length} precautionary
                </p>
              </div>
              <a href="#label" className="shrink-0 rounded-lg bg-[#062A78] px-4 py-2 text-sm font-semibold text-white">
                Go to the label ↓
              </a>
            </div>
            <div id="label" className="scroll-mt-24">
              <GHSLabelConstructor
                displayName={mixName}
                casNumber={mixCas}
                ecNumber={mixEc || null}
                signalWord={mixSignal}
                pictograms={picked}
                hStatements={pickedHList}
                pStatements={pickedPList}
                initialJurisdiction={effJurisdiction}
                initialPurpose={effPurpose}
                initialStockId={effStockId}
                initialSecondLang={effLang}
                initialSelectedP={pickedP}
              />
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Пустое состояние: выбор вещества ──────────────────────────────────────
  // ⚠⚠ Поисков здесь было ДВА: свой примитивный сверху (ilike по одному полю) и
  // полноценный внутри SubstanceFilterBrowse — с нечётким поиском через fuse.js
  // и фильтрами по пиктограммам и сигнальному слову. Свой убран: два поля ввода
  // на одном экране заставляют выбирать, каким из них пользоваться.
  if (!cas && !substance) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-gray-900">Labelling your own mixture or product?</p>
          <p className="mt-1 text-sm text-gray-600">
            Mixtures have no harmonised classification — yours comes from your safety data sheet.
            Set the pictograms, signal word and hazard statements yourself.
          </p>
          <button
            type="button"
            onClick={() => setManual(true)}
            className="mt-3 cursor-pointer rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#ea670c]"
          >
            Build a label manually →
          </button>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="font-semibold text-[#062A78]">Or pick a substance from the database</p>
          <p className="mt-1 text-sm text-gray-600">
            Search by name or CAS number, or narrow the list by pictogram. Classification,
            signal word and H/P statements are filled in for you.
          </p>
          <div className="-mx-2 mt-4 sm:mx-0">
            <SubstanceFilterBrowse onSelectSubstance={(c) => { setCas(c); setLabelConstructorUrl(c) }} />
          </div>
          <p className="mt-4 text-sm text-gray-500">
            Open the catalogue on its own page: <a href="/substances/" className="text-[#062A78] underline">Substance database →</a>
          </p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-500">Loading substance data…</div>

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-gray-600">Substance not found for CAS: {cas}</p>
        <button
          type="button"
          onClick={() => { setCas(null); setSubstance(null); setLabelConstructorUrl(null) }}
          className="text-sm text-[#062A78] underline"
        >← Search again</button>
      </div>
    )
  }

  if (!substance) return null

  // ⚠⚠ ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЗАПИСЬ БАЗЫ ПРЕВРАЩАЕТСЯ В ЭТИКЕТКУ. На печать
  // идёт ОДНА форма — её имя, её CAS, её EC, — а не строка Annex VI целиком: у
  // групповых записей там пять имён подряд и склеенные номера всех форм,
  // обрезанные по длине колонки. Разбор и проверка формы — в
  // `labelProductName.ts`; номер, не прошедший проверку, не печатается вовсе.
  const nameVariants = productNameVariants(substance)
  const ids = defaultLabelIdentifiers(substance)
  const displayName = ids.name || substanceNameFull(substance)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-5 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-green-700">Selected substance</p>
          <p className="font-bold text-gray-900">{displayName}</p>
          {/* ⚠ Не `substance.cas_number`: у групповых записей в колонке лежит
              склейка номеров всех форм, и человеку она показывалась как есть. */}
          {ids.cas && <p className="text-sm text-gray-500">CAS {ids.cas}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setCas(null); setSubstance(null); setPictograms([]); setHStatements([]); setPStatements([])
            setLabelConstructorUrl(null)
          }}
          className="text-sm text-gray-400 underline hover:text-gray-600"
        >Change substance</button>
      </div>

      <GHSLabelConstructor
        displayName={displayName}
        casNumber={ids.cas}
        ecNumber={ids.ec}
        entryKey={substance.cas_number}
        signalWord={substance.signal_word}
        pictograms={pictograms}
        hStatements={hStatements}
        pStatements={pStatements}
        initialJurisdiction={effJurisdiction}
        initialPurpose={effPurpose}
        initialStockId={effStockId}
        initialSecondLang={effLang}
        nameVariants={nameVariants}
      />
    </div>
  )
}
