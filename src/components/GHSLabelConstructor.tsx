import { useState, useEffect, useRef, type ChangeEvent, type DragEvent } from 'react'
import { buildSizedLabel, downloadSvg, downloadLabelPdf, CLP_TIERS, LABEL_STOCK, PX_PER_MM, type ClpTierKey } from '../lib/labelArtifact'
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
}
type VolumeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type PFormat = 'codes' | 'combined'
const VOLUME_TIERS = [
  { key: 'xs' as const, label: '≤ 0.5 L', sublabel: 'Vials, small bottles', labelMm: '52 × 74 mm', picMm: '10 × 10 mm', picSizePx: 38, maxWidthPx: 260, fontScale: 'xs' as const },
  { key: 'sm' as const, label: '0.5 – 3 L', sublabel: 'Bottles, canisters', labelMm: '52 × 74 mm', picMm: '16 × 16 mm', picSizePx: 52, maxWidthPx: 280, fontScale: 'sm' as const },
  { key: 'md' as const, label: '3 – 50 L', sublabel: 'Pails, canisters', labelMm: '74 × 105 mm', picMm: '23 × 23 mm', picSizePx: 72, maxWidthPx: 420, fontScale: 'md' as const },
  { key: 'lg' as const, label: '50 – 500 L', sublabel: 'Drums, IBCs', labelMm: '105 × 148 mm', picMm: '32 × 32 mm', picSizePx: 100, maxWidthPx: 580, fontScale: 'lg' as const },
  { key: 'xl' as const, label: '> 500 L', sublabel: 'Large IBCs, tanks', labelMm: '148 × 210 mm', picMm: '46 × 46 mm', picSizePx: 140, maxWidthPx: 720, fontScale: 'xl' as const },
]
// CLP Art 26 pictogram precedence is ALREADY resolved in the source data
// (substances.ghs_pictogram_codes comes from CLP Annex VI). Do NOT re-derive it
// from pictogram codes alone: that needs per-H-statement hazard context and wrongly
// drops GHS07 for substances like thiram (Acute Tox 4 -> GHS07 is never absorbed by a
// STOT-RE GHS08). Render the official code set as-is.
function combinePStatements(pStatements: PStatement[]): string {
  return pStatements.map(p => p.text_en).join(' ')
}
const STORAGE_KEY = 'ghs_supplier_data'
const LOGO_STORAGE_KEY = 'ghs_logo_data'
const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]'
const labelClass = 'block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide'
export default function GHSLabelConstructor({
  displayName, casNumber, ecNumber, signalWord,
  pictograms, hStatements, pStatements,
}: Props) {
  const [volume, setVolume] = useState<VolumeKey>('sm')
  const [supplierName, setSupplierName] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [nominalQty, setNominalQty] = useState('')
  const [ufiCode, setUfiCode] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [pFormat, setPFormat] = useState<PFormat>('codes')
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [logo, setLogo] = useState<{ dataUrl: string; aspect: number } | null>(null)
  const [logoName, setLogoName] = useState('')
  const [logoError, setLogoError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tier = VOLUME_TIERS.find(v => v.key === volume)!
  // Map the 5 capacity bands to the 4 CLP Table 1.3 tiers (<=0.5 L folds into <=3 L for now).
  const CLP_TIER_BY_VOLUME: Record<VolumeKey, ClpTierKey> = { xs: 'le3', sm: 'le3', md: 'gt3le50', lg: 'gt50le500', xl: 'gt500' }
  const clpTierKey = CLP_TIER_BY_VOLUME[volume]
  const clpTier = CLP_TIERS.find(t => t.key === clpTierKey)!
  const [sizeUnit, setSizeUnit] = useState<'mm' | 'in'>('mm')
  const [sizeW, setSizeW] = useState<number>(clpTier.labelMinW)
  const [sizeH, setSizeH] = useState<number>(clpTier.labelMinH)
  const handleVolumeChange = (key: VolumeKey) => {
    setVolume(key)
    const t = CLP_TIERS.find(x => x.key === CLP_TIER_BY_VOLUME[key])!
    setSizeW(t.labelMinW)
    setSizeH(t.labelMinH)
  }
  const filteredPics = pictograms
  const MAX_P = 6
  const shownP = pStatements.slice(0, MAX_P)
  const hiddenPCount = pStatements.length - MAX_P
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
  }, [])
  useEffect(() => {
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
  }, [])
  useEffect(() => {
    track('label_editor_open', { cas: casNumber })
  }, [])
  const saveToStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        supplierName, supplierAddress, supplierPhone
      }))
    } catch {}
  }
  const confirmDownload = () => {
    if (!agreed) { setSubmitError('Please confirm the disclaimer.'); return }
    setSubmitError('')
    saveToStorage()
    setSubmitted(true)
    track('label_download_unlocked', { cas: casNumber })
  }
  const MAX_LOGO_DIM = 600
  const processLogoFile = (file: File) => {
    setLogoError('')
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setLogoError('Please use a PNG or JPEG image.')
      return
    }
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
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) { setLogoError('Could not process that image.'); return }
        ctx.drawImage(img, 0, 0, cw, ch)
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        const dataUrl = canvas.toDataURL(mime, 0.9)
        const aspect = cw / ch
        setLogo({ dataUrl, aspect })
        setLogoName(file.name)
        try { localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify({ dataUrl, aspect, name: file.name })) } catch {}
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
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) processLogoFile(f)
  }
  const removeLogo = () => {
    setLogo(null)
    setLogoName('')
    setLogoError('')
    try { localStorage.removeItem(LOGO_STORAGE_KEY) } catch {}
  }
  const labelFilenameBase = `GHS-label-${(casNumber || 'label').replace(/[^\w.-]+/g, '-')}`
  const buildLabelArtifact = () =>
    buildSizedLabel({
      productName: displayName,
      casNumber,
      ecNumber,
      nominalQty,
      batchNumber,
      ufiCode,
      signalWord: signalWord ?? null,
      pictograms: filteredPics.map((p) => ({ code: p.code, svg: p.svg_content ?? '' })),
      hStatements: hStatements.map((h) => ({ code: h.code, text: h.text_en })),
      pStatements: shownP.map((p) => ({ code: p.code, text: p.text_en })),
      pFormat,
      combinedPText: pFormat === 'combined' ? combinePStatements(shownP) : undefined,
      hiddenPCount,
      supplier: { name: supplierName, address: supplierAddress, phone: supplierPhone },
      logo: logo ?? undefined,
    }, { tierKey: clpTierKey, widthMm: Math.max(20, sizeW), heightMm: Math.max(20, sizeH) })
  const trackLabelDownload = (format: 'svg' | 'pdf') => track('label_download', { format, cas: casNumber })
  const trackSdsAffiliateClick = () =>
    track('affiliate_click', { partner: 'sds_manager', placement: 'label_constructor', cas: casNumber })
  const handleDownloadSvg = () => {
    const { svg } = buildLabelArtifact()
    downloadSvg(svg, `${labelFilenameBase}.svg`)
    trackLabelDownload('svg')
  }
  const handleDownloadPdf = async () => {
    try {
      const artifact = buildLabelArtifact()
      await downloadLabelPdf(artifact, `${labelFilenameBase}.pdf`)
      trackLabelDownload('pdf')
    } catch (e) {
      console.error('PDF download failed', e)
    }
  }
  const previewArtifact = buildLabelArtifact()
  const previewSvg = previewArtifact.svg
  const fit = previewArtifact.fit
  const toUnit = (mm: number) => (sizeUnit === 'in' ? Math.round((mm / 25.4) * 100) / 100 : Math.round(mm))
  const fromUnit = (v: number) => (sizeUnit === 'in' ? v * 25.4 : v)
  const fmtDim = (mm: number) => (sizeUnit === 'in' ? (mm / 25.4).toFixed(2) : String(Math.round(mm)))
  const ISO_A: { name: string; w: number; h: number }[] = [
    { name: 'A8', w: 52, h: 74 }, { name: 'A7', w: 74, h: 105 }, { name: 'A6', w: 105, h: 148 }, { name: 'A5', w: 148, h: 210 }, { name: 'A4', w: 210, h: 297 },
  ]
  const isoFormat = (w: number, h: number): string | null => {
    const hit = ISO_A.find((a) => Math.abs(a.w - w) <= 1 && Math.abs(a.h - h) <= 1)
    return hit ? hit.name : null
  }
  const clpMinFmt = isoFormat(clpTier.labelMinW, clpTier.labelMinH)
  const sizeOptions: { w: number; h: number; note: string }[] = [{ w: clpTier.labelMinW, h: clpTier.labelMinH, note: `${clpMinFmt ? clpMinFmt + ' · ' : ''}CLP minimum` }]
  for (const st of LABEL_STOCK) {
    if (st.widthMm >= clpTier.labelMinW && st.heightMm >= clpTier.labelMinH && !(st.widthMm === clpTier.labelMinW && st.heightMm === clpTier.labelMinH)) {
      sizeOptions.push({ w: st.widthMm, h: st.heightMm, note: st.name })
    }
  }
  const outWmm = previewArtifact.width / PX_PER_MM
  const outHmm = previewArtifact.height / PX_PER_MM
  const outFmt = fit.fits ? isoFormat(outWmm, outHmm) : null
  const supplierIncomplete = !supplierName.trim() || !supplierAddress.trim() || !supplierPhone.trim()
  return (
    <>
    <details className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold text-[#062A78] select-none">How to use this tool</summary>
      <div className="mt-3 space-y-3 text-sm text-gray-700">
        <ol className="list-decimal list-inside space-y-1">
          <li><span className="font-medium">Container capacity</span> — pick your container; this sets the CLP Annex I Table 1.3 minimum label and pictogram size.</li>
          <li><span className="font-medium">Label size</span> — keep the CLP minimum, choose a stock size, or enter a custom size (toggle mm / in). Sizes follow ISO paper formats: A8 = 52 × 74 mm, A7 = 74 × 105 mm, A6 = 105 × 148 mm, A5 = 148 × 210 mm.</li>
          <li><span className="font-medium">Product &amp; supplier details</span> — fill in quantity, batch, UFI and the CLP Article 17 supplier block.</li>
          <li><span className="font-medium">Company logo</span> (optional) — drop a PNG or JPEG; it appears beside the supplier block as supplemental information (it must not cover the hazard elements — CLP Art 25 / OSHA HCS C.3.1).</li>
          <li><span className="font-medium">Precautionary format</span> — codes with text, or a combined space-saving line.</li>
          <li><span className="font-medium">Download</span> — PDF for printing, or SVG for label software.</li>
        </ol>
        <p>
          <span className="font-medium">The live preview</span> updates as you type. It is scaled to fit your screen, so it looks larger or smaller than real life — the true print size is shown as <span className="font-medium">Output</span> under the preview. The status line means:
          <span className="text-green-700"> green</span> = everything fits;
          <span className="text-amber-700"> amber</span> = content needs a taller label or a fold-out / tie-on tag (CLP Art. 29);
          <span className="text-red-700"> red</span> = the chosen size is below the CLP minimum.
        </p>
        <p>
          <span className="font-medium">PDF</span> is generated at the exact physical size shown in <span className="font-medium">Output</span> — print it at 100% (actual size) and it lands on your label stock at the right dimensions. If the label had to grow (amber), the PDF is a fold-out / tie-on-tag master.
        </p>
        <p>
          <span className="font-medium">SVG</span> is a scalable vector — open it in label software (e.g. BarTender, Adobe Illustrator) to resize or edit without any loss of quality.
        </p>
      </div>
    </details>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
      {/* CONTROLS + GATE (left on desktop; below preview on mobile) */}
      <div className="order-2 lg:order-1 space-y-5">
        {/* Container & label size */}
        <section className="bg-blue-50 border border-blue-200 rounded-xl p-4 sm:p-5 space-y-3">
          <p className="font-semibold text-[#062A78]">Container &amp; label size</p>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Container capacity</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {VOLUME_TIERS.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => handleVolumeChange(v.key)}
                className={`cursor-pointer flex flex-col items-start rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                  volume === v.key
                    ? 'bg-[#062A78] text-white border-[#062A78]'
                    : 'bg-white text-gray-900 border-gray-300 hover:border-[#062A78]'
                }`}
              >
                <span className="text-sm font-semibold">{v.label}</span>
                <span className={`text-xs mt-0.5 ${volume === v.key ? 'text-blue-100' : 'text-gray-500'}`}>{v.sublabel}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Label size</p>
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
              {(['mm', 'in'] as const).map(u => (
                <button key={u} type="button" onClick={() => setSizeUnit(u)}
                  className={`px-2 py-1 cursor-pointer ${sizeUnit === u ? 'bg-[#062A78] text-white' : 'bg-white text-gray-600'}`}>{u}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map(o => {
              const active = Math.abs(o.w - sizeW) < 0.5 && Math.abs(o.h - sizeH) < 0.5
              return (
                <button key={`${o.w}x${o.h}`} type="button" onClick={() => { setSizeW(o.w); setSizeH(o.h) }}
                  className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${
                    active ? 'bg-[#062A78] text-white border-[#062A78]' : 'bg-white text-gray-900 border-gray-300 hover:border-[#062A78]'
                  }`}>
                  <span className="block text-sm font-medium">{fmtDim(o.w)} × {fmtDim(o.h)} {sizeUnit}</span>
                  <span className={`block text-[11px] ${active ? 'text-blue-100' : 'text-gray-500'}`}>{o.note}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Custom:</span>
            <input type="number" min={10} value={toUnit(sizeW)} onChange={e => setSizeW(fromUnit(Number(e.target.value)))}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
            <span className="text-gray-400">×</span>
            <input type="number" min={10} value={toUnit(sizeH)} onChange={e => setSizeH(fromUnit(Number(e.target.value)))}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
            <span className="text-xs text-gray-500">{sizeUnit}</span>
          </div>
          {fit.belowClpMin ? (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {fmtDim(sizeW)} × {fmtDim(sizeH)} {sizeUnit} is below the CLP minimum ({fit.clpMinLabel}) for this capacity.
            </p>
          ) : fit.fits ? (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {fmtDim(sizeW)} × {fmtDim(sizeH)} {sizeUnit} · pictograms {fit.pictogramMm} mm · all elements fit
            </p>
          ) : (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Needs about {fit.neededHeightMm} mm height to stay legible — use a taller label, a larger size, or a fold-out / tie-on tag (CLP Art. 29).
            </p>
          )}
          <p className="text-[11px] text-gray-400">PDF prints at this physical size; the SVG is fully scalable in label software.</p>
        </section>
        {/* Product information */}
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
          <p className="font-semibold text-[#062A78]">Product information</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Nominal quantity</label>
              <input type="text" value={nominalQty} onChange={e => setNominalQty(e.target.value)} placeholder="500 mL" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Batch / Lot number</label>
              <input type="text" value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="LOT-2024-001" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>UFI code <span className="font-normal text-gray-400">(EU mixtures, required from 2025)</span></label>
              <input type="text" value={ufiCode} onChange={e => setUfiCode(e.target.value)} placeholder="UFI: XXXX-XXXX-XXXX-XXXX" className={inputClass} />
            </div>
          </div>
        </section>
        {/* Supplier */}
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-[#062A78]">Supplier details</p>
            <span className="text-[11px] text-gray-400">CLP Article 17 · saved locally</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Company name</label>
              <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)} onBlur={saveToStorage} placeholder="ACME Chemicals Ltd" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Address</label>
              <input type="text" value={supplierAddress} onChange={e => setSupplierAddress(e.target.value)} onBlur={saveToStorage} placeholder="123 Industrial Ave, London" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Emergency phone</label>
              <input type="text" value={supplierPhone} onChange={e => setSupplierPhone(e.target.value)} onBlur={saveToStorage} placeholder="+44 800 000 0000" className={inputClass} />
            </div>
          </div>
          {supplierIncomplete && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Add supplier name, address and phone — required by CLP Article 17 for a compliant label.
            </p>
          )}
          {/* Brand / logo (optional) — supplemental info, sits with the supplier block */}
          <div className="pt-1">
            <label className={labelClass}>Company logo <span className="font-normal text-gray-400">(optional)</span></label>
            {logo ? (
              <div className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2">
                <img src={logo.dataUrl} alt="Logo preview" className="h-10 w-auto max-w-[120px] object-contain" />
                <span className="text-xs text-gray-600 truncate flex-1">{logoName || 'logo'}</span>
                <button type="button" onClick={removeLogo} className="text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer">Remove</button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
                onDrop={onLogoDrop}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center cursor-pointer transition-colors ${dragActive ? 'border-[#062A78] bg-blue-50' : 'border-gray-300 bg-white hover:border-[#062A78]'}`}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span className="text-sm text-gray-600">Drop your logo here or click to upload</span>
                <span className="text-[11px] text-gray-400">PNG or JPEG</span>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onLogoInputChange} className="hidden" />
            {logoError && <p className="text-xs text-red-600 mt-1">{logoError}</p>}
            <p className="text-[11px] text-gray-400 mt-1">Your logo is added as supplemental information beside the supplier block. It must not cover the hazard pictograms or signal word, or imply the product is non-hazardous (CLP Art 25 / OSHA HCS C.3.1).</p>
          </div>
        </section>
        {/* P-statement format */}
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
          <p className="font-semibold text-[#062A78]">Precautionary statement format</p>
          <p className="text-xs text-gray-500">Both are permitted under CLP. Combined text saves space on small labels.</p>
          <div className="space-y-2">
            <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${pFormat === 'codes' ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="pformat" value="codes" checked={pFormat === 'codes'} onChange={() => setPFormat('codes')} className="mt-1 accent-[#062A78]" />
              <div>
                <p className="font-semibold text-sm">With codes</p>
                <p className="text-xs text-gray-500 mt-1">P210: Keep away from heat... P233: Keep container tightly closed.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${pFormat === 'combined' ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="pformat" value="combined" checked={pFormat === 'combined'} onChange={() => setPFormat('combined')} className="mt-1 accent-[#062A78]" />
              <div>
                <p className="font-semibold text-sm">Combined text (compact)</p>
                <p className="text-xs text-gray-500 mt-1">Keep away from heat. Keep container tightly closed. Use explosion-proof equipment...</p>
              </div>
            </label>
          </div>
        </section>
        {/* Download gate — placed after the controls so on mobile it follows them */}
        {!submitted ? (
          <div className="bg-blue-50 border-2 border-[#062A78] rounded-xl p-4 sm:p-5 space-y-4">
            <p className="font-bold text-[#062A78]">Download your label</p>
            <p className="text-sm text-gray-600">Free download of your label as PDF and SVG. Please confirm the disclaimer below.</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              <p className="font-semibold mb-1">Disclaimer — please confirm before downloading:</p>
              <p>This tool generates reference label layouts for informational purposes only. The user bears full responsibility for verifying compliance with applicable regulations (CLP, OSHA HCS, WHMIS). GHS Pictograms is not liable for regulatory penalties or injuries arising from label use.</p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-1 w-4 h-4 accent-[#062A78]" />
              <span className="text-sm text-gray-800">I accept full responsibility for verifying label compliance before use.</span>
            </label>
            {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
            <button
              type="button"
              onClick={confirmDownload}
              className="w-full py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors"
            >
              Show download links
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
              <p className="font-semibold">Ready to download!</p>
              <p>Your label is ready — download it as SVG (scalable, for label software) or PDF. Reference size: {tier.labelMm}.</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                <button type="button" onClick={handleDownloadPdf}
                  className="flex-1 py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors">
                  Download PDF
                </button>
                <button type="button" onClick={handleDownloadSvg}
                  className="flex-1 py-3 rounded-lg border-2 border-[#062A78] text-[#062A78] font-semibold hover:bg-[#062A78] hover:text-white transition-colors">
                  Download SVG
                </button>
              </div>
              <NewsletterOptIn source="label_constructor" />
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="text-sm font-semibold text-[#062A78]">
                  Need a Safety Data Sheet for {displayName}?
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Your label and a compliant SDS are the two documents that travel with this
                  substance. SDS Manager is a recommended partner solution for authoring and
                  managing GHS-compliant Safety Data Sheets.
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
                  <a href="/affiliate-disclosure/" className="underline hover:text-gray-700">
                    See disclosure
                  </a>
                  .
                </p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              <p className="font-semibold mb-1">For official use — print on certified materials</p>
              <p>Office printing does not meet BS5609 durability requirements for chemical-resistant labels.</p>
            </div>
          </div>
        )}
      </div>
      {/* PREVIEW (right on desktop, sticky; top on mobile) */}
      <div className="order-1 lg:order-2 lg:sticky lg:top-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Live preview</p>
          <div className="bg-white rounded-lg p-3 flex justify-center">
            <div
              className="w-full max-w-[460px] [&>svg]:w-full [&>svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>
          <div className="mt-2 text-center">
            <p className="text-xs font-medium text-gray-700">
              Output: {outFmt ? outFmt + ' · ' : ''}{fmtDim(outWmm)} × {fmtDim(outHmm)} {sizeUnit}{!fit.fits ? ' · fold-out / tie-on tag' : ''}
            </p>
            <p className="text-[11px] text-gray-400">Preview is scaled to fit your screen — the size above is the real print size.</p>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
