// src/components/MixtureClassifier.tsx — остров классификатора смесей
// (/tools/clp-mixture-classifier/, session 81, design-doc §7).
//
// ⭐⭐⭐ ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Остров НЕ СЧИТАЕТ. Он собирает состав,
// показывает, что подтянулось из Annex VI, отправляет всё на `/api/classify`
// и печатает ответ движка с провенансом. Ни одной таблицы правил здесь нет и
// быть не может: они закрыты для anon (№99), а service-ключ живёт только в
// `functions/api/classify/_shared.ts`.
//
// ⭐⭐⭐ ЛЕНТА «WHAT CHANGED» — главная находка разведки s80: такого нет ни у
// одного конкурента. Каждое действие человека записывается, а при следующем
// расчёте рядом печатается, ЧТО ИМЕННО поехало: какое правило перестало
// применяться и какая категория сменилась.
//
// ⚠⚠ ПЕРЕСЧЁТ — ПО КНОПКЕ, А НЕ НА КАЖДОЕ ДЕЙСТВИЕ. В прототипе движок жил в
// браузере и пересчитывал бесплатно. Здесь каждый расчёт — обращение к серверу
// и одна единица из 30 в час на IP: автопересчёт на каждое нажатие клавиши съел
// бы квоту за минуту. Поэтому действия копятся, результат помечается устаревшим
// (карточка №108 — тот же дефект в ATE-острове), и лента пишется в момент
// пересчёта.
//
// ⚠ Вёрстка — семья `mx-*` из `src/styles/mixture-classifier.css`, НЕ утилиты
// Tailwind: правило дизайн-системы §7. ATE-остров написан ещё на утилитах — он
// старше правила, равняться на него в этом не надо.
//
// ⛔⛔ ВСЕ СТРОКИ ДЛЯ ЧЕЛОВЕКА — ПО-АНГЛИЙСКИ (урок s68: литералы лежат в бандле
// и читаются по Ctrl+U независимо от того, вызовется ли ветка). Комментарии
// выбрасывает сборщик — они остаются русскими.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Audience, ClassifierResult, Decision, InhalForm, PhysicalState, Warning,
} from '../lib/classifier/types'
import { buildReport, resultFingerprint, stampTime } from '../lib/classifier/report'
import MixtureReport, { Picto } from './MixtureReport'
import { labelMakerHref } from '../lib/labelMakerLink'

/* ── контракт с Function ─────────────────────────────────────────────────── */

interface LookupCandidate {
  indexNumber: string
  name: string
  casPrimary: string | null
  ecPrimary: string | null
  hCodes: string[] | null
  formsSharingCas: number
  pairs: number
}

interface ProfilePair {
  classCode: string
  categoryCode: string | null
  hCode: string | null
  star: boolean
  raw: string
}

interface ProfileScl { raw: string; needsReview: boolean }
interface ProfileM { raw: string; value: number; scope: string | null; needsReview: boolean }
/**
 * ⚠ `unit` и `form` НУЛЛЯЕМЫ, и это не перестраховка: одна строка Annex VI
 * печатает ATE без единицы вовсе («ATE = 700 (gases)»), единицу выводит уже
 * движок по форме ингаляции. Объявить здесь `string` — значит однажды
 * напечатать в карточке «oral 700 null».
 */
interface ProfileAte { route: string; value: number; unit: string | null; form?: string | null }

interface Profile {
  substance: { name: string | null; casPrimary: string | null; ecPrimary: string | null; hCodes: string[] | null } | null
  pairs: ProfilePair[] | null
  scl: ProfileScl[] | null
  mFactors: ProfileM[] | null
  ate: ProfileAte[] | null
  notes: string[] | null
}

interface RateInfo { remaining: number; limit: number; resetAt: string }

/**
 * Тело запроса к `/api/classify`. ⭐⭐⭐ Оно же — то, что хранит короткая ссылка
 * (решение s80: хранится ВХОД, не результат). Поэтому тип объявлен отдельно и
 * используется в обе стороны: собрали → посчитали → отдали в `share`; получили
 * из `share` → посчитали тем же кодом. Две разные сборки тела означали бы, что
 * по ссылке считается не то, что считал автор.
 */
interface RequestBody {
  components: {
    id: string
    source: RowSource
    indexNumber: string | null
    name: string
    conc: number
    concMax: number | null
    knownNonhazard: boolean
    classifications: { classCode: string; categoryCode: string }[]
  }[]
  properties: {
    physicalState: PhysicalState
    inhalForm: InhalForm
    ph: number | null
    acidAlkaliReserve: boolean
    viscosityMm2s40c: number | null
    separatesIntoLayers: boolean
  }
  audience: Audience
  remainderStatedNonhazard: boolean
}

/** Что известно про открытую короткую ссылку и чем её ответ отличается от нашего. */
interface OpenedShare {
  createdAt: string
  releaseKey: string
  /** `null` — отпечаток не сохранялся (ссылка старше №118). */
  storedHash: string | null
  verdict: 'same' | 'changed' | 'unknown'
}

/* ── реестр классов (приходит со сборки, см. страницу) ───────────────────── */

export interface RegistryCategoryProp { code: string; h: string | null; pic: string | null; signal: string | null }
export interface RegistryClassProp {
  code: string
  name: string
  group: string
  euOnly: boolean
  categories: RegistryCategoryProp[]
}

interface Props {
  /**
   * ⚠ Реестр приходит СО СБОРКИ, а не из ответа расчёта. Ответ движка несёт
   * `classCode`, но не человеческое имя класса: печатать «STOT_SE» посетителю
   * нельзя, а второй сетевой запрос ради подписи — лишний. Список категорий из
   * того же реестра нужен форме поставщика: пары выбираются из списка, а не
   * набираются текстом (design-doc §4.2).
   */
  registry: RegistryClassProp[]
}

/* ── состояние состава ───────────────────────────────────────────────────── */

type RowSource = 'annex6' | 'supplier'

interface Row {
  key: string
  source: RowSource
  indexNumber: string | null
  name: string
  cas: string | null
  ec: string | null
  /** Ввод как текст: число в поле нельзя стирать до конца, если хранить number. */
  conc: string
  concMax: string
  /** Диапазон раскрыт вручную — иначе поле «max» только шумит (макет s80: одно поле). */
  range: boolean
  knownNonhazard: boolean
  profile: Profile | null
  formsSharingCas: number
  pairs: { classCode: string; categoryCode: string }[]
}

interface LedgerTransition { text: string; kind: 'rule' | 'category' | 'status' }
/** Действие человека, ждущее следующего расчёта. `key` — поле, по которому схлопывать повтор. */
interface PendingAction { key?: string; text: string }
interface LedgerEntry { id: number; actions: string[]; transitions: LedgerTransition[] }

/**
 * ⚠⚠ ВКЛАДОК ДВЕ, А НЕ ТРИ (решение Сергея, s81, после первого взгляда на прод).
 * В прототипе была третья — «03 Result», — но результат показан ВСЕГДА, справа,
 * при любой вкладке: это прямое требование «видеть, что происходит после
 * каждой операции». Значит третья вкладка не открывала ничего нового, она лишь
 * прятала левую колонку и растягивала таблицу — то есть была кнопкой «пошире»
 * с именем шага. ⛔ Управляющий элемент, который обещает содержимое и не даёт
 * его, хуже отсутствующего.
 */
type Tab = 'composition' | 'properties'

const STATES: { value: PhysicalState; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'liquid', label: 'Liquid' },
  { value: 'gas', label: 'Gas' },
]

const FORMS: { value: InhalForm; label: string }[] = [
  { value: 'gas', label: 'Gas (ppmV)' },
  { value: 'vapour', label: 'Vapour (mg/L)' },
  { value: 'dust_mist', label: 'Dust / mist (mg/L)' },
]

const FORM_SHORT: Record<InhalForm, string> = { gas: 'gas', vapour: 'vapour', dust_mist: 'dust / mist' }

const STATUS_LABEL: Record<Decision['status'], string> = {
  classified: 'Classified',
  not_classified: 'Not classified',
  insufficient_data: 'Insufficient data',
  not_computed: 'Not computed',
}

/** Классы, у которых строка результата зависит от выбранной формы ингаляции. */
const INHAL_CLASS = 'ACUTE_TOX_INHAL'

/**
 * ⚠ Форма ингаляции по умолчанию повторяет `defaultInhalForm` движка. Копия
 * здесь нужна, чтобы поле показывало то же, что посчитает сервер, ДО первого
 * расчёта; сам расчёт всё равно делает сервер, и он источник истины.
 */
function defaultForm(state: PhysicalState): InhalForm {
  return state === 'gas' ? 'gas' : state === 'solid' ? 'dust_mist' : 'vapour'
}

let seq = 0
const nextKey = (): string => `c${++seq}`

function num(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—'
  return Math.abs(n) >= 100 ? n.toFixed(digits) : n.toFixed(digits)
}

/**
 * Короткая половина причины `not_computed`. Движок печатает полное предложение
 * («Not computed in this version — module A4 (Cut-off classes) covers this class
 * and is not built yet. No ingredient in this mixture carries it.»), и в таблице
 * первая половина повторяется в каждой из двадцати строк, а вторая — та, ради
 * которой строку читают.
 *
 * ⚠ Режем ПО ТОЧКЕ первого предложения, а не по длине: если движок сменит
 * формулировку, здесь останется его текст целиком, а не обрубок посередине.
 * ⛔ Своего текста не пишем: причина обязана быть словами движка (контракт §5.2).
 */
function shortReason(reason: string | null): string {
  if (!reason) return ''
  const at = reason.indexOf('yet.')
  return at >= 0 ? reason.slice(at + 4).trim() || reason : reason
}

/**
 * Имя для ЛЕНТЫ, не для карточки. Записи Annex VI бывают под двести символов
 * («tetrasodium [7-(2,5-dihydroxy-KO2-7-sulfonato-6-[4-…]cuprate(II)»), и в
 * строке ленты такое имя стоит дважды — «добавил» и «пометил», — превращая
 * карточку в простыню. ⚠ Режем по границе слова и ставим многоточие: в
 * карточке состава имя остаётся ПОЛНЫМ, обрезка живёт только в журнале.
 */
