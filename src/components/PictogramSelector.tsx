// =====================================================================
// GHS Pictogram Selector — React island (redesigned)
// Place at: src/components/PictogramSelector.tsx
// Mount with <PictogramSelector client:load /> inside the #f6f8fc MAIN section.
// Pictogram SVGs are read from Supabase (pictograms_signals.svg_content) via
// the loader's svgByCode map — no local asset files.
// =====================================================================
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { loadSelectorData, type LoadedData } from '../lib/selectorData';
import { resolveSelection, type Selection } from '../lib/pictogramSelector';
import { buildLabelElementsSvg, downloadSvg, downloadPdf } from '../lib/labelArtifact';

const SG = "'Space Grotesk', system-ui, sans-serif";

// Short display names for the result tiles (stable GHS standard — no need to fetch).
const PICTO_NAME: Record<string, string> = {
  GHS01: 'Explosive',
  GHS02: 'Flammable',
  GHS03: 'Oxidising',
  GHS04: 'Gas',
  GHS05: 'Corrosive',
  GHS06: 'Toxic',
  GHS07: 'Irritant',
  GHS08: 'Health hazard',
  GHS09: 'Environmental',
};

const JTAG: Record<string, string> = { UN_GHS: 'UN GHS', EU_CLP: 'EU CLP', GB_CLP: 'GB CLP', OSHA_HCS: 'OSHA HCS' };
const JUR_ORDER: Record<string, number> = { UN_GHS: 0, EU_CLP: 1, GB_CLP: 2, OSHA_HCS: 3 };
const GROUP_LABELS: Record<string, string> = { PHYSICAL: 'Physical hazards', HEALTH: 'Health hazards', ENVIRONMENTAL: 'Environmental hazards' };
const GROUP_ORDER = ['PHYSICAL', 'HEALTH', 'ENVIRONMENTAL'];

// ---- SDS Manager affiliate slot ---------------------------------------
// DISABLED. Turn on ONLY when BOTH ship in the SAME deploy:
//   1) tracking URL in hand (paste into `href`),
//   2) SDS Manager listed on /affiliate-disclosure/.
// Marking is mandatory and already wired: † + rel="sponsored nofollow noopener" + target="_blank".
const SDS_MANAGER = { enabled: false, href: '' };

const card: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e4e9f2',
  borderRadius: 14,
  boxShadow: '0 1px 2px rgba(16,32,64,.04),0 18px 40px -28px rgba(16,32,64,.28)',
};
const micro: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', color: '#9aa3b5', textTransform: 'uppercase' };
const cardH: CSSProperties = { fontFamily: SG, fontWeight: 600, fontSize: 17, letterSpacing: '-.01em', margin: 0, color: '#16224a' };

const SCOPED_CSS = `
.gs-wrap select.gs-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:190px;padding:9px 30px 9px 12px;border:1px solid #d8deea;border-radius:8px;font-family:'Inter',system-ui,sans-serif;font-size:13.5px;color:#33415f;background:#fff;cursor:pointer;}
.gs-wrap select.gs-select.chosen{border-color:#1f5fd0;background:#f3f7fe;color:#16224a;font-weight:600;}
.gs-wrap .gs-row:hover{background:#f8fafe;}
.gs-wrap .gs-jur:hover{border-color:#1f5fd0 !important;}
.gs-wrap .gs-send:hover{background:#e87f45 !important;}
.gs-wrap .gs-browse:hover{border-color:#cfdcf6 !important;}
.gs-wrap .gs-email:focus{border-color:#1f5fd0;outline:none;}
.gs-wrap .gs-picto svg{width:100%;height:100%;display:block;}
@media (max-width:900px){.gs-wrap .gs-grid{grid-template-columns:1fr !important;}.gs-wrap .gs-aside{position:static !important;}}
`;

type CategoryOption = { code: string; hint: string | null };
type LeadState = 'idle' | 'sending' | 'done' | 'error';

