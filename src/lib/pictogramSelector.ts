// =====================================================================
// Pictogram Selector — resolution engine (pure, deployment-agnostic)
// Takes the reference data (loaded from Supabase: public-read tables) + the
// user's selection, returns the final label elements with a "why" trace.
// No I/O here — load `RefData` once (client or server) and call resolve().
//
// Core correctness model:
//   A pictogram can be justified by MORE THAN ONE (class, category) via an
//   endpoint. Precedence rules suppress a single (pictogram, endpoint)
//   JUSTIFICATION — never the pictogram outright. A pictogram is shown iff it
//   still has >= 1 surviving justification. (So GHS07 required for acute tox
//   Cat 4 is NOT dropped by GHS05/GHS08 — only GHS06 drops it, via its
//   wildcard endpoint=null rule.)
//
//   IMPORTANT: signal word and hazard statements come from the FULL
//   post-override set and are NOT affected by pictogram precedence. CLP
//   Article 26 consolidates *pictograms* only — a hazard whose pictogram is
//   absorbed (e.g. GHS07 under GHS06) keeps its hazard statement (e.g. H332).
//   Hazard-statement precedence (H410>H400, H314>H318, ...) is a separate
//   mechanism handled via hPrecedence.
// =====================================================================

export type RefData = {
  jurisdictions: { id: string; code: string }[];
  catalog: { id: string; class_code: string }[];
  mapping: {
    hazard_class_id: string;
    category_code: string;
    pictogram_code: string | null;
    signal_word: string | null;       // 'Danger' | 'Warning' | null
    h_statement_code: string | null;
    endpoint_key: string | null;
  }[];
  overrides: {
    jurisdiction_id: string;
    hazard_class_id: string;
    category_code: string;
    override_action: "NOT_APPLICABLE" | "REPLACE" | "OPTIONAL";
    pictogram_code: string | null;
    signal_word: string | null;
    h_statement_code: string | null;
    reason: string;
  }[];
  precedence: {
    jurisdiction_id: string | null;   // null = universal
    rule_code: string;
    if_pictogram: string | null;
    if_endpoint: string | null;       // extra trigger condition on the source endpoint
    then_action: "REMOVE" | "MAKE_OPTIONAL";
    affected_pictogram: string | null;
    affected_endpoint: string | null; // null = wildcard (all justifications of affected_pictogram)
    explanation_en: string;
    legal_reference: string;
    is_active?: boolean;
  }[];
  hPrecedence: {
    jurisdiction_id: string | null;
    if_h_code: string;
    then_omit_h_code: string;
  }[];
};

export type Selection = { class_code: string; category_code: string }[];

export type ResolveResult = {
  pictograms: { code: string; optional: boolean }[];
  signal_word: string | null;
  h_codes: string[];
  applied_rules: { rule_code: string; explanation: string; legal_reference: string }[];
  notes: string[]; // dropped (NOT_APPLICABLE), unknown class, missing mapping, etc.
};

type Justification = {
  pictogram: string | null;
  signal: string | null;
  h_code: string | null;
  endpoint: string | null;
  optional: boolean;
  sourceClass: string;
  sourceCat: string;
};

const GHS_ORDER = ["GHS01","GHS02","GHS03","GHS04","GHS05","GHS06","GHS07","GHS08","GHS09"];

