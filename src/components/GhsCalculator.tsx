import { useState, useEffect } from 'react';

/**
 * Per-pictogram interactive calculator shell for /ghs/[code]/ pages.
 * One component, one config per pictogram. Renders null for codes without a
 * config (so adding GHS06/09/05/01/etc. later needs no page edit).
 *
 * The classification logic for each pictogram is a pure function, verified
 * against official sources (CLP Annex I / OSHA HCS) before shipping.
 */

type Jurisdiction = 'EU' | 'US';

type InputDef =
  | { type: 'number'; id: string; label: string; unit?: string; placeholder?: string }
  | { type: 'select'; id: string; label: string; options: { value: string; label: string }[] }
  | { type: 'checkbox'; id: string; label: string };

interface CalcResult {
  ok: boolean;
  message?: string;            // shown when ok === false (e.g. missing input)
  classified?: boolean;        // true => an actual GHS classification
  category?: string;
  hCode?: string;
  signal?: 'Danger' | 'Warning';
  pictogram?: string | null;   // e.g. 'GHS02', or null when no pictogram is required
  headline?: string;           // shown when classified === false
  note?: string | null;
  tone?: 'danger' | 'warning' | 'neutral';
}

interface CalcConfig {
  title: string;
  subtitle: string;
  jurisdictionAware: boolean;
  inputs: InputDef[];
  compute: (values: Record<string, string | boolean>, jur: Jurisdiction) => CalcResult;
  affiliate?: boolean;         // show the SDS authoring slot after a classified result
}

// ---------------------------------------------------------------------------
// GHS02 — flammable liquids. EU = CLP Annex I 2.6; US = OSHA HCS 29 CFR 1910.106
// App B. Closed-cup flash point (°C); initial boiling point (°C, optional).
// Logic verified by a standalone boundary test (14/14) before delivery.
// ---------------------------------------------------------------------------
function computeFlammableLiquid(
  values: Record<string, string | boolean>,
  jur: Jurisdiction,
): CalcResult {
  const fp = parseFloat(String(values.fp ?? ''));
  const bpRaw = String(values.bp ?? '').trim();
  const bp = bpRaw === '' ? null : parseFloat(bpRaw);
  if (Number.isNaN(fp)) return { ok: false, message: 'Enter a flash point in °C.' };
  const bpKnown = bp !== null && !Number.isNaN(bp);

  const cls = (
    category: string,
    hCode: string,
    signal: 'Danger' | 'Warning',
    pictogram: string | null,
    note?: string | null,
  ): CalcResult => ({
    ok: true,
    classified: true,
    category,
    hCode,
    signal,
    pictogram,
    note: note ?? null,
    tone: signal === 'Danger' ? 'danger' : 'warning',
  });

  // Category 1 — fp < 23 °C AND bp ≤ 35 °C
  if (fp < 23 && bpKnown && (bp as number) <= 35) return cls('Category 1', 'H224', 'Danger', 'GHS02');

  // Category 2 — fp < 23 °C AND (bp > 35 °C OR bp unknown)
  if (fp < 23)
    return cls(
      'Category 2',
      'H225',
      'Danger',
      'GHS02',
      bpKnown ? null : 'Boiling point unknown — defaulted to Category 2 (Category 1 requires a boiling point ≤ 35 °C).',
    );

  // Category 3 — 23 °C ≤ fp ≤ 60 °C
  if (fp <= 60) {
    const note =
      jur === 'EU' && fp > 35
        ? 'EU only: may be exempt from Category 3 if the UN L.2 sustained-combustibility test is negative (CLP 2.6.4.5).'
        : null;
    return cls('Category 3', 'H226', 'Warning', 'GHS02', note);
  }

  // 60 °C < fp ≤ 93 °C — jurisdictions diverge
  if (fp <= 93) {
    if (jur === 'US')
      return cls(
        'Category 4',
        'H227',
        'Warning',
        null,
        'US (OSHA HazCom) only: combustible liquid — signal word Warning, no pictogram. Not classified as a flammable liquid under EU CLP (cut-off is a 60 °C flash point).',
      );
    return {
      ok: true,
      classified: false,
      tone: 'neutral',
      headline: 'Not a flammable liquid under EU CLP',
      note: 'EU CLP classifies flammable liquids only up to a 60 °C flash point. In the US this would be OSHA Category 4 (H227, combustible liquid).',
    };
  }

  // fp > 93 °C
  return {
    ok: true,
    classified: false,
    tone: 'neutral',
    headline: 'Not a flammable liquid',
    note: 'Flash point above 93 °C — outside the flammable-liquid scope in both the EU and US.',
  };
}

