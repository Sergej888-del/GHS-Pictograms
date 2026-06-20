// =====================================================================
// GHS Pictogram Selector — React island
// Place at: src/components/PictogramSelector.tsx
// Mount with <PictogramSelector client:load /> from the .astro page.
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { loadSelectorData, type LoadedData } from '../lib/selectorData';
import { resolveSelection, type Selection } from '../lib/pictogramSelector';

// Standard GHS pictogram names (stable — no need to fetch).
const PICTOGRAM_NAMES: Record<string, string> = {
  GHS01: 'Explosive',
  GHS02: 'Flammable',
  GHS03: 'Oxidizing',
  GHS04: 'Gas under pressure',
  GHS05: 'Corrosive',
  GHS06: 'Acute toxicity',
  GHS07: 'Harmful / irritant',
  GHS08: 'Health hazard',
  GHS09: 'Hazardous to the environment',
};

const GROUP_LABELS: Record<string, string> = {
  PHYSICAL: 'Physical hazards',
  HEALTH: 'Health hazards',
  ENVIRONMENTAL: 'Environmental hazards',
};
const GROUP_ORDER = ['PHYSICAL', 'HEALTH', 'ENVIRONMENTAL'];

// ---- SDS Manager affiliate slot ---------------------------------------
// DISABLED. Turn on ONLY when BOTH ship in the SAME deploy:
//   1) the tracking URL is in hand (paste into `href`),
//   2) SDS Manager is listed on /affiliate-disclosure/.
// Marking is mandatory and already wired below: dagger (†),
// rel="sponsored nofollow noopener", target="_blank".
const SDS_MANAGER = {
  enabled: false,
  href: '', // e.g. 'https://sdsmanager.com/?ref=...'  (check for a sub-id / campaign param for attribution)
};

type CategoryOption = { code: string; hint: string | null };
type LeadState = 'idle' | 'sending' | 'done' | 'error';

const JUR_ORDER: Record<string, number> = { UN_GHS: 0, EU_CLP: 1, GB_CLP: 2, OSHA_HCS: 3 };

