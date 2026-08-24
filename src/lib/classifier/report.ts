// src/lib/classifier/report.ts — МОДЕЛЬ ПЕЧАТНОГО ОТЧЁТА (№118, session 84).
//
// ⭐⭐⭐ ОТЧЁТ — ЧИСТАЯ ФУНКЦИЯ ОТ `ClassifierResult` (решение Сергея, s80).
// Ни одного обращения к базе, ни одного запроса к сети, ни одной величины,
// которой нет в ответе движка. Именно поэтому в ответе лежит `input:
// ReportInput` — полное эхо входа: печать обязана обходиться тем, что уже
// приехало, иначе PDF, короткая ссылка и экран однажды разойдутся.
//
// ⭐⭐⭐ ЭКРАН И PDF — ДВЕ ПРОЕКЦИИ ОДНОЙ МОДЕЛИ. `MixtureReport.tsx` рисует её
// React-ом, `reportHtml.ts` — строкой для html2pdf. Ни один из них не знает,
// ЧТО печатать: это решает файл. Урок s82/s83 в его окончательном виде: если
// текст повторяет то, что уже знает код, он обязан из кода и браться — иначе
// две копии расходятся, и обе выглядят зелёными.
//
// ⭐⭐ ЧЕГО ЗДЕСЬ НЕТ: ни одного собственного суждения. Причины, цитаты,
// провенанс и предупреждения печатаются словами движка. Модель только
// раскладывает их по разделам и форматирует числа.
//
// ⛔⛔ ВСЕ СТРОКИ — ПО-АНГЛИЙСКИ: файл уезжает в браузер и в PDF (урок s68).

import type {
  AdditionalCategory, ClassifierResult, Contribution, Decision, DecisionStatus,
  ReportComponent, Warning, WarningLevel,
} from './types.ts';

/* ── 1. Модель ───────────────────────────────────────────────────────────── */

export interface ReportKV { label: string; value: string }

export interface ReportContributionLine {
  name: string;
  /** Концентрация, с которой компонент вошёл в правило. */
  conc: string;
  value: string;
  limit: string;
  provenance: string;
  counted: boolean;
}

/** Правило одной строки: ключ, дословный текст, арифметика, вклады. */
export interface ReportRuleBlock {
  ruleKey: string;
  raw: string | null;
  sourceRef: string | null;
  marker: string | null;
  aggregate: string | null;
  contributions: ReportContributionLine[];
  candidates: { text: string; passed: boolean }[];
  warnings: ReportWarningLine[];
}

export interface ReportWarningLine { code: string; level: WarningLevel; text: string }

export interface ReportClassLine {
  classCode: string;
  className: string;
  category: string;
  hCode: string;
  status: DecisionStatus;
  statusLabel: string;
  module: string;
  provisional: boolean;
  /** Обязательна у `insufficient_data` и `not_computed` (контракт §5.2). */
  reason: string | null;
  rule: ReportRuleBlock;
  /** Сопутствующие категории того же класса — со своим правилом и цитатой. */
  additional: { title: string; rule: ReportRuleBlock }[];
}

export interface ReportSection {
  key: DecisionStatus;
  title: string;
  /** Зачем раздел в отчёте — одна фраза, читаемая инспектором. */
  lead: string;
  lines: ReportClassLine[];
}

export interface ReportIngredientLine {
  id: string;
  name: string;
  identity: string;
  entered: string;
  used: string;
  worstCase: boolean;
  classifications: string[];
  scl: string[];
  mFactors: string[];
  ate: string[];
  knownNonhazard: boolean;
  notes: string[];
}

export interface ReportModel {
  title: string;
  /** «Computed 2026-08-24 19:20 UTC» либо честное «no timestamp». */
  computedAt: string;
  source: string;
  shareUrl: string | null;
  verdict: {
    headline: string;
    assigned: string[];
    signalWord: string | null;
    pictograms: string[];
    hCodes: string[];
    badges: string[];
  };
  composition: {
    properties: ReportKV[];
    totals: ReportKV[];
    lines: ReportIngredientLine[];
  };
  sections: ReportSection[];
  supplemental: { code: string; text: string; raw: string | null; ruleKey: string | null }[];
  warnings: ReportWarningLine[];
  stamp: {
    lines: ReportKV[];
    /** Расхождения штампов и прочее, что портит аудиторский след, а не расчёт. */
    notes: string[];
  };
  fingerprint: string;
  disclaimer: string[];
  method: string;
}