// ---------------------------------------------------------------------------
// GHS06 / GHS07 — acute toxicity. EU CLP Table 3.1.1 and US OSHA HCS Table A.1.1
// are numerically identical (both UN GHS), so this tool is not jurisdiction-aware.
// Cut-offs verified verbatim against OSHA 1910.1200 App A Table A.1.1 (the dermal
// Cat 1 upper bound corrected to 50 via the App A Table A.1.2 cross-check).
// Cat 1-3 -> GHS06 (Danger); Cat 4 -> GHS07 (Warning). Logic boundary-tested (22/22).
// ---------------------------------------------------------------------------
const ACUTE_TOX_TABLE: Record<string, { unit: string; label: string; bounds: number[]; h: string[] }> = {
  oral: { unit: 'mg/kg bw', label: 'Oral', bounds: [5, 50, 300, 2000], h: ['H300', 'H300', 'H301', 'H302'] },
  dermal: { unit: 'mg/kg bw', label: 'Dermal', bounds: [50, 200, 1000, 2000], h: ['H310', 'H310', 'H311', 'H312'] },
  inh_gas: { unit: 'ppmV', label: 'Inhalation, gas', bounds: [100, 500, 2500, 20000], h: ['H330', 'H330', 'H331', 'H332'] },
  inh_vapour: { unit: 'mg/L', label: 'Inhalation, vapour', bounds: [0.5, 2.0, 10.0, 20.0], h: ['H330', 'H330', 'H331', 'H332'] },
  inh_dust: { unit: 'mg/L', label: 'Inhalation, dust/mist', bounds: [0.05, 0.5, 1.0, 5.0], h: ['H330', 'H330', 'H331', 'H332'] },
};

function computeAcuteToxicity(values: Record<string, string | boolean>, _jur: Jurisdiction): CalcResult {
  const routeKey = String(values.route ?? '');
  const t = ACUTE_TOX_TABLE[routeKey];
  if (!t) return { ok: false, message: 'Select an exposure route.' };
  const v = parseFloat(String(values.value ?? ''));
  if (Number.isNaN(v)) return { ok: false, message: 'Enter an LD50 / LC50 value.' };

  let cat = 0;
  for (let i = 0; i < 4; i++) {
    if (v <= t.bounds[i]) {
      cat = i + 1;
      break;
    }
  }
  if (cat === 0) {
    return {
      ok: true,
      classified: false,
      tone: 'neutral',
      headline: 'Not classified for acute toxicity',
      note: `${t.label}: above the Category 4 cut-off (${t.bounds[3]} ${t.unit}). UN GHS Category 5 exists but is not adopted by EU CLP or US OSHA HazCom (identical cut-offs apply in both).`,
    };
  }
  const signal: 'Danger' | 'Warning' = cat === 4 ? 'Warning' : 'Danger';
  const pictogram = cat === 4 ? 'GHS07' : 'GHS06';
  const note =
    cat === 4
      ? 'Category 4 acute toxicity carries GHS07 (exclamation mark), not GHS06 (skull) — signal word Warning. Identical under EU CLP and US OSHA HazCom.'
      : 'Identical cut-offs under EU CLP and US OSHA HazCom (UN GHS).';
  return {
    ok: true,
    classified: true,
    category: `Category ${cat}`,
    hCode: t.h[cat - 1],
    signal,
    pictogram,
    note,
    tone: signal === 'Danger' ? 'danger' : 'warning',
  };
}

