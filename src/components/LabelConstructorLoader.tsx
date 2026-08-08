import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { substanceNameFull } from '../lib/substanceName'
import { productNameVariants, defaultLabelIdentifiers } from '../lib/labelProductName'
import GHSLabelConstructor from './GHSLabelConstructor'
import type { JurisdictionKey, LabelPurpose } from '../lib/jurisdictions'
import {
  LABEL_MAKER_BASE,
  LM_STICKY_PARAMS,
  labelMakerUrlAfterSelect,
  parseLabelMakerParams,
  resolveStatementCodes,
  signalWordFromParam,
  wantsManualMode,
  type LabelMakerParams,
} from '../lib/labelMakerLink'

/**
 * Конструктор этикетки и всё, что его кормит.
 *
 * ⚠⚠⚠ ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: КОНСТРУКТОР ВИДЕН СРАЗУ.
 * До session 47 здесь было «пустое состояние»: пока вещество не выбрано,
 * инструмента на странице не было вовсе — вместо него стоял подбор вещества.
 * Сергей, посмотрев собранный сайт: «ты не видишь инструмент, из-за этого мало
 * кто доходит до глубоко зарытого инструмента». Это и есть причина, по которой
 * файл переписан: конструктор монтируется ВСЕГДА, пустой, а вещество —
 * необязательный источник классификации, который его заполняет.
 *
 * Отсюда три следствия, и ломать их нельзя:
 *   1. подбор вещества живёт на своей странице `/ghs-label-maker/pick/`;
 *      здесь только строка поиска, которая туда ведёт;
 *   2. возврат с той страницы приходит на `?cas=…#build` — на якорь
 *      инструмента, а не в начало страницы;
 *   3. «Start over» обязан существовать: раз конструктор всегда на экране,
 *      человеку нужен способ выйти из набранного состояния.
 */

/**
 * Адрес, на котором инструмент сейчас стоит.
 *
 * ⚠⚠ БЕРЁТСЯ ИЗ location, А НЕ ЗАШИТ КОНСТАНТОЙ. Конструктор стоит на хабе, но
 * `?cas=` может прийти на любой адрес раздела, где остров ещё смонтирован.
 */
function labelBase(): string {
  const p = window.location.pathname
  return p.endsWith('/') ? p : p + '/'
}

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
  jurisdiction?: JurisdictionKey
  purpose?: LabelPurpose
  initialStockId?: string
}

/**
 * Что стоит в адресе на ПЕРВОМ рендере.
 *
 * ⚠⚠ ЧИТАЕТСЯ СИНХРОННО, А НЕ В `useEffect`, И ЭТО ПРИНЦИПИАЛЬНО.
 * `GHSLabelConstructor` заводит юрисдикцию, назначение и формат через
 * `useState(проп)` — берёт проп ОДИН РАЗ, при монтаже. Прочитай мы адрес
 * эффектом, конструктор смонтировался бы с умолчанием `osha`, а `?jur=clp` из
 * ссылки не подействовал бы никогда.
 */
function urlStateNow(): { params: LabelMakerParams | null; hubRoot: boolean } {
  if (typeof window === 'undefined') return { params: null, hubRoot: false }
  return { params: parseLabelMakerParams(window.location.search), hubRoot: isHubRoot(labelBase()) }
}

