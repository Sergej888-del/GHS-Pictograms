import { useState, useEffect } from 'react'

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
type FontScale = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type PFormat = 'codes' | 'combined'
type Step = 1 | 2 | 3 | 4 | 5

const VOLUME_TIERS = [
  {
    key: 'xs' as const,
    label: '≤ 0.5 L',
    sublabel: 'Vials, small bottles',
    labelMm: '52 × 74 mm',
    picMm: '10 × 10 mm',
    picSizePx: 38,
    maxWidthPx: 260,
    fontScale: 'xs' as const,
  },
  {
    key: 'sm' as const,
    label: '0.5 – 3 L',
    sublabel: 'Bottles, canisters',
    labelMm: '52 × 74 mm',
    picMm: '16 × 16 mm',
    picSizePx: 52,
    maxWidthPx: 280,
    fontScale: 'sm' as const,
  },
  {
    key: 'md' as const,
    label: '3 – 50 L',
    sublabel: 'Pails, canisters',
    labelMm: '74 × 105 mm',
    picMm: '23 × 23 mm',
    picSizePx: 72,
    maxWidthPx: 420,
    fontScale: 'md' as const,
  },
  {
    key: 'lg' as const,
    label: '50 – 500 L',
    sublabel: 'Drums, IBCs',
    labelMm: '105 × 148 mm',
    picMm: '32 × 32 mm',
    picSizePx: 100,
    maxWidthPx: 580,
    fontScale: 'lg' as const,
  },
  {
    key: 'xl' as const,
    label: '> 500 L',
    sublabel: 'Large IBCs, tanks',
    labelMm: '148 × 210 mm',
    picMm: '46 × 46 mm',
    picSizePx: 140,
    maxWidthPx: 720,
    fontScale: 'xl' as const,
  },
]

function getFontClasses(scale: FontScale) {
  const map: Record<
    FontScale,
    { name: string; cas: string; label: string; h: string; p: string; signal: string; supplier: string }
  > = {
    xs: {
      name: 'text-[10px]',
      cas: 'text-[8px]',
      label: 'text-[8px] uppercase',
      h: 'text-[8px] leading-tight',
      p: 'text-[8px] leading-tight',
      signal: 'text-xs',
      supplier: 'text-[7px]',
    },
    sm: {
      name: 'text-xs',
      cas: 'text-[9px]',
      label: 'text-[9px] uppercase',
      h: 'text-[9px] leading-snug',
      p: 'text-[9px] leading-snug',
      signal: 'text-sm',
      supplier: 'text-[8px]',
    },
    md: {
      name: 'text-sm',
      cas: 'text-xs',
      label: 'text-[10px] uppercase',
      h: 'text-xs leading-snug',
      p: 'text-xs leading-snug',
      signal: 'text-base',
      supplier: 'text-[9px]',
    },
    lg: {
      name: 'text-base',
      cas: 'text-xs',
      label: 'text-xs uppercase',
      h: 'text-xs leading-normal',
      p: 'text-xs leading-normal',
      signal: 'text-lg',
      supplier: 'text-xs',
    },
    xl: {
      name: 'text-lg',
      cas: 'text-sm',
      label: 'text-xs uppercase',
      h: 'text-sm leading-normal',
      p: 'text-sm leading-normal',
      signal: 'text-xl',
      supplier: 'text-sm',
    },
  }
  return map[scale]
}

function applyPrecedence(pictograms: Pictogram[]): Pictogram[] {
  const codes = pictograms.map(p => p.code)
  return pictograms.filter(p => {
    if (p.code === 'GHS07' && (codes.includes('GHS06') || codes.includes('GHS05') || codes.includes('GHS08'))) return false
    return true
  })
}

function combinePStatements(pStatements: PStatement[]): string {
  return pStatements.map(p => p.text_en).join(' ')
}

/** Раскладка пиктограмм в левой колонке по CLP/GHS */
function PictogramsCluster({ pics, sizePx }: { pics: Pictogram[]; sizePx: number }) {
  const n = pics.length
  if (n === 0) return null

  const cell = (p: Pictogram) => (
    <div
      key={p.code}
      style={{ width: sizePx, height: sizePx }}
      className="flex shrink-0 items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: p.svg_content ?? '' }}
    />
  )

  if (n === 1) {
    return <div className="flex w-full justify-start">{cell(pics[0])}</div>
  }
  if (n === 2 || n === 3) {
    return <div className="flex flex-col items-center gap-1">{pics.map(cell)}</div>
  }
  if (n === 4) {
    return <div className="grid grid-cols-2 gap-1 justify-items-center">{pics.map(cell)}</div>
  }
  if (n === 5) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="grid grid-cols-2 gap-1 justify-items-center">{pics.slice(0, 4).map(cell)}</div>
        <div className="flex w-full justify-center">{cell(pics[4])}</div>
      </div>
    )
  }
  return <div className="grid grid-cols-2 gap-1 justify-items-center">{pics.map(cell)}</div>
}