export interface ReportOptions {
  /** Человеческое имя класса. ⛔ Реестр приходит снаружи: движок его не несёт. */
  className: (classCode: string) => string;
  /** Адрес инструмента — печатается в шапке и в подвале. */
  source?: string;
  /** Короткая ссылка, если она уже создана для этого расчёта. */
  shareUrl?: string | null;
}

/* ── 2. Формат ───────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<DecisionStatus, string> = {
  classified: 'Classified',
  not_classified: 'Not classified',
  insufficient_data: 'Insufficient data',
  not_computed: 'Not computed',
};

const SECTION_TITLE: Record<DecisionStatus, string> = {
  classified: 'Hazard classes assigned',
  not_classified: 'Checked and not classified',
  insufficient_data: 'Insufficient data — a number is missing',
  not_computed: 'Not computed in this version',
};

/**
 * ⚠ Заголовок раздела говорит ЧТО, подзаголовок — ЧЕГО ЭТО СТОИТ. Раздел
 * «not classified» без этой фразы читается как «неопасно», а он означает
 * «правило проверено, порог не достигнут» — разные утверждения (урок s76).
 */
const SECTION_LEAD: Record<DecisionStatus, string> = {
  classified:
    'Each line carries the rule it rests on, that rule as the regulation prints it, and the contribution of every ingredient.',
  not_classified:
    'The rule was applied and the threshold was not met. This is a computed answer, not a gap — the arithmetic is below.',
  insufficient_data:
    'The rule applies to this mixture, but a value it needs was not entered. Until it is, the class is neither assigned nor ruled out.',
  not_computed:
    'These classes were not evaluated by this version at all. An absent line is not a clean bill of health — the reason and the ingredients carrying the class are printed with each one.',
};

const INHAL_FORM_LABEL: Record<string, string> = {
  gas: 'gas (ppmV)',
  vapour: 'vapour (mg/L)',
  dust_mist: 'dust / mist (mg/L)',
};

/** Число для печати: без хвоста из нулей, но и без научной записи. */
function n(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = Math.abs(x) >= 1000 || Number.isInteger(x) ? String(x) : x.toFixed(digits);
  return s.replace(/\.0+$/, '');
}

function pc(x: number | null | undefined, digits = 1): string {
  return x == null || !Number.isFinite(x) ? '—' : `${n(x, digits)} %`;
}

/**
 * ISO → «2026-08-24 19:20 UTC». ⚠ Без локали намеренно: отчёт читают в другой
 * стране и через год, а `toLocaleString` печатал бы разное на разных машинах —
 * и две копии одного отчёта расходились бы в дате.
 */
export function stampTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/* ── 3. Отпечаток результата ─────────────────────────────────────────────── */