// ---------------------------------------------------------------------------
// GHS09 — aquatic environmental hazard. EU CLP Annex I Part 4 (Tables 4.1.0/4.1.1).
// US OSHA HazCom does NOT regulate environmental hazards -> out of scope.
// CLP uses Aquatic Acute Category 1 only (H400). GHS09 is carried by Acute 1 (H400),
// Chronic 1 (H410) and Chronic 2 (H411) only; Chronic 3 (H412) / 4 (H413) = statement
// only (no pictogram, no signal word). Signal: Acute1 Warning, Chronic1 Warning,
// Chronic2 none. Chronic categories here use the surrogate method (acute L(E)C50 +
// adverse fate); adequate chronic NOEC/ECx data takes precedence. Boundary-tested (11/11).
// ---------------------------------------------------------------------------
function computeAquatic(values: Record<string, string | boolean>, jur: Jurisdiction): CalcResult {
  if (jur === 'US') {
    return {
      ok: true,
      classified: false,
      tone: 'neutral',
      headline: 'Not classified under US OSHA HazCom',
      note: 'OSHA HazCom does not cover environmental (aquatic) hazards. GHS09 applies under EU CLP, UN GHS and for transport (marine pollutant) — but not on US workplace labels. Switch to EU · CLP to classify.',
    };
  }

  const lc50 = parseFloat(String(values.lc50 ?? ''));
  if (Number.isNaN(lc50)) return { ok: false, message: 'Enter an acute L(E)C50 / EC50 in mg/L.' };
  const adverseFate = Boolean(values.notRapid) || Boolean(values.bioacc);

  const acute1 = lc50 <= 1;
  let chronicCat = 0;
  if (adverseFate) {
    if (lc50 <= 1) chronicCat = 1;
    else if (lc50 <= 10) chronicCat = 2;
    else if (lc50 <= 100) chronicCat = 3;
  }

  const hasPicto = acute1 || chronicCat === 1 || chronicCat === 2;
  const surrogateNote =
    'Chronic categories use the surrogate method (acute data + environmental fate); adequate chronic NOEC/ECx data takes precedence. Use the lowest L(E)C50 across fish, crustacea and algae.';

  if (hasPicto) {
    const parts: string[] = [];
    const codes: string[] = [];
    if (acute1) {
      parts.push('Acute 1');
      codes.push('H400');
    }
    if (chronicCat === 1) {
      parts.push('Chronic 1');
      codes.push('H410');
    } else if (chronicCat === 2) {
      parts.push('Chronic 2');
      codes.push('H411');
    }
    const signal: 'Warning' | undefined = acute1 || chronicCat === 1 ? 'Warning' : undefined;
    return {
      ok: true,
      classified: true,
      category: `Aquatic ${parts.join(' + ')}`,
      hCode: codes.join(' + '),
      signal,
      pictogram: 'GHS09',
      tone: 'warning',
      note:
        chronicCat > 0
          ? surrogateNote
          : 'Acute classification only. Tick degradability / bioaccumulation to also screen long-term (chronic) toxicity.',
    };
  }

  if (chronicCat === 3) {
    return {
      ok: true,
      classified: false,
      tone: 'neutral',
      headline: 'Aquatic Chronic 3 (H412)',
      note: `No pictogram and no signal word — hazard statement only. ${surrogateNote}`,
    };
  }

  return {
    ok: true,
    classified: false,
    tone: 'neutral',
    headline: 'Not classified for the aquatic environment (CLP)',
    note:
      lc50 > 100
        ? 'L(E)C50 above 100 mg/L — no acute (CLP Acute 1 needs ≤ 1 mg/L) or surrogate chronic classification.'
        : "From acute data alone. Tick 'not rapidly degradable' or 'bioaccumulative' to screen chronic classification; a safety-net Chronic 4 (H413) can still apply to poorly soluble substances.",
  };
}

const CONFIGS: Record<string, CalcConfig> = {
  GHS02: {
    title: 'Flash point → GHS category',
    subtitle: 'Enter a closed-cup flash point (and the boiling point, if known) to classify a liquid.',
    jurisdictionAware: true,
    inputs: [
      { type: 'number', id: 'fp', label: 'Flash point', unit: '°C', placeholder: 'e.g. -20' },
      { type: 'number', id: 'bp', label: 'Boiling point (optional)', unit: '°C', placeholder: 'e.g. 56' },
    ],
    compute: computeFlammableLiquid,
    affiliate: true,
  },
  GHS06: {
    title: 'LD50 / LC50 → acute toxicity category',
    subtitle: 'Pick the exposure route, then enter the LD50 (oral/dermal) or LC50 (inhalation) value.',
    jurisdictionAware: false,
    inputs: [
      {
        type: 'select',
        id: 'route',
        label: 'Exposure route',
        options: [
          { value: 'oral', label: 'Oral — LD50 (mg/kg bw)' },
          { value: 'dermal', label: 'Dermal — LD50 (mg/kg bw)' },
          { value: 'inh_gas', label: 'Inhalation, gas — LC50 (ppmV)' },
          { value: 'inh_vapour', label: 'Inhalation, vapour — LC50 (mg/L)' },
          { value: 'inh_dust', label: 'Inhalation, dust/mist — LC50 (mg/L)' },
        ],
      },
      { type: 'number', id: 'value', label: 'LD50 / LC50 value', placeholder: 'e.g. 25' },
    ],
    compute: computeAcuteToxicity,
    affiliate: true,
  },
  GHS09: {
    title: 'Aquatic L(E)C50 → environmental classification',
    subtitle: 'Enter the lowest acute L(E)C50 / EC50 (fish, crustacea or algae) in mg/L.',
    jurisdictionAware: true,
    inputs: [
      { type: 'number', id: 'lc50', label: 'Acute L(E)C50 / EC50', unit: 'mg/L', placeholder: 'e.g. 0.5' },
      { type: 'checkbox', id: 'notRapid', label: 'Not rapidly degradable' },
      { type: 'checkbox', id: 'bioacc', label: 'Bioaccumulative (log Kow ≥ 4 or BCF ≥ 500)' },
    ],
    compute: computeAquatic,
    affiliate: true,
  },
};