function shortName(name: string, max = 44): string {
  if (name.length <= max) return name
  const cut = name.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`
}

/** Есть ли у компонента хоть одна гармонизированная пара острой токсичности. */
function hasHarmonisedAcute(r: Row): boolean {
  return (r.profile?.pairs ?? []).some((p) => p.classCode.startsWith('ACUTE_TOX'))
    || r.pairs.some((p) => p.classCode.startsWith('ACUTE_TOX'))
}

/** Эффективная концентрация строки: верх диапазона, иначе одно число. */
function effective(r: Row): number {
  const min = num(r.conc) ?? 0
  const max = r.range ? num(r.concMax) : null
  return max != null && max > min ? max : min
}

/* ── ЛЕНТА: что поехало между двумя расчётами ────────────────────────────── */

/**
 * ⭐⭐⭐ Сравнение двух ответов движка. Печатаем три вида перехода: категория,
 * статус и правило (в том числе флаг `provisional` — коррекция 3.1.3.6.2.3).
 *
 * ⚠ Сравниваем ПО КЛАССУ, а не по порядку строк: порядок задаёт реестр, и
 * вставка нового класса сдвинула бы всё и напечатала десять ложных переходов.
 */
function diffResults(
  prev: ClassifierResult | null,
  next: ClassifierResult,
  className: (c: string) => string,
): LedgerTransition[] {
  if (!prev) return []
  const out: LedgerTransition[] = []
  const before = new Map(prev.decisions.map((d) => [d.classCode, d]))

  for (const d of next.decisions) {
    const b = before.get(d.classCode)
    if (!b) continue
    const label = className(d.classCode)

    if (b.status !== d.status) {
      out.push({ kind: 'status', text: `${label}: ${STATUS_LABEL[b.status].toLowerCase()} → ${STATUS_LABEL[d.status].toLowerCase()}` })
    } else if (b.categoryCode !== d.categoryCode) {
      out.push({
        kind: 'category',
        text: `${label}: ${b.categoryCode ? `Category ${b.categoryCode}` : 'no category'} → ${d.categoryCode ? `Category ${d.categoryCode}` : 'no category'}`,
      })
    }

    if (b.ruleKey !== d.ruleKey && (b.ruleKey || d.ruleKey)) {
      out.push({
        kind: 'rule',
        text: d.ruleKey
          ? `${label}: the rule applied is now ${d.ruleKey}${b.ruleKey ? ` (was ${b.ruleKey})` : ''}`
          : `${label}: rule ${b.ruleKey} no longer applies`,
      })
    }

    if (!!b.provisional !== !!d.provisional) {
      out.push({
        kind: 'rule',
        text: d.provisional
          ? `${label}: correction 3.1.3.6.2.3 now applies — the result is provisional`
          : `${label}: correction 3.1.3.6.2.3 no longer applies`,
      })
    }
  }

  const codes = (r: ClassifierResult) => new Set(r.warnings.map((w) => w.code))
  const wb = codes(prev)
  const wn = codes(next)
  for (const c of wn) if (!wb.has(c)) out.push({ kind: 'rule', text: `new warning: ${c}` })
  for (const c of wb) if (!wn.has(c)) out.push({ kind: 'rule', text: `warning cleared: ${c}` })

  return out
}

/* ── мелкие части разметки ───────────────────────────────────────────────── */

/* ⚠ `Picto` переехал в `MixtureReport.tsx` (s84): один ромб на два места —
   вердикт острова и вердикт отчёта. Две копии разошлись бы. */

function Fold({ title, count, children }: { title: string; count: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`mx-fold ${open ? 'on' : ''}`}>
      <button type="button" className="mx-fold-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="t">{title}</span>
        <span className="c">{count}</span>
        <span className="a" aria-hidden="true">▾</span>
      </button>
      {open && <div className="mx-fold-body">{children}</div>}
    </div>
  )
}

function WarningLine({ w }: { w: Warning }) {
  return (
    <p className={`mx-warn ${w.level}`}>
      <b className="mono">{w.code}</b> {w.message}
      {w.ruleKey && <span className="mono"> · {w.ruleKey}</span>}
    </p>
  )
}

/* ── компонент ───────────────────────────────────────────────────────────── */

export default function MixtureClassifier({ registry }: Props) {
  const [tab, setTab] = useState<Tab>('composition')

  const [rows, setRows] = useState<Row[]>([])
  const [physicalState, setPhysicalState] = useState<PhysicalState>('liquid')
  const [inhalForm, setInhalForm] = useState<InhalForm>('vapour')
  const [formTouched, setFormTouched] = useState(false)
  const [ph, setPh] = useState('')
  const [reserve, setReserve] = useState(false)
  const [viscosity, setViscosity] = useState('')
  const [layers, setLayers] = useState(false)
  const [audience, setAudience] = useState<Audience>('professional')
  const [remainderStated, setRemainderStated] = useState(false)

  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<LookupCandidate[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [result, setResult] = useState<ClassifierResult | null>(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rate, setRate] = useState<RateInfo | null>(null)
  const [openWhy, setOpenWhy] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  /* ── отчёт, PDF и короткая ссылка (№118) ──────────────────────────────── */

  const [showReport, setShowReport] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  /**
   * ⚠ Тело, которым получен ТЕКУЩИЙ результат, а не то, что набрано слева.
   * Делиться надо ровно тем расчётом, который человек видит: состав мог
   * измениться после него (для этого и живёт пометка «out of date»).
   */
  const [lastBody, setLastBody] = useState<RequestBody | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [opened, setOpened] = useState<OpenedShare | null>(null)

  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const pending = useRef<PendingAction[]>([])
  const ledgerId = useRef(0)

  const classNameOf = useCallback(
    (code: string) => registry.find((c) => c.code === code)?.name ?? code,
    [registry],
  )

  /**
   * Записать действие человека. Печатается в ленте при следующем расчёте.
   *
   * ⚠ `key` схлопывает повтор по ОДНОМУ И ТОМУ ЖЕ полю: переключить состояние
   * на газ и обратно на жидкость — это ноль изменений, а лента печатала обе
   * строки и выглядела так, будто произошло два события. Остаётся последнее.
   */
  const note = useCallback((text: string, key?: string) => {
    const list = pending.current
    pending.current = key && list.length && list[list.length - 1]?.key === key
      ? [...list.slice(0, -1), { key, text }]
      : [...list, { key, text }]
    setStale(true)
  }, [])

  const touch = useCallback(() => setStale(true), [])

  const toggleWhy = useCallback((classCode: string) => {
    setOpenWhy((s) => ({ ...s, [classCode]: !s[classCode] }))
  }, [])

  /* ── поиск ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setCandidates([]); setSearchError(null); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/classify/lookup?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        if (cancelled) return
        if (!data.ok) {
          setSearchError(data.error?.message ?? 'The search could not be completed.')
          setCandidates([])
        } else {
          setSearchError(null)
          setCandidates(data.candidates ?? [])
          setProfiles((p) => ({ ...p, ...(data.profiles ?? {}) }))
          if (data.rateLimit) setRate(data.rateLimit)
        }
      } catch {
        if (!cancelled) {
          setSearchError('Search is unreachable from here. The API runs in the Cloudflare Pages build, not in the Astro dev server.')
          setCandidates([])
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 320)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  /* ── состав ───────────────────────────────────────────────────────────── */

  const blank = (over: Partial<Row>): Row => ({
    key: nextKey(), source: 'annex6', indexNumber: null, name: '', cas: null, ec: null,
    conc: '', concMax: '', range: false, knownNonhazard: false, profile: null,
    formsSharingCas: 0, pairs: [], ...over,
  })

  const addAnnex6 = (c: LookupCandidate) => {
    setRows((r) => [...r, blank({
      source: 'annex6', indexNumber: c.indexNumber, name: c.name,
      cas: c.casPrimary, ec: c.ecPrimary,
      profile: profiles[c.indexNumber] ?? null, formsSharingCas: c.formsSharingCas,
    })])
    note(`added ${shortName(c.name)} (${c.indexNumber})`)
    setQuery(''); setCandidates([])
  }

  const addSupplier = (name: string, withPairs: boolean) => {
    setRows((r) => [...r, blank({
      source: 'supplier', name,
      // ⚠ Вне Annex VI по умолчанию «данные есть, не классифицирован» — иначе
      // вода в каждом рецепте попадала бы в Σ C(unknown) и запускала коррекцию
      // 3.1.3.6.2.3 на пустом месте (урок аудита №100). Флаг виден и снимается.
      knownNonhazard: !withPairs,
    })])
    note(`added ${shortName(name)} as a supplier entry`)
    setQuery(''); setCandidates([])
  }

  const patch = (key: string, next: Partial<Row>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...next } : x)))
  }

  const remove = (key: string) => {
    const row = rows.find((x) => x.key === key)
    setRows((r) => r.filter((x) => x.key !== key))
    if (row) note(`removed ${shortName(row.name)}`)
  }

  const reset = () => {
    setRows([]); setResult(null); setStale(false); setLedger([]); setError(null)
    setQuery(''); setCandidates([]); setPh(''); setViscosity('')
    setReserve(false); setLayers(false); setRemainderStated(false)
    setPhysicalState('liquid'); setInhalForm('vapour'); setFormTouched(false)
    setTab('composition')
    // ⚠ Отчёт, ссылка и пометка «открыто по ссылке» относились к сброшенному
    // расчёту. Оставить их — значит показать штамп одного расчёта над другим.
    setShowReport(false); setLastBody(null); setShareUrl(null); setShareError(null)
    setShareCopied(false); setPdfError(null); setOpened(null)
    pending.current = []
  }

  /** Пример из разведки s80: метанол 25 · едкий натр 5 · вода 70. */
  const loadExample = async () => {
    setBusy(true); setError(null)
    try {
      const built: Row[] = []
      for (const p of [{ q: '67-56-1', conc: '25' }, { q: '1310-73-2', conc: '5' }]) {
        const res = await fetch(`/api/classify/lookup?q=${encodeURIComponent(p.q)}`)
        const data = await res.json()
        const c: LookupCandidate | undefined = data.ok ? data.candidates?.[0] : undefined
        if (!c) continue
        setProfiles((x) => ({ ...x, ...(data.profiles ?? {}) }))
        built.push(blank({
          source: 'annex6', indexNumber: c.indexNumber, name: c.name, cas: c.casPrimary,
          ec: c.ecPrimary, conc: p.conc, profile: data.profiles?.[c.indexNumber] ?? null,
          formsSharingCas: c.formsSharingCas,
        }))
      }
      built.push(blank({ source: 'supplier', name: 'water (carrier)', cas: '7732-18-5', conc: '70', knownNonhazard: false }))
      if (built.length < 3) {
        setError('The example could not be loaded — the lookup service did not answer.')
      } else {
        setRows(built); setResult(null); setLedger([]); setStale(true)
        pending.current = [{ text: 'example mixture loaded — methanol 25 %, sodium hydroxide 5 %, water 70 %' }]
      }
    } catch {
      setError('The example could not be loaded — the lookup service is unreachable.')
    } finally {
      setBusy(false)
    }
  }

  /* ── живые итоги ──────────────────────────────────────────────────────── */

  const totals = useMemo(() => {
    let sum = 0
    let unknown = 0
    for (const r of rows) {
      const c = effective(r)
      if (c > 0) sum += c
      // Оценка Σ C(unknown) ДО расчёта: компонент считается неизвестным, если он
      // не помечен «данные есть, не классифицирован» и не несёт ни одной пары
      // Acute Tox. ⚠ Подсказка интерфейса, а не расчёт: решает сервер.
      const acute = (r.profile?.pairs ?? []).some((p) => p.classCode.startsWith('ACUTE_TOX'))
        || r.pairs.some((p) => p.classCode.startsWith('ACUTE_TOX'))
      if (c >= 1 && !r.knownNonhazard && !acute) unknown += c
    }
    return { sum, unknown, remainder: 100 - sum }
  }, [rows])

  const canClassify = rows.length > 0 && rows.every((r) => effective(r) > 0)

  /* ── расчёт ───────────────────────────────────────────────────────────── */

  /** Тело запроса из того, что набрано слева. Одна сборка на все пути. */
  const buildBody = useCallback((): RequestBody => {
    return {
        components: rows.map((r) => {
          const min = num(r.conc) ?? 0
          const max = r.range ? num(r.concMax) : null
          return {
            id: r.key,
            source: r.source,
            indexNumber: r.indexNumber,
            name: r.name,
            conc: min,
            concMax: max != null && max > min ? max : null,
            // ⚠ Флаг гасится, если у компонента есть гармонизированная
            // Acute Tox.: галочку он мог получить раньше (строка поставщика
            // заводится с ней), а после добавления пары она перестаёт быть
            // законной, и интерфейс её уже не показывает. Движок её и так не
            // применит — но посылать серверу утверждение, которого на экране
            // нет, нельзя: оно уедет в эхо входа и в отчёт для аудита.
            knownNonhazard: r.knownNonhazard && !hasHarmonisedAcute(r),
            classifications: r.source === 'supplier' ? r.pairs : [],
          }
        }),
        properties: {
          physicalState, inhalForm,
          ph: num(ph), acidAlkaliReserve: reserve,
          viscosityMm2s40c: num(viscosity), separatesIntoLayers: layers,
        },
        audience,
        remainderStatedNonhazard: remainderStated,
    }
  }, [rows, physicalState, inhalForm, ph, reserve, viscosity, layers, audience, remainderStated])

  /**
   * Расчёт. ⭐ Принимает ГОТОВОЕ тело: по короткой ссылке считается то, что
   * прислал автор, а не то, что успело собраться из восстановленных полей.
   * Возвращает результат — открывшему ссылку его надо сверить с отпечатком.
   */
  const classify = async (override?: RequestBody): Promise<ClassifierResult | null> => {
    setBusy(true); setError(null)
    try {
      const body = override ?? buildBody()

      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.rateLimit) setRate(data.rateLimit)
      if (!data.ok) { setError(data.error?.message ?? 'The classification could not be completed.'); return null }

      const next: ClassifierResult = data.result
      const transitions = diffResults(result, next, classNameOf)
      const actions = pending.current.map((a) => a.text)
      pending.current = []
      ledgerId.current += 1
      setLedger((l) => [{ id: ledgerId.current, actions, transitions }, ...l].slice(0, 20))
      setResult(next)
      setLastBody(body)
      setStale(false)
      // ⚠ Ссылка относилась к ПРЕДЫДУЩЕМУ расчёту — после нового она бы врала.
      setShareUrl(null); setShareError(null); setShareCopied(false)
      return next
    } catch {
      setError('The classifier is unreachable from here. The API runs in the Cloudflare Pages build, not in the Astro dev server.')
      return null
    } finally {
      setBusy(false)
    }
  }

  /* ── выходы ───────────────────────────────────────────────────────────── */

  /**
   * ⚠ Ссылка в конструктор строится ИЗ РЕЗУЛЬТАТА, а не из введённого состава:
   * до расчёта передавать нечего. При «ни одного классифицированного класса»
   * ссылки нет вовсе — приглашение печатать этикетку на неклассифицированную
   * смесь читалось бы как наш недосчёт (hub-plan A3, тот же приём в ATE-острове).
   *
   * ⚠ P-фразы НЕ передаём: их выбирает движок старшинства уже в конструкторе.
   * Передать свой список означало бы обойти precedence (урок hub-plan A2).
   */
  const labelHref = useMemo(() => {
    if (!result || !result.labelPairs.length) return null
    const h = [...new Set(result.labelPairs.map((p) => p.hCode).filter((x): x is string => !!x))]
    const pic = [...new Set(result.labelPairs.map((p) => p.pictogramCode).filter((x): x is string => !!x))]
    const danger = result.labelPairs.some((p) => p.signalWord === 'Danger')
    const warning = result.labelPairs.some((p) => p.signalWord === 'Warning')
    return labelMakerHref({
      jurisdiction: 'clp', h, pictograms: pic,
      signal: danger ? 'danger' : warning ? 'warning' : 'none',
    })
  }, [result])

  /**
   * Перенос состава в ATE-калькулятор форматом острова (s79):
   * `?mix=CAS:conc[:n],~name:conc[:u]&form=…`.
   * ⚠ Флаги зеркальны: у вещества Annex VI `:n` = «данные есть, не
   * классифицирован», а у нелистингового так по умолчанию, и `:u` — обратное.
   */
  const ateHref = useMemo(() => {
    const parts = rows.filter((r) => effective(r) > 0).map((r) => {
      const c = effective(r)
      return r.source === 'annex6' && r.cas
        ? `${r.cas}:${c}${r.knownNonhazard ? ':n' : ''}`
        : `~${encodeURIComponent(r.name)}:${c}${r.knownNonhazard ? '' : ':u'}`
    })
    if (!parts.length) return null
    const qs = new URLSearchParams()
    qs.set('mix', parts.join(','))
    if (inhalForm !== 'vapour') qs.set('form', inhalForm)
    return `/tools/ate-mixture-calculator/?${qs.toString()}`
  }, [rows, inhalForm])

  /**
   * ⭐⭐ «Copy for SDS Section 2» — денежный запрос набора (`sds section 2`,
   * 720 US / $7,44, `semrush-classifier-keywords.md`). Текст собирается ТОЛЬКО
   * из ответа движка, вместе со строкой релиза и честной строкой про
   * непосчитанные классы: раздел 2, из которого вырезали оговорку, — хуже, чем
   * никакого.
   */
  const sdsText = useMemo(() => {
    if (!result) return ''
    const lines: string[] = []
    lines.push('SECTION 2: Hazards identification')
    lines.push('2.1 Classification of the substance or mixture')
    lines.push('Classification according to Regulation (EC) No 1272/2008 (CLP):')
    const cls = result.decisions.filter((d) => d.status === 'classified')
    if (cls.length) {
      for (const d of cls) {
        lines.push(`  ${classNameOf(d.classCode)}, Category ${d.categoryCode ?? '—'}${d.hCode ? ` — ${d.hCode}` : ''}`)
      }
    } else {
      lines.push('  Not classified for any hazard class computed by this tool.')
    }
    lines.push('')
    lines.push('2.2 Label elements')
    const danger = result.labelPairs.some((p) => p.signalWord === 'Danger')
    const warning = !danger && result.labelPairs.some((p) => p.signalWord === 'Warning')
    lines.push(`  Signal word: ${danger ? 'Danger' : warning ? 'Warning' : 'none'}`)
    const pics = [...new Set(result.labelPairs.map((p) => p.pictogramCode).filter(Boolean))]
    lines.push(`  Pictograms: ${pics.length ? pics.join(', ') : 'none'}`)
    const hs = [...new Set(result.labelPairs.map((p) => p.hCode).filter(Boolean))]
    lines.push(`  Hazard statements: ${hs.length ? hs.join(', ') : 'none'}`)
    lines.push('  Precautionary statements: select per Annex IV — see the GHS Label Maker.')
    lines.push('')
    const nc = result.decisions.filter((d) => d.status === 'not_computed').length
    if (nc) lines.push(`Note: ${nc} hazard classes were NOT evaluated by this calculation (including all physical hazards, which require testing). Their absence above is not a statement that the mixture is not hazardous for them.`)
    if (result.release) {
      lines.push(`Computed with data release ${result.release.releaseKey} (Annex VI ${result.release.annex6Consolidation}, ${result.release.atp}), engine ${result.engineVersion}.`)
    }
    lines.push('Source: ghspictograms.com/tools/clp-mixture-classifier/')
    return lines.join('\n')
  }, [result, classNameOf])

  const copySds = async () => {
    try {
      await navigator.clipboard.writeText(sdsText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('The clipboard is not available in this browser — select the report text manually.')
    }
  }

  /* ── отчёт, PDF, короткая ссылка (№118) ───────────────────────────────── */

  /**
   * ⭐⭐⭐ Модель отчёта — ЧИСТАЯ ФУНКЦИЯ ОТ ОТВЕТА (решение Сергея, s80).
   * Ни одного запроса, ни одной величины помимо той, что уже приехала. Экран
   * (`MixtureReport`) и PDF (`reportPdfHtml`) читают ЕЁ ЖЕ — разойтись им нечем.
   */
  const report = useMemo(
    () => (result ? buildReport(result, { className: classNameOf, shareUrl }) : null),
    [result, classNameOf, shareUrl],
  )

  const downloadPdf = async () => {
    if (!report) return
    setPdfBusy(true); setPdfError(null)
    try {
      // Оба модуля — динамическим import(): html2pdf весит больше страницы,
      // а разметка отчёта нужна только тому, кто нажал кнопку.
      const html2pdf = (await import('html2pdf.js')).default as any
      const { reportPdfHtml } = await import('../lib/classifier/reportHtml')

      const holder = document.createElement('div')
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;color:#0f172a;background:#ffffff;'
      holder.innerHTML = reportPdfHtml(report)
      document.body.appendChild(holder)

      // ⚠⚠ s79, повторно: html2pdf клонирует фрагмент в `document.body`, а
      // html2canvas 1.4.1 разбирает computed-цвет КАЖДОГО узла — включая
      // унаследованный от body `oklch(…)` Tailwind v4, которого он не знает
      // («Attempting to parse an unsupported color function "oklch"»), и молча
      // роняет кнопку. Лечение — hex прямо в клоне документа.
      const neutralise = (doc: Document) => {
        const roots = [doc.documentElement, doc.body,
          ...Array.from(doc.querySelectorAll<HTMLElement>('.html2pdf__overlay, .html2pdf__container'))]
        for (const el of roots) {
          if (!el) continue
          el.style.color = '#0f172a'
          el.style.backgroundColor = '#ffffff'
          el.style.borderColor = '#e2e8f0'
        }
        const win = doc.defaultView
        if (!win) return
        const PROPS: Array<[string, string]> = [
          ['color', '#0f172a'], ['backgroundColor', 'transparent'],
          ['borderTopColor', '#e2e8f0'], ['borderRightColor', '#e2e8f0'],
          ['borderBottomColor', '#e2e8f0'], ['borderLeftColor', '#e2e8f0'],
          ['textDecorationColor', '#0f172a'], ['outlineColor', 'transparent'],
        ]
        doc.querySelectorAll<HTMLElement>('.html2pdf__container, .html2pdf__container *').forEach((el) => {
          const cs = win.getComputedStyle(el)
          for (const [prop, fallback] of PROPS) {
            const v = (cs as any)[prop] as string | undefined
            if (v && /oklch|oklab|color-mix|lab\(|lch\(/i.test(v)) (el.style as any)[prop] = fallback
          }
        })
      }

      const stamp = (result?.computedAt ?? new Date().toISOString()).slice(0, 10)
      try {
        await html2pdf()
          .set({
            margin: [10, 10, 12, 10],
            filename: `clp-mixture-classification-report-${stamp}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', onclone: neutralise },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            // ⚠ s79: `avoid-all` уносил целые таблицы на новую страницу, оставляя
            // заголовок над пустотой. Неразрывны только строки и карточка класса.
            pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.cl', '.vd'] },
          })
          .from(holder.firstElementChild as HTMLElement)
          .save()
      } finally {
        holder.remove()
      }
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : String(err))
      // ⚠ Сообщение об ошибке обещает, что отчёт есть на странице — значит он
      // обязан быть РАСКРЫТ. Обещание, которого не видно, — то же, что ложь.
      setShowReport(true)
    } finally {
      setPdfBusy(false)
    }
  }

  /**
   * ⭐⭐⭐ Ссылка хранит ВХОД, а рядом — отпечаток результата (решение s80).
   * Открывший её получит не «релиз другой», а «результат тот же» либо
   * «результат изменился»: расчёт повторится по текущему релизу, и отпечатки
   * сравнятся.
   */
  const makeShareLink = async () => {
    if (!result || !lastBody) return
    setShareBusy(true); setShareError(null)
    try {
      const res = await fetch('/api/classify/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: lastBody,
          releaseKey: result.release?.releaseKey ?? 'unknown',
          resultHash: resultFingerprint(result),
        }),
      })
      const data = await res.json()
      if (!data.ok) { setShareError(data.error?.message ?? 'The link could not be created.'); return }
      setShareUrl(data.url)
      // ⚠ Ссылка ПЕЧАТАЕТСЯ рядом в любом случае: буфер обмена недоступен в
      // части браузеров, и «Copied» без видимой ссылки не даёт ничего.
      try {
        await navigator.clipboard.writeText(data.url)
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2200)
      } catch { /* ссылка видна текстом — этого достаточно */ }
    } catch {
      setShareError('The link could not be created — the sharing service is unreachable.')
    } finally {
      setShareBusy(false)
    }
  }

  /**
   * ⭐⭐ Открытие короткой ссылки `?s=…`: достать вход, восстановить левую
   * колонку, ПЕРЕСЧИТАТЬ по текущему релизу и сказать, тот ли это результат.
   * ⚠ Один раз за загрузку страницы: `[]` намеренно.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = new URLSearchParams(window.location.search).get('s')
    if (!token) return
    let cancelled = false

    void (async () => {
      setBusy(true); setError(null)
      try {
        const res = await fetch(`/api/classify/share?s=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        if (!data.ok) {
          setError(data.error?.message ?? 'This link could not be opened.')
          return
        }
        const payload = data.payload as RequestBody
        if (!payload?.components?.length) {
          setError('This link carries no composition — ask whoever sent it for a new one.')
          return
        }

        const restored: Row[] = payload.components.map((c) => blank({
          source: c.source === 'supplier' ? 'supplier' : 'annex6',
          indexNumber: c.indexNumber ?? null,
          name: c.name,
          conc: String(c.conc),
          concMax: c.concMax != null ? String(c.concMax) : '',
          range: c.concMax != null,
          knownNonhazard: !!c.knownNonhazard,
          pairs: c.source === 'supplier' ? (c.classifications ?? []) : [],
        }))
        setRows(restored)
        const p = payload.properties
        if (p) {
          setPhysicalState(p.physicalState); setInhalForm(p.inhalForm); setFormTouched(true)
          setPh(p.ph == null ? '' : String(p.ph))
          setReserve(!!p.acidAlkaliReserve)
          setViscosity(p.viscosityMm2s40c == null ? '' : String(p.viscosityMm2s40c))
          setLayers(!!p.separatesIntoLayers)
        }
        setAudience(payload.audience === 'general_public' ? 'general_public' : 'professional')
        setRemainderStated(!!payload.remainderStatedNonhazard)
        // ⚠ Дата приходит от сервера и может не прийти вовсе — тогда честное
        // «earlier», а не строка «undefined» в ленте и в шапке.
        const createdAt = typeof data.createdAt === 'string' ? data.createdAt : ''
        pending.current = [{ text: `opened from a shared link created ${stampTime(createdAt) || 'earlier'}` }]

        const fresh = await classify(payload)
        if (cancelled || !fresh) return

        // ⭐ Личность компонентов Annex VI берётся из ЭХО ОТВЕТА, а не из
        // ссылки: имя и пределы приезжают из базы (№125), и карточки состава
        // показывают ровно то, чем считали. Сверка по порядку — движок его не
        // меняет, а ключи строк у нас теперь свои.
        setRows((prev) => prev.map((row, i) => {
          const echo = fresh.input.components[i]
          if (!echo) return row
          return {
            ...row,
            name: echo.name,
            cas: echo.casPrimary,
            ec: echo.ecPrimary,
            profile: row.source === 'annex6' ? {
              substance: { name: echo.name, casPrimary: echo.casPrimary, ecPrimary: echo.ecPrimary, hCodes: null },
              pairs: echo.classifications.map((x) => ({
                classCode: x.classCode, categoryCode: x.categoryCode, hCode: x.hCode,
                star: !!x.star, raw: x.raw ?? `${x.classCode} ${x.categoryCode ?? ''}`.trim(),
              })),
              scl: echo.scl.map((s) => ({ raw: s.raw, needsReview: s.needsReview })),
              mFactors: echo.mFactors.map((m) => ({ raw: m.raw, value: m.value, scope: m.scope, needsReview: m.needsReview })),
              ate: echo.ate.map((a) => ({ route: a.route, value: a.value, unit: a.unit, form: a.form })),
              notes: echo.notes,
            } : null,
          }
        }))

        const storedHash: string | null = typeof data.resultHash === 'string' ? data.resultHash : null
        setOpened({
          createdAt,
          releaseKey: typeof data.releaseKey === 'string' ? data.releaseKey : 'unknown',
          storedHash,
          verdict: storedHash == null
            ? 'unknown'
            : storedHash === resultFingerprint(fresh) ? 'same' : 'changed',
        })
        setShowReport(true)
      } catch {
        if (!cancelled) setError('This link could not be opened — the sharing service is unreachable.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── разбивка результата ──────────────────────────────────────────────── */

  const computed = result ? result.decisions.filter((d) => d.status !== 'not_computed') : []
  const notComputed = result ? result.decisions.filter((d) => d.status === 'not_computed') : []
  const assigned = computed.filter((d) => d.status === 'classified')
  const provisional = !!result && result.decisions.some((d) => d.provisional)
  const star = !!result && (result.warnings.some((w) => w.code === 'STAR')
    || result.decisions.some((d) => d.warnings.some((w) => w.code === 'STAR')))
  const allWarnings: Warning[] = result
    ? [...result.warnings, ...result.decisions.flatMap((d) => d.warnings)]
    : []

  const danger = !!result && result.labelPairs.some((p) => p.signalWord === 'Danger')
  const warning = !!result && !danger && result.labelPairs.some((p) => p.signalWord === 'Warning')
  const pics = result ? [...new Set(result.labelPairs.map((p) => p.pictogramCode).filter(Boolean))] as string[] : []

  /* ── разметка ─────────────────────────────────────────────────────────── */

  return (
    <div className="mx-tool">

      <nav className="mx-tabs" aria-label="Steps">
        {([
          ['composition', '01', 'Composition'],
          ['properties', '02', 'Mixture properties'],
        ] as [Tab, string, string][]).map(([id, n, label]) => (
          <button key={id} type="button" className={`mx-tab ${tab === id ? 'on' : ''}`}
            onClick={() => setTab(id)} aria-current={tab === id ? 'step' : undefined}>
            <span className="n">{n}</span> {label}
          </button>
        ))}
      </nav>

      <div className="mx-grid">

        {/* ── ЛЕВАЯ КОЛОНКА ───────────────────────────────────────────── */}
        <div className="mx-side">

            {tab === 'composition' && (
              <>
                {/*
                  ⚠⚠⚠ НАТИВНЫЙ <details>, А НЕ СОСТОЯНИЕ REACT. Панель закрыта по
                  умолчанию, и при `{helpOpen && …}` её содержимое НЕ ПОПАДАЛО БЫ
                  В HTML вовсе: Astro рендерит остров на сборке ровно один раз, в
                  закрытом состоянии. Поймано живой выдачей прода (s81) — ровно
                  тот отказ, про который правило страницы /hazard-classes/:
                  «список, отрисованный JS-ом, для краулера не существует».
                  ⭐ Побочная выгода: раскрытие работает ДО гидратации острова.
                */}
                <details className="mx-panel help">
                  <summary className="mx-panel-head as-button">
                    <span className="mx-panel-title">How to use this calculator</span>
                    <span className="mx-panel-side">6 steps</span>
                    <span className="a" aria-hidden="true">▾</span>
                  </summary>
                  {(
                    <div className="mx-help">
                      <p className="have">
                        <b>Have ready:</b> section 3 of the safety data sheet of every raw material (ingredient
                        identity and concentration), the physical state of your mixture, and — if you have them —
                        pH and kinematic viscosity.
                      </p>
                      <ol>
                        <li>
                          <b>Add every ingredient.</b> Search Annex VI by CAS, EC, index number or name. Water,
                          solvents, carriers and in-house blends are not in Annex VI by construction — add them
                          with <b>+ Unlisted ingredient</b> or <b>+ From supplier SDS</b>.
                        </li>
                        <li>
                          <b>Enter each concentration.</b> % w/w, or % v/v for gases. If your SDS gives a range,
                          enter both bounds — the calculation uses the upper one and says so.
                        </li>
                        <li>
                          <b>Say what you know about ingredients without data.</b> Tick “data available, not
                          classified” only when you actually hold data showing the ingredient is not acutely toxic
                          (water, sugar). Left unticked, it counts as unknown and the result is marked
                          provisional — that is the safe default, not a complaint.
                        </li>
                        <li>
                          <b>Set the mixture properties.</b> Physical state and inhalation form pick the right
                          columns of the tables; pH and viscosity unlock the skin and aspiration rules.
                        </li>
                        <li>
                          <b>Read the result.</b> Open <b>Why</b> on any line to see the rule, its text as printed
                          in the Official Journal, and what each ingredient contributed. Lines marked
                          <b> not computed</b> were not evaluated — they are not a clean bill of health.
                        </li>
                        <li>
                          <b>Keep the record.</b> <b>Full report</b> prints the whole audit trail — what you
                          entered, what was taken into the calculation, every rule with its text, and what was
                          not computed and why — and <b>Download PDF</b> saves that same report as a file.
                          <b> Share link</b> keeps the composition rather than the answer: whoever opens it gets
                          the calculation repeated on the data release current that day, and is told whether it
                          still comes out the same. <b>Copy for SDS Section 2</b> takes the classification into
                          the sheet together with the note about what was not evaluated.
                        </li>
                      </ol>
                    </div>
                  )}
                </details>

                <section className="mx-panel">
                  <div className="mx-panel-head">
                    <span className="mx-panel-title">Add ingredient</span>
                    <span className="mx-panel-side">Annex VI</span>
                  </div>

                  <input
                    className="mx-search"
                    type="search"
                    value={query}
                    placeholder="CAS, EC, Index number or name"
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search Annex VI"
                  />

                  {searching && <p className="mx-note">searching…</p>}
                  {searchError && <p className="mx-note err">{searchError}</p>}

                  {candidates.length > 0 && (
                    <ul className="mx-cands">
                      {candidates.map((c) => {
                        const p = profiles[c.indexNumber]
                        return (
                          <li key={c.indexNumber}>
                            <button type="button" className="mx-cand" onClick={() => addAnnex6(c)}>
                              <span className="n">{c.name}</span>
                              <span className="m">
                                {c.indexNumber}{c.casPrimary ? ` · CAS ${c.casPrimary}` : ''}
                                {c.formsSharingCas > 1 ? ` · ${c.formsSharingCas} forms share this CAS` : ''}
                              </span>
                              <span className="m">
                                {c.pairs} classification{c.pairs === 1 ? '' : 's'}
                                {p?.scl?.length ? ` · ${p.scl.length} SCL` : ''}
                                {p?.mFactors?.length ? ` · ${p.mFactors.length} M` : ''}
                                {p?.ate?.length ? ` · ${p.ate.length} ATE` : ''}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {query.trim().length >= 2 && !searching && !candidates.length && !searchError && (
                    <p className="mx-note">
                      Nothing in Annex VI matches that. Water, carriers, most solvents used as such and in-house
                      blends have no harmonised entry by construction — that is not a gap in the search. Add them
                      below and give the classification from the supplier’s sheet.
                    </p>
                  )}

                  <div className="mx-btns">
                    <button type="button" className="mx-btn" onClick={() => addSupplier(query.trim() || 'Supplier ingredient', true)}>
                      + From supplier SDS
                    </button>
                    <button type="button" className="mx-btn" onClick={() => addSupplier(query.trim() || 'Unlisted ingredient', false)}>
                      + Unlisted ingredient
                    </button>
                  </div>
                </section>

                <section className="mx-panel">
                  <div className="mx-panel-head">
                    <span className="mx-panel-title">Composition</span>
                    <span className="mx-panel-side">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
                  </div>

                  {!rows.length && (
                    <p className="mx-note">
                      No ingredients yet. Search above, or load the example mixture to see what the output looks
                      like before you type anything of your own.
                    </p>
                  )}

                  {rows.map((r) => (
                    <IngredientCard
                      key={r.key}
                      row={r}
                      registry={registry}
                      onPatch={(next) => { patch(r.key, next); touch() }}
                      onNote={note}
                      onRemove={() => remove(r.key)}
                    />
                  ))}

                  {rows.length > 0 && (
                    <div className="mx-tot">
                      <div className="mx-tot-row">
                        <span>Sum of entered ingredients</span>
                        <b className={totals.sum > 100.0001 ? 'over' : ''}>{fmt(totals.sum)} %</b>
                      </div>
                      <div className="mx-tot-row">
                        <span>Unclassified remainder</span>
                        <b>{fmt(totals.remainder)} %</b>
                      </div>
                      <div className="mx-tot-row">
                        <span>Unknown acute toxicity (relevant)</span>
                        <b className={totals.unknown > 10 ? 'over' : ''}>{fmt(totals.unknown)} %</b>
                      </div>
                      {totals.unknown > 10 && (
                        <p className="mx-note">
                          Above 10 %, Annex I 3.1.3.6.2.3 reduces the numerator of the additivity formula to
                          (100 − Σ C<sub>unknown</sub>) and the acute-toxicity result is marked provisional.
                        </p>
                      )}
                      {totals.remainder > 0.0001 && (
                        <label className="mx-check">
                          <input type="checkbox" checked={remainderStated}
                            onChange={(e) => { setRemainderStated(e.target.checked); note(`remainder ${fmt(totals.remainder)} % ${e.target.checked ? 'stated non-hazardous' : 'no longer stated non-hazardous'}`, 'remainder') }} />
                          <span>The remaining {fmt(totals.remainder)} % is stated non-hazardous</span>
                        </label>
                      )}
                    </div>
                  )}

                  <div className="mx-btns">
                    <button type="button" className="mx-btn" onClick={reset}>Reset</button>
                    <button type="button" className="mx-btn" onClick={loadExample} disabled={busy}>Load example mixture</button>
                  </div>
                </section>
              </>
            )}

            {tab === 'properties' && (
              <section className="mx-panel">
                <div className="mx-panel-head">
                  <span className="mx-panel-title">Mixture properties</span>
                </div>

                <p className="mx-lab">Physical state</p>
                <div className="mx-seg">
                  {STATES.map((s) => (
                    <button key={s.value} type="button" className={`mx-seg-b ${physicalState === s.value ? 'on' : ''}`}
                      onClick={() => {
                        setPhysicalState(s.value)
                        if (!formTouched) setInhalForm(defaultForm(s.value))
                        note(`physical state set to ${s.label.toLowerCase()}`, 'state')
                      }}>{s.label}</button>
                  ))}
                </div>

                <p className="mx-lab">Inhalation form</p>
                <div className="mx-seg wrap">
                  {FORMS.map((f) => (
                    <button key={f.value} type="button" className={`mx-seg-b ${inhalForm === f.value ? 'on' : ''}`}
                      onClick={() => { setInhalForm(f.value); setFormTouched(true); note(`inhalation form set to ${FORM_SHORT[f.value]}`, 'form') }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <p className="mx-hint">
                  H330 does not encode the physical form, so the whole mixture uses one column of Tables 3.1.1
                  and 3.1.2.
                </p>

                <label className="mx-lab" htmlFor="mx-ph">pH (optional)</label>
                <input id="mx-ph" className="mx-input" inputMode="decimal" value={ph} placeholder="e.g. 13.2"
                  onChange={(e) => { setPh(e.target.value); touch() }} />
                <p className="mx-hint">
                  pH ≤ 2 or ≥ 11.5 triggers Skin Corr. 1 under 3.2.3.1.2 unless acid/alkali reserve data say
                  otherwise.
                </p>
                <label className="mx-check">
                  <input type="checkbox" checked={reserve} onChange={(e) => { setReserve(e.target.checked); touch() }} />
                  <span>Acid / alkali reserve data are available</span>
                </label>

                <label className="mx-lab" htmlFor="mx-visc">Kinematic viscosity at 40 °C, mm²/s (optional)</label>
                <input id="mx-visc" className="mx-input" inputMode="decimal" value={viscosity} placeholder="e.g. 18.5"
                  onChange={(e) => { setViscosity(e.target.value); touch() }} />
                <p className="mx-hint">
                  Aspiration hazard needs both Σ Category 1 ≥ 10 % and viscosity ≤ 20.5 mm²/s.
                </p>
                <label className="mx-check">
                  <input type="checkbox" checked={layers} onChange={(e) => { setLayers(e.target.checked); touch() }} />
                  <span>The mixture separates into layers (3.10.3.3.1.3)</span>
                </label>

                <p className="mx-lab">Label audience</p>
                <div className="mx-seg">
                  <button type="button" className={`mx-seg-b ${audience === 'professional' ? 'on' : ''}`}
                    onClick={() => { setAudience('professional'); touch() }}>Professional</button>
                  <button type="button" className={`mx-seg-b ${audience === 'general_public' ? 'on' : ''}`}
                    onClick={() => { setAudience('general_public'); touch() }}>General public</button>
                </div>
                <p className="mx-hint">Chooses the P-statement set further down the pipeline.</p>
              </section>
            )}

            <div className="mx-run">
              {/* ⚠ Обёртка, а не `onClick={classify}`: расчёт принимает ГОТОВОЕ
                  тело (короткая ссылка), и событие мыши уехало бы в него телом. */}
              <button type="button" className="mx-btn go" onClick={() => { void classify() }} disabled={!canClassify || busy}>
                {busy ? 'Classifying…' : result ? 'Re-classify' : 'Classify mixture'}
              </button>
              {!canClassify && rows.length > 0 && <p className="mx-note">Every ingredient needs a concentration above zero.</p>}
              {!rows.length && <p className="mx-note">Add at least one ingredient.</p>}
              {error && <p className="mx-note err">{error}</p>}
              {rate && <p className="mx-note">{rate.remaining} of {rate.limit} free calculations left this hour</p>}
            </div>
        </div>

        {/* ── ПРАВАЯ КОЛОНКА ──────────────────────────────────────────── */}
        <div className="mx-main">

          {!result && (
            <div className="mx-blank">
              <p className="t">No result yet</p>
              <p>
                Build a composition on the left and press <b>Classify mixture</b>. The result appears here with a
                row per hazard class — every one of them carrying the rule it rests on, the threshold it was
                compared against and the contribution of each ingredient.
              </p>
            </div>
          )}

          {result && (
            <>
              {stale && (
                <p className="mx-stale">
                  The composition changed after this result was produced — it is out of date. Press
                  “Re-classify”.
                </p>
              )}

              {/*
                ⭐⭐⭐ ОТВЕТ НА ВОПРОС «А ЧТО ВИДЕЛ ЧЕЛОВЕК В ТОТ ДЕНЬ». Короткая
                ссылка хранит ВХОД, поэтому открывший её получает расчёт по
                СЕГОДНЯШНЕМУ релизу — и обязан узнать, тот ли это результат.
                ⛔ Молчание здесь было бы худшим из вариантов: человек решил бы,
                что видит копию присланного, а видел бы пересчёт.
              */}
              {opened && (
                <p className={`mx-shared ${opened.verdict}`}>
                  {opened.verdict === 'same' && (
                    <>
                      Opened from a link created {stampTime(opened.createdAt) || "earlier"}. The
                      composition was classified again on the current data release and{' '}
                      <b>the result is the same</b> as the one whoever sent it saw.
                    </>
                  )}
                  {opened.verdict === 'changed' && (
                    <>
                      Opened from a link created {stampTime(opened.createdAt) || "earlier"} on data
                      release <span className="mono">{opened.releaseKey}</span>. Classified again on{' '}
                      <span className="mono">{result.release?.releaseKey ?? 'the current release'}</span>,{' '}
                      <b>the result is not the same</b> — compare the report below with the copy you were sent.
                    </>
                  )}
                  {opened.verdict === 'unknown' && (
                    <>
                      Opened from a link created {stampTime(opened.createdAt) || "earlier"}. No result
                      fingerprint was stored with it, so this calculation cannot be compared with the one its
                      author saw — only the composition came across.
                    </>
                  )}
                </p>
              )}

              <section className="mx-verdict">
                <div className="mx-verdict-main">
                  <h2>
                    {assigned.length
                      ? `${assigned.length} hazard class${assigned.length === 1 ? '' : 'es'} assigned`
                      : 'No hazard class assigned by the modules in this version'}
                  </h2>
                  <p className="sub">
                    {assigned.length
                      ? assigned.map((d) => `${classNameOf(d.classCode)} ${d.categoryCode ?? ''}`.trim()).join(' · ')
                      : 'Every class computed came back “not classified” or “insufficient data”. Open the rows below to see which rule decided that.'}
                  </p>
                  <div className="mx-badges">
                    {provisional && <span className="mx-badge amber">provisional · 3.1.3.6.2.3</span>}
                    {star && <span className="mx-badge amber">minimum classification *</span>}
                    {result.composition.worstCase && <span className="mx-badge amber">range at upper bound</span>}
                    <span className="mx-badge teal">audit trail on every row</span>
                  </div>
                </div>
                {(danger || warning || pics.length > 0) && (
                  <div className="mx-verdict-label">
                    {danger && <p className="sig danger">Danger</p>}
                    {warning && <p className="sig warning">Warning</p>}
                    <div className="pics">{pics.map((p) => <Picto key={p} code={p} />)}</div>
                  </div>
                )}
              </section>

              {ledger.length > 0 && (
                <section className="mx-changed">
                  <div className="mx-changed-head">
                    <span className="mx-panel-title">What changed</span>
                    <span className="mx-panel-side">live</span>
                  </div>
                  <ol>
                    {ledger.map((e, i) => (
                      <li key={e.id}>
                        <span className="k">+{ledger.length - i}</span>
                        <div className="v">
                          <p className="a">{e.actions.length ? e.actions.join('; ') : 'recalculated with no change to the input'}</p>
                          {e.transitions.length ? (
                            <ul>{e.transitions.map((t, j) => <li key={j} className={t.kind}>{t.text}</li>)}</ul>
                          ) : (
                            <p className="none">no classification changed</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <table className="mx-table">
                <thead>
                  <tr>
                    <th>Hazard class</th>
                    <th>Category</th>
                    <th>H</th>
                    <th>Status</th>
                    <th><span className="sr">Why</span></th>
                  </tr>
                </thead>
                <tbody>
                  {computed.map((d) => {
                    const open = !!openWhy[d.classCode]
                    return (
                      // ⚠ Fragment с ключом, а не `<>`: строка «Why» — вторая
                      // <tr> того же класса, и без ключа на обёртке React
                      // пересобирал бы раскрытые строки при каждом расчёте.
                      <Fragment key={d.classCode}>
                        {/*
                          ⚠⚠ КЛИКАБЕЛЬНА ВСЯ СТРОКА, а не только галочка справа
                          (замечание Сергея, s81): «малюсенький треугольничек не
                          видно». Треугольник остаётся ИНДИКАТОРОМ состояния и
                          из порядка обхода убран (`aria-hidden`) — иначе на
                          строке-кнопке появилась бы вложенная кнопка, и с
                          клавиатуры один и тот же ряд открывался бы дважды.
                        */}
                        <tr
                          className={`mx-row ${d.status} ${open ? 'on' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-expanded={open}
                          onClick={() => toggleWhy(d.classCode)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWhy(d.classCode) }
                          }}
                        >
                          <td>
                            <p className="cls">{classNameOf(d.classCode)}</p>
                            <p className="sub mono">
                              {d.classCode}
                              {d.classCode === INHAL_CLASS && ` · ${FORM_SHORT[result.inhalForm]}`}
                              {` · module ${d.module}`}
                            </p>
                            {/*
                              ⚠⚠ ПРОСЬБА О ДАННЫХ ВИДНА БЕЗ РАСКРЫТИЯ (s83).
                              `insufficient_data` — единственный статус, который
                              просит человека что-то сделать: аспирация без
                              кинематической вязкости не считается ни в какую
                              сторону. Спрятать этот текст за «Why» значило бы
                              задать вопрос и не показать его — тот же дефект,
                              что в s81 у элемента, который обещал содержимое.
                              ⛔ Свой текст не пишем: это слова движка.
                            */}
                            {d.status === 'insufficient_data' && d.reason && (
                              <p className="sub need">{d.reason}</p>
                            )}
                          </td>
                          {/*
                            ⚠⚠ СОПУТСТВУЮЩИЕ КАТЕГОРИИ ПЕЧАТАЮТСЯ ЗДЕСЬ ЖЕ (s82).
                            Внутри класса CLP бывают категории, которые не спорят
                            за место, а складываются: Repr. 1A/1B/2 + «Lact.»
                            (H362), STOT SE «3» + «3 narcotic» (H336). Они уже
                            уехали в `labelPairs` — значит стоят на этикетке, в
                            копии для SDS и в ссылке на конструктор. Строка,
                            которая о них молчит, врала бы читателю о том, что
                            инструмент посчитал.
                          */}
                          <td>
                            {d.categoryCode ? `Category ${d.categoryCode}` : '—'}
                            {(d.additional ?? []).map((a) => (
                              <p key={a.categoryCode} className="sub">+ {a.categoryCode}</p>
                            ))}
                          </td>
                          {/* ⚠ Прочерк — не H-код: синий цвет колонки на нём читался
                              бы как ссылка, которой нет. */}
                          <td className={`mono h ${d.hCode ? '' : 'none'}`}>
                            {d.hCode ?? '—'}
                            {(d.additional ?? []).map((a) => (
                              a.hCode ? <p key={a.categoryCode} className="sub mono">{a.hCode}</p> : null
                            ))}
                          </td>
                          <td>
                            <span className={`mx-st ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                            {d.provisional && <span className="mx-st provisional">Provisional</span>}
                          </td>
                          <td className="act">
                            <span className={`mx-caret ${open ? 'on' : ''}`} aria-hidden="true">▾</span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="mx-why-row">
                            <td colSpan={5}><Why decision={d} /></td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>

              <Fold title="Supplemental information & warnings" count={String(allWarnings.length + result.supplemental.length)}>
                {result.supplemental.map((s, i) => (
                  <div key={`s${i}`} className="mx-supp">
                    <p>
                      {s.text}
                      {s.raw && <q className="mx-quote">{s.raw}</q>}
                    </p>
                    <span className="tag mono">{s.code ?? s.kind}</span>
                  </div>
                ))}
                {allWarnings.map((w, i) => <WarningLine key={`w${i}`} w={w} />)}
                {!allWarnings.length && !result.supplemental.length && (
                  <p className="mx-note">Nothing supplemental and no warnings on this calculation.</p>
                )}
              </Fold>

              <Fold title="Not computed in this version" count={`${notComputed.length} classes`}>
                <p className="mx-note">
                  These classes are part of the registry but have no module in this version. The tool says so on
                  the result screen instead of printing an empty cell — an empty cell reads as “not hazardous”.
                </p>
                <table className="mx-table quiet">
                  <tbody>
                    {notComputed.map((d) => (
                      <tr key={d.classCode} className="mx-row not_computed">
                        <td>
                          <p className="cls">{classNameOf(d.classCode)}</p>
                          <p className="sub">{shortReason(d.reason)}</p>
                        </td>
                        <td className="mono">module {d.module}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Fold>

              <div className="mx-out">
                {/* ⚠ Отчёт первым: это то, ради чего расчёт и делали (№118). */}
                <button type="button" className="mx-btn go" onClick={() => setShowReport((v) => !v)}>
                  {showReport ? 'Hide the full report' : 'Full report'}
                </button>
                <button type="button" className="mx-btn" onClick={downloadPdf} disabled={pdfBusy}>
                  {pdfBusy ? 'Building the PDF…' : 'Download PDF'}
                </button>
                <button type="button" className="mx-btn" onClick={makeShareLink} disabled={shareBusy || !lastBody}>
                  {shareBusy ? 'Creating…' : shareCopied ? 'Link copied' : 'Share link'}
                </button>
                {labelHref && <a className="mx-btn label" href={labelHref}>Open in GHS Label Maker →</a>}
                <button type="button" className="mx-btn" onClick={copySds}>
                  {copied ? 'Copied' : 'Copy for SDS Section 2'}
                </button>
                {ateHref && <a className="mx-btn" href={ateHref}>Open in the ATE calculator</a>}
              </div>

              {pdfError && (
                <p className="mx-note err">
                  The PDF could not be built: {pdfError}. The report is on this page in full — nothing is
                  missing from it.
                </p>
              )}
              {shareError && <p className="mx-note err">{shareError}</p>}
              {shareUrl && (
                <p className="mx-share-url">
                  {/* ⚠ Ссылка ВИДНА, а не только «скопирована»: буфер обмена
                      доступен не везде, и невидимая ссылка — это её отсутствие. */}
                  <span className="mono">{shareUrl}</span>{' '}
                  <span className="hint">
                    keeps the composition, not the result: whoever opens it gets the calculation repeated on
                    the release current that day, and is told whether it still comes out the same.
                  </span>
                </p>
              )}

              {showReport && report && <MixtureReport model={report} />}

              {result.release && (
                <p className="mx-release mono">
                  Data release {result.release.releaseKey} · annex6 {result.release.annex6Consolidation} ·
                  atp {result.release.atp} · engine {result.engineVersion}
                  {result.release.parserVersion ? ` · ${result.release.parserVersion}` : ''}
                  {result.release.gclMd5 ? ` · gcl ${result.release.gclMd5}` : ''}
                  {/* ⭐ №116: объём данных приезжает в ответе, а не пишется на
                      странице руками — `data_release` закрыт для сборки (s78). */}
                  {result.release.annex6Rows != null && (
                    <>
                      <br />
                      {result.release.annex6Rows} Annex VI rows ·{' '}
                      {result.release.classificationPairs ?? '—'} harmonised class/category pairs ·{' '}
                      {result.release.registryCategories ?? '—'} registry categories
                    </>
                  )}
                  <br />
                  Every result carries the release it was computed with. Physical hazards are not derived from
                  composition.
                </p>
              )}
            </>
          )}

          {/*
            ⚠⚠⚠ ДИСКЛЕЙМЕР И «RELATED TOOLS» — ВНЕ ветки `{result && …}`.
            Пока они стояли внутри неё, в собранном HTML их не было ВООБЩЕ:
            остров рендерится на сборке без результата. Для дисклеймера это
            прямое нарушение решения s80 («дисклеймер обязателен на странице»),
            для ссылок — потеря межстраничной сетки, ради которой они и стоят.
            Оба блока говорят об ИНСТРУМЕНТЕ, а не о конкретном расчёте, значит
            их место — на странице всегда.
          */}
            <section className="mx-disc">
              <p className="mx-disc-head">Disclaimer — read before you use any result from this tool</p>
              <p>
                This calculator applies the classification rules of <b>CLP Annex I</b> to the composition you
                enter. It is a calculation, <b>not a legal classification decision and not advice</b>. Under
                <b> Article 4 of Regulation (EC) No 1272/2008</b> the supplier remains responsible for
                classifying, labelling and packaging the mixture before placing it on the market.
              </p>
              <p>
                The result depends entirely on what you enter: an ingredient left out, a wrong concentration, or
                a supplier classification that has since changed will change it. <b>Physical hazards are never
                derived from composition</b> — they require testing. Classes marked <b>not computed</b> were not
                evaluated at all. Where the classification is not obvious, CLP 1.1.1 expects expert judgement,
                and this tool does not replace it.
              </p>
            </section>

            <section className="mx-related">
              <p className="mx-panel-title">Related tools on this site</p>
              <ul>
                <li>
                  <a href="/tools/ate-mixture-calculator/">ATE Mixture Calculator</a> — the same three
                  acute-toxicity routes, in depth: every C<sub>i</sub>/ATE<sub>i</sub> line, the inhalation form
                  side by side, its own PDF. <b>Same engine, same numbers</b> — this calculator uses it as
                  module A1, so the composition travels between the two without being retyped.
                </li>
                <li>
                  <a href="/ghs-label-maker/">GHS Label Maker</a> — turns the classified pairs above into a
                  printable label after the P-statement precedence engine has run.
                </li>
                <li>
                  <a href="/sds-sections/section-2-hazards-identification/">SDS Section 2</a> — what a
                  classification looks like once it is written into a safety data sheet.
                </li>
                <li>
                  {/* ⚠ Числа берутся из реестра, пришедшего со сборки, а не пишутся
                      руками: захардкоженное «37 классов» — это обязательство
                      перечитывать страницу после каждого ATP (урок oxidizers.md). */}
                  <a href="/hazard-classes/">Hazard classes and categories</a> — all {registry.length} classes
                  and {registry.reduce((n, c) => n + c.categories.length, 0)} categories of CLP, with the
                  H-statements and pictograms each one carries.
                </li>
              </ul>
            </section>
        </div>
      </div>
    </div>
  )
}

/* ── строка состава ──────────────────────────────────────────────────────── */

function IngredientCard({
  row: r, registry, onPatch, onNote, onRemove,
}: {
  row: Row
  registry: RegistryClassProp[]
  onPatch: (next: Partial<Row>) => void
  onNote: (text: string, key?: string) => void
  onRemove: () => void
}) {
  const pairs = r.profile?.pairs ?? []
  const sclCount = r.profile?.scl?.length ?? 0
  const mCount = r.profile?.mFactors?.length ?? 0
  const ateCount = r.profile?.ate?.length ?? 0
  /**
   * ⭐⭐⭐ ГАЛОЧКА «data available, not classified» ЕСТЬ ТОЛЬКО ТАМ, ГДЕ ОНА
   * РАБОТАЕТ (решение Сергея, s81: «вещества с классификацией галочку не имеют,
   * это ложный путь»).
   *
   * Annex I 3.1.3.6.1(b) разрешает не считать ингредиент, который **считается
   * не обладающим острой токсичностью** (вода, сахар). Вещество с гармонизированной
   * `Acute Tox.` таковым не считается по определению — и `ate.ts` после аудита
   * №100 ведёт себя строго так: `knownNonhazard` НЕ перебивает путь, по которому
   * данные есть. Значит галочка на таком веществе молча ничего не делает.
   * ⛔ Управляющий элемент, который выглядит работающим и не работает, — хуже
   * отсутствующего: человек решит, что учёл воду, а учтён токсикант.
   */
  const harmonisedAcute = hasHarmonisedAcute(r)
  const longName = r.name.length > 48

  return (
    <div className="mx-ing">
      <div className="mx-ing-top">
        <div className="mx-ing-id">
          {r.source === 'supplier'
            ? <input className={`mx-ing-name-input ${longName ? 'long' : ''}`} value={r.name} aria-label="Ingredient name"
                onChange={(e) => onPatch({ name: e.target.value })} />
            : <p className={`mx-ing-name ${longName ? 'long' : ''}`}>{r.name}</p>}
          <p className="mx-ing-meta mono">
            {r.source === 'annex6'
              ? <>{r.indexNumber}{r.cas ? ` · CAS ${r.cas}` : ''}{r.formsSharingCas > 1 ? ` · ${r.formsSharingCas} forms share this CAS` : ''}</>
              : 'UNLISTED'}
          </p>
        </div>
        <div className="mx-ing-conc">
          <input className="mx-num" inputMode="decimal" value={r.conc} aria-label="Concentration"
            onChange={(e) => onPatch({ conc: e.target.value })} />
          <span className="pc">%</span>
          <button type="button" className="mx-x" onClick={onRemove} aria-label={`Remove ${shortName(r.name)}`}>×</button>
        </div>
      </div>

      {r.range ? (
        <div className="mx-range">
          <label><span>up to</span>
            <input className="mx-num" inputMode="decimal" value={r.concMax}
              onChange={(e) => onPatch({ concMax: e.target.value })} />
          </label>
          <span className="pc">%</span>
          <button type="button" className="mx-link" onClick={() => onPatch({ range: false, concMax: '' })}>drop the range</button>
          <p className="mx-hint">Computed at the upper bound — the worst case, and the only method available from the composition alone.</p>
        </div>
      ) : (
        <button type="button" className="mx-link" onClick={() => onPatch({ range: true })}>+ enter a range</button>
      )}

      {r.source === 'annex6' ? (
        <div className="mx-chips">
          {/*
            ⚠⚠ H-КОД ОБЯЗАН СТОЯТЬ РЯДОМ С КЛАССОМ. Дословная ячейка Annex VI
            печатает «Acute Tox. 4» — БЕЗ пути, потому что путь в этой колонке
            кодируется H-кодом (H302 оральный, H312 кожный, H332 ингаляционный).
            В классификаторе смесей путь и есть главное: без него строка состава
            не говорит, во что именно ингредиент внесёт вклад.
          */}
          {pairs.map((p, i) => (
            <span key={i} className={`mx-chip ${p.star ? 'star' : ''}`}>
              {p.raw}{p.hCode && !p.raw.includes(p.hCode) ? ` · ${p.hCode}` : ''}
            </span>
          ))}
          {sclCount > 0 && <span className="mx-chip count">{sclCount} SCL</span>}
          {/* ⚠ «1 M» читается как «одномолярный». Пишем словом. */}
          {mCount > 0 && <span className="mx-chip count">{mCount} M-factor{mCount > 1 ? 's' : ''}</span>}
          {ateCount > 0 && <span className="mx-chip count">{ateCount} ATE</span>}
          {!pairs.length && <span className="mx-chip none">no harmonised classification in Annex VI</span>}
        </div>
      ) : (
        <>
          {!r.pairs.length && (
            <div className="mx-chips">
              <span className="mx-chip none">not in Annex VI — no harmonised classification</span>
            </div>
          )}
          <SupplierPairs id={r.key} registry={registry} pairs={r.pairs} name={r.name}
            onChange={(pairs, what) => { onPatch({ pairs }); onNote(what) }} />
        </>
      )}

      {harmonisedAcute ? (
        <p className="mx-hint">
          Acute toxicity is harmonised for this ingredient, so it enters the additivity formula by its own
          category — it cannot be declared outside it under 3.1.3.6.1(b).
        </p>
      ) : (
        <label className="mx-check">
          <input type="checkbox" checked={r.knownNonhazard}
            onChange={(e) => {
              onPatch({ knownNonhazard: e.target.checked })
              onNote(
                `${shortName(r.name)} ${e.target.checked ? 'marked “data available, not classified for acute toxicity”' : 'no longer marked “data available, not classified”'}`,
                `nonhazard:${r.key}`,
              )
            }} />
          <span>
            Data available, not classified for acute toxicity (3.1.3.6.1(b) — out of the formula and out of
            Σ C<sub>unknown</sub>)
          </span>
        </label>
      )}

      {r.profile?.notes?.length ? (
        <p className="mx-hint">Annex VI notes, shown but not applied: {r.profile.notes.join('; ')}</p>
      ) : null}
    </div>
  )
}

/* ── пары поставщика ─────────────────────────────────────────────────────── */

function SupplierPairs({
  id, registry, pairs, name, onChange,
}: {
  /** ⚠ Ключ строки, а не имя: имя редактируется, и `htmlFor` уехал бы вместе с ним. */
  id: string
  registry: RegistryClassProp[]
  pairs: { classCode: string; categoryCode: string }[]
  name: string
  onChange: (pairs: { classCode: string; categoryCode: string }[], what: string) => void
}) {
  const [cls, setCls] = useState('')
  const cats = registry.find((c) => c.code === cls)?.categories ?? []

  return (
    <div className="mx-supplier">
      {pairs.length > 0 && (
        <div className="mx-chips">
          {pairs.map((p, i) => {
            const c = registry.find((x) => x.code === p.classCode)
            const cat = c?.categories.find((x) => x.code === p.categoryCode)
            return (
              <span key={`${p.classCode}-${p.categoryCode}`} className="mx-chip">
                {c?.name ?? p.classCode} {p.categoryCode}{cat?.h ? ` · ${cat.h}` : ''}
                <button type="button" className="mx-x small"
                  onClick={() => onChange(pairs.filter((_, j) => j !== i), `${shortName(name)}: removed ${p.classCode} ${p.categoryCode}`)}
                  aria-label="Remove classification">×</button>
              </span>
            )
          })}
        </div>
      )}
      <div className="mx-pick">
        <select className="mx-select" value={cls} onChange={(e) => setCls(e.target.value)}
          aria-label="Hazard class from the supplier's sheet" id={`cls-${id}`}>
          <option value="">— hazard class from the SDS —</option>
          {registry.map((c) => <option key={c.code} value={c.code}>{c.name}{c.euOnly ? ' (EU only)' : ''}</option>)}
        </select>
        <select className="mx-select" value="" disabled={!cls} aria-label="Category" id={`cat-${id}`}
          onChange={(e) => {
            const cat = e.target.value
            if (!cat) return
            if (pairs.some((p) => p.classCode === cls && p.categoryCode === cat)) return
            onChange([...pairs, { classCode: cls, categoryCode: cat }], `${shortName(name)}: added ${cls} ${cat}`)
          }}>
          <option value="">— category —</option>
          {cats.map((c) => <option key={c.code} value={c.code}>{c.code}{c.h ? ` · ${c.h}` : ''}</option>)}
        </select>
      </div>
      <p className="mx-hint">
        Categories come from the registry the engine itself uses, so a pair that does not exist cannot be
        entered. Enter what the supplier states — it is recorded as supplier data and never silently improved.
      </p>
    </div>
  )
}

/* ── раскрытие «Why» ─────────────────────────────────────────────────────── */

function Why({ decision: d }: { decision: Decision }) {
  const counted = d.contributions.filter((c) => c.counted)
  const skipped = d.contributions.filter((c) => !c.counted)

  return (
    <div className="mx-why">
      <p className="mx-why-rule mono">
        <b>{d.ruleKey ?? 'no rule key'}</b>
        {d.sourceRef && <span> · {d.sourceRef}</span>}
        {d.marker && <span> · {d.marker}</span>}
        <span> · module {d.module}</span>
      </p>

      {/* ⚠ Цитата регламента — моно и БЕЗ верхнего регистра (дизайн-система §3). */}
      {d.raw && <q className="mx-quote">{d.raw}</q>}

      {d.reason && <p className="mx-why-reason">{d.reason}</p>}

      {d.aggregate && (
        <p className="mx-formula mono">
          {d.aggregate.expr}
          {d.aggregate.threshold != null && ` — threshold ${d.aggregate.threshold}${d.aggregate.unit ? ` ${d.aggregate.unit}` : ''}`}
        </p>
      )}

      {d.contributions.length > 0 && (
        <table className="mx-contrib">
          <thead>
            <tr><th>Ingredient</th><th>C %</th><th>Value</th><th>Limit</th><th>Provenance</th></tr>
          </thead>
          <tbody>
            {counted.map((c) => (
              <tr key={c.componentId}>
                <td>{c.name}</td>
                <td className="mono">{fmt(c.conc)}</td>
                <td className="mono">{c.value == null ? '—' : c.value}</td>
                <td className="mono">{c.limit == null ? '—' : `${c.limit}${c.limitSource && c.limitSource !== 'NONE' ? ` (${c.limitSource})` : ''}`}</td>
                <td>{c.provenance}</td>
              </tr>
            ))}
            {skipped.map((c) => (
              <tr key={c.componentId} className="out">
                <td>{c.name}</td>
                <td className="mono">{fmt(c.conc)}</td>
                <td className="mono">{c.value == null ? '—' : c.value}</td>
                <td className="mono">—</td>
                <td>not counted — {c.provenance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        ⚠⚠ У СОПУТСТВУЮЩЕЙ КАТЕГОРИИ СВОЁ ПРАВИЛО И СВОЯ ЦИТАТА. Она не
        приписка к строке выше: H362 — самостоятельная классификация, и
        читатель обязан увидеть, каким пределом она получена, ровно как у
        основной. Контракт провенанса на неё распространяется целиком.
      */}
      {(d.additional ?? []).map((a) => (
        <div className="mx-why-extra" key={a.categoryCode}>
          <p className="mx-lab">
            Additional category of the same class: {a.categoryCode}
            {a.hCode ? ` · ${a.hCode}` : ''}
          </p>
          <p className="mx-why-rule mono">
            <b>{a.ruleKey ?? 'no rule key'}</b>
            {a.sourceRef && <span> · {a.sourceRef}</span>}
            {a.marker && <span> · {a.marker}</span>}
          </p>
          {a.raw && <q className="mx-quote">{a.raw}</q>}
          {a.aggregate && (
            <p className="mx-formula mono">
              {a.aggregate.expr}
              {a.aggregate.threshold != null && ` — threshold ${a.aggregate.threshold}${a.aggregate.unit ? ` ${a.aggregate.unit}` : ''}`}
            </p>
          )}
          {a.warnings.map((w, i) => <WarningLine key={i} w={w} />)}
        </div>
      ))}

      {d.candidates?.length ? (
        <div className="mx-cands-checked">
          <p className="mx-lab">Thresholds checked</p>
          <ul>
            {d.candidates.map((c, i) => (
              <li key={i} className={c.passed ? 'pass' : 'fail'}>
                <span className="mono">{c.categoryCode ?? '—'} · {c.ruleKey}</span>
                {' '}{c.passed ? 'met' : 'not met'}{c.note ? ` — ${c.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {d.warnings.length > 0 && d.warnings.map((w, i) => <WarningLine key={i} w={w} />)}
    </div>
  )
}