/** Адрес страницы подбора с сохранением настроек инструмента. */
function pickHref(seed?: string): string {
  const q = new URLSearchParams()
  if (typeof window !== 'undefined') {
    const cur = new URLSearchParams(window.location.search)
    // ⚠⚠ Настройки обязаны пережить поход за веществом. Человек, выставивший
    // EU CLP и формат Avery, теряет их ровно в тот момент, когда наконец
    // выбрал вещество, — если не передать их туда и обратно.
    for (const name of LM_STICKY_PARAMS) {
      const v = cur.get(name)
      if (v) q.set(name, v)
    }
  }
  if (seed && seed.trim()) q.set('q', seed.trim())
  const s = q.toString()
  return `${LABEL_MAKER_BASE}pick/${s ? `?${s}` : ''}`
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

  /** Строка поиска над конструктором — она только уводит на страницу подбора. */
  const [seed, setSeed] = useState('')

  // ── Классификация своими руками: свой продукт или смесь ───────────────────
  // ⚠ Без неё инструмент бесполезен половине посетителей: они маркируют СВОЮ
  // смесь, которой в гармонизированном перечне CLP Annex VI нет и быть не может.
  const [classOpen, setClassOpen] = useState(() => {
    const p = urlStateNow().params
    return p ? wantsManualMode(p) : false
  })
  /**
   * ⚠⚠ ПО УМОЛЧАНИЮ — БЕЗ СИГНАЛЬНОГО СЛОВА, а не «Danger».
   * Пока конструктор монтировался только после выбора вещества, умолчание
   * «Danger» было безобидным. Теперь он открыт всегда и пустой — и с этим
   * умолчанием пустая заготовка печатала во всю ширину алое DANGER, то есть
   * заявляла опасность продукта, о котором ей ещё ничего не сказали. Поймано
   * отрисовкой пустого состояния.
   */
  const [mixSignal, setMixSignal] = useState<string | null>(() => {
    const w = signalWordFromParam(urlStateNow().params?.signal ?? null)
    return w === undefined ? null : w
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

  const [urlParams, setUrlParams] = useState<LabelMakerParams | null>(() => urlStateNow().params)
  const pendingRef = useRef<LabelMakerParams | null>(urlStateNow().params)

  useEffect(() => {
    const readFromUrl = () => {
      const p = parseLabelMakerParams(window.location.search)
      setUrlParams(p)
      setCas(p.cas ?? null)
      if (!p.cas) {
        setSubstance(null); setPictograms([]); setHStatements([]); setPStatements([]); setNotFound(false)
      }
      if (wantsManualMode(p)) {
        pendingRef.current = p
        setClassOpen(true)
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

  // Справочники грузятся один раз и только когда человек открыл панель
  // классификации: на обычном пути они не нужны и стоили бы трёх лишних
  // запросов каждому.
  useEffect(() => {
    if (!classOpen || allPics.length > 0) return
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
  }, [classOpen])

  /**
   * Коды из адреса отмечаются, КОГДА СПРАВОЧНИКИ УЖЕ ЗАГРУЖЕНЫ.
   *
   * ⚠⚠ Разрешение идёт по загруженному перечню, а не приведением к верхнему
   * регистру. В перечне живут `H360D`, `H360Df`, `H360FD`, `H361d`, `H361fd`,
   * `H350i` — регистр суффикса несёт смысл: прописная означает доказанное
   * действие, строчная — предполагаемое. `toUpperCase()` склеил бы `H360Df` и
   * `H360FD` и поставил бы на этикетку чужую фразу о вреде для потомства.
   */
  useEffect(() => {
    const p = pendingRef.current
    if (!p || allH.length === 0) return
    pendingRef.current = null
    const h = resolveStatementCodes(p.h ?? [], allH.map((x) => x.code))
    const ps = resolveStatementCodes(p.p ?? [], allP.map((x) => x.code))
    const pics = resolveStatementCodes(p.pictograms ?? [], allPics.map((x) => x.code))
    if (h.length) setPickedH(h)
    if (ps.length) setPickedP(ps)
    if (pics.length) setPickedPics(pics)
  }, [allH, allP, allPics])

  // ── Умолчания инструмента: страница против адреса ─────────────────────────
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
  const effLang = urlParams?.lang ?? undefined

  /**
   * Куда вернуть взгляд.
   *
   * ⚠ Скроллим ТОЛЬКО по действию человека. При заходе по ссылке `?cas=…#build`
   * прокруткой занимается сам якорь — вмешиваться нельзя, иначе получим два
   * конкурирующих скролла на одном кадре.
   */
  const toolRef = useRef<HTMLDivElement | null>(null)
  function scrollToTool() {
    if (typeof window === 'undefined') return
    requestAnimationFrame(() => {
      toolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  /** Сброс: снять вещество, снять ручную классификацию, очистить адрес. */
  function startOver() {
    setCas(null); setSubstance(null)
    setPictograms([]); setHStatements([]); setPStatements([])
    setNotFound(false)
    setPickedPics([]); setPickedH([]); setPickedP([]); setMixSignal(null)
    setHQuery(''); setPQuery(''); setSeed('')
    setClassOpen(false)
    setLabelConstructorUrl(null)
    scrollToTool()
  }

  function goPick(e?: { preventDefault: () => void }) {
    e?.preventDefault()
    window.location.assign(pickHref(seed))
  }

  // ── Что идёт в конструктор ────────────────────────────────────────────────
  // ⚠⚠ ОДИН ИСТОЧНИК КЛАССИФИКАЦИИ ЗА РАЗ. Выбранное вещество ПОБЕЖДАЕТ ручные
  // отметки: смешивать гармонизированную классификацию Annex VI с набранной от
  // руки — значит напечатать этикетку, которой нет ни в одном регламенте.
  // Ручные отметки при этом не стираются: сняв вещество, человек находит их на
  // месте.
  const usingSubstance = Boolean(substance)
  const ids = substance ? defaultLabelIdentifiers(substance) : null
  const nameVariants = substance ? productNameVariants(substance) : undefined
  const displayName = substance ? (ids!.name || substanceNameFull(substance)) : ''

  const outPics = usingSubstance ? pictograms : allPics.filter((p) => pickedPics.includes(p.code))
  const outH = usingSubstance ? hStatements : allH.filter((h) => pickedH.includes(h.code))
  const outP = usingSubstance ? pStatements : allP.filter((x) => pickedP.includes(x.code))
  const outSignal = usingSubstance ? substance!.signal_word : mixSignal

  // ── Панель ручной классификации ───────────────────────────────────────────
  const P_ORDER: Record<string, number> = { general: 0, prevention: 1, response: 2, storage: 3, disposal: 4 }
  const P_TITLE: Record<string, string> = {
    general: 'General', prevention: 'Prevention', response: 'Response',
    storage: 'Storage', disposal: 'Disposal', other: 'Other',
  }
  const pMatched = pQuery.trim()
    ? allP.filter((x) => (x.code + ' ' + x.text_en).toLowerCase().includes(pQuery.trim().toLowerCase()))
    : allP
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

  return (
    <div ref={toolRef} className="lm-wrap">

      {/* ── ИСТОЧНИК КЛАССИФИКАЦИИ — ПОЛОСА НАД КОНСТРУКТОРОМ ──────────────
          ⚠⚠ Это первое, что человек видит над инструментом, и здесь ровно два
          пути: взять вещество из перечня или задать классификацию самому.
          Списка веществ здесь НЕТ — он на своей странице. */}
      <div className="lm-source">
        <div className="lm-source-main">
          <p className="tool-label">Start from a substance</p>
          <form className="lm-source-form" onSubmit={goPick} role="search">
            <input
              type="search"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Search name or CAS — acetone, 67-64-1…"
              aria-label="Search the CLP Annex VI list"
              className="tool-search"
            />
            <button type="submit" className="tool-cta">Search →</button>
          </form>
          <div className="lm-source-links">
            <a href={pickHref()} className="tool-preview-all">Browse all substances →</a>
            <button
              type="button"
              onClick={() => { setClassOpen((v) => !v) }}
              className="lm-link"
              aria-expanded={classOpen}
            >
              {classOpen ? 'Hide the classification panel' : 'My own mixture — set the classification myself'}
            </button>
          </div>
        </div>

        <div className="lm-source-state">
          {loading ? (
            <p className="lm-hint">Loading substance data…</p>
          ) : notFound ? (
            <>
              <p className="k">Not in the list</p>
              <p className="v">CAS {cas}</p>
              <p className="lm-hint">
                This number has no harmonised CLP Annex VI entry. Set the classification yourself,
                or search by name.
              </p>
            </>
          ) : substance ? (
            <>
              <p className="k">Selected substance</p>
              <p className="v">{displayName}</p>
              {ids?.cas && <p className="cas">CAS {ids.cas}</p>}
              <p className="lm-hint">
                Pictograms, signal word and H/P statements come from CLP Annex VI.
              </p>
            </>
          ) : (
            <>
              <p className="k">No substance selected</p>
              <p className="lm-hint">
                The label below is empty and ready. Pick a substance to fill the classification
                in, or type your own product name straight into the tool.
              </p>
            </>
          )}
          <button type="button" onClick={startOver} className="lm-reset">↺ Start over</button>
        </div>
      </div>

      {/* ── ПАНЕЛЬ РУЧНОЙ КЛАССИФИКАЦИИ ────────────────────────────────────
          ⚠ Открывается по требованию. Когда вещество выбрано, она не нужна —
          и не должна молча спорить с гармонизированной классификацией. */}
      {classOpen && (
        <div className="tool-panel lm-form">
          {usingSubstance && (
            <p className="tool-note warn">
              A substance from CLP Annex VI is selected, and its classification wins. Press
              <strong> ↺ Start over</strong> to build the label from your own classification instead.
            </p>
          )}
          {refLoading && <p className="lm-hint">Loading reference data…</p>}

          <div>
            <p className="tool-label">Signal word</p>
            <div className="tool-chips">
              {[{ v: 'Danger', l: 'Danger' }, { v: 'Warning', l: 'Warning' }, { v: null, l: 'No signal word' }].map((o) => (
                <button
                  key={String(o.v)} type="button" onClick={() => setMixSignal(o.v)}
                  className={mixSignal === o.v ? 'tool-chip on' : 'tool-chip'}
                >{o.l}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="tool-label">Pictograms</p>
            <div className="lm-pics">
              {allPics.map((p) => {
                const on = pickedPics.includes(p.code)
                return (
                  <button
                    key={p.code} type="button" title={p.name_en} aria-pressed={on}
                    onClick={() => setPickedPics((prev) => on ? prev.filter((c) => c !== p.code) : [...prev, p.code])}
                    className={on ? 'lm-pic on' : 'lm-pic'}
                  >
                    <span className="g" dangerouslySetInnerHTML={{ __html: p.svg_content ?? '' }} />
                    <span className="c">{p.code}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="lm-head">
              <p className="tool-label">Hazard statements</p>
              <span className="n">{pickedH.length} of {allH.length} selected</span>
            </div>
            <input
              type="search" value={hQuery} onChange={(e) => setHQuery(e.target.value)}
              placeholder="Search by code or text: flammable, H225…"
              aria-label="Search hazard statements"
              className="lm-input"
            />
            <div className="lm-scroll">
              {hFiltered.map((h) => {
                const on = pickedH.includes(h.code)
                return (
                  <label key={h.code} className={on ? 'lm-opt on' : 'lm-opt'}>
                    <input
                      type="checkbox" checked={on}
                      onChange={() => setPickedH((prev) => on ? prev.filter((c) => c !== h.code) : [...prev, h.code])}
                    />
                    <span><b>{h.code}</b> {h.text_en}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div>
            <div className="lm-head">
              <p className="tool-label">Precautionary statements</p>
              <span className="n">{pickedP.length} of {allP.length} selected</span>
            </div>
            <p className="lm-hint">
              Six is the usual maximum on a label — pick the ones that match how the product is actually used.
            </p>
            <input
              type="search" value={pQuery} onChange={(e) => setPQuery(e.target.value)}
              placeholder="Search by code or text: gloves, P280…"
              aria-label="Search precautionary statements"
              className="lm-input"
            />
            <div className="lm-scroll">
              {pGroups.map(([key, list]) => (
                <div key={key} className="lm-group">
                  <p className="gt">{P_TITLE[key] ?? key} ({list.length})</p>
                  {list.map((x) => {
                    const on = pickedP.includes(x.code)
                    return (
                      <label key={x.code} className={on ? 'lm-opt on' : 'lm-opt'}>
                        <input
                          type="checkbox" checked={on}
                          onChange={() => setPickedP((prev) => on ? prev.filter((c) => c !== x.code) : [...prev, x.code])}
                        />
                        <span><b>{x.code}</b> {x.text_en}</span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── КОНСТРУКТОР ─────────────────────────────────────────────────────
          ⚠⚠ БЕЗ УСЛОВИЙ. Он рисуется всегда, в том числе с пустым именем и
          пустой классификацией: увидеть инструмент важнее, чем показать его
          «готовым». Проверка соответствия внутри сама скажет, чего не хватает. */}
      <GHSLabelConstructor
        displayName={displayName}
        casNumber={ids?.cas ?? ''}
        ecNumber={ids?.ec ?? null}
        entryKey={substance?.cas_number}
        signalWord={outSignal}
        pictograms={outPics}
        hStatements={outH}
        pStatements={outP}
        initialJurisdiction={effJurisdiction}
        initialPurpose={effPurpose}
        initialStockId={effStockId}
        initialSecondLang={effLang}
        initialSelectedP={usingSubstance ? undefined : pickedP}
        nameVariants={nameVariants}
      />
    </div>
  )
}