const SDS_AUTHORING_URL = 'https://sdsmanager.com/us/sds-authoring?fpr=ghs3&fp_sid=gpauth';

function track(event: string, params: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    (window as any).gtag('event', event, params);
  }
}

interface Props {
  code: string;
}

export default function GhsCalculator({ code }: Props) {
  const upper = (code ?? '').toUpperCase();
  const config = CONFIGS[upper];

  const [jur, setJur] = useState<Jurisdiction>('EU');
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    if (config) for (const inp of config.inputs) init[inp.id] = inp.type === 'checkbox' ? false : '';
    return init;
  });
  const [result, setResult] = useState<CalcResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Reproduce a shared result from URL params on first mount.
  useEffect(() => {
    if (!config) return;
    const params = new URLSearchParams(window.location.search);
    if (Array.from(params.keys()).length === 0) return;
    const next: Record<string, string | boolean> = { ...values };
    let any = false;
    for (const inp of config.inputs) {
      const v = params.get(inp.id);
      if (v !== null) {
        next[inp.id] = inp.type === 'checkbox' ? v === '1' || v === 'true' : v;
        any = true;
      }
    }
    const jp = params.get('jur');
    const jurFromUrl: Jurisdiction = jp === 'US' ? 'US' : 'EU';
    if (jp === 'US' || jp === 'EU') any = true;
    if (any) {
      setJur(jurFromUrl);
      setValues(next);
      const res = config.compute(next, jurFromUrl);
      setResult(res);
      track('ghs_calculate', {
        code: upper,
        jurisdiction: jurFromUrl,
        category: res.category ?? 'none',
        source: 'shared_link',
      });
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!config) return null; // self-hide: no calculator for this pictogram yet

  const setVal = (id: string, v: string | boolean) => setValues((prev) => ({ ...prev, [id]: v }));

  const runCompute = (j: Jurisdiction) => {
    const res = config.compute(values, j);
    setResult(res);
    setCopied(false);
    track('ghs_calculate', { code: upper, jurisdiction: j, category: res.category ?? 'none', source: 'click' });
  };

  const onJurChange = (j: Jurisdiction) => {
    setJur(j);
    if (result) {
      const res = config.compute(values, j);
      setResult(res);
    }
  };

  const buildShareUrl = (): string => {
    const params = new URLSearchParams();
    params.set('jur', jur);
    for (const inp of config.inputs) {
      const v = values[inp.id];
      if (inp.type === 'checkbox') {
        if (v) params.set(inp.id, '1');
      } else if (String(v).trim() !== '') {
        params.set(inp.id, String(v));
      }
    }
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  const onShare = async () => {
    const url = buildShareUrl();
    track('ghs_share', { code: upper, jurisdiction: jur });
    const nav = navigator as any;
    if (typeof nav !== 'undefined' && typeof nav.share === 'function') {
      try {
        await nav.share({ title: `${upper} classification`, text: `${upper} — ${config.title}`, url });
        return;
      } catch {
        /* user dismissed or unsupported — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const onAffiliateClick = () => {
    track('affiliate_click', { partner: 'sds_manager', placement: 'ghs_calculator', code: upper, jurisdiction: jur });
  };

  const toneCls = (tone?: string): string =>
    tone === 'danger'
      ? 'bg-red-50 border-red-200 text-red-900'
      : tone === 'warning'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : 'bg-slate-50 border-slate-200 text-slate-800';

  return (
    <section className="rounded-2xl border-2 border-[#062A78]/15 bg-white p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#062A78]/70">Interactive tool</p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">{config.title}</h2>
          <p className="text-gray-600 text-sm mt-1 max-w-xl">{config.subtitle}</p>
        </div>
        {config.jurisdictionAware && (
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden shrink-0" role="group" aria-label="Jurisdiction">
            {(['EU', 'US'] as Jurisdiction[]).map((j) => (
              <button
                key={j}
                type="button"
                onClick={() => onJurChange(j)}
                aria-pressed={jur === j}
                className={`px-4 py-1.5 text-sm font-semibold transition-colors ${jur === j ? 'bg-[#062A78] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {j === 'EU' ? 'EU · CLP' : 'US · OSHA'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        {config.inputs.map((inp) => {
          if (inp.type === 'number') {
            return (
              <div key={inp.id}>
                <label htmlFor={`calc-${inp.id}`} className="block text-sm text-gray-600 mb-1">
                  {inp.label}
                  {inp.unit ? ` (${inp.unit})` : ''}
                </label>
                <input
                  id={`calc-${inp.id}`}
                  type="number"
                  inputMode="decimal"
                  placeholder={inp.placeholder}
                  value={String(values[inp.id] ?? '')}
                  onChange={(e) => setVal(inp.id, e.target.value)}
                  className="w-44 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]/40 focus:border-transparent"
                />
              </div>
            );
          }
          if (inp.type === 'select') {
            return (
              <div key={inp.id}>
                <label htmlFor={`calc-${inp.id}`} className="block text-sm text-gray-600 mb-1">
                  {inp.label}
                </label>
                <select
                  id={`calc-${inp.id}`}
                  value={String(values[inp.id] ?? '')}
                  onChange={(e) => setVal(inp.id, e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#062A78]/40"
                >
                  <option value="">Select…</option>
                  {inp.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <label key={inp.id} className="flex items-center gap-2 text-sm text-gray-700 pb-2">
              <input
                type="checkbox"
                checked={Boolean(values[inp.id])}
                onChange={(e) => setVal(inp.id, e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#062A78] focus:ring-[#062A78]/40"
              />
              {inp.label}
            </label>
          );
        })}
        <button
          type="button"
          onClick={() => runCompute(jur)}
          className="px-5 py-2 bg-[#062A78] hover:bg-[#051f5c] text-white font-semibold rounded-lg transition-colors text-sm"
        >
          Classify
        </button>
      </div>

      {result && (
        <div className="mt-5">
          {!result.ok ? (
            <p className="text-sm text-gray-500">{result.message}</p>
          ) : (
            <>
              <div className={`rounded-xl border p-4 ${toneCls(result.tone)}`}>
                {result.classified ? (
                  <>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-lg font-bold">{result.category}</span>
                      {result.hCode && <span className="font-mono text-sm font-semibold">{result.hCode}</span>}
                      {result.signal && (
                        <span className="text-sm">
                          Signal word: <strong>{result.signal}</strong>
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1">
                      {result.pictogram ? (
                        <>
                          Pictogram: <strong>{result.pictogram}</strong>
                        </>
                      ) : (
                        <>No pictogram required</>
                      )}
                      {config.jurisdictionAware && (
                        <span className="opacity-70"> · {jur === 'EU' ? 'EU · CLP' : 'US · OSHA HazCom'}</span>
                      )}
                    </p>
                    {result.note && <p className="text-xs mt-2 opacity-80">{result.note}</p>}
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{result.headline}</p>
                    {result.note && <p className="text-xs mt-1 opacity-80">{result.note}</p>}
                  </>
                )}
              </div>

              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={onShare}
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {copied ? 'Link copied' : 'Share result'}
                </button>
                <span className="text-xs text-gray-400">Copies a link that reproduces this exact result.</span>
              </div>

              {config.affiliate && result.classified && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-900">
                    This classification belongs in <strong>section 2</strong> of your Safety Data Sheet.
                  </p>
                  <a
                    href={SDS_AUTHORING_URL}
                    target="_blank"
                    rel="sponsored nofollow noopener"
                    onClick={onAffiliateClick}
                    className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Create an SDS with SDS Manager †
                  </a>
                  <p className="text-[11px] text-gray-500 mt-2">
                    † SDS Manager is a partner solution; we may earn a commission.{' '}
                    <a href="/affiliate-disclosure/" className="underline">
                      See disclosure
                    </a>
                    .
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