export function resolveSelection(
  ref: RefData,
  jurisdictionCode: string,
  selection: Selection
): ResolveResult {
  const notes: string[] = [];
  const juris = ref.jurisdictions.find((j) => j.code === jurisdictionCode);
  if (!juris) {
    return { pictograms: [], signal_word: null, h_codes: [], applied_rules: [], notes: [`Unknown jurisdiction: ${jurisdictionCode}`] };
  }
  const jurisId = juris.id;
  const classByCode = new Map(ref.catalog.map((c) => [c.class_code, c]));

  // ---- Steps 1 + 2: build justifications, applying jurisdiction overrides ----
  let justifications: Justification[] = [];
  for (const sel of selection) {
    const cls = classByCode.get(sel.class_code);
    if (!cls) { notes.push(`Unknown hazard class: ${sel.class_code}`); continue; }

    const ov = ref.overrides.find(
      (o) => o.jurisdiction_id === jurisId && o.hazard_class_id === cls.id && o.category_code === sel.category_code
    );
    if (ov && ov.override_action === "NOT_APPLICABLE") {
      notes.push(`${sel.class_code} ${sel.category_code}: not applicable under ${jurisdictionCode} — ${ov.reason}`);
      continue; // hazard does not apply in this jurisdiction
    }

    const rows = ref.mapping.filter(
      (m) => m.hazard_class_id === cls.id && m.category_code === sel.category_code
    );
    if (rows.length === 0) { notes.push(`No mapping for ${sel.class_code} ${sel.category_code}`); continue; }

    for (const r of rows) { // multiple rows => multi-pictogram category (e.g. Self-reactive Type B)
      let pictogram = r.pictogram_code;
      let signal = r.signal_word;
      let h_code = r.h_statement_code;
      let optional = false;
      if (ov && ov.override_action === "REPLACE") {
        if (ov.pictogram_code !== null) pictogram = ov.pictogram_code;
        if (ov.signal_word !== null) signal = ov.signal_word;
        if (ov.h_statement_code !== null) h_code = ov.h_statement_code;
      }
      if (ov && ov.override_action === "OPTIONAL") optional = true;
      justifications.push({
        pictogram, signal, h_code, endpoint: r.endpoint_key, optional,
        sourceClass: sel.class_code, sourceCat: sel.category_code,
      });
    }
  }

  // Snapshot the full post-override set BEFORE pictogram precedence mutates it.
  // Signal word and hazard statements are derived from THIS set — pictogram
  // consolidation (Article 26) must not remove hazard statements or change the
  // signal word.
  const hazardSet = justifications.slice();

  // ---- Step 4: pictogram precedence (jurisdiction-filtered) ----
  const rules = ref.precedence.filter(
    (r) => r.is_active !== false && (r.jurisdiction_id === null || r.jurisdiction_id === jurisId)
  );
  const applied: ResolveResult["applied_rules"] = [];
  const presentPictos = () => new Set(justifications.filter((j) => j.pictogram).map((j) => j.pictogram as string));

  for (const rule of rules) {
    const picts = presentPictos();
    // trigger checks
    if (rule.if_pictogram && !picts.has(rule.if_pictogram)) continue;
    if (rule.if_endpoint) {
      const triggered = justifications.some((j) => j.pictogram === rule.if_pictogram && j.endpoint === rule.if_endpoint);
      if (!triggered) continue;
    }

    if (rule.then_action === "REMOVE") {
      const before = justifications.length;
      justifications = justifications.filter((j) => {
        if (j.pictogram !== rule.affected_pictogram) return true;
        if (rule.affected_endpoint === null) return false;           // wildcard: drop all justifications of this pictogram
        return j.endpoint !== rule.affected_endpoint;                // else drop only the matching-endpoint justification
      });
      if (justifications.length !== before) {
        applied.push({ rule_code: rule.rule_code, explanation: rule.explanation_en, legal_reference: rule.legal_reference });
      }
    } else if (rule.then_action === "MAKE_OPTIONAL") {
      // Article 26(a) exception: GHS02/GHS03 are NOT optional when more than one of them is compulsory.
      if (rule.if_pictogram === "GHS01" && (rule.affected_pictogram === "GHS02" || rule.affected_pictogram === "GHS03")) {
        if (picts.has("GHS02") && picts.has("GHS03")) continue; // both compulsory -> exception applies, skip
      }
      let changed = false;
      for (const j of justifications) {
        if (j.pictogram === rule.affected_pictogram && (rule.affected_endpoint === null || j.endpoint === rule.affected_endpoint)) {
          if (!j.optional) { j.optional = true; changed = true; }
        }
      }
      if (changed) {
        applied.push({ rule_code: rule.rule_code, explanation: rule.explanation_en, legal_reference: rule.legal_reference });
      }
    }
  }

  // ---- Step 5: signal word (Danger outranks Warning; one per label) — from the full set ----
  const signal_word = hazardSet.some((j) => j.signal === "Danger")
    ? "Danger"
    : hazardSet.some((j) => j.signal === "Warning")
    ? "Warning"
    : null;

  // ---- Pictograms: a pictogram is optional only if ALL its surviving justifications are optional ----
  const pictoAllOptional = new Map<string, boolean>();
  for (const j of justifications) {
    if (!j.pictogram) continue;
    if (!pictoAllOptional.has(j.pictogram)) pictoAllOptional.set(j.pictogram, true);
    if (!j.optional) pictoAllOptional.set(j.pictogram, false);
  }
  const pictograms = [...pictoAllOptional.entries()]
    .map(([code, allOpt]) => ({ code, optional: allOpt }))
    .sort((a, b) => GHS_ORDER.indexOf(a.code) - GHS_ORDER.indexOf(b.code));

  // ---- Step 6: H-codes (from the full set) + H-statement precedence (jurisdiction-filtered) ----
  const hSet = new Set(hazardSet.map((j) => j.h_code).filter(Boolean) as string[]);
  const hRules = ref.hPrecedence.filter((r) => r.jurisdiction_id === null || r.jurisdiction_id === jurisId);
  for (const hr of hRules) {
    if (hSet.has(hr.if_h_code)) hSet.delete(hr.then_omit_h_code);
  }
  const h_codes = [...hSet].sort();

  return { pictograms, signal_word, h_codes, applied_rules: applied, notes };
}