export default function PictogramSelector() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [jurisdiction, setJurisdiction] = useState('EU_CLP');
  const [picked, setPicked] = useState<Record<string, string>>({});

  const [email, setEmail] = useState('');
  const [leadState, setLeadState] = useState<LeadState>('idle');
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSelectorData()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setLoadError(e?.message ?? 'Load failed'); setLoading(false); } });
    return () => { alive = false; };
  }, []);

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
      const opts: CategoryOption[] = [...catMap.entries()].map(([code, hSet]) => ({ code, hint: hSet.size === 1 ? [...hSet][0] : null }));
      opts.sort((a, b) => naturalCat(a.code) - naturalCat(b.code) || a.code.localeCompare(b.code));
      out[cc] = opts;
    }
    return out;
  }, [data]);

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

  const result = useMemo(() => (data ? resolveSelection(data, jurisdiction, selection) : null), [data, jurisdiction, selection]);

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
        body: JSON.stringify({ email, source: 'pictogram-selector', tool: 'pictogram-selector', notes: `Selection: ${sel} || ${res}` }),
      });
      setLeadState(r.ok ? 'done' : 'error');
    } catch { setLeadState('error'); }
  }

  function buildArtifact() {
    if (!result) return null;
    return buildLabelElementsSvg({
      jurisdictionTag: JTAG[jurisdiction] ?? jurisdiction,
      pictograms: result.pictograms.map((p) => ({
        code: p.code,
        name: PICTO_NAME[p.code] ?? '',
        svg: data?.svgByCode[p.code] ?? '',
        optional: p.optional,
      })),
      signalWord: result.signal_word,
      hStatements: result.h_codes.map((h) => ({ code: h, text: data?.hText[h] ?? '' })),
    });
  }

  function handleDownloadSvg() {
    const art = buildArtifact();
    if (art) downloadSvg(art.svg, 'ghs-label-elements.svg');
  }

  async function handleDownloadPdf() {
    const art = buildArtifact();
    if (!art) return;
    setPdfBusy(true);
    try {
      await downloadPdf(art, 'ghs-label-elements.pdf');
    } catch {
      /* swallow — user can retry */
    } finally {
      setPdfBusy(false);
    }
  }

  if (loading) return <div style={{ ...card, padding: '24px', fontSize: 14, color: '#6b7488' }}>Loading hazard reference data…</div>;
  if (loadError) return <div style={{ ...card, border: '1px solid #f0d6d7', padding: '24px', fontSize: 14, color: '#b23b3b' }}>Could not load reference data: {loadError}</div>;
  if (!data) return null;

  const selectedCount = selection.length;
  const signalColor = result?.signal_word === 'Danger' ? '#d62828' : result?.signal_word === 'Warning' ? '#d4860f' : '#8a94a6';

  return (
    <div className="gs-wrap">
      <style>{SCOPED_CSS}</style>
      <div className="gs-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 28, alignItems: 'start' }}>
        {/* ---------------- LEFT ---------------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Jurisdiction */}
          <div style={{ ...card, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1f5fd0', display: 'inline-block' }} />
              <h2 style={cardH}>Jurisdiction</h2>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[...data.jurisdictions].sort((a, b) => (JUR_ORDER[a.code] ?? 9) - (JUR_ORDER[b.code] ?? 9)).map((j) => {
                const active = jurisdiction === j.code;
                return (
                  <button
                    key={j.code}
                    type="button"
                    className="gs-jur"
                    onClick={() => setJurisdiction(j.code)}
                    style={{
                      fontFamily: "'Inter',system-ui,sans-serif", fontSize: 13.5, fontWeight: 600, padding: '9px 15px', borderRadius: 9, cursor: 'pointer',
                      border: active ? '1px solid #1f5fd0' : '1px solid #d6deeb',
                      background: active ? '#1f5fd0' : '#fff',
                      color: active ? '#fff' : '#33415f',
                    }}
                  >
                    {j.name_en}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#6b7488', margin: '14px 0 0' }}>
              The base building blocks are UN GHS; EU/GB CLP and OSHA HazCom differences are applied automatically.
            </p>
          </div>

          {/* Hazard classification */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px', borderBottom: '1px solid #eef1f6' }}>
              <h2 style={cardH}>Select your hazard classification</h2>
              {selectedCount > 0 && (
                <button type="button" onClick={reset} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Inter',system-ui,sans-serif", fontSize: 13, fontWeight: 600, color: '#1f5fd0', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}>
                  Reset ({selectedCount})
                </button>
              )}
            </div>

            {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
              <div key={group}>
                <div style={{ padding: '18px 24px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: '#9aa3b5', textTransform: 'uppercase' }}>
                  {GROUP_LABELS[group] ?? group}
                </div>
                {grouped[group].map((cls) => {
                  const opts = categoriesByClass[cls.class_code] ?? [];
                  const value = picked[cls.class_code] ?? '';
                  return (
                    <label key={cls.class_code} className="gs-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px 24px', borderTop: '1px solid #f1f3f8', cursor: 'pointer' }}>
                      <span style={{ fontSize: 14.5, color: '#33415f', fontWeight: 500 }}>{cls.name_en}</span>
                      <span style={{ position: 'relative', flex: 'none' }}>
                        <select
                          className={'gs-select' + (value ? ' chosen' : '')}
                          value={value}
                          onChange={(e) => setClassCategory(cls.class_code, e.target.value)}
                        >
                          <option value="">— not selected —</option>
                          {opts.map((o) => (
                            <option key={o.code} value={o.code}>{catLabel(o)}</option>
                          ))}
                        </select>
                        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#8a94a6', fontSize: 11 }}>▼</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            <div style={{ height: 8 }} />
          </div>
        </div>

        {/* ---------------- RIGHT (sticky) ---------------- */}
        <div className="gs-aside" style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Label elements */}
          <div style={{ ...card, padding: '22px 22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 18 }}>
              <h3 style={{ ...cardH, fontSize: 17 }}>Label elements</h3>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', color: '#1f5fd0', background: '#eaf1fd', border: '1px solid #d4e3fb', borderRadius: 5, padding: '3px 8px' }}>
                {JTAG[jurisdiction] ?? jurisdiction}
              </span>
            </div>

            {/* pictograms */}
            <div style={{ ...micro, marginBottom: 10 }}>Pictograms</div>
            {selectedCount === 0 ? (
              <div style={{ border: '1px dashed #d8deea', borderRadius: 10, padding: 18, textAlign: 'center', fontSize: 13, color: '#8a94a6', marginBottom: 20 }}>
                Select one or more hazard classes to generate the label elements.
              </div>
            ) : result && result.pictograms.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                {result.pictograms.map((p) => {
                  const svg = data.svgByCode[p.code];
                  return (
                    <div key={p.code} style={{ position: 'relative', width: 96, border: '1px solid #f0d6d7', background: '#fff', borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', boxShadow: '0 1px 2px rgba(16,32,64,.05)' }}>
                      {svg ? (
                        <div className="gs-picto" style={{ width: 52, height: 52, margin: '0 auto 6px' }} dangerouslySetInnerHTML={{ __html: svg }} />
                      ) : null}
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#16224a' }}>{p.code}</div>
                      <div style={{ fontSize: 10.5, color: '#7a8398', marginTop: 1 }}>{PICTO_NAME[p.code] ?? ''}</div>
                      {p.optional && (
                        <span style={{ position: 'absolute', top: -8, right: -8, background: '#f6c453', color: '#5b4708', fontSize: 9, fontWeight: 700, borderRadius: 999, padding: '2px 6px' }}>optional</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#8a94a6', marginBottom: 20 }}>No pictogram required for the selected classification.</div>
            )}

            {/* signal word */}
            <div style={{ ...micro, marginBottom: 6 }}>Signal word</div>
            <div style={{ fontFamily: SG, fontWeight: 700, fontSize: 24, letterSpacing: '-.01em', marginBottom: 20, color: signalColor }}>
              {result?.signal_word ?? '—'}
            </div>

            {/* hazard statements */}
            <div style={{ ...micro, marginBottom: 10 }}>Hazard statements</div>
            {result && result.h_codes.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {result.h_codes.map((h) => (
                  <div key={h} style={{ fontSize: 14, lineHeight: 1.5, color: '#2a3656' }}>
                    <span style={{ fontWeight: 700, color: '#16224a' }}>{h}</span>
                    {data.hText[h] ? <><span style={{ color: '#9aa3b5' }}> — </span>{data.hText[h]}</> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#8a94a6' }}>—</div>
            )}

            {/* precedence applied (blue) */}
            {result && result.applied_rules.length > 0 && (
              <div style={{ marginTop: 18, border: '1px solid #d6e2f4', background: '#eef4fc', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.10em', color: '#3a6abf', textTransform: 'uppercase', marginBottom: 7 }}>Precedence applied — Art. 26</div>
                {result.applied_rules.map((r) => (
                  <div key={r.rule_code} style={{ fontSize: 12.5, lineHeight: 1.55, color: '#3c4d6e', marginTop: 4 }}>
                    {r.explanation} <span style={{ color: '#8aa0c6' }}>({r.legal_reference})</span>
                  </div>
                ))}
              </div>
            )}

            {/* not applicable in jurisdiction */}
            {result && result.notes.length > 0 && (
              <div style={{ marginTop: 12, border: '1px solid #ecdcc0', background: '#fbf5ea', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.10em', color: '#9a6b1e', textTransform: 'uppercase', marginBottom: 7 }}>Not applicable in {JTAG[jurisdiction] ?? jurisdiction}</div>
                {result.notes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: '#7c5a1f', marginTop: 4 }}>{n}</div>
                ))}
              </div>
            )}
          </div>

          {/* email */}
          <div style={{ ...card, boxShadow: '0 1px 2px rgba(16,32,64,.04)', padding: '20px 22px' }}>
            <h4 style={{ fontFamily: SG, fontWeight: 600, fontSize: 15, margin: '0 0 4px', color: '#16224a' }}>Download this result</h4>
            <p style={{ fontSize: 13, color: '#6b7488', margin: '0 0 14px', lineHeight: 1.5 }}>Enter your email to download these label elements.</p>
            {leadState === 'done' ? (
              <div>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: '#1f8a4c', margin: '0 0 10px' }}>Ready — download your copy:</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={pdfBusy}
                    style={{ flex: 1, background: '#ef915d', border: 'none', color: '#fff', fontFamily: "'Inter',system-ui,sans-serif", fontWeight: 700, fontSize: 13.5, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', opacity: pdfBusy ? 0.6 : 1 }}
                  >
                    {pdfBusy ? 'Preparing…' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    style={{ flex: 1, background: '#fff', border: '1px solid #d8deea', color: '#16224a', fontFamily: "'Inter',system-ui,sans-serif", fontWeight: 700, fontSize: 13.5, padding: '10px 14px', borderRadius: 8, cursor: 'pointer' }}
                  >
                    Download SVG
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="gs-email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ flex: 1, minWidth: 0, padding: '10px 12px', border: '1px solid #d8deea', borderRadius: 8, fontFamily: "'Inter',system-ui,sans-serif", fontSize: 13.5, color: '#16224a', background: '#fff' }}
                />
                <button
                  type="button"
                  className="gs-send"
                  onClick={submitLead}
                  disabled={leadState === 'sending' || !email.includes('@')}
                  style={{ background: '#ef915d', border: 'none', color: '#fff', fontFamily: "'Inter',system-ui,sans-serif", fontWeight: 700, fontSize: 13.5, padding: '10px 18px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', opacity: leadState === 'sending' || !email.includes('@') ? 0.55 : 1 }}
                >
                  {leadState === 'sending' ? 'Sending…' : 'Get it'}
                </button>
              </div>
            )}
            {leadState === 'error' && <p style={{ fontSize: 12, color: '#b23b3b', margin: '8px 0 0' }}>Something went wrong. Please try again.</p>}
          </div>

          {/* SDS Manager — next step (DISABLED until tracking URL + disclosure) */}
          {SDS_MANAGER.enabled && SDS_MANAGER.href && (
            <div style={{ ...card, boxShadow: '0 1px 2px rgba(16,32,64,.04)', padding: '18px 22px' }}>
              <h4 style={{ fontFamily: SG, fontWeight: 600, fontSize: 15, margin: '0 0 4px', color: '#16224a' }}>Next step: the full Safety Data Sheet</h4>
              <p style={{ fontSize: 13, color: '#6b7488', margin: '0 0 12px', lineHeight: 1.5 }}>These are your label pictograms. For the complete 16-section SDS, SDS Manager handles authoring and management.</p>
              <a href={SDS_MANAGER.href} target="_blank" rel="sponsored nofollow noopener" style={{ display: 'inline-block', border: '1.5px solid #1f5fd0', color: '#1f5fd0', fontWeight: 700, fontSize: 13.5, textDecoration: 'none', padding: '9px 16px', borderRadius: 8 }}>
                Explore SDS Manager †
              </a>
              <p style={{ fontSize: 11, color: '#9aa3b5', margin: '10px 0 0' }}>† Affiliate link. See our <a href="/affiliate-disclosure/" style={{ color: '#1f5fd0' }}>affiliate disclosure</a>.</p>
            </div>
          )}

          {/* browse cross-link */}
          <a href="/pictograms/" className="gs-browse" style={{ ...card, boxShadow: '0 1px 2px rgba(16,32,64,.04)', display: 'block', padding: '18px 22px', textDecoration: 'none' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1f5fd0', lineHeight: 1.5 }}>Looking for a specific substance? Browse harmonized substances →</span>
          </a>

          {/* disclaimer */}
          <p style={{ fontSize: 11.5, lineHeight: 1.6, color: '#9aa3b5', margin: 0, padding: '0 4px' }}>
            Reference tool implementing the UN GHS building blocks and CLP Article 26 precedence rules. Always verify against the current legal text for your jurisdiction. This is not legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}

// "Cat 2", "Cat 1A"; leave non-numeric codes (e.g. "Type B") as-is; append H-code hint when unambiguous.
function catLabel(o: CategoryOption): string {
  const base = /^\d/.test(o.code) ? `Cat ${o.code}` : o.code;
  return o.hint ? `${base} · ${o.hint}` : base;
}
function naturalCat(code: string): number {
  const m = code.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}
