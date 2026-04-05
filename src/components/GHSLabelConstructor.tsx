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

type VolumeKey = 'le3' | '3to50' | '50to500' | 'gt500'
type Template = 'A' | 'B' | 'C'
type PFormat = 'codes' | 'combined'
type Step = 1 | 2 | 3 | 4 | 5

const VOLUME_OPTIONS: { key: VolumeKey; label: string; labelMm: string; picMm: string; template: Template }[] = [
  { key: 'le3',      label: 'Up to 3 L',    labelMm: '52 × 74 mm',   picMm: '16 × 16 mm', template: 'A' },
  { key: '3to50',    label: '3 L – 50 L',   labelMm: '74 × 105 mm',  picMm: '23 × 23 mm', template: 'B' },
  { key: '50to500',  label: '50 – 500 L',   labelMm: '105 × 148 mm', picMm: '32 × 32 mm', template: 'C' },
  { key: 'gt500',    label: 'Over 500 L',   labelMm: '148 × 210 mm', picMm: '46 × 46 mm', template: 'C' },
]

const PIC_SIZE: Record<VolumeKey, number> = { le3: 56, '3to50': 80, '50to500': 104, gt500: 128 }

const TEMPLATE_LABELS: Record<Template, string> = {
  A: 'A — Compact vertical (small bottles)',
  B: 'B — Two-column (canisters, pails)',
  C: 'C — Horizontal (drums, IBC)',
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

const STORAGE_KEY = 'ghs_supplier_data'

export default function GHSLabelConstructor({
  displayName, casNumber, ecNumber, signalWord,
  pictograms, hStatements, pStatements,
}: Props) {
  const [step, setStep] = useState<Step>(1)
  const [volume, setVolume] = useState<VolumeKey>('3to50')
  const [template, setTemplate] = useState<Template>('B')
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

  const volInfo = VOLUME_OPTIONS.find(v => v.key === volume)!
  const picSizePx = PIC_SIZE[volume]
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
    setTemplate(VOLUME_OPTIONS.find(v => v.key === key)!.template)
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
          label_template: template,
          volume_range: volInfo.label,
        }),
      })
      setSubmitted(true)
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const PictogramsBlock = ({ size }: { size: number }) => (
    <div className="flex flex-wrap gap-4 justify-center">
      {filteredPics.map(p => (
        <div
          key={p.code}
          style={{ width: size, height: size }}
          className="flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
          dangerouslySetInnerHTML={{ __html: p.svg_content ?? '' }}
        />
      ))}
    </div>
  )

  const SignalWordBlock = () => signalWord ? (
    <p className={`text-center font-black tracking-tight uppercase text-3xl ${signalWord === 'Danger' ? 'text-red-700' : 'text-amber-700'}`}>
      {signalWord}
    </p>
  ) : null

  const HBlock = ({ small }: { small?: boolean }) => hStatements.length > 0 ? (
    <div>
      <p className="text-xs font-bold uppercase text-gray-500 mb-1 tracking-wide">Hazard statements</p>
      <ul className={`${small ? 'text-xs' : 'text-sm'} space-y-1 leading-snug`}>
        {hStatements.map(h => <li key={h.code}><span className="font-bold">{h.code}:</span> {h.text_en}</li>)}
      </ul>
    </div>
  ) : null

  const PBlock = ({ small }: { small?: boolean }) => shownP.length > 0 ? (
    <div>
      <p className="text-xs font-bold uppercase text-gray-500 mb-1 tracking-wide">Precautionary statements</p>
      {pFormat === 'combined' ? (
        <p className={`${small ? 'text-xs' : 'text-sm'} leading-relaxed text-gray-800`}>{combinePStatements(shownP)}</p>
      ) : (
        <ul className={`${small ? 'text-xs' : 'text-sm'} space-y-1 leading-snug`}>
          {shownP.map(p => <li key={p.code}><span className="font-bold">{p.code}:</span> {p.text_en}</li>)}
        </ul>
      )}
      {hiddenPCount > 0 && (
        <p className="mt-1 text-xs text-amber-700">+{hiddenPCount} more — see SDS (CLP max. 6 on label)</p>
      )}
    </div>
  ) : null

  const SupplierBlock = ({ small }: { small?: boolean }) => (
    <div>
      <p className="text-xs font-bold uppercase text-gray-500 mb-1 tracking-wide">Supplier</p>
      {supplierName || supplierAddress || supplierPhone ? (
        <div className={`${small ? 'text-xs' : 'text-sm'} text-gray-800`}>
          {supplierName && <p className="font-semibold">{supplierName}</p>}
          {supplierAddress && <p>{supplierAddress}</p>}
          {supplierPhone && <p>{supplierPhone}</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">[Add supplier in Step 2 — required by CLP Art. 17]</p>
      )}
    </div>
  )

  const ProductBlock = ({ small }: { small?: boolean }) => (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Product identifier</p>
      <p className={`${small ? 'text-base' : 'text-lg'} font-bold mt-0.5`}>{displayName}</p>
      <p className="text-xs text-gray-600">CAS: {casNumber}{ecNumber ? ` · EC: ${ecNumber}` : ''}</p>
      {nominalQty && <p className="text-xs text-gray-600">Qty: {nominalQty}</p>}
      {batchNumber && <p className="text-xs text-gray-600">Batch: {batchNumber}</p>}
      {ufiCode && <p className="text-xs font-mono text-gray-700 mt-0.5">{ufiCode}</p>}
    </div>
  )

  const LabelTemplateA = () => (
    <div className="bg-white border-[3px] border-red-600 p-4 mx-auto" style={{ maxWidth: 320 }}>
      <ProductBlock small />
      <div className="border-t border-gray-200 my-3" />
      <div className="flex justify-center my-3">
        <PictogramsBlock size={picSizePx} />
      </div>
      <SignalWordBlock />
      <div className="border-t border-gray-200 my-3 space-y-3">
        <HBlock small />
        <PBlock small />
      </div>
      <div className="border-t border-dashed border-gray-300 pt-2">
        <SupplierBlock small />
      </div>
      <p className="text-center text-xs text-gray-300 mt-2">{volInfo.labelMm} · {volInfo.picMm} · CLP Annex I</p>
    </div>
  )

  const LabelTemplateB = () => (
    <div className="bg-white border-[3px] border-red-600 p-5 mx-auto" style={{ maxWidth: 560 }}>
      <ProductBlock />
      <div className="border-t border-gray-200 my-3" />
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col items-center justify-start gap-3">
          <PictogramsBlock size={picSizePx} />
          <SignalWordBlock />
        </div>
        <div className="space-y-3 text-sm">
          <HBlock />
          <PBlock />
        </div>
      </div>
      <div className="border-t border-dashed border-gray-300 mt-4 pt-3">
        <SupplierBlock />
      </div>
      <p className="text-center text-xs text-gray-300 mt-2">{volInfo.labelMm} · {volInfo.picMm} · CLP Annex I</p>
    </div>
  )

  const LabelTemplateC = () => (
    <div className="bg-white border-[3px] border-red-600 p-6 mx-auto" style={{ maxWidth: 720 }}>
      <div className="flex gap-6">
        <div className="flex flex-col items-center justify-center gap-3 shrink-0" style={{ minWidth: picSizePx * 2 + 16 }}>
          <PictogramsBlock size={picSizePx} />
          <SignalWordBlock />
        </div>
        <div className="flex-1 space-y-3">
          <ProductBlock />
          <div className="border-t border-gray-200" />
          <HBlock />
          <PBlock />
          <div className="border-t border-dashed border-gray-300 pt-2">
            <SupplierBlock />
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-gray-300 mt-3">{volInfo.labelMm} · {volInfo.picMm} · CLP Annex I</p>
    </div>
  )

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {VOLUME_OPTIONS.map(v => (
              <button key={v.key} type="button" onClick={() => handleVolumeChange(v.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${volume === v.key ? 'bg-[#062A78] text-white border-[#062A78]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#062A78]'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600">
            Label size: <span className="font-semibold">{volInfo.labelMm}</span> · Pictogram: <span className="font-semibold">{volInfo.picMm}</span> · CLP Annex I
          </p>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Label template (auto-selected, can change):</p>
            <div className="flex flex-col gap-2">
              {(['A','B','C'] as Template[]).map(t => (
                <label key={t} className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${template === t ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <input type="radio" name="template" value={t} checked={template === t} onChange={() => setTemplate(t)} className="accent-[#062A78]" />
                  <span className="text-sm font-medium">{TEMPLATE_LABELS[t]}</span>
                </label>
              ))}
            </div>
          </div>
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
            {template === 'A' && <LabelTemplateA />}
            {template === 'B' && <LabelTemplateB />}
            {template === 'C' && <LabelTemplateC />}
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
                <p>Print instructions: select "Actual size" in your print dialog. Label size: {volInfo.labelMm}.</p>
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