/** Две 32-битные свёртки подряд — 16 hex-знаков без обращения к crypto. */
function hash16(s: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = ((Math.imul(b, 33) >>> 0) + c) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * ⭐⭐⭐ ОТПЕЧАТОК ОТВЕТА, А НЕ ЕГО ФОРМУЛИРОВКИ. Короткая ссылка хранит ВХОД и
 * пересчитывает его по текущему релизу (s80), а рядом лежит отпечаток того, что
 * видел автор. Открывший узнаёт не «релиз другой», а «результат тот же» либо
 * «результат изменился».
 *
 * ⚠ Поэтому в свёртку идут только КОДЫ: класс, категория, статус, ключ правила,
 * пометка provisional, сопутствующие категории и коды EUH. Тексты причин и
 * предупреждений НЕ идут: правка формулировки — не смена ответа, а если бы шла,
 * каждая косметическая правка кричала бы «результат изменился» на всех старых
 * ссылках разом.
 */
export function resultFingerprint(result: ClassifierResult): string {
  const parts: string[] = [];
  const decisions = [...result.decisions].sort((x, y) => x.classCode.localeCompare(y.classCode));
  for (const d of decisions) {
    parts.push(`${d.classCode}|${d.categoryCode ?? ''}|${d.status}|${d.ruleKey ?? ''}|${d.provisional ? 'p' : ''}`);
    const extra = [...(d.additional ?? [])].sort((x, y) => x.categoryCode.localeCompare(y.categoryCode));
    for (const a of extra) parts.push(`+${d.classCode}|${a.categoryCode}|${a.ruleKey ?? ''}`);
  }
  parts.push(...result.supplemental.map((s) => `${s.kind}:${s.code ?? ''}`).sort());
  return hash16(parts.join('\n'));
}

/* ── 4. Сборка ───────────────────────────────────────────────────────────── */

function contributionLines(list: Contribution[]): ReportContributionLine[] {
  return list.map((c) => ({
    name: c.name,
    conc: pc(c.conc),
    value: c.value == null ? '—' : n(c.value, 3),
    limit: c.limit == null
      ? '—'
      : `${n(c.limit, 3)}${c.limitSource && c.limitSource !== 'NONE' ? ` (${c.limitSource})` : ''}`,
    provenance: c.counted ? c.provenance : `not counted — ${c.provenance}`,
    counted: c.counted,
  }));
}

function warningLines(list: Warning[]): ReportWarningLine[] {
  return list.map((w) => ({ code: w.code, level: w.level, text: w.message }));
}

function aggregateText(a: Decision['aggregate'] | AdditionalCategory['aggregate']): string | null {
  if (!a) return null;
  const threshold = a.threshold == null ? '' : ` — threshold ${n(a.threshold, 3)}${a.unit ? ` ${a.unit}` : ''}`;
  return `${a.expr}${threshold}`;
}

/**
 * ⚠ `ruleKey` печатается всегда, и когда его нет — словами. Пустая ячейка на
 * месте ключа правила читалась бы как «правило есть, просто не показали».
 */
function ruleBlock(d: Decision | AdditionalCategory, contributions: Contribution[], warnings: Warning[]): ReportRuleBlock {
  return {
    ruleKey: d.ruleKey ?? 'no rule key',
    raw: d.raw ?? null,
    sourceRef: d.sourceRef ?? null,
    marker: d.marker ?? null,
    aggregate: aggregateText(d.aggregate),
    contributions: contributionLines(contributions),
    candidates: ('candidates' in d ? d.candidates ?? [] : []).map((c) => ({
      text: `${c.categoryCode ?? '—'} · ${c.ruleKey} — ${c.passed ? 'met' : 'not met'}${c.note ? `; ${c.note}` : ''}`,
      passed: c.passed,
    })),
    warnings: warningLines(warnings),
  };
}

function classLine(d: Decision, className: (c: string) => string): ReportClassLine {
  return {
    classCode: d.classCode,
    className: className(d.classCode),
    category: d.categoryCode ? `Category ${d.categoryCode}` : '—',
    hCode: d.hCode ?? '—',
    status: d.status,
    statusLabel: STATUS_LABEL[d.status],
    module: d.module,
    provisional: !!d.provisional,
    reason: d.reason,
    rule: ruleBlock(d, d.contributions, d.warnings),
    additional: (d.additional ?? []).map((a) => ({
      title: `Additional category of the same class: ${a.categoryCode}${a.hCode ? ` · ${a.hCode}` : ''}`,
      rule: ruleBlock(a, a.contributions, a.warnings),
    })),
  };
}

function ingredientLine(c: ReportComponent): ReportIngredientLine {
  const idBits: string[] = [];
  if (c.indexNumber) idBits.push(`Index ${c.indexNumber}`);
  if (c.casPrimary) idBits.push(`CAS ${c.casPrimary}`);
  if (c.ecPrimary) idBits.push(`EC ${c.ecPrimary}`);
  if (!idBits.length) idBits.push(c.source === 'supplier' ? 'not in Annex VI — supplier entry' : 'no identifier');
  const entered = c.concEntered.max != null && c.concEntered.max > c.concEntered.min
    ? `${n(c.concEntered.min)} – ${n(c.concEntered.max)} %`
    : pc(c.concEntered.min);
  return {
    id: c.id,
    name: c.name,
    identity: idBits.join(' · '),
    entered,
    used: pc(c.concUsed),
    worstCase: c.worstCase,
    // ⚠ Дословная ячейка Annex VI, а не наша перепись: `raw` первым.
    classifications: c.classifications.map((p) => {
      const raw = p.raw?.trim();
      const short = `${p.classCode} ${p.categoryCode ?? ''}`.trim();
      const base = raw || short;
      return p.hCode && !base.includes(p.hCode) ? `${base} · ${p.hCode}` : base;
    }),
    scl: c.scl.map((s) => `${s.raw}${s.needsReview ? ' [needs review — read as printed, not as a number]' : ''}`),
    mFactors: c.mFactors.map((m) => `${m.raw}${m.needsReview ? ' [needs review]' : ''}`),
    ate: c.ate.map((a) => `${a.route}: ${n(a.value, 3)}${a.unit ? ` ${a.unit}` : ''}${a.form ? ` (${a.form})` : ''}`),
    knownNonhazard: c.knownNonhazard,
    notes: c.notes,
  };
}

/**
 * Свойства смеси. ⚠ Печатаются ВСЕ, включая незаполненные: «pH — not entered»
 * говорит читателю, что правило pH к смеси не применялось, а пропущенная строка
 * не говорит ничего.
 */
function propertyLines(result: ClassifierResult): ReportKV[] {
  const p = result.input.properties;
  const out: ReportKV[] = [
    { label: 'Physical state', value: result.physicalState },
    { label: 'Inhalation form', value: INHAL_FORM_LABEL[result.inhalForm] ?? result.inhalForm },
    { label: 'pH', value: p.ph == null ? 'not entered' : n(p.ph, 2) },
    { label: 'Acid / alkali reserve data', value: p.acidAlkaliReserve ? 'available' : 'not available' },
    {
      label: 'Kinematic viscosity at 40 °C',
      value: p.viscosityMm2s40c == null ? 'not entered' : `${n(p.viscosityMm2s40c, 3)} mm2/s`,
    },
    { label: 'Separates into layers', value: p.separatesIntoLayers ? 'yes (3.10.3.3.1.3)' : 'no' },
    { label: 'Label audience', value: result.input.audience === 'general_public' ? 'general public' : 'professional' },
  ];
  return out;
}

function totalsLines(result: ClassifierResult): ReportKV[] {
  const c = result.composition;
  return [
    { label: 'Ingredients entered', value: String(c.componentCount) },
    { label: 'Sum of entered concentrations', value: pc(c.sumConc) },
    {
      label: 'Unaccounted remainder',
      value: c.remainder <= 0.0001
        ? pc(Math.max(c.remainder, 0))
        : `${pc(c.remainder)}${c.remainderStatedNonhazard ? ' — stated non-hazardous by the author' : ' — not stated'}`,
    },
    {
      label: 'Concentration ranges',
      value: c.worstCase ? 'at least one range — computed at the upper bound (worst case)' : 'none',
    },
  ];
}

function stampLines(result: ClassifierResult, engineVersionInCode: string): ReportKV[] {
  const r = result.release;
  const lines: ReportKV[] = [
    { label: 'Engine', value: engineVersionInCode },
  ];
  if (!r) {
    lines.push({ label: 'Data release', value: 'none — this result carries no release stamp' });
    return lines;
  }
  lines.push({ label: 'Data release', value: r.releaseKey });
  lines.push({ label: 'Annex VI consolidation', value: r.annex6Consolidation });
  lines.push({ label: 'ATP', value: r.atp });
  if (r.parserVersion) lines.push({ label: 'Annex VI parser', value: r.parserVersion });
  // ⭐⭐ №116: объём данных, на которых считали. Числа приходят из `data_release`.
  const volume: string[] = [];
  if (r.annex6Rows != null) volume.push(`${r.annex6Rows} Annex VI rows`);
  if (r.classificationPairs != null) volume.push(`${r.classificationPairs} harmonised class/category pairs`);
  if (r.registryCategories != null) volume.push(`${r.registryCategories} registry categories`);
  if (volume.length) lines.push({ label: 'Data volume', value: volume.join(' · ') });
  if (r.gclMd5) lines.push({ label: 'Rule table checksum', value: r.gclMd5 });
  if (r.limitsMd5) lines.push({ label: 'Annex VI limits checksum', value: r.limitsMd5 });
  if (r.classificationMd5) lines.push({ label: 'Classification checksum', value: r.classificationMd5 });
  lines.push({ label: 'Release issued', value: stampTime(r.releasedAt) || r.releasedAt });
  return lines;
}

/** Коды, которые говорят о ШТАМПЕ, а не о смеси, — им место в подвале версии. */
const STAMP_CODES = ['ENGINE_STAMP_DRIFT', 'PARSER_STAMP_DRIFT', 'DATA_STAMP_MISSING'];

const DISCLAIMER = [
  'This report is a calculation of the classification rules of CLP Annex I applied to the composition entered above. It is not a legal classification decision and not advice. Under Article 4 of Regulation (EC) No 1272/2008 the supplier remains responsible for classifying, labelling and packaging the mixture before it is placed on the market.',
  'The result depends entirely on the composition entered: an ingredient left out, a wrong concentration or a supplier classification that has since changed will change it. Physical hazards are never derived from a composition — they require testing. Classes printed as “not computed” were not evaluated at all. Where the classification is not obvious, CLP 1.1.1 expects expert judgement, and this tool does not replace it.',
];

const METHOD =
  'Method: CLP Annex I. Acute toxicity by the additivity formula of 3.1.3.6.1 with the correction of 3.1.3.6.2.3 for ingredients of unknown acute toxicity; the remaining classes by concentration limits on the ingredients — a cut-off on a single ingredient, a band between two concentrations, or a summation across ingredients, whichever the class calls for. A specific concentration limit from Annex VI replaces the generic limit for that ingredient and that class; the generic limit is still shown, marked as checked and outranked. Thresholds are read from our copy of the regulation, never retyped into the tool, and each line quotes the row it used.';

export function buildReport(result: ClassifierResult, opts: ReportOptions): ReportModel {
  const className = opts.className;
  const assigned = result.decisions.filter((d) => d.status === 'classified');

  const sections: ReportSection[] = (['classified', 'insufficient_data', 'not_classified', 'not_computed'] as DecisionStatus[])
    .map((key) => ({
      key,
      title: SECTION_TITLE[key],
      lead: SECTION_LEAD[key],
      lines: result.decisions.filter((d) => d.status === key).map((d) => classLine(d, className)),
    }))
    // ⚠ Пустой раздел не печатаем, КРОМЕ «assigned»: «ни одного класса» — это
    // ответ, и он обязан стоять на своём месте, а не исчезать вместе с разделом.
    .filter((s) => s.lines.length > 0 || s.key === 'classified');

  const badges: string[] = [];
  if (result.decisions.some((d) => d.provisional)) badges.push('provisional — correction 3.1.3.6.2.3 applied');
  if (result.warnings.some((w) => w.code === 'STAR')
    || result.decisions.some((d) => d.warnings.some((w) => w.code === 'STAR'))) {
    badges.push('minimum classification (*) among the ingredients');
  }
  if (result.composition.worstCase) badges.push('range entered — computed at the upper bound');

  const stampNotes = result.warnings.filter((w) => STAMP_CODES.includes(w.code)).map((w) => w.message);

  return {
    title: 'CLP mixture classification report',
    computedAt: result.computedAt
      ? `Computed ${stampTime(result.computedAt)}`
      : 'Computed — no timestamp on this result',
    source: opts.source ?? 'ghspictograms.com/tools/clp-mixture-classifier/',
    shareUrl: opts.shareUrl ?? null,
    verdict: {
      headline: assigned.length
        ? `${assigned.length} hazard class${assigned.length === 1 ? '' : 'es'} assigned`
        : 'No hazard class assigned by the modules in this version',
      assigned: assigned.map((d) => `${className(d.classCode)}${d.categoryCode ? ` ${d.categoryCode}` : ''}${d.hCode ? ` · ${d.hCode}` : ''}`),
      signalWord: result.labelPairs.some((p) => p.signalWord === 'Danger')
        ? 'Danger'
        : result.labelPairs.some((p) => p.signalWord === 'Warning') ? 'Warning' : null,
      pictograms: [...new Set(result.labelPairs.map((p) => p.pictogramCode).filter((x): x is string => !!x))],
      hCodes: [...new Set(result.labelPairs.map((p) => p.hCode).filter((x): x is string => !!x))],
      badges,
    },
    composition: {
      properties: propertyLines(result),
      totals: totalsLines(result),
      lines: result.input.components.map(ingredientLine),
    },
    sections,
    supplemental: result.supplemental.map((s) => ({
      code: s.code ?? s.kind,
      text: s.text,
      raw: s.raw,
      ruleKey: s.ruleKey,
    })),
    // ⚠ Предупреждения штампа отсюда УБРАНЫ — они печатаются в подвале версии,
    // где им место; в общем списке они читались бы как замечание к смеси.
    warnings: warningLines(result.warnings.filter((w) => !STAMP_CODES.includes(w.code))),
    stamp: { lines: stampLines(result, result.engineVersion), notes: stampNotes },
    fingerprint: resultFingerprint(result),
    disclaimer: DISCLAIMER,
    method: METHOD,
  };
}
