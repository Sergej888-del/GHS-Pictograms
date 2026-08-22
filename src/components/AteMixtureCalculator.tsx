// ATE Mixture Calculator — pro island (ghspictograms.com /tools/ate-mixture-calculator/)
// A rebuild of the old ghssymbols 3-route tool into a professional-grade
// classifier. What makes it "pro":
//   1. All five GHS inhalation-inclusive routes (oral, dermal, inhalation as
//      gas / vapour / dust-mist) — the old tool did three.
//   2. Table 3.1.2 conversion: a component with a harmonised acute-tox H-code
//      but no numeric ATE still enters the additivity formula via its converted
//      point estimate. This is THE GHS mixture method and it makes the tool work
//      across the whole 4,000-substance base, not just the ~848 with a number.
//   3. Provenance on every value (DB numeric / converted from H-code / manual /
//      unknown) — and the DB's ate_oral==1.00 import artifacts are refused.
//   4. The additivity formula with the >10% "unknown toxicity" correction.
//   5. Per-component manual override of ATE or category, per route.
//   6. StorageTool-rev6-grade search (Fuse + synonyms + common_name display +
//      multi-CAS via live /sds/ pages) and a "Full report →" link to /sds/.
//   7. A full professional report (print) — no email gate.
import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import ShareResult from './ShareResult'
import { supabase } from '../lib/supabase'
import { substanceNameFull, truncateName } from '../lib/substanceName'
import { casShapeOk, casForDisplay } from '../lib/substanceIdentifiers'
import {
  resolveRoute, computeRoute, rollUp, tableKey, UNITS, P_TEXT, RELEVANCE_CUTOFF_CAT1_3,
  type Route, type InhalForm, type Resolved, type RouteResult, type RouteWarning,
  type Annex6AcutePair, type Annex6Ate,
} from '../lib/ate'
import { ateMixtureCta } from '../lib/labelMakerCta'
import LabelMakerCtaBlock from './LabelMakerCtaBlock'

const ROUTES: Route[] = ['oral', 'dermal', 'inhalation']
const ROUTE_LABEL: Record<Route, string> = { oral: 'Oral', dermal: 'Dermal', inhalation: 'Inhalation' }
const INHAL_FORMS: { value: InhalForm; label: string }[] = [
  { value: 'gas', label: 'Gas' },
  { value: 'vapour', label: 'Vapour' },
  { value: 'dust_mist', label: 'Dust / mist' },
]

interface SubRow {
  id: string
  cas_number: string
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  synonyms: string[] | null
  ec_number: string | null
  molecular_formula: string | null
  h_statement_codes: string[] | null
  ate_oral: number | null
  index_number: string | null
}
/** Ответ `get_acute_tox_profile` на один index_number (s79, №100): точные
 *  категории Annex VI (A0) + гармонизированные ATE. Таблицы под ним закрыты для
 *  anon — читает SECURITY DEFINER RPC, как `get_storage_verdict`. */
interface AcuteProfile {
  pairs: (Annex6AcutePair & { raw?: string })[] | null
  ate: Annex6Ate[] | null
}
interface IndexedSub extends SubRow {
  display_name: string
  display_norm: string
  name_norm: string
  syn_norm: string
  cas_nodash: string
  display_cas: string
  sdsSlug: string | null
}
interface Comp {
  key: string
  substance_id: string | null
  cas: string
  name: string
  slug: string | null
  hCodes: string[] | null
  dbAteOral: number | null
  /** Annex VI index number — ключ профиля A0/ATE (null у веществ без записи). */
  indexNumber: string | null
  concentration: number
  manual: Partial<Record<Route, { ate?: number | null; cat?: number | null }>>
  /** «Данные есть, не классифицирован» — пути без значения считаются nonhazard, а не unknown (§6.1 п.1). */
  knownNonhazard: boolean
  /** Компонент вне Annex VI (вода, носитель, сырьё поставщика): имя вводится свободно, поиска нет (s79, design §4.2 зародыш). */
  unlisted: boolean
  showRefine: boolean
}
interface Pictogram { code: string; name_en: string; svg_content: string | null }
interface HRow { code: string; text_en: string }

let COMP_SEQ = 0
const newComp = (): Comp => ({
  key: `c${COMP_SEQ++}`, substance_id: null, cas: '', name: '', slug: null,
  hCodes: null, dbAteOral: null, indexNumber: null, concentration: 0, manual: {}, knownNonhazard: false, unlisted: false, showRefine: false,
})
/** Компонент вне Annex VI: по умолчанию «данные есть, не классифицирован» — это и есть вода/носитель. */
const newUnlisted = (name = ''): Comp => ({ ...newComp(), name, unlisted: true, knownNonhazard: true })

/** Тексты предупреждений пути — одни и те же в карточке и в PDF. */
const ROUTE_WARNING_TEXT: Record<RouteWarning, string> = {
  UNKNOWN_GT10: 'Provisional — ingredients of unknown acute toxicity exceed 10 % (Annex I 3.1.3.6.2.3)',
  CAT1_3_BELOW_1PCT: 'Includes a Category 1–3 ingredient below 1 % (generic cut-off 0,1 %, Table 1.1)',
  STAR: 'Annex VI minimum classification (*) in at least one ingredient — a stricter category may apply',
  FORM_MISMATCH: 'Annex VI prints an inhalation ATE for another physical form — converted value used instead',
  EDGE_POINT_ESTIMATE: 'ATEmix sits exactly on a category boundary because Table 3.1.2 point estimates are range edges — classified in the ingredients’ own category, not the stricter one',
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/sulph/g, 'sulf').replace(/aluminium/g, 'aluminum').replace(/\s+/g, ' ').trim()
}

