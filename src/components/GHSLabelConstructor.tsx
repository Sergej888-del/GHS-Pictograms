import { useState, useEffect, useRef, useMemo, type ChangeEvent, type DragEvent } from 'react'
import {
  layoutLabel, renderSvg, downloadLabelSvg, downloadLabelPdf, downloadLabelSheetPdf,
  type LabelInput,
} from '../lib/labelEngine'
import {
  JURISDICTIONS, JURISDICTION_ORDER, sizeTierForLitres, recommendedTierForLitres, smallPackageRuleFor,
  type JurisdictionKey, type LabelPurpose,
} from '../lib/jurisdictions'
import {
  stockFor, stockMm, stockSizeLabel, inchLabel, SHEET_MM, SHEET_NAME, MM_PER_INCH,
  type LabelStockItem,
} from '../lib/labelStock'
import NewsletterOptIn from './NewsletterOptIn'

interface Pictogram { code: string; name_en: string; svg_content: string | null }
interface HStatement { code: string; text_en: string }
interface PStatement { code: string; text_en: string }

interface Props {
  displayName: string
  casNumber: string
  ecNumber?: string | null
  signalWord?: string | null
  pictograms: Pictogram[]
  hStatements: HStatement[]
  pStatements: PStatement[]
  /** Юрисдикция, с которой открывается инструмент (задаётся страницей раздела). */
  initialJurisdiction?: JurisdictionKey
  /** Вид этикетки, с которого открывается инструмент. */
  initialPurpose?: LabelPurpose
  /**
   * Какие P-фразы отмечены изначально. Для вещества из базы это первые шесть из
   * его собственного набора; в ручном режиме сюда приходит пустой массив —
   * там список общий, все 117, и первые шесть означали бы случайный выбор.
   */
  initialSelectedP?: string[]
}

const STORAGE_KEY = 'ghs_supplier_data'
const LOGO_STORAGE_KEY = 'ghs_logo_data'
const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]'
const labelClass = 'block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide'

/** Быстрые объёмы тары. Второе число — литры, ими выбирается ярус CLP. */
const CAPACITY_PRESETS = [
  { label: '100 mL', ml: 100 },
  { label: '500 mL', ml: 500 },
  { label: '5 L', ml: 5_000 },
  { label: '20 L', ml: 20_000 },
  { label: '200 L', ml: 200_000 },
  { label: '1000 L', ml: 1_000_000 },
]