export default function PictogramSelector() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [jurisdiction, setJurisdiction] = useState('EU_CLP');
  const [picked, setPicked] = useState<Record<string, string>>({}); // class_code -> category_code

  const [email, setEmail] = useState('');
  const [leadState, setLeadState] = useState<LeadState>('idle');

  useEffect(() => {
    let alive = true;
    loadSelectorData()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setLoadError(e?.message ?? 'Load failed'); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // class_code -> category options (derived from the base mapping)
  const categoriesByClass = useMemo(() => {
    const out: Record<string, CategoryOption[]> = {};
    if (!data) return out;
    const idToCode = new Map(data.catalog.map((c) => [c.id, c.class_code]));
    const acc: Record<string, Map<string, Set<string>>> = {};
    for (const m of data.mapping) {
      const cc = idToCode.get(m.hazard_class_id);
      if (!cc) continue;
      (acc[cc] ??= new Map());
      if (!acc[cc].has(m.category_code)) acc[cc].set(m.category_code, new Set());
      if (m.h_statement_code) acc[cc].get(m.category_code)!.add(m.h_statement_code);
    }
    for (const [cc, catMap] of Object.entries(acc)) {
      const opts: CategoryOption[] = [...catMap.entries()].map(([code, hSet]) => ({
        code,
        hint: hSet.size === 1 ? [...hSet][0] : null,
      }));
      opts.sort((a, b) => naturalCat(a.code) - naturalCat(b.code) || a.code.localeCompare(b.code));
      out[cc] = opts;
    }
    return out;
  }, [data]);

  // group_type -> classes (display-ordered)
  const grouped = useMemo(() => {
    const out: Record<string, LoadedData['catalog']> = {};
    if (!data) return out;
    for (const c of [...data.catalog].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))) {
      (out[c.group_type] ??= []).push(c);
    }
    return out;
  }, [data]);

  const selection: Selection = useMemo(
    () => Object.entries(picked).filter(([, cat]) => cat).map(([class_code, category_code]) => ({ class_code, category_code })),
    [picked]
  );

  const result = useMemo(
    () => (data ? resolveSelection(data, jurisdiction, selection) : null),
    [data, jurisdiction, selection]
  );

  function setClassCategory(classCode: string, cat: string) {
    setPicked((p) => ({ ...p, [classCode]: cat }));
    if (leadState === 'done') setLeadState('idle');
  }
  function reset() { setPicked({}); setLeadState('idle'); }

  async function submitLead() {
    if (!email.includes('@')) return;
    setLeadState('sending');
    const sel = selection.map((s) => `${s.class_code} ${s.category_code}`).join('; ');
    const res = result
      ? `Jurisdiction: ${jurisdiction} | Pictograms: ${result.pictograms.map((p) => p.code).join(',') || 'none'} | Signal: ${result.signal_word ?? 'none'} | H: ${result.h_codes.join(',') || 'none'}`
      : '';
    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: 'pictogram-selector',
          tool: 'pictogram-selector',
          notes: `Selection: ${sel} || ${res}`,
        }),
      });
      setLeadState(r.ok ? 'done' : 'error');
    } catch {
      setLeadState('error');
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading hazard reference data…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Could not load reference data: {loadError}</div>;
  }
  if (!data) return null;

  const selectedCount = selection.length;
  const jurName = data.jurisdictions.find((j) => j.code === jurisdiction)?.name_en ?? jurisdiction;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-[1fr_390px]">
        {/* ---------------- INPUTS ---------------- */}
        <section className="space-y-6">
          {/* Jurisdiction */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Jurisdiction</span>
            <div className="flex flex-wrap gap-2">
              {[...data.jurisdictions]
                .sort((a, b) => (JUR_ORDER[a.code] ?? 9) - (JUR_ORDER[b.code] ?? 9))
                .map((j) => (
                  <button
                    key={j.code}
                    type="button"
                    onClick={() => setJurisdiction(j.code)}
                    className={
                      'rounded-lg border px-3 py-2 text-sm font-medium transition ' +
                      (jurisdiction === j.code
                        ? 'border-blue-800 bg-blue-800 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400')
                    }
                  >
                    {j.name_en}
                  </button>
                ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The base building blocks are UN GHS; EU/GB CLP and OSHA HazCom differences are applied automatically.
            </p>
          </div>

          {/* Hazard classes */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Select your hazard classification</h2>
              {selectedCount > 0 && (
                <button type="button" onClick={reset} className="text-xs font-medium text-slate-500 underline hover:text-slate-800">
                  Reset ({selectedCount})
                </button>
              )}
            </div>

            <div className="space-y-5">
              {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{GROUP_LABELS[group] ?? group}</h3>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                    {grouped[group].map((cls) => {
                      const opts = categoriesByClass[cls.class_code] ?? [];
                      const value = picked[cls.class_code] ?? '';
                      return (
                        <div key={cls.class_code} className="flex items-center gap-3 px-3 py-2">
                          <span className={'flex-1 text-sm ' + (value ? 'font-medium text-slate-900' : 'text-slate-600')}>
                            {cls.name_en}
                          </span>
                          <select
                            value={value}
                            onChange={(e) => setClassCategory(cls.class_code, e.target.value)}
                            className={
                              'w-44 shrink-0 rounded-md border px-2 py-1.5 text-sm ' +
                              (value ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-300 bg-white text-slate-600')
                            }
                          >
                            <option value="">— not selected —</option>
                            {opts.map((o) => (
                              <option key={o.code} value={o.code}>
                                {catLabel(o)}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- RESULT ---------------- */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-800">
              Label elements
              <span className="ml-2 text-xs font-normal text-slate-400">{jurName}</span>
            </h2>

            {selectedCount === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Select one or more hazard classes on the left to see the required pictograms, signal word, and hazard statements.
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {/* pictograms */}
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Pictograms</div>
                  {result && result.pictograms.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {result.pictograms.map((p) => (
                        <div key={p.code} className="relative w-24 rounded-md border-2 border-red-600 bg-white p-2 text-center">
                          <div className="text-sm font-bold text-slate-900">{p.code}</div>
                          <div className="mt-0.5 text-[11px] leading-tight text-slate-600">{PICTOGRAM_NAMES[p.code] ?? ''}</div>
                          {p.optional && (
                            <span className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-950">
                              optional
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No pictogram required for this classification.</p>
                  )}
                </div>

                {/* signal word */}
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Signal word</div>
                  {result?.signal_word ? (
                    <div className={'text-lg font-extrabold ' + (result.signal_word === 'Danger' ? 'text-red-600' : 'text-amber-500')}>
                      {result.signal_word}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">None</div>
                  )}
                </div>

                {/* hazard statements */}
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Hazard statements</div>
                  {result && result.h_codes.length > 0 ? (
                    <ul className="space-y-1">
                      {result.h_codes.map((h) => (
                        <li key={h} className="text-sm text-slate-700">
                          <span className="font-semibold text-slate-900">{h}</span>
                          {data.hText[h] ? <span className="text-slate-600"> — {data.hText[h]}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">None</p>
                  )}
                </div>

                {/* why (precedence trace) */}
                {result && result.applied_rules.length > 0 && (
                  <details className="rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                      Why these pictograms? ({result.applied_rules.length} rule{result.applied_rules.length > 1 ? 's' : ''} applied)
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {result.applied_rules.map((r) => (
                        <li key={r.rule_code} className="text-xs text-slate-600">
                          <span className="text-slate-800">{r.explanation}</span>{' '}
                          <span className="text-slate-400">({r.legal_reference})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* not applicable in jurisdiction */}
                {result && result.notes.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Not applicable in {jurName}</div>
                    <ul className="mt-1 space-y-1">
                      {result.notes.map((n, i) => (
                        <li key={i} className="text-xs text-amber-800">{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* lead capture (primary) */}
          {selectedCount > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-800">Email me this result</div>
              <p className="mt-1 text-xs text-slate-500">Get a copy of these label elements for your records.</p>
              {leadState === 'done' ? (
                <p className="mt-3 text-sm font-medium text-green-700">Sent — check your inbox.</p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={submitLead}
                    disabled={leadState === 'sending' || !email.includes('@')}
                    className="shrink-0 rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
                  >
                    {leadState === 'sending' ? 'Sending…' : 'Send'}
                  </button>
                </div>
              )}
              {leadState === 'error' && <p className="mt-2 text-xs text-red-600">Something went wrong. Please try again.</p>}
            </div>
          )}

          {/* SDS Manager — next step (DISABLED until tracking URL + disclosure) */}
          {SDS_MANAGER.enabled && SDS_MANAGER.href && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-800">Next step: the full Safety Data Sheet</div>
              <p className="mt-1 text-xs text-slate-600">
                These are your label pictograms. For the complete 16-section SDS, SDS Manager handles authoring and management.
              </p>
              <a
                href={SDS_MANAGER.href}
                target="_blank"
                rel="sponsored nofollow noopener"
                className="mt-3 inline-block rounded-md border border-blue-800 px-3 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-50"
              >
                Explore SDS Manager †
              </a>
              <p className="mt-2 text-[11px] text-slate-400">
                † Affiliate link. See our <a href="/affiliate-disclosure/" className="underline">affiliate disclosure</a>.
              </p>
            </div>
          )}

          {/* cross-link to substance browser */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <a href="/pictograms/" className="text-sm font-medium text-blue-800 hover:underline">
              Looking for a specific substance? Browse harmonized substances →
            </a>
          </div>

          {/* disclaimer */}
          <p className="px-1 text-[11px] leading-relaxed text-slate-400">
            Reference tool implementing the UN GHS building blocks and CLP Article 26 precedence rules. Always verify against the
            current legal text for your jurisdiction. This is not legal advice.
          </p>
        </aside>
      </div>
    </div>
  );
}

// "Cat 2", "Cat 1A", but leave non-numeric codes (e.g. "Type B") as-is; append the H-code hint when unambiguous.
function catLabel(o: CategoryOption): string {
  const base = /^\d/.test(o.code) ? `Cat ${o.code}` : o.code;
  return o.hint ? `${base} · ${o.hint}` : base;
}

function naturalCat(code: string): number {
  const m = code.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}