/** Ширина левой колонки (пиктограммы + сигнальное слово) */
function getLeftColumnWidth(picCount: number, picSizePx: number): number {
  if (picCount <= 0) return picSizePx + 16
  if (picCount <= 3) return picSizePx + 16
  return picSizePx * 2 + 24
}

const STORAGE_KEY = 'ghs_supplier_data'

export default function GHSLabelConstructor({
  displayName, casNumber, ecNumber, signalWord,
  pictograms, hStatements, pStatements,
}: Props) {
  const [step, setStep] = useState<Step>(1)
  const [volume, setVolume] = useState<VolumeKey>('sm')
  const [supplierName, setSupplierName] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [nominalQty, setNominalQty] = useState('')
  const [ufiCode, setUfiCode] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [pFormat, setPFormat] = useState<PFormat>('codes')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [agreed, setAgreed] = useState(false)

  const tier = VOLUME_TIERS.find(v => v.key === volume)!
  const filteredPics = applyPrecedence(pictograms)
  const MAX_P = 6
  const shownP = pStatements.slice(0, MAX_P)
  const hiddenPCount = pStatements.length - MAX_P

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.supplierName) setSupplierName(data.supplierName)
        if (data.supplierAddress) setSupplierAddress(data.supplierAddress)
        if (data.supplierPhone) setSupplierPhone(data.supplierPhone)
        if (data.email) setEmail(data.email)
        if (data.company) setCompany(data.company)
        if (data.role) setRole(data.role)
      }
    } catch {}
  }, [])

  const saveToStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        supplierName, supplierAddress, supplierPhone, email, company, role
      }))
    } catch {}
  }

  const handleVolumeChange = (key: VolumeKey) => {
    setVolume(key)
  }

  const handleSubmitLead = async () => {
    if (!email || !email.includes('@')) { setSubmitError('Please enter a valid email address.'); return }
    if (!agreed) { setSubmitError('Please confirm the disclaimer.'); return }
    setSubmitting(true)
    setSubmitError('')
    try {
      saveToStorage()
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, company, role,
          cas_number: casNumber,
          substance_name: displayName,
          label_template: volume,
          volume_range: tier.label,
        }),
      })
      setSubmitted(true)
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const signalWordNorm = signalWord?.trim().toLowerCase() ?? ''
  const signalColor =
    signalWordNorm === 'danger' ? 'text-red-700' : 'text-amber-600'

  const UnifiedLabelPreview = () => {
    const fc = getFontClasses(tier.fontScale)
    const nPics = filteredPics.length
    const leftColW = getLeftColumnWidth(nPics, tier.picSizePx)
    const hasLeft = nPics > 0 || !!signalWord

    const labelInnerClass =
      volume === 'xs' || volume === 'sm'
        ? 'flex flex-row p-2 gap-2'
        : volume === 'md'
          ? 'flex flex-row p-3 gap-3'
          : 'flex flex-row p-4 gap-4'

    const supplierLine = [supplierName, supplierAddress, supplierPhone].filter(Boolean).join(' | ')

    return (
      <div
        className="bg-white border-[3px] border-red-600 mx-auto font-sans text-gray-900 antialiased overflow-hidden"
        style={{ maxWidth: tier.maxWidthPx }}
      >
        <div className={labelInnerClass}>
          {hasLeft ? (
            <div
              className="shrink-0 flex flex-col items-center gap-1 justify-start"
              style={{ width: leftColW }}
            >
              {filteredPics.length > 0 ? (
                <PictogramsCluster pics={filteredPics} sizePx={tier.picSizePx} />
              ) : null}
              {signalWord ? (
                <p className={`text-center font-black uppercase tracking-tight leading-tight ${fc.signal} ${signalColor}`}>
                  {signalWord}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={`min-w-0 flex flex-1 flex-col gap-1 ${!hasLeft ? 'w-full' : ''}`}>
            <p className={`font-bold leading-tight break-words hyphens-auto ${fc.name}`}>{displayName}</p>
            <p className={`text-gray-500 ${fc.cas}`}>
              CAS: {casNumber}
              {ecNumber ? ` · EC: ${ecNumber}` : ''}
            </p>
            {nominalQty ? <p className={`text-gray-600 ${fc.cas}`}>Qty: {nominalQty}</p> : null}
            {batchNumber ? <p className={`text-gray-600 ${fc.cas}`}>Batch: {batchNumber}</p> : null}
            {ufiCode ? <p className={`font-mono text-gray-700 ${fc.cas}`}>{ufiCode}</p> : null}

            {(hStatements.length > 0 || shownP.length > 0) ? (
              <div className="border-t border-gray-200 my-0.5" />
            ) : null}

            {hStatements.length > 0 ? (
              <>
                <p className={`font-semibold text-gray-400 tracking-wider ${fc.label}`}>Hazard statements</p>
                <ul className={`space-y-0.5 ${fc.h}`}>
                  {hStatements.map(h => (
                    <li key={h.code}>
                      <span className="font-bold">{h.code}:</span> {h.text_en}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {hStatements.length > 0 && shownP.length > 0 ? (
              <div className="border-t border-gray-200 my-0.5" />
            ) : null}

            {shownP.length > 0 ? (
              <>
                <p className={`font-semibold text-gray-400 tracking-wider ${fc.label}`}>Precautionary statements</p>
                {pFormat === 'combined' ? (
                  <p className={`${fc.p}`}>{combinePStatements(shownP)}</p>
                ) : (
                  <ul className={`space-y-0.5 ${fc.p}`}>
                    {shownP.map(p => (
                      <li key={p.code}>
                        <span className="font-bold">{p.code}:</span> {p.text_en}
                      </li>
                    ))}
                  </ul>
                )}
                {hiddenPCount > 0 ? (
                  <p className={`mt-0.5 text-amber-800 ${fc.cas}`}>+{hiddenPCount} more — see SDS</p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {supplierLine ? (
          <div className={`border-t border-dashed border-gray-300 px-2 py-1.5 sm:px-3 leading-snug break-words ${fc.supplier}`}>
            <span className="font-bold text-gray-600">SUPPLIER: </span>
            <span className="text-gray-800">{supplierLine}</span>
          </div>
        ) : null}
      </div>
    )
  }

  const stepTitles = ['Container volume', 'Supplier details', 'Product info', 'P-statement format', 'Preview & Download']

  return (
    <div className="space-y-6">

      {/* Progress bar */}
      <div className="flex items-center gap-1 max-w-2xl mx-auto">
        {([1,2,3,4,5] as Step[]).map(s => (
          <div key={s} className="flex-1 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => s < step && setStep(s)}
              className={`w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                s === step ? 'bg-[#062A78] text-white' :
                s < step ? 'bg-green-500 text-white cursor-pointer' :
                'bg-gray-200 text-gray-400'
              }`}
            >
              {s < step ? '✓' : s}
            </button>
            <span className="text-xs text-gray-500 hidden sm:block text-center leading-tight">{stepTitles[s-1]}</span>
          </div>
        ))}
      </div>

      {/* Step 1 — Volume */}
      {step === 1 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
          <p className="font-semibold text-[#062A78]">Step 1 — Select container volume</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {VOLUME_TIERS.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => handleVolumeChange(v.key)}
                className={`cursor-pointer flex flex-col items-start rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${
                  volume === v.key
                    ? 'bg-[#062A78] text-white border-[#062A78]'
                    : 'bg-white text-gray-900 border-gray-300 hover:border-[#062A78]'
                }`}
              >
                <span className="text-sm font-semibold">{v.label}</span>
                <span className={`text-xs mt-0.5 ${volume === v.key ? 'text-blue-100' : 'text-gray-500'}`}>
                  {v.sublabel}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600">
            Label size: <span className="font-semibold">{tier.labelMm}</span> · Pictogram: <span className="font-semibold">{tier.picMm}</span> · CLP Annex I Table 1.3
          </p>
          <button type="button" onClick={() => setStep(2)}
            className="w-full py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors">
            Next: Supplier details
          </button>
        </div>
      )}

      {/* Step 2 — Supplier */}
      {step === 2 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <p className="font-semibold text-[#062A78]">Step 2 — Supplier details</p>
          <p className="text-xs text-gray-500">Required by CLP Article 17. Saved locally for next visit.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Company name *</label>
              <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="ACME Chemicals Ltd" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Address *</label>
              <input type="text" value={supplierAddress} onChange={e => setSupplierAddress(e.target.value)} placeholder="123 Industrial Ave, London" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Emergency phone *</label>
              <input type="text" value={supplierPhone} onChange={e => setSupplierPhone(e.target.value)} placeholder="+44 800 000 0000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
            </div>
          </div>
          {submitError && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="flex-1 py-3 rounded-lg border-2 border-gray-300 text-gray-700 font-semibold hover:border-gray-400 transition-colors">Back</button>
            <button type="button" onClick={() => {
              if (!supplierName.trim() || !supplierAddress.trim() || !supplierPhone.trim()) {
                setSubmitError('Please fill in all supplier fields — required by CLP Article 17.')
                return
              }
              setSubmitError('')
              saveToStorage()
              setStep(3)
            }} className="flex-1 py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors">Next: Product info</button>
          </div>
        </div>
      )}

      {/* Step 3 — Product info */}
      {step === 3 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <p className="font-semibold text-[#062A78]">Step 3 — Product information</p>
          <div className="bg-white rounded-lg p-3 border border-gray-200 text-sm">
            <p className="text-gray-500 text-xs mb-1">From database:</p>
            <p className="font-semibold">{displayName}</p>
            <p className="text-gray-500">CAS: {casNumber}{ecNumber ? ` · EC: ${ecNumber}` : ''}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Nominal quantity</label>
              <input type="text" value={nominalQty} onChange={e => setNominalQty(e.target.value)} placeholder="500 mL" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Batch / Lot number</label>
              <input type="text" value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="LOT-2024-001" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">UFI code <span className="font-normal text-gray-400">(EU mixtures, required from 2025)</span></label>
              <input type="text" value={ufiCode} onChange={e => setUfiCode(e.target.value)} placeholder="UFI: XXXX-XXXX-XXXX-XXXX" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(2)} className="flex-1 py-3 rounded-lg border-2 border-gray-300 text-gray-700 font-semibold hover:border-gray-400 transition-colors">Back</button>
            <button type="button" onClick={() => setStep(4)} className="flex-1 py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors">Next: P-statement format</button>
          </div>
        </div>
      )}

      {/* Step 4 — P format */}
      {step === 4 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <p className="font-semibold text-[#062A78]">Step 4 — Precautionary statement format</p>
          <p className="text-xs text-gray-500">Both formats are permitted under CLP. Combined text saves space on small labels.</p>
          <div className="space-y-3">
            <label className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${pFormat === 'codes' ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="pformat" value="codes" checked={pFormat === 'codes'} onChange={() => setPFormat('codes')} className="mt-1 accent-[#062A78]" />
              <div>
                <p className="font-semibold text-sm">With codes</p>
                <p className="text-xs text-gray-500 mt-1">P210: Keep away from heat... P233: Keep container tightly closed.</p>
              </div>
            </label>
            <label className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${pFormat === 'combined' ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="pformat" value="combined" checked={pFormat === 'combined'} onChange={() => setPFormat('combined')} className="mt-1 accent-[#062A78]" />
              <div>
                <p className="font-semibold text-sm">Combined text (compact)</p>
                <p className="text-xs text-gray-500 mt-1">Keep away from heat. Keep container tightly closed. Use explosion-proof equipment...</p>
              </div>
            </label>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(3)} className="flex-1 py-3 rounded-lg border-2 border-gray-300 text-gray-700 font-semibold hover:border-gray-400 transition-colors">Back</button>
            <button type="button" onClick={() => setStep(5)} className="flex-1 py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors">Preview label</button>
          </div>
        </div>
      )}

      {/* Step 5 — Preview + Lead */}
      {step === 5 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-[#062A78] text-lg">Step 5 — Label preview</p>
            <button type="button" onClick={() => setStep(4)} className="text-sm text-gray-500 hover:text-gray-700 underline">Back</button>
          </div>

          <div id="label-preview-print">
            <UnifiedLabelPreview />
          </div>

          {!submitted ? (
            <div className="max-w-2xl mx-auto bg-blue-50 border-2 border-[#062A78] rounded-xl p-5 space-y-4">
              <p className="font-bold text-[#062A78]">Download your label</p>
              <p className="text-sm text-gray-600">Enter your details to download PDF and SVG files. Your data is saved for future sessions.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Work email *</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Company</label>
                  <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Your role</label>
                  <select value={role} onChange={e => setRole(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]">
                    <option value="">Select role...</option>
                    <option value="EHS Manager">EHS Manager</option>
                    <option value="Production Manager">Production Manager</option>
                    <option value="Lab Technician">Lab Technician</option>
                    <option value="Logistics">Logistics / Transport</option>
                    <option value="Packaging Designer">Packaging Designer</option>
                    <option value="Compliance Officer">Compliance Officer</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
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
                onClick={handleSubmitLead}
                disabled={submitting}
                className="w-full py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors disabled:opacity-50"
              >
                {submitting ? 'Processing...' : 'Get download links'}
              </button>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
                <p className="font-semibold">Ready to download!</p>
                <p>Print instructions: select &quot;Actual size&quot; in your print dialog. Label size: {tier.labelMm}.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button type="button" onClick={() => window.print()}
                  className="flex-1 py-3 rounded-lg bg-[#062A78] text-white font-semibold hover:bg-[#051f5c] transition-colors">
                  Download as PDF
                </button>
                <a href="https://ghslabels.com" target="_blank" rel="noopener noreferrer"
                  className="flex-1 py-3 rounded-lg border-2 border-[#062A78] text-[#062A78] font-semibold hover:bg-[#062A78] hover:text-white transition-colors text-center">
                  Order certified print
                </a>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
                <p className="font-semibold mb-1">For official use — print on certified materials</p>
                <p>Office printing does not meet BS5609 durability requirements for chemical-resistant labels.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