export default function GHSLabelConstructor({
  displayName, casNumber, ecNumber, signalWord,
  pictograms, hStatements, pStatements,
  initialJurisdiction = 'osha', initialPurpose = 'supplier', initialSelectedP,
}: Props) {
  const [jurisdictionKey, setJurisdictionKey] = useState<JurisdictionKey>(initialJurisdiction)
  const [purpose, setPurpose] = useState<LabelPurpose>(initialPurpose)
  const j = JURISDICTIONS[jurisdictionKey]

  const [unit, setUnit] = useState<'mm' | 'in'>(JURISDICTIONS[initialJurisdiction].unit)
  const [capacityMl, setCapacityMl] = useState<number>(500)
  const [sizeW, setSizeW] = useState<number>(101.6) // мм, Avery 4 × 2 in
  const [sizeH, setSizeH] = useState<number>(50.8)
  const [stockId, setStockId] = useState<string | null>('us-4x2')

  const [supplierName, setSupplierName] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [nominalQty, setNominalQty] = useState('')
  const [ufiCode, setUfiCode] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [pFormat, setPFormat] = useState<'codes' | 'combined'>('codes')
  const [selectedP, setSelectedP] = useState<string[]>(
    () => initialSelectedP ?? pStatements.slice(0, 6).map((p) => p.code),
  )
  const [showAllP, setShowAllP] = useState(false)
  const [pQuery, setPQuery] = useState('')

  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [logo, setLogo] = useState<{ dataUrl: string; aspect: number } | null>(null)
  const [logoName, setLogoName] = useState('')
  const [logoError, setLogoError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [sheetNote, setSheetNote] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ⚠ Набор P-фраз пересобирается при смене вещества: иначе от прошлого вещества
  // остаются коды, которых у нового нет, и на этикетку не попадает ничего.
  useEffect(() => {
    setSelectedP(initialSelectedP ?? pStatements.slice(0, 6).map((p) => p.code))
  }, [casNumber, pStatements.length])

  // Смена юрисдикции переключает единицы и набор пресетов, но НЕ трогает уже
  // выбранный физический размер: человек выбирал его под свою пачку наклеек.
  useEffect(() => {
    setUnit(j.unit)
  }, [jurisdictionKey])

  const track = (event: string, params: Record<string, unknown> = {}) => {
    if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', event, params)
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.supplierName) setSupplierName(data.supplierName)
        if (data.supplierAddress) setSupplierAddress(data.supplierAddress)
        if (data.supplierPhone) setSupplierPhone(data.supplierPhone)
      }
    } catch {}
    try {
      const saved = localStorage.getItem(LOGO_STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data && typeof data.dataUrl === 'string' && typeof data.aspect === 'number') {
          setLogo({ dataUrl: data.dataUrl, aspect: data.aspect })
          if (typeof data.name === 'string') setLogoName(data.name)
        }
      }
    } catch {}
    track('label_editor_open', { cas: casNumber })
  }, [])

  const saveToStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ supplierName, supplierAddress, supplierPhone }))
    } catch {}
  }

  // ── Размеры ───────────────────────────────────────────────────────────────
  const litres = capacityMl / 1000
  /** Юридический минимум — только там, где он есть (ЕС, Великобритания). */
  const tier = sizeTierForLitres(j, litres)
  /** Ориентир по объёму — есть всегда, в том числе для США и Канады. */
  const recTier = recommendedTierForLitres(litres)
  const smallRule = smallPackageRuleFor(j, capacityMl)

  /**
   * Помещается ли формат под ярус — с учётом ОБЕИХ ориентаций. Наклейка
   * 4 × 2 in под ярус 52 × 74 мм не подходит как есть, но подходит повёрнутой,
   * и отбрасывать её было бы неправдой.
   */
  const fitsTierStrict = (m: { w: number; h: number }, t: { labelMinW: number; labelMinH: number }) =>
    (m.w >= t.labelMinW - 0.5 && m.h >= t.labelMinH - 0.5)
    || (m.h >= t.labelMinW - 0.5 && m.w >= t.labelMinH - 0.5)

  /**
   * ⚠⚠ Там, где закон размеров НЕ устанавливает, годность считается ПО ПЛОЩАДИ,
   * а не по сторонам. Иначе выходит нелепость: на пол-литровую бутылку
   * подбирается наклейка 4 × 4 in, потому что привычная 4 × 2 in не проходит по
   * одной стороне яруса CLP — хотя площади в ней в полтора раза больше.
   * Вторая проверка отсекает длинные узкие ленты: короткая сторона не может
   * быть меньше 70 % короткой стороны яруса.
   */
  const fitsTierByArea = (m: { w: number; h: number }, t: { labelMinW: number; labelMinH: number }) =>
    m.w * m.h >= t.labelMinW * t.labelMinH * 0.95
    && Math.min(m.w, m.h) >= Math.min(t.labelMinW, t.labelMinH) * 0.7

  /** Годность по правилам текущей юрисдикции: закон строже рекомендации. */
  const fitsTier = (m: { w: number; h: number }, t: { labelMinW: number; labelMinH: number }) =>
    tier ? fitsTierStrict(m, t) : fitsTierByArea(m, t)

  const stocks = useMemo(() => {
    const list = stockFor(j.region)
    // ⚠ Там, где минимум предписан законом, форматы ниже него не показываются
    // вовсе: этикетка на них незаконна. Где закон молчит — показываются все, но
    // подходящие по объёму идут первыми.
    if (tier) return list.filter((s) => fitsTier(stockMm(s), tier))
    return [...list].sort((a, b) => {
      const fa = fitsTier(stockMm(a), recTier) ? 0 : 1
      const fb = fitsTier(stockMm(b), recTier) ? 0 : 1
      if (fa !== fb) return fa - fb
      if (a.chemical !== b.chemical) return a.chemical ? -1 : 1
      const ma = stockMm(a), mb = stockMm(b)
      return ma.w * ma.h - mb.w * mb.h
    })
  }, [j.region, tier?.key, recTier.key])

  const pickStock = (s: LabelStockItem) => {
    const m = stockMm(s)
    setSizeW(m.w); setSizeH(m.h); setStockId(s.id); setSheetNote('')
  }
  const pickClpMinimum = () => {
    if (!tier) return
    setSizeW(tier.labelMinW); setSizeH(tier.labelMinH); setStockId(null); setSheetNote('')
  }
  const rotate = () => {
    setSizeW(sizeH); setSizeH(sizeW); setStockId(null); setSheetNote('')
  }

  /**
   * ⚠⚠ Смена объёма тары ПЕРЕВЫБИРАЕТ размер этикетки.
   *
   * Раньше объём влиял только на подсказку, и в режиме OSHA — где размерных норм
   * нет вовсе — переключение «500 мл → 200 л» не меняло на экране ничего. Это
   * читается как сломанная кнопка, хотя формально всё верно. Теперь объём
   * подбирает наименьшую подходящую наклейку: под канистру — канистровую, под
   * бочку — бочковую.
   */
  const applyCapacity = (ml: number) => {
    setCapacityMl(ml)
    const rec = recommendedTierForLitres(ml / 1000)
    const ok = tier ? fitsTierStrict : fitsTierByArea
    const candidates = stockFor(j.region)
      .filter((st) => st.chemical && st.sheet !== 'roll' && ok(stockMm(st), rec))
      .sort((a, b) => {
        const ma = stockMm(a), mb = stockMm(b)
        return ma.w * ma.h - mb.w * mb.h
      })
    const best = candidates[0]
    const bestArea = best ? stockMm(best).w * stockMm(best).h : Infinity
    // ⚠ Сам ярусный размер — тоже кандидат, и часто лучший. В европейском списке
    // химстойкие наклейки начинаются с 210 × 148 мм, и без этой строки на
    // пол-литровую бутылку подбиралась бы этикетка с половину листа A4.
    if (best && bestArea <= rec.labelMinW * rec.labelMinH * 1.6) {
      const m = stockMm(best)
      // ⚠ Переворачиваем формат ТОЛЬКО там, где ярус обязателен по закону и
      // как есть не проходит. Где это лишь рекомендация — оставляем ориентацию
      // каталога: Avery 60505 продаётся как 4 × 2 in, и разворачивать её в
      // 2 × 4 значит спорить с пачкой, которая лежит у человека на столе.
      const asIs = tier ? (m.w >= rec.labelMinW - 0.5 && m.h >= rec.labelMinH - 0.5) : true
      setSizeW(asIs ? m.w : m.h)
      setSizeH(asIs ? m.h : m.w)
      setStockId(best.id)
    } else {
      setSizeW(rec.labelMinW); setSizeH(rec.labelMinH); setStockId(null)
    }
    setSheetNote('')
  }

  const toUnit = (mm: number) => (unit === 'in' ? Math.round((mm / MM_PER_INCH) * 1000) / 1000 : Math.round(mm * 10) / 10)
  const fromUnit = (v: number) => (unit === 'in' ? v * MM_PER_INCH : v)
  const fmt = (mm: number) => (unit === 'in' ? inchLabel(mm / MM_PER_INCH) : String(Math.round(mm * 10) / 10))

  const selectedStock = stockId ? stocks.find((s) => s.id === stockId) ?? null : null

  // ── Сборка этикетки ───────────────────────────────────────────────────────
  const shownP = pStatements.filter((p) => selectedP.includes(p.code))
  // Отмеченные всегда наверху списка: иначе выбранная фраза уезжает вниз, и
  // человек не видит, что именно он уже набрал.
  const visibleP = (() => {
    const q = pQuery.trim().toLowerCase()
    const matched = q
      ? pStatements.filter((p) => (p.code + ' ' + p.text_en).toLowerCase().includes(q))
      : pStatements
    const chosen = matched.filter((p) => selectedP.includes(p.code))
    const rest = matched.filter((p) => !selectedP.includes(p.code))
    const tail = q || showAllP ? rest : rest.slice(0, Math.max(0, 12 - chosen.length))
    return [...chosen, ...tail]
  })()
  const notes: string[] = []
  if (purpose === 'small' && smallRule?.keep.includes('outerPackageNote')) {
    notes.push('Full label information is provided on the immediate outer package.')
  }
  if (purpose === 'workplace' && j.workplaceElements.includes('sdsAvailableNote')) {
    notes.push('A safety data sheet for this product is available in the workplace.')
  }

  const labelInput: LabelInput = {
    productName: displayName,
    casNumber,
    ecNumber,
    nominalQty,
    batchNumber,
    ufiCode,
    signalWord: signalWord ?? null,
    pictograms: pictograms.map((p) => ({ code: p.code, svg: p.svg_content ?? '' })),
    hStatements: hStatements.map((h) => ({ code: h.code, text: h.text_en })),
    pStatements: shownP.map((p) => ({ code: p.code, text: p.text_en })),
    pFormat,
    combinedPText: pFormat === 'combined' ? shownP.map((p) => p.text_en).join(' ') : undefined,
    hiddenPCount: pStatements.length - shownP.length,
    supplier: { name: supplierName, address: supplierAddress, phone: supplierPhone },
    logo: logo ?? undefined,
    notes,
  }

  const layout = layoutLabel(labelInput, {
    jurisdiction: jurisdictionKey,
    purpose,
    widthMm: Math.max(15, sizeW),
    heightMm: Math.max(15, sizeH),
    containerLitres: litres,
    containerMl: capacityMl,
  })
  const previewSvg = renderSvg(layout)
  const fit = layout.fit

  const fileBase = `GHS-label-${(casNumber || 'label').replace(/[^\w.-]+/g, '-')}-${j.key}`

  const confirmDownload = () => {
    if (!agreed) { setSubmitError('Please confirm the disclaimer.'); return }
    setSubmitError('')
    saveToStorage()
    setSubmitted(true)
    track('label_download_unlocked', { cas: casNumber, jurisdiction: j.key })
  }
  const handleSvg = () => {
    downloadLabelSvg(layout, `${fileBase}.svg`)
    track('label_download', { format: 'svg', cas: casNumber, jurisdiction: j.key })
  }
  const handlePdf = async () => {
    try {
      await downloadLabelPdf(layout, `${fileBase}.pdf`)
      track('label_download', { format: 'pdf', cas: casNumber, jurisdiction: j.key })
    } catch (e) { console.error('PDF download failed', e) }
  }
  const handleSheet = async () => {
    if (!selectedStock || selectedStock.sheet === 'roll') return
    const sheet = SHEET_MM[selectedStock.sheet]
    try {
      const res = await downloadLabelSheetPdf(
        layout,
        { widthMm: sheet.w, heightMm: sheet.h, name: SHEET_NAME[selectedStock.sheet] },
        `${fileBase}-sheet.pdf`,
      )
      setSheetNote(`${res.perSheet} labels per sheet (${res.cols} × ${res.rows})`)
      track('label_download', { format: 'sheet_pdf', cas: casNumber, jurisdiction: j.key })
    } catch (e) { console.error('Sheet PDF failed', e) }
  }
  const trackSdsAffiliateClick = () =>
    track('affiliate_click', { partner: 'sds_manager', placement: 'label_constructor', cas: casNumber })

  // ── Логотип ───────────────────────────────────────────────────────────────
  const MAX_LOGO_DIM = 600
  const processLogoFile = (file: File) => {
    setLogoError('')
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setLogoError('Please use a PNG or JPEG image.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || '')
      const img = new Image()
      img.onload = () => {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) { setLogoError('Could not read that image.'); return }
        const scale = Math.min(1, MAX_LOGO_DIM / Math.max(w, h))
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) { setLogoError('Could not process that image.'); return }
        ctx.drawImage(img, 0, 0, cw, ch)
        const dataUrl = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9)
        setLogo({ dataUrl, aspect: cw / ch })
        setLogoName(file.name)
        try { localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify({ dataUrl, aspect: cw / ch, name: file.name })) } catch {}
        track('label_logo_added', { cas: casNumber })
      }
      img.onerror = () => setLogoError('Could not read that image.')
      img.src = src
    }
    reader.onerror = () => setLogoError('Could not read that file.')
    reader.readAsDataURL(file)
  }
  const onLogoInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0]
    if (f) processLogoFile(f)
    e.target.value = ''
  }
  const onLogoDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragActive(false)
    const f = e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) processLogoFile(f)
  }
  const removeLogo = () => {
    setLogo(null); setLogoName(''); setLogoError('')
    try { localStorage.removeItem(LOGO_STORAGE_KEY) } catch {}
  }

  const purposeTabs: { key: LabelPurpose; label: string; hint: string }[] = [
    { key: 'supplier', label: 'Shipped container', hint: 'full supplier label' },
    { key: 'workplace', label: 'Workplace / secondary', hint: 'decanted inside your site' },
    { key: 'small', label: 'Small container', hint: 'reduced label information' },
  ]

  return (
    <>
      {/* ── Юрисдикция и вид этикетки ─────────────────────────────────────── */}
      <section className="mb-6 rounded-xl border-2 border-[#062A78] bg-blue-50 p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Where the product is sold or used</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {JURISDICTION_ORDER.map((key) => {
            const jj = JURISDICTIONS[key]
            const active = key === jurisdictionKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setJurisdictionKey(key); track('label_jurisdiction', { jurisdiction: key }) }}
                className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                  active ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                }`}
              >
                <span className="block text-sm font-semibold">{jj.tag}</span>
                <span className={`block text-[11px] ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                  {key === 'osha' ? 'United States' : key === 'clp' ? 'European Union' : key === 'whmis' ? 'Canada' : 'Great Britain'}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {purposeTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setPurpose(t.key)}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                purpose === t.key ? 'border-[#062A78] bg-white font-semibold text-[#062A78]' : 'border-gray-300 bg-white/70 text-gray-600 hover:border-[#062A78]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-gray-600">{j.languageNote}</p>
        {purpose === 'workplace' && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700">{j.workplaceNote}</p>
        )}
        {purpose === 'small' && smallRule && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700">
            {smallRule.note} <span className="text-gray-400">{smallRule.citation}</span>
          </p>
        )}
        {purpose === 'small' && !smallRule && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No reduced-label provision applies to a {capacityMl} ml container here — the full set of elements is printed.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-8">
        {/* ── Управление ──────────────────────────────────────────────────── */}
        <div className="order-2 space-y-5 lg:order-1">
          {/* Тара и размер */}
          <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
            <p className="font-semibold text-[#062A78]">Container &amp; label size</p>

            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Container capacity</p>
            <div className="flex flex-wrap gap-2">
              {CAPACITY_PRESETS.map((c) => (
                <button
                  key={c.ml}
                  type="button"
                  onClick={() => applyCapacity(c.ml)}
                  className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-sm transition-colors ${
                    capacityMl === c.ml ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={capacityMl}
                onChange={(e) => applyCapacity(Math.max(1, Number(e.target.value)))}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                aria-label="Container capacity in millilitres"
              />
              <span className="self-center text-xs text-gray-500">mL</span>
            </div>
            {tier ? (
              <p className="text-[11px] text-gray-500">
                {j.tag}: for {tier.capacityLabel} the label must be at least {tier.labelMinW} × {tier.labelMinH} mm
                and each pictogram at least {tier.pictogramMm} mm
              </p>
            ) : (
              <p className="text-[11px] text-gray-500">
                {j.tag} sets no minimum label or pictogram size — only a legibility requirement.
                For {recTier.capacityLabel} ({recTier.examples}) we suggest at least{' '}
                <span className="font-medium">{recTier.labelMinW} × {recTier.labelMinH} mm</span> — our recommendation,
                not a legal minimum.
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Label size</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={rotate} className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-[#062A78]">
                  ⤢ Rotate
                </button>
                <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs">
                  {(['mm', 'in'] as const).map((u) => (
                    <button key={u} type="button" onClick={() => setUnit(u)}
                      className={`cursor-pointer px-2 py-1 ${unit === u ? 'bg-[#062A78] text-white' : 'bg-white text-gray-600'}`}>{u}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {tier && (
                <button
                  type="button"
                  onClick={pickClpMinimum}
                  className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${
                    !stockId && Math.abs(sizeW - tier.labelMinW) < 0.5 && Math.abs(sizeH - tier.labelMinH) < 0.5
                      ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                  }`}
                >
                  <span className="block text-sm font-medium">{tier.labelMinW} × {tier.labelMinH} mm</span>
                  <span className="block text-[11px] opacity-70">{j.tag} minimum</span>
                </button>
              )}
              {stocks.map((s) => {
                const m = stockMm(s)
                const active = stockId === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickStock(s)}
                    title={s.aliases.join(' · ')}
                    className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${
                      active ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                    }`}
                  >
                    {/* ⚠ Размер печатается в ЕДИНИЦЕ, ВЫБРАННОЙ ПОЛЬЗОВАТЕЛЕМ.
                        Раньше здесь стояла родная единица формата, и при
                        переключении на миллиметры американские наклейки всё
                        равно оставались в дюймах. Родное обозначение никуда не
                        делось — оно во второй строке, рядом с кодом. */}
                    <span className="block text-sm font-medium">{fmt(m.w)} × {fmt(m.h)} {unit}</span>
                    <span className={`block text-[11px] ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                      {s.aliases[0]}{s.unit !== unit ? ` · ${stockSizeLabel(s)}` : ''}{s.perSheet && s.perSheet > 1 ? ` · ${s.perSheet} per sheet` : ''}{s.chemical ? ' · chemical-resistant' : ''}{!tier && !fitsTier(m, recTier) ? ' · small for this container' : ''}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Custom:</span>
              <input type="number" min={10} step={unit === 'in' ? 0.125 : 1} value={toUnit(sizeW)}
                onChange={(e) => { setSizeW(fromUnit(Number(e.target.value))); setStockId(null) }}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
              <span className="text-gray-400">×</span>
              <input type="number" min={10} step={unit === 'in' ? 0.125 : 1} value={toUnit(sizeH)}
                onChange={(e) => { setSizeH(fromUnit(Number(e.target.value))); setStockId(null) }}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
              <span className="text-xs text-gray-500">{unit}</span>
            </div>

            {fit.belowMinimum ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {fmt(sizeW)} × {fmt(sizeH)} {unit} is below the {fit.minimumLabel} minimum for this container ({j.tag}).
              </p>
            ) : fit.fits ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                Everything fits · pictograms {fit.pictogramMm} mm · text {fit.bodyMm} mm
                {fit.requiredPictogramMm ? ` (minimum ${fit.requiredPictogramMm} mm)` : ''}
              </p>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Does not fit: about {fit.neededHeightMm} mm of height is needed. Use a larger size, drop some
                precautionary statements, or switch to a fold-out label.
              </p>
            )}
          </section>

          {/* Продукт */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <p className="font-semibold text-[#062A78]">Product information</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Nominal quantity</label>
                <input type="text" value={nominalQty} onChange={(e) => setNominalQty(e.target.value)} placeholder="500 mL" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Batch / Lot number</label>
                <input type="text" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="LOT-2026-001" className={inputClass} />
              </div>
              {j.requiresUfi && (
                <div className="sm:col-span-2">
                  <label className={labelClass}>UFI code <span className="font-normal text-gray-400">(EU mixtures)</span></label>
                  <input type="text" value={ufiCode} onChange={(e) => setUfiCode(e.target.value)} placeholder="UFI: XXXX-XXXX-XXXX-XXXX" className={inputClass} />
                </div>
              )}
            </div>
          </section>

          {/* Поставщик */}
          {j.supplierElements.includes('supplier') && purpose !== 'workplace' && (
            <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-[#062A78]">Supplier details</p>
                <span className="text-[11px] text-gray-400">
                  {j.key === 'osha' ? 'US address and phone · (f)(1)(vi)' : j.key === 'whmis' ? 'initial supplier identifier' : 'CLP Article 17'} · saved locally
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Company name</label>
                  <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} onBlur={saveToStorage} placeholder="ACME Chemicals Inc" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Address</label>
                  <input type="text" value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} onBlur={saveToStorage} placeholder={j.key === 'osha' ? '1200 Industrial Rd, Houston, TX' : '123 Industrial Ave, London'} className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Phone</label>
                  <input type="text" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} onBlur={saveToStorage} placeholder={j.key === 'osha' ? '+1 800 000 0000' : '+44 800 000 0000'} className={inputClass} />
                </div>
              </div>

              <div className="pt-1">
                <label className={labelClass}>Company logo <span className="font-normal text-gray-400">(optional)</span></label>
                {logo ? (
                  <div className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2">
                    <img src={logo.dataUrl} alt="Logo preview" className="h-10 w-auto max-w-[120px] object-contain" />
                    <span className="flex-1 truncate text-xs text-gray-600">{logoName || 'logo'}</span>
                    <button type="button" onClick={removeLogo} className="cursor-pointer text-xs font-semibold text-rose-600 hover:text-rose-700">Remove</button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                    onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
                    onDrop={onLogoDrop}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors ${dragActive ? 'border-[#062A78] bg-blue-50' : 'border-gray-300 bg-white hover:border-[#062A78]'}`}
                  >
                    <span className="text-sm text-gray-600">Drop your logo here or click to upload</span>
                    <span className="text-[11px] text-gray-400">PNG or JPEG</span>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onLogoInputChange} className="hidden" />
                {logoError && <p className="mt-1 text-xs text-rose-600">{logoError}</p>}
                <p className="mt-1 text-[11px] text-gray-400">
                  Your logo is placed as supplemental information beside the supplier block. It must not obscure the
                  mandatory elements (CLP Art. 25 / OSHA HCS App C.3.1).
                </p>
              </div>
            </section>
          )}

          {/* P-фразы */}
          {j.supplierElements.includes('precautionaryStatements') && purpose === 'supplier' && pStatements.length > 0 && (
            <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-[#062A78]">Precautionary statements</p>
                <span className="text-[11px] text-gray-400">{selectedP.length} of {pStatements.length} selected</span>
              </div>
              <p className="text-xs text-gray-500">
                Six is the usual maximum on a label. Which six is your call — it depends on how the product is
                actually used, and the regulations let you omit statements that do not apply.
              </p>
              {/* ⚠ В ручном режиме сюда приходят все 117 фраз, и без поиска
                  список бесполезен: нужную ищут по слову, а не листанием. */}
              {pStatements.length > 12 && (
                <input
                  type="search" value={pQuery} onChange={(e) => setPQuery(e.target.value)}
                  placeholder="Search by code or text: gloves, P280…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              )}
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {visibleP.map((p) => {
                  const on = selectedP.includes(p.code)
                  return (
                    <label key={p.code} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${on ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelectedP((prev) => on ? prev.filter((c) => c !== p.code) : [...prev, p.code])}
                        className="mt-0.5 accent-[#062A78]"
                      />
                      <span><span className="font-semibold">{p.code}</span> {p.text_en}</span>
                    </label>
                  )
                })}
              </div>
              {!pQuery && pStatements.length > 12 && (
                <button type="button" onClick={() => setShowAllP((v) => !v)} className="cursor-pointer text-xs font-semibold text-[#062A78] underline">
                  {showAllP ? 'Show fewer' : `Show all ${pStatements.length}`}
                </button>
              )}
              <div className="flex gap-2 pt-1">
                {(['codes', 'combined'] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setPFormat(f)}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors ${pFormat === f ? 'border-[#062A78] bg-white font-semibold text-[#062A78]' : 'border-gray-300 bg-white text-gray-600'}`}>
                    {f === 'codes' ? 'With codes' : 'Combined text (compact)'}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Скачивание */}
          {!submitted ? (
            <div className="space-y-4 rounded-xl border-2 border-[#062A78] bg-blue-50 p-4 sm:p-5">
              <p className="font-bold text-[#062A78]">Download your label</p>
              <p className="text-sm text-gray-600">Free, no signup: a PDF at the exact physical size and an SVG for label software.</p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="mb-1 font-semibold">Disclaimer — please confirm before downloading:</p>
                <p>{j.disclaimer}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-[#062A78]" />
                <span className="text-sm text-gray-800">I accept full responsibility for verifying label compliance before use.</span>
              </label>
              {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
              <button type="button" onClick={confirmDownload} className="w-full cursor-pointer rounded-lg bg-[#062A78] py-3 font-semibold text-white transition-colors hover:bg-[#051f5c]">
                Show download links
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <p className="font-semibold">Ready</p>
                <p>Print size: {fmt(layout.widthMm)} × {fmt(layout.heightMm)} {unit}. Print at 100% (“actual size”).</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-3">
                  <button type="button" onClick={handlePdf} className="flex-1 cursor-pointer rounded-lg bg-[#062A78] py-3 font-semibold text-white transition-colors hover:bg-[#051f5c]">
                    Download PDF
                  </button>
                  <button type="button" onClick={handleSvg} className="flex-1 cursor-pointer rounded-lg border-2 border-[#062A78] py-3 font-semibold text-[#062A78] transition-colors hover:bg-[#062A78] hover:text-white">
                    Download SVG
                  </button>
                </div>
                {selectedStock && selectedStock.sheet !== 'roll' && (selectedStock.perSheet ?? 1) > 1 && (
                  <button type="button" onClick={handleSheet} className="cursor-pointer rounded-lg border-2 border-[#062A78] py-2.5 text-sm font-semibold text-[#062A78] transition-colors hover:bg-[#062A78] hover:text-white">
                    Full sheet — {SHEET_NAME[selectedStock.sheet]}, {selectedStock.perSheet} labels
                  </button>
                )}
                {sheetNote && <p className="text-center text-xs text-gray-500">{sheetNote}</p>}
                <NewsletterOptIn source="label_constructor" />
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <p className="text-sm font-semibold text-[#062A78]">Need a Safety Data Sheet for {displayName}?</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Your label and a compliant SDS are the two documents that travel with this substance.
                    SDS Manager is a recommended partner solution for authoring and managing GHS-compliant Safety Data Sheets.
                  </p>
                  <a
                    href="https://sdsmanager.com/us/sds-authoring?fpr=ghs3&fp_sid=gpauth"
                    target="_blank"
                    rel="sponsored nofollow noopener"
                    onClick={trackSdsAffiliateClick}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#ea670c]"
                  >
                    Create an SDS with SDS Manager †
                  </a>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">
                    † SDS Manager is a partner solution; we may earn a commission.{' '}
                    <a href="/affiliate-disclosure/" className="underline hover:text-gray-700">See disclosure</a>.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="mb-1 font-semibold">For official use — print on certified materials</p>
                <p>Office printing does not meet BS5609 durability requirements for chemical-resistant labels.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Превью и соответствие ───────────────────────────────────────── */}
        {/* ⚠ Превью прокручивается САМО, независимо от страницы. Пока правая
            колонка была просто `sticky`, она прилипала только после того, как
            пользователь дочитывал её до низа: блок выше экрана до этого момента
            едет вместе со страницей. Ограничение по высоте экрана плюс
            собственная прокрутка держат этикетку на виду всегда. */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">Live preview · {j.tag}</p>
            <div className="flex justify-center rounded-lg bg-white p-3">
              {/* ⚠ Высота ограничена экраном: этикетка A4 в портрете иначе
                  вытягивает колонку на два экрана. Пропорции держит viewBox. */}
              <div
                className="w-full max-w-[460px] [&>svg]:h-auto [&>svg]:max-h-[58vh] [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
            </div>
            <div className="mt-2 text-center">
              <p className="text-xs font-medium text-gray-700">
                Print size: {fmt(layout.widthMm)} × {fmt(layout.heightMm)} {unit}
                {!fit.fits ? ' · grown to fit the content' : ''}
              </p>
              <p className="text-[11px] text-gray-400">The preview is scaled to your screen — the real print size is shown above.</p>
            </div>
          </div>

          {/* ⚠ Список того, чего не хватает по нормам выбранной юрисдикции.
              Этого не делает ни один бесплатный генератор в нише. */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-[#062A78]">Compliance check · {j.tag}</p>
            {layout.issues.length === 0 ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                All required elements are present.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {layout.issues.map((iss, i) => (
                  <li
                    key={i}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      iss.level === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800'
                        : iss.level === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                    }`}
                  >
                    {iss.text}
                    {iss.citation && <span className="ml-1 opacity-60">· {iss.citation}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-gray-400">{j.groupingCitation}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {j.citations.map((c) => (
                <a key={c.url} href={c.url} target="_blank" rel="noopener" className="text-[11px] text-[#062A78] underline">
                  {c.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