const SOURCE_STYLE: Record<Resolved['source'], { label: string; cls: string }> = {
  db: { label: 'DB value', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  'annex6-ate': { label: 'Annex VI ATE', cls: 'bg-teal-50 text-teal-800 border-teal-300' },
  'annex6-cat': { label: 'Annex VI category', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  converted: { label: 'from H-code', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  manual: { label: 'manual', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  'manual-cat': { label: 'manual cat', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  nonhazard: { label: 'not classified (stated)', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  unknown: { label: 'unknown', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toPrecision(2))

// SDS Manager affiliate (results slot) — matches the GhsCalculator placement +
// its registered fp_sid=gpauth so conversions land in the existing dashboard link.
const SDS_AUTHORING_URL = 'https://sdsmanager.com/us/sds-authoring?fpr=ghs3&fp_sid=gpauth'
function track(event: string, params: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    ;(window as any).gtag('event', event, params)
  }
}

export default function AteMixtureCalculator() {
  const [all, setAll] = useState<IndexedSub[]>([])
  const [loading, setLoading] = useState(true)
  const [comps, setComps] = useState<Comp[]>(() => [newComp()])
  const [searchTexts, setSearchTexts] = useState<Record<string, string>>({})
  const [activeSearch, setActiveSearch] = useState<string | null>(null)
  const [inhalForm, setInhalForm] = useState<InhalForm>('vapour')

  const [result, setResult] = useState<ReturnType<typeof rollUp> | null>(null)
  const [pictograms, setPictograms] = useState<Pictogram[]>([])
  const [hStatements, setHStatements] = useState<HRow[]>([])
  const [calcInhalForm, setCalcInhalForm] = useState<InhalForm>('vapour')
  const [generating, setGenerating] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  // Профили A0/ATE по index_number (s79). Ключ есть → данных больше не спрашиваем
  // (пустой профиль тоже кэшируется, чтобы не дёргать RPC на каждый рендер).
  const [profiles, setProfiles] = useState<Map<string, AcuteProfile>>(() => new Map())

  async function loadProfiles(indexNumbers: (string | null | undefined)[]) {
    const want = Array.from(new Set(indexNumbers.filter((x): x is string => !!x && !profiles.has(x))))
    if (want.length === 0) return
    const { data, error } = await supabase.rpc('get_acute_tox_profile', { p_index: want.slice(0, 50) })
    const got = (!error && data && typeof data === 'object' ? data : {}) as Record<string, Partial<AcuteProfile>>
    setProfiles(prev => {
      const next = new Map(prev)
      for (const ix of want) next.set(ix, { pairs: got[ix]?.pairs ?? null, ate: got[ix]?.ate ?? null })
      return next
    })
  }

  // Load substances + live /sds/ registry once (StorageTool rev6 pattern).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const bySubId = new Map<string, { slug: string; cas: string }>()
      const slugByCas = new Map<string, string>()
      const { data: pages } = await supabase.from('sds_pages').select('slug, cas_number, substance_id').eq('status', 'live')
      for (const p of pages ?? []) {
        if (p.substance_id) bySubId.set(p.substance_id, { slug: p.slug, cas: p.cas_number })
        if (p.cas_number) slugByCas.set(p.cas_number, p.slug)
      }
      const rows: IndexedSub[] = []
      let from = 0
      const size = 1000
      while (true) {
        const { data, error } = await supabase
          .from('substances')
          .select('id, cas_number, iupac_name, common_name, display_name_short, synonyms, ec_number, molecular_formula, h_statement_codes, ate_oral, index_number')
          .not('cas_number', 'is', null)
          .order('cas_number', { ascending: true })
          .range(from, from + size - 1)
        if (error || !data || data.length === 0) break
        for (const r of data as SubRow[]) {
          const cas = r.cas_number?.trim()
          if (!cas || cas === '-') continue
          const page = bySubId.get(r.id) ?? null
          // ⚠⚠ Признак непечатаемого CAS — ФОРМА, а не скобка. Две записи склеены
          // БЕЗ маркеров («127087-87-09016-45-9», «3811-73-215922-78-8») и
          // проверку на скобку проходили насквозь; ещё у трёх страниц SDS свой
          // cas_number тоже не той формы. Правило одно — substanceIdentifiers.ts.
          if (!casShapeOk(cas) && !page) continue
          const displayCas = casShapeOk(cas) ? cas : (casForDisplay(page!.cas) || casForDisplay(cas))
          if (!displayCas) continue
          const displayName = substanceNameFull(r)
          rows.push({
            ...r, cas_number: cas,
            display_name: displayName, display_norm: norm(displayName), name_norm: norm(r.iupac_name),
            syn_norm: (r.synonyms ?? []).map(norm).filter(Boolean).join(' | '),
            cas_nodash: displayCas.replace(/-/g, ''), display_cas: displayCas,
            sdsSlug: page?.slug ?? slugByCas.get(cas) ?? null,
          })
        }
        if (data.length < size) break
        from += size
      }
      if (!cancelled) { setAll(rows); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Deep-links after load:
  //   ?mix=CAS:conc,CAS:conc&form=vapour  → rebuild a shared mixture (from Share)
  //   ?substance=CAS                       → prefill a single component (from /sds/)
  useEffect(() => {
    if (loading || all.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const findByCas = (cas: string) => all.find(x => x.cas_number === cas || x.display_cas === cas)
    const toComp = (s: IndexedSub, conc: number, knownNonhazard = false): Comp => ({
      ...newComp(), substance_id: s.id, cas: s.display_cas, name: s.display_name, slug: s.sdsSlug,
      hCodes: s.h_statement_codes, dbAteOral: s.ate_oral, indexNumber: s.index_number,
      concentration: Math.max(0, Math.min(100, conc)), knownNonhazard,
    })

    const form = params.get('form')
    if (form === 'gas' || form === 'vapour' || form === 'dust_mist') setInhalForm(form)

    const mix = params.get('mix')
    if (mix) {
      const built: Comp[] = []
      const texts: Record<string, string> = {}
      for (const part of mix.split(',')) {
        // CAS:conc[:n] — флаг «n» = knownNonhazard (s79), старые ссылки без него читаются как раньше;
        // ~name:conc[:u] — компонент вне Annex VI (s79), «u» = unknown (чекбокс снят)
        if (part.startsWith('~')) {
          const [rawName, concStr, flag] = part.slice(1).split(':')
          const name = decodeURIComponent(rawName ?? '').trim()
          if (!name) continue
          const c = { ...newUnlisted(name), concentration: Math.max(0, Math.min(100, parseFloat(concStr ?? '') || 0)), knownNonhazard: flag !== 'u' }
          built.push(c); texts[c.key] = name
          continue
        }
        const [cas, concStr, flag] = part.split(':')
        const s = cas && findByCas(cas.trim())
        if (!s) continue
        const c = toComp(s, parseFloat(concStr ?? '') || 0, flag === 'n')
        built.push(c); texts[c.key] = s.display_name
      }
      if (built.length) { setComps(built); setSearchTexts(texts); void loadProfiles(built.map(c => c.indexNumber)); return }
    }

    const cas = params.get('substance')?.trim()
    if (!cas) return
    const s = findByCas(cas)
    if (!s) return
    const c = toComp(s, 100)
    setComps([c])
    setSearchTexts({ [c.key]: s.display_name })
    void loadProfiles([c.indexNumber])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Shareable URL that reproduces the current mixture on the recipient's side.
  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const mix = comps
      .filter(c => (c.cas || (c.unlisted && c.name)) && c.concentration > 0)
      .map(c => c.unlisted
        ? `~${encodeURIComponent(c.name)}:${c.concentration}${c.knownNonhazard ? '' : ':u'}`
        : `${c.cas}:${c.concentration}${c.knownNonhazard ? ':n' : ''}`)
      .join(',')
    const base = `${window.location.origin}/tools/ate-mixture-calculator/`
    const qs = new URLSearchParams()
    if (mix) qs.set('mix', mix)
    if (inhalForm !== 'vapour') qs.set('form', inhalForm)
    const q = qs.toString()
    return q ? `${base}?${q}` : base
  }, [comps, inhalForm])

  const shareTitle = result?.signalWord
    ? `GHS/CLP acute toxicity: ${result.signalWord}${result.hCodes.length ? ' · ' + result.hCodes.join(', ') : ''} — ATE Mixture Calculator`
    : 'ATE Mixture Calculator — GHS/CLP acute toxicity classification'

  // ⚠⚠ БЛОК-ПЕРЕДАЧА В КОНСТРУКТОР — ИЗ `result`, а не из введённых компонентов:
  // элементы этикетки появляются только после `rollUp`, и до нажатия «Classify
  // mixture» передавать нечего. ⚠ При «not classified» (`worstCategory === null`)
  // сборщик возвращает `null`, и блок не рисуется вовсе — приглашение печатать
  // этикетку на неклассифицированную смесь читалось бы как наш недосчёт.
  const labelMakerCta = useMemo(
    () =>
      result
        ? ateMixtureCta({
            worstCategory: result.worstCategory,
            signalWord: result.signalWord,
            pictogram: result.pictogram,
            hCodes: result.hCodes,
            pCodes: result.pCodes,
          })
        : null,
    [result],
  )

  const fuse = useMemo(
    () => new Fuse(all, {
      keys: [
        { name: 'display_norm', weight: 2.5 }, { name: 'name_norm', weight: 2 }, { name: 'iupac_name', weight: 2 },
        { name: 'syn_norm', weight: 1.5 }, { name: 'cas_number', weight: 1.5 }, { name: 'display_cas', weight: 1.5 },
        { name: 'cas_nodash', weight: 1.5 }, { name: 'ec_number', weight: 1 },
      ],
      threshold: 0.2, minMatchCharLength: 2, ignoreLocation: true,
    }),
    [all],
  )

  const searchResults = useMemo(() => {
    if (!activeSearch) return []
    const q = norm(searchTexts[activeSearch] ?? '')
    if (q.length < 2) return []
    return fuse.search(q).slice(0, 8).map(r => r.item)
  }, [activeSearch, searchTexts, fuse])

  const totalConc = comps.reduce((s, c) => s + c.concentration, 0)
  /** Остаток до 100 % — по design §4.3 считается заявленным неклассифицированным (в формулу и в неизвестные не входит). */
  const remainder = Math.max(0, Math.round((100 - totalConc) * 10) / 10)

  function selectSub(key: string, s: IndexedSub) {
    setComps(prev => prev.map(c => c.key !== key ? c : {
      ...c, substance_id: s.id, cas: s.display_cas, name: s.display_name, slug: s.sdsSlug,
      hCodes: s.h_statement_codes, dbAteOral: s.ate_oral, indexNumber: s.index_number, manual: {}, knownNonhazard: false,
    }))
    setSearchTexts(t => ({ ...t, [key]: s.display_name }))
    setActiveSearch(null)
    void loadProfiles([s.index_number])
  }
  const setNonhazard = (key: string, v: boolean) =>
    setComps(prev => prev.map(c => c.key === key ? { ...c, knownNonhazard: v } : c))

  const setConc = (key: string, v: string) =>
    setComps(prev => prev.map(c => c.key === key ? { ...c, concentration: Math.max(0, Math.min(100, parseFloat(v) || 0)) } : c))
  const setManual = (key: string, route: Route, patch: { ate?: number | null; cat?: number | null }) =>
    setComps(prev => prev.map(c => c.key !== key ? c : { ...c, manual: { ...c.manual, [route]: { ...c.manual[route], ...patch } } }))
  const addComp = () => setComps(prev => [...prev, newComp()])
  const removeComp = (key: string) => setComps(prev => prev.filter(c => c.key !== key))
  /** «+ Add unlisted ingredient» — вода, носитель, сырьё поставщика; имя свободное. */
  const addUnlisted = (name = '', fromKey: string | null = null) => {
    const c = newUnlisted(name)
    setComps(prev => fromKey
      // из пустого поиска: заменяем ту же строку, а не добавляем вторую
      ? prev.map(x => x.key === fromKey ? { ...c, concentration: x.concentration } : x)
      : [...prev, c])
    setSearchTexts(t => ({ ...t, [c.key]: name }))
    setActiveSearch(null)
  }
  const setUnlistedName = (key: string, name: string) => {
    setComps(prev => prev.map(c => c.key === key ? { ...c, name: name.trim() } : c))
    setSearchTexts(t => ({ ...t, [key]: name }))
  }
  /** Обнулить калькулятор (просьба Сергея s79): состав, результат, форма, адрес. */
  const resetAll = () => {
    const c = newComp()
    setComps([c]); setSearchTexts({}); setActiveSearch(null)
    setResult(null); setPictograms([]); setHStatements([]); setPdfError(null)
    setInhalForm('vapour'); setCalcInhalForm('vapour')
    if (typeof window !== 'undefined' && window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }
  const toggleRefine = (key: string) => setComps(prev => prev.map(c => c.key === key ? { ...c, showRefine: !c.showRefine } : c))

  // Live per-component resolution (re-runs as inputs/inhalation-form change).
  const resolvedByComp = useMemo(() => {
    const map = new Map<string, Record<Route, Resolved>>()
    for (const c of comps) {
      const prof = c.indexNumber ? profiles.get(c.indexNumber) : undefined
      const input = {
        concentration: c.concentration, hCodes: c.hCodes, dbAteOral: c.dbAteOral, manual: c.manual,
        annex6: prof?.pairs ?? null, annex6Ate: prof?.ate ?? null, knownNonhazard: c.knownNonhazard,
      }
      map.set(c.key, {
        oral: resolveRoute(input, 'oral', inhalForm),
        dermal: resolveRoute(input, 'dermal', inhalForm),
        inhalation: resolveRoute(input, 'inhalation', inhalForm),
      })
    }
    return map
  }, [comps, inhalForm, profiles])

  // ⚠ s79 (№100): компонент категории 1–3 релевантен с 0,1 % (Table 1.1), поэтому
  // порог кнопки — RELEVANCE_CUTOFF_CAT1_3, а не 1 %; движок сам решит, кто входит.
  const canCalc = comps.some(c => c.name && c.concentration >= RELEVANCE_CUTOFF_CAT1_3)

  async function calculate() {
    const routeResults: RouteResult[] = ROUTES.map(route => {
      const key = tableKey(route, inhalForm)
      const rows = comps.filter(c => c.name).map(c => ({ conc: c.concentration, resolved: resolvedByComp.get(c.key)![route] }))
      return computeRoute(rows, route, key)
    })
    const roll = rollUp(routeResults)
    setResult(roll)
    setCalcInhalForm(inhalForm)

    if (roll.pictogram) {
      const { data } = await supabase.from('pictograms_signals').select('code, name_en, svg_content').eq('code', roll.pictogram)
      setPictograms((data ?? []) as Pictogram[])
    } else setPictograms([])

    if (roll.hCodes.length) {
      const { data } = await supabase.from('h_statements').select('code, text_en:text_plain').in('code', roll.hCodes)
      setHStatements(((data ?? []) as HRow[]).sort((a, b) => a.code.localeCompare(b.code)))
    } else setHStatements([])
  }

  // ── Professional report — true PDF download (no email gate, no print dialog).
  async function downloadReport() {
    if (!result || generating) return
    setGenerating(true)
    const date = new Date().toISOString().slice(0, 10)
    const formLabel = INHAL_FORMS.find(f => f.value === calcInhalForm)!.label
    const compRows = comps.filter(c => c.name).map(c => {
      const r = resolvedByComp.get(c.key)!
      const cell = (x: Resolved) => x.ate != null
        ? `${fmt(x.ate)}${x.star ? ' *' : ''} <span style="color:#94a3b8">(${SOURCE_STYLE[x.source].label}${x.cat != null && x.source !== 'manual' && x.source !== 'manual-cat' ? ` cat ${x.cat}` : ''}${x.ambiguous ? ', 1–2?' : ''})</span>`
        : x.source === 'nonhazard' ? '<span style="color:#64748b">not classified (stated)</span>' : '<span style="color:#cbd5e1">unknown</span>'
      return `<tr><td>${c.name}${c.unlisted ? ' <span style="color:#94a3b8;font-size:10px">(not in Annex VI)</span>' : ''}</td><td style="font-family:monospace">${c.cas || '—'}</td><td style="text-align:right">${c.concentration.toFixed(1)}%</td><td>${cell(r.oral)}</td><td>${cell(r.dermal)}</td><td>${cell(r.inhalation)}</td></tr>`
    }).join('') + (remainder > 0
      ? `<tr><td colspan="2" style="color:#64748b">Unclassified remainder — assumed not classified (stated)</td><td style="text-align:right;color:#64748b">${remainder.toFixed(1)}%</td><td colspan="3" style="color:#94a3b8">not in the formula, not counted as unknown</td></tr>`
      : '')
    const routeCards = result.routes.map(rr => {
      if (rr.ateMix == null) return `<div class="rc"><div class="rl">${ROUTE_LABEL[rr.route]}${rr.route === 'inhalation' ? ` (${formLabel})` : ''}</div><div class="rv" style="color:#94a3b8">Not classified</div><div class="ru">${rr.knownCount === 0 ? 'no data for any component' : ''}</div></div>`
      const warns = rr.warnings.filter(w => w !== 'UNKNOWN_GT10').map(w => `<div class="warn">${ROUTE_WARNING_TEXT[w]}</div>`).join('')
      const cat = rr.category == null ? '<div class="cat" style="background:#e2e8f0;color:#334155">above Category 4 — not classified</div>' : `<div class="cat cat${rr.category <= 2 ? 'd' : 'w'}">Category ${rr.category} · ${rr.hCode}</div>`
      return `<div class="rc"><div class="rl">${ROUTE_LABEL[rr.route]}${rr.route === 'inhalation' ? ` (${formLabel})` : ''}</div><div class="rv">${fmt(rr.ateMix)}<span class="us"> ${UNITS[rr.key]}</span></div>${cat}${rr.corrected ? `<div class="warn">Corrected for ${rr.unknownConc.toFixed(1)}% unknown (3.1.3.6.2.3)</div>` : ''}${warns}${rr.nonhazardConc > 0 ? `<div class="warn" style="color:#64748b">${rr.nonhazardConc.toFixed(1)}% stated not classified — excluded</div>` : ''}<div style="margin-top:4px;font-family:monospace;font-size:9px;color:#94a3b8">rule ${rr.ruleKey}</div></div>`
    }).join('')
    const hRows = hStatements.map(h => `<tr><td style="font-family:monospace;font-weight:700;color:#991b1b">${h.code}</td><td>${h.text_en}</td></tr>`).join('')
    const pRows = result.pCodes.map(p => `<tr><td style="font-family:monospace;font-weight:700;color:#166534">${p}</td><td>${P_TEXT[p] ?? ''}</td></tr>`).join('')
    const picto = pictograms.map(p => `<div style="width:74px;height:74px;border:2px solid #111;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;transform:rotate(45deg);margin:8px 14px"><div style="transform:rotate(-45deg);width:52px;height:52px">${p.svg_content ?? p.code}</div></div>`).join('')
    const sig = result.signalWord ?? 'Not classified'
    const sigBg = sig === 'Danger' ? '#dc2626' : sig === 'Warning' ? '#facc15' : '#e5e7eb'
    const sigFg = sig === 'Danger' ? '#ffffff' : '#0f172a'
    // Self-contained fragment; every rule scoped under .ate-pdf-root so nothing
    // leaks onto the live page while html2pdf renders it offscreen.
    const reportHtml = `<div class="ate-pdf-root">
      <style>
        .ate-pdf-root{font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:13px;color:#0f172a;background:#fff;width:760px;padding:32px}
        .ate-pdf-root *{box-sizing:border-box}
        .ate-pdf-root h1{font-size:21px;margin:0 0 2px}
        .ate-pdf-root .meta{color:#64748b;font-size:11px;margin-bottom:18px}
        .ate-pdf-root h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin:22px 0 10px}
        .ate-pdf-root table{width:100%;border-collapse:collapse;font-size:12px}
        .ate-pdf-root th{background:#f1f5f9;text-align:left;padding:6px 8px;border:1px solid #e2e8f0}
        .ate-pdf-root td{padding:6px 8px;border:1px solid #eef2f7;vertical-align:top}
        .ate-pdf-root .sig{display:inline-block;padding:6px 22px;border-radius:20px;font-weight:800;font-size:15px;background:${sigBg};color:${sigFg}}
        .ate-pdf-root .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:6px 0 4px}
        .ate-pdf-root .rc{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;min-width:0}
        .ate-pdf-root section{page-break-inside:avoid;break-inside:avoid}
        .ate-pdf-root tr{page-break-inside:avoid;break-inside:avoid}
        .ate-pdf-root .rl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
        .ate-pdf-root .rv{font-size:22px;font-weight:800;margin-top:2px}
        .ate-pdf-root .us{font-size:11px;font-weight:500;color:#94a3b8}
        .ate-pdf-root .cat{display:inline-block;margin-top:6px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9px}
        .ate-pdf-root .catd{background:#fee2e2;color:#991b1b}.ate-pdf-root .catw{background:#fef9c3;color:#854d0e}
        .ate-pdf-root .warn{margin-top:5px;font-size:10px;color:#b45309}
        .ate-pdf-root .foot{margin-top:26px;font-size:10px;color:#94a3b8;border-top:1px solid #eef2f7;padding-top:10px;line-height:1.5}
        .ate-pdf-root svg{max-width:100%;max-height:100%}
      </style>
      <h1>ATE Mixture Classification Report</h1>
      <div class="meta">Generated ${date} · ghspictograms.com · Method: UN GHS Chapter 3.1 / CLP Annex I 3.1.3 (additivity formula, Table 3.1.2 conversion)</div>
      <div class="sig">${sig}${result.pictogram ? ` · ${result.pictogram}` : ''}</div>${result.provisional ? ' <span style="display:inline-block;margin-left:8px;padding:4px 10px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:12px;font-size:11px;font-weight:700">Provisional</span>' : ''}
      ${picto ? `<section><h2>Pictogram</h2><div>${picto}</div></section>` : ''}
      <section><h2>Acute toxicity estimate — by route</h2><div class="cards">${routeCards}</div></section>
      <section><h2>Mixture components</h2><table><thead><tr><th>Component</th><th>CAS</th><th style="text-align:right">Conc.</th><th>ATE oral</th><th>ATE dermal</th><th>ATE inhal.</th></tr></thead><tbody>${compRows}</tbody></table></section>
      ${hRows ? `<section><h2>Hazard statements</h2><table><thead><tr><th style="width:64px">Code</th><th>Statement</th></tr></thead><tbody>${hRows}</tbody></table></section>` : ''}
      ${pRows ? `<section><h2>Precautionary statements</h2><table><thead><tr><th style="width:82px">Code</th><th>Statement</th></tr></thead><tbody>${pRows}</tbody></table></section>` : ''}
      <div class="foot">Formula (Annex I 3.1.3.6.1): 100 / ATE<sub>mix</sub> = &Sigma;(C<sub>i</sub> / ATE<sub>i</sub>) over relevant ingredients with a known ATE — &ge; 1%, or &ge; 0,1% for Category 1–3 ingredients (Table 1.1). Where relevant ingredients of unknown acute toxicity exceed 10%, the numerator is corrected to (100 − &Sigma;C<sub>unknown</sub>) (3.1.3.6.2.3). Values: harmonised Annex VI ATE where printed, otherwise the Annex VI category converted via Table 3.1.2; * marks a minimum classification (Annex VI 1.2.1). Inhalation classified as ${formLabel.toLowerCase()}. This report is a computed aid for SDS authoring, not a substitute for classification review — verify against each ingredient's SDS and Annex VI.</div>
    </div>`
    // ⚠⚠ s79: html2pdf клонирует фрагмент в `document.body` (overlay → container →
    // фрагмент), а html2canvas 1.4.1 разбирает computed-цвета КАЖДОГО узла, включая
    // container без собственного `color` — тот наследует `text-gray-900` от body,
    // а в Tailwind v4 это `oklch(…)`, которого html2canvas не знает: «Attempting to
    // parse an unsupported color function "oklch"» — кнопка молча не работала.
    // Лечение — `onclone`: в клоне документа задать html/body/overlay hex-цвета, так
    // что ни один разбираемый узел не видит oklch. Ошибка больше не глотается.
    try {
      // html2pdf.js = jsPDF + html2canvas. Dynamic import → code-split, loads only
      // on click. Renders the fragment offscreen and downloads a real .pdf file.
      const html2pdf = (await import('html2pdf.js')).default as any
      const holder = document.createElement('div')
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;color:#0f172a;background:#ffffff;'
      holder.innerHTML = reportHtml
      document.body.appendChild(holder)
      const neutralise = (doc: Document) => {
        for (const el of [doc.documentElement, doc.body, ...Array.from(doc.querySelectorAll<HTMLElement>('.html2pdf__overlay, .html2pdf__container'))]) {
          if (!el) continue
          el.style.color = '#0f172a'
          el.style.backgroundColor = '#ffffff'
          el.style.borderColor = '#e2e8f0'
        }
        // Страховка: любой узел фрагмента, у которого computed-цвет всё же oklch/color-mix
        // (наследование, preflight), получает явный hex — html2canvas иначе падает.
        const win = doc.defaultView
        if (!win) return
        const PROPS: Array<[string, string]> = [
          ['color', '#0f172a'], ['backgroundColor', 'transparent'],
          ['borderTopColor', '#e2e8f0'], ['borderRightColor', '#e2e8f0'], ['borderBottomColor', '#e2e8f0'], ['borderLeftColor', '#e2e8f0'],
          ['textDecorationColor', '#0f172a'], ['outlineColor', 'transparent'],
        ]
        doc.querySelectorAll<HTMLElement>('.html2pdf__container, .html2pdf__container *').forEach(el => {
          const cs = win.getComputedStyle(el)
          for (const [prop, fallback] of PROPS) {
            const v = (cs as any)[prop] as string | undefined
            if (v && /oklch|oklab|color-mix|lab\(|lch\(/i.test(v)) (el.style as any)[prop] = fallback
          }
        })
      }
      try {
        await html2pdf()
          .set({
            margin: [10, 10, 12, 10],
            filename: `ate-mixture-report-${date}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', onclone: neutralise },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            // ⚠ s79: `avoid-all` переносил ЦЕЛУЮ таблицу P-фраз на новую страницу,
            // оставляя заголовок и полстраницы пустоты. Теперь: css + legacy,
            // неразрывны только <section> (заголовок + его таблица) и строки <tr>.
            pagebreak: { mode: ['css', 'legacy'], avoid: ['section', 'tr', '.rc'] },
          })
          .from(holder.firstElementChild as HTMLElement)
          .save()
      } finally {
        holder.remove()
      }
      setPdfError(null)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Inhalation form selector */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Inhalation form</span>
        <div className="flex gap-1.5">
          {INHAL_FORMS.map(f => (
            <button key={f.value} type="button" onClick={() => setInhalForm(f.value)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${inhalForm === f.value ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">Sets which Table 3.1.1 column the inhalation route uses.</span>
      </div>

      {/* Components */}
      <div className="space-y-3">
        {comps.map((c, idx) => {
          const r = resolvedByComp.get(c.key)!
          return (
            <div key={c.key} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start gap-2">
                <div className="relative flex-1">
                  {c.unlisted ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text" placeholder="Ingredient not in Annex VI — e.g. water, carrier, supplier raw material"
                        value={searchTexts[c.key] ?? ''}
                        onChange={e => setUnlistedName(c.key, e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                      />
                      <span className="shrink-0 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500" title="Not an Annex VI entry — values come from you (Refine ATE) or it counts as not classified">unlisted</span>
                    </div>
                  ) : (
                  <input
                    type="text" placeholder="Search chemical name, synonym or CAS…"
                    value={searchTexts[c.key] ?? ''}
                    onChange={e => { setSearchTexts(t => ({ ...t, [c.key]: e.target.value })); setActiveSearch(c.key) }}
                    onFocus={() => setActiveSearch(c.key)}
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                  />
                  )}
                  {!c.unlisted && !loading && activeSearch === c.key && searchResults.length === 0 && norm(searchTexts[c.key] ?? '').length >= 2 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-xl">
                      No Annex VI entry matches «{searchTexts[c.key]}».{' '}
                      <button type="button" onClick={() => addUnlisted(searchTexts[c.key] ?? '', c.key)} className="font-semibold text-teal-700 hover:underline">
                        Add it as an unlisted ingredient
                      </button>
                      {' '}(water, carriers, supplier raw materials — treated as not classified unless you enter an ATE).
                    </div>
                  )}
                  {!c.unlisted && activeSearch === c.key && searchResults.length > 0 && (
                    <ul className="absolute z-20 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
                      {searchResults.map(s => (
                        <li key={s.id}>
                          <button type="button" onClick={() => selectSub(c.key, s)} className="w-full px-3 py-2 text-left text-sm hover:bg-teal-50">
                            <span className="font-medium text-gray-900" title={s.display_name}>{truncateName(s.display_name)}</span>
                            <span className="ml-2 font-mono text-xs text-gray-400">{s.display_cas}</span>
                            {(s.h_statement_codes ?? []).some(h => isAcuteTox(h)) && <span className="ml-2 text-xs text-teal-600">acute-tox data</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {comps.length > 1 && (
                  <button type="button" onClick={() => removeComp(c.key)} className="shrink-0 p-2 text-gray-400 hover:text-rose-500" aria-label="Remove component">✕</button>
                )}
              </div>

              {/* concentration */}
              <div className="mt-3 flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">Concentration</span>
                <input type="range" min={0} max={100} step={0.1} value={c.concentration} onChange={e => setConc(c.key, e.target.value)} className="h-2 flex-1 cursor-pointer accent-teal-600" />
                <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-gray-300">
                  <input type="number" min={0} max={100} step={0.1} value={c.concentration || ''} onChange={e => setConc(c.key, e.target.value)} className="w-16 px-2 py-1.5 text-right text-sm outline-none focus:ring-2 focus:ring-teal-500/20" />
                  <span className="self-stretch border-l border-gray-300 bg-gray-50 px-1.5 text-sm text-gray-400 flex items-center">%</span>
                </div>
              </div>

              {/* resolved ATE chips + refine */}
              {c.name && (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {ROUTES.map(route => {
                      const x = r[route]
                      const st = SOURCE_STYLE[x.source]
                      return (
                        <span key={route} title={x.provenance + (x.warnings.length ? ' · ' + x.warnings.join(', ') : '')}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${st.cls}`}>
                          <span className="font-semibold">{ROUTE_LABEL[route]}{route === 'inhalation' ? ` (${INHAL_FORMS.find(f => f.value === inhalForm)!.label})` : ''}:</span>
                          {x.ate != null ? <span>{fmt(x.ate)} {UNITS[tableKey(route, inhalForm)]}</span> : <span>—</span>}
                          <span className="opacity-70">· {st.label}{x.cat != null && x.source !== 'manual' && x.source !== 'manual-cat' ? ` cat ${x.cat}` : ''}{x.ambiguous ? ' (1–2?)' : ''}{x.star ? ' *' : ''}</span>
                        </span>
                      )
                    })}
                    <button type="button" onClick={() => toggleRefine(c.key)} className="text-xs font-semibold text-teal-700 hover:underline">
                      {c.showRefine ? 'Close' : 'Refine ATE ▾'}
                    </button>
                    {c.slug && <a href={`/sds/${c.slug}/`} className="text-xs font-semibold text-teal-700 hover:underline">Full report →</a>}
                  </div>

                  {c.showRefine && (
                    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      {/* s79 (№100 п.1): «данные есть, не классифицирован» — пути без значения
                          выходят и из формулы, и из суммы неизвестных (вода, носители). */}
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700">
                        <input type="checkbox" checked={c.knownNonhazard} onChange={e => setNonhazard(c.key, e.target.checked)} className="mt-0.5 accent-teal-600" />
                        <span><span className="font-semibold">Data available — not classified for acute toxicity.</span> Routes without a value are treated as known non-hazardous (e.g. water, inert carriers) instead of «unknown», so they do not trigger the &gt;10 % unknown-ingredient correction.</span>
                      </label>
                      <p className="text-xs text-gray-500">Override the auto value per route — enter a numeric ATE (LD50/LC50 point estimate) or pick a hazard category. Leave blank to keep the auto value.</p>
                      {ROUTES.map(route => (
                        <div key={route} className="flex flex-wrap items-center gap-2">
                          <span className="w-28 shrink-0 text-xs font-medium text-gray-600">{ROUTE_LABEL[route]}{route === 'inhalation' ? ` (${INHAL_FORMS.find(f => f.value === inhalForm)!.label})` : ''}</span>
                          <input
                            type="number" min={0} step="any" placeholder="ATE value"
                            value={c.manual[route]?.ate ?? ''}
                            onChange={e => setManual(c.key, route, { ate: e.target.value === '' ? null : Math.max(0, parseFloat(e.target.value) || 0), cat: null })}
                            className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-teal-500/20"
                          />
                          <span className="text-xs text-gray-400">or</span>
                          <select
                            value={c.manual[route]?.cat ?? ''}
                            onChange={e => setManual(c.key, route, { cat: e.target.value === '' ? null : parseInt(e.target.value, 10), ate: null })}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-teal-500/20">
                            <option value="">Auto</option>
                            <option value="1">Category 1</option>
                            <option value="2">Category 2</option>
                            <option value="3">Category 3</option>
                            <option value="4">Category 4</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* total + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* s79 (design §4.3): остаток до 100 % — заявленный неклассифицированный, и это написано прямо */}
        <span className={`text-sm font-medium ${totalConc > 100.05 ? 'text-rose-600' : 'text-teal-600'}`}>
          Total: {totalConc.toFixed(1)}%
          {totalConc > 100.05 && ' — exceeds 100%'}
          {remainder > 0 && <span className="text-gray-500"> · {remainder.toFixed(1)}% remainder — assumed not classified (stated)</span>}
        </span>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={resetAll} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-rose-400 hover:text-rose-600" title="Clear all components and the result">Reset</button>
          <button type="button" onClick={addComp} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-teal-500 hover:text-teal-700">+ Add component</button>
          <button type="button" onClick={() => addUnlisted()} className="rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-teal-500 hover:text-teal-700" title="Water, carriers, supplier raw materials — not in Annex VI">+ Add unlisted ingredient</button>
          <button type="button" onClick={calculate} disabled={!canCalc} className="rounded-lg bg-teal-600 px-6 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40">Classify mixture</button>
        </div>
      </div>

      {/* results */}
      {result && (
        <div className="space-y-6 rounded-2xl border border-teal-200 bg-teal-50/60 p-6">
          <div className="flex flex-wrap items-center gap-4">
            <h3 className="text-lg font-bold text-gray-900" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Classification result</h3>
            <span className={`rounded-full px-5 py-1.5 text-sm font-bold ${result.signalWord === 'Danger' ? 'bg-rose-600 text-white' : result.signalWord === 'Warning' ? 'bg-yellow-400 text-yellow-900' : 'bg-gray-200 text-gray-600'}`}>
              {result.signalWord ?? 'Not classified for acute toxicity'}
            </span>
            {result.provisional && (
              <span title={ROUTE_WARNING_TEXT.UNKNOWN_GT10} className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Provisional</span>
            )}
          </div>

          {pictograms.length > 0 && (
            <div className="flex flex-wrap gap-6">
              {pictograms.map(p => (
                <div key={p.code} className="flex flex-col items-center gap-1">
                  <div className="flex h-20 w-20 rotate-45 items-center justify-center rounded-lg border-2 border-black bg-white">
                    <div className="h-14 w-14 -rotate-45 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: p.svg_content ?? '' }} />
                  </div>
                  <span className="mt-1 font-mono text-xs text-gray-400">{p.code}</span>
                </div>
              ))}
            </div>
          )}

          {/* per-route ATE cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {result.routes.map(rr => (
              <div key={rr.route} className="rounded-xl bg-white p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  ATEmix {ROUTE_LABEL[rr.route]}{rr.route === 'inhalation' ? ` (${INHAL_FORMS.find(f => f.value === calcInhalForm)!.label})` : ''}
                </div>
                {rr.ateMix != null ? (
                  <>
                    <div className="mt-0.5 text-2xl font-bold text-gray-900">{fmt(rr.ateMix)}</div>
                    <div className="text-xs text-gray-400">{UNITS[rr.key]}</div>
                    {rr.category != null ? (
                      <div className={`mt-2 inline-block rounded px-2 py-1 text-xs font-bold ${rr.category <= 2 ? 'bg-rose-100 text-rose-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        Category {rr.category} · {rr.hCode}
                      </div>
                    ) : (
                      // ATEmix выше потолка категории 4 (Table 3.1.1) — по этому пути не классифицируется
                      <div className="mt-2 inline-block rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">Not classified — above Category 4</div>
                    )}
                    {rr.corrected && <p className="mt-2 text-xs text-amber-600">Corrected for {rr.unknownConc.toFixed(1)}% unknown toxicity</p>}
                  </>
                ) : (
                  <div className="mt-2 text-sm text-gray-400">{rr.knownCount === 0 ? 'No ATE data for any component' : 'Not classified'}</div>
                )}
                {rr.warnings.filter(w => w !== 'UNKNOWN_GT10').map(w => (
                  <p key={w} className="mt-1.5 text-[11px] leading-snug text-amber-700">{ROUTE_WARNING_TEXT[w]}</p>
                ))}
                {rr.nonhazardConc > 0 && <p className="mt-1.5 text-[11px] leading-snug text-gray-500">{rr.nonhazardConc.toFixed(1)}% stated not classified — excluded from the formula</p>}
                {rr.ateMix != null && <p className="mt-1.5 font-mono text-[10px] text-gray-400">rule {rr.ruleKey}</p>}
              </div>
            ))}
          </div>

          {hStatements.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Hazard statements</h4>
              <div className="space-y-2">
                {hStatements.map(h => (
                  <div key={h.code} className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
                    <span className="w-14 shrink-0 font-mono font-bold">{h.code}</span><p className="font-medium">{h.text_en}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.pCodes.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Precautionary statements</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.pCodes.map(p => (
                  <div key={p} className="flex gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    <span className="w-20 shrink-0 font-mono font-bold">{p}</span><p>{P_TEXT[p] ?? ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-teal-200 bg-white p-4">
            <p className="mb-3 text-sm font-medium text-gray-900">Download the full classification report as a PDF for your SDS section 2 / 3.</p>
            <button type="button" onClick={downloadReport} disabled={generating} className="rounded-lg bg-teal-600 px-6 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 disabled:cursor-wait">
              {generating ? 'Generating PDF…' : 'Download PDF report'}
            </button>
            {pdfError && (
              <p className="mt-2 text-xs text-rose-700">PDF export failed ({pdfError}). Use your browser’s Print (Ctrl+P / ⌘P) and choose «Save as PDF» instead.</p>
            )}
            <ShareResult url={shareUrl} title={shareTitle} />
          </div>

          {/* ⭐⭐ Вход в конструктор — ВЫШЕ партнёрской карточки (решение
              session 53: бесплатный инструмент прежде платного партнёра).
              Замер session 45: ATE считают ровно затем, чтобы напечатать
              этикетку на смесь, а в блоке «дальше» предлагали SDS-библиотеку и
              матрицу хранения. 20 780 запросов за сутки против 133 у главной —
              это второй по стоимости вход на сайте. */}
          <LabelMakerCtaBlock content={labelMakerCta} variant="wide" />

          {/* SDS Manager affiliate slot — the classification result belongs in SDS section 2. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-900">
              This mixture classification belongs in <strong>section 2</strong> of your Safety Data Sheet.
            </p>
            <a
              href={SDS_AUTHORING_URL}
              target="_blank"
              rel="sponsored nofollow noopener"
              onClick={() => track('affiliate_click', { partner: 'sds_manager', placement: 'ate_mixture_calculator' })}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Author the SDS with SDS Manager †
            </a>
            <p className="mt-2 text-[11px] text-gray-500">
              † SDS Manager is a partner solution; we may earn a commission.{' '}
              <a href="/affiliate-disclosure/" className="underline">See disclosure</a>.
            </p>
          </div>

          <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-600">
            <span className="font-semibold text-gray-800">Computed aid, not a classification decision.</span> ATE values are auto-resolved from harmonised Annex VI H-codes via GHS Table 3.1.2 where a measured value is absent; verify each ingredient against its SDS and refine where you hold better data.
          </p>
        </div>
      )}

      {loading && <p className="text-xs text-gray-400">Loading substance database…</p>}
    </div>
  )
}

function isAcuteTox(h: string): boolean {
  return ['H300', 'H301', 'H302', 'H310', 'H311', 'H312', 'H330', 'H331', 'H332'].includes(h)
}
