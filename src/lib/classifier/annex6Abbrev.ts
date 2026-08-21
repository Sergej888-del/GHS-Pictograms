// src/lib/classifier/annex6Abbrev.ts
// Словарь сокращений Annex VI (Table 1.1 Part 1 консолидации CLP) → язык реестра
// (`hazard_class_catalog.class_code` + `hazard_category_mapping.category_code`)
// и разбор колонки (3) «Classification — Hazard Class and Category Code(s)».
//
// ⚠⚠⚠ ЧИСТЫЙ МОДУЛЬ: ни одного обращения к базе. Его гоняет
// `scripts/check-classifier.ts` под `node --experimental-strip-types` и
// `scripts/build-annex6-classification.ts` (service-ключ). Тот же код — в сборке.
//
// ⭐ ИСТОЧНИК СОКРАЩЕНИЙ — Table 1.1 (Annex VI, 1.1.2.1.1) консолидации
// 02008R1272-20260501 (`.tmp-eurlex/clp-consolidated.html`), дословно:
//   Unst. Expl. · Expl. 1.1–1.6 · Flam. Gas 1A/1B/2 · Pyr. Gas · Chem. Unst. Gas A/B ·
//   Aerosol 1–3 · Ox. Gas 1 · Press. Gas · Flam. Liq. 1–3 · Flam. Sol. 1–2 ·
//   Self-react. A/B/CD/EF/G · Pyr. Liq. 1 · Pyr. Sol. 1 · Self-heat. 1–2 ·
//   Water-react. 1–3 · Ox. Liq. 1–3 · Ox. Sol. 1–3 · Org. Perox. A/B/CD/EF/G ·
//   Met. Corr. 1 · Desen. Expl. 1–4 · Acute Tox. 1–4 · Skin Corr. 1/1A/1B/1C ·
//   Skin Irrit. 2 · Eye Dam. 1 · Eye Irrit. 2 · Resp. Sens. 1/1A/1B ·
//   Skin Sens. 1/1A/1B · Muta. 1A/1B/2 · Carc. 1A/1B/2 · Repr. 1A/1B/2 · Lact. ·
//   STOT SE 1–3 · STOT RE 1–2 · Asp. Tox. 1 · ED HH 1–2 · Aquatic Acute 1 ·
//   Aquatic Chronic 1–4 · ED ENV 1–2 · PBT · vPvB · PMT · vPvM · Ozone 1.
//
// ⚠ В Table 3 сами строки печатают ТИПЫ одной буквой («Self-react. C»), а не
// «CD», как в легенде; категории реестра — «Type C and D». Мост — здесь.
//
// ⚠ Маркеры Annex VI Part 1 (1.2.1–1.2.4) в той же ячейке:
//   *    — минимальная классификация (Acute Tox., STOT RE) · 1.2.1
//   **   — путь воздействия не указан (на H37x) · 1.2.2
//   ***  — дифференциация репротоксичности (на H360/H361) · 1.2.3
//   **** — физопасность требует подтверждения испытанием · 1.2.4
// Маркер относится к ПРЕДЫДУЩЕМУ коду класса той же ячейки.
//
// ⚠⚠ ОПЕЧАТКИ ИСТОЧНИКА (`SOURCE_TYPOS`) — это errata регламента, как в
// `annex6RowErrata.ts`: мы их читаем, но не «исправляем базу» — в базе ячейка
// лежит как напечатано, а пара получает флаг `TYPO_FIXED` с тем, что прочли.
// Каждая опечатка — в ТОЧНОЙ форме ячейки; новая форма после ATP не пройдёт
// молча: `tokenizeClassCat` вернёт `unparsed`, и `check-classifier` покраснеет.

/** Категория в языке реестра (`hazard_category_mapping.category_code`). */
export type RegistryCategory = string;

/** Разобранный код класса из колонки (3). */
export type ClassToken = {
  /** Код класса реестра. `ACUTE_TOX` — путь ещё не известен, решает H-код (см. `annex6Classification.ts`). */
  classCode: string;
  /** Категория реестра; `null` — Annex VI её не печатает (Press. Gas, «Expl. ****»). */
  categoryCode: RegistryCategory | null;
  /** Категория/тип как напечатано («C», «1», «1.1», «2»). */
  categoryRaw: string | null;
  /** Сырой текст, который разобран в этот токен (после правки опечатки). */
  raw: string;
  /** `*` — минимальная классификация (1.2.1). */
  star: boolean;
  /** `****` — физопасность подтвердить испытанием (1.2.4). */
  testRequired: boolean;
  /** Пометки словаря: перевод легаси-категории, опечатка источника и т.п. */
  flags: TokenFlag[];
};

export type TokenFlag =
  /** Ячейка содержала опечатку из `SOURCE_TYPOS`; прочитано исправленное. */
  | 'TYPO_FIXED'
  /** «Flam. Gas 1» (до 2019/521): по H220 = Category 1A; 1B требует данных. */
  | 'LEGACY_FLAM_GAS_1'
  /** «Eye Irrit. 2» CLP = GHS Category 2A (H319) — так названо в реестре. */
  | 'EYE_IRRIT_2_AS_2A'
  /** Тип C/D, E/F → «Type C and D», «Type E and F» реестра. */
  | 'TYPE_MERGED'
  /** Пары нет в реестре (зарезервировано для следующего ATP; после №102 не встречается). */
  | 'REGISTRY_GAP'
  /** `**`/`***` напечатаны в колонке (3), хотя относятся к H-кодам; прочитано без значения. */
  | 'MARKER_MISPLACED';

export type TokenizeResult = {
  tokens: ClassToken[];
  /** Куски текста, которые словарь не знает. Пусто = ячейка разобрана целиком. */
  unparsed: string[];
  /** Ячейка (или её часть) — голые `****` без класса: физопасность не установлена (1.2.4). */
  bareTestRequired: boolean;
  /** Текст ячейки после склейки и правки опечаток — для протокола. */
  normalized: string;
};

/**
 * Опечатки источника — ТОЧНЫЕ формы ячеек Table 3 (консолидация 2026-05-01),
 * найденные замером s77/s78 (~190 различных форм ячейки). Ключ — как
 * напечатано, значение — как читаем. Сверено по `clp-consolidated.html`.
 */
export const SOURCE_TYPOS: ReadonlyArray<readonly [printed: RegExp, read: string, why: string]> = [
  [/Carc\. 1Β/g, 'Carc. 1B', 'greek capital beta (U+0392) instead of latin B — 604-016-00-4'],
  [/Carc\. 1a\b/g, 'Carc. 1A', 'lower-case subcategory'],
  [/Repr\. 1a\b/g, 'Repr. 1A', 'lower-case subcategory'],
  [/\bmuta\. 1B/g, 'Muta. 1B', 'lower-case class — 649-287-00-X'],
  [/Muta 2\b/g, 'Muta. 2', 'missing full stop'],
  [/Muta\. 1B A\b/g, 'Muta. 1B', 'stray "A" after the category — 649-297-00-4, printed so in the OJ'],
  [/Flam\. Gas\. 1\b/g, 'Flam. Gas 1', 'extra full stop — 016-021-00-3'],
  [/Skin\. Corr\. 1B/g, 'Skin Corr. 1B', 'extra full stop — 016-011-00-9'],
  [/Eye Dam\.1\b/g, 'Eye Dam. 1', 'missing space'],
  [/Asp Tox\. 1/g, 'Asp. Tox. 1', 'missing full stop — 612-283/284'],
  [/STOT RE\. 2/g, 'STOT RE 2', 'extra full stop'],
  [/Self-heat 1\b/g, 'Self-heat. 1', 'missing full stop'],
  [/Self-React\. C/g, 'Self-react. C', 'capital R'],
  [/Carc\. 2\. Repr\. 1B/g, 'Carc. 2 Repr. 1B', 'extra full stop after the category'],
  [/Unst\. Expl(?![.a-z])/g, 'Unst. Expl.', 'missing full stop — 609-010-00-5 and two more rows print "Unst. Expl"'],
];

/**
 * Легенда Table 1.1 → реестр. Порядок важен: более длинные формы раньше
 * («Aquatic Chronic» до «Aquatic», «Skin Corr.» — подкатегория 1A/1B/1C до «1»).
 * Каждая запись: регулярное выражение с «липким» разбором от текущей позиции.
 */
type AbbrevRule = {
  re: RegExp;
  classCode: string;
  /** Категория реестра из групп совпадения; `null` — категории нет. */
  category: (m: RegExpExecArray) => { code: RegistryCategory | null; raw: string | null; flags: TokenFlag[] };
};

const typeMerged = (t: string): { code: string; raw: string; flags: TokenFlag[] } => {
  switch (t) {
    case 'A': return { code: 'Type A', raw: t, flags: [] };
    case 'B': return { code: 'Type B', raw: t, flags: [] };
    case 'C': case 'D': return { code: 'Type C and D', raw: t, flags: ['TYPE_MERGED'] };
    case 'E': case 'F': return { code: 'Type E and F', raw: t, flags: ['TYPE_MERGED'] };
    case 'G': return { code: 'Type G', raw: t, flags: [] };
    case 'CD': return { code: 'Type C and D', raw: t, flags: [] };
    case 'EF': return { code: 'Type E and F', raw: t, flags: [] };
    default: return { code: t, raw: t, flags: [] };
  }
};
const plain = (m: RegExpExecArray) => ({ code: m[1] ?? null, raw: m[1] ?? null, flags: [] as TokenFlag[] });
const fixed = (code: string) => () => ({ code, raw: code, flags: [] as TokenFlag[] });

export const ABBREV_RULES: ReadonlyArray<AbbrevRule> = [
  // ── физические опасности ───────────────────────────────────────────────────
  { re: /Unst\. Expl\./y, classCode: 'EXPLOSIVES', category: () => ({ code: 'Unstable explosive', raw: 'Unst.', flags: [] }) },
  { re: /Expl\.(?:\s+(1\.[1-6]))?/y, classCode: 'EXPLOSIVES', category: plain },
  { re: /Flam\. Gas\s+(1A|1B|1|2)\b/y, classCode: 'FLAM_GAS', category: (m) => (m[1] === '1'
      ? { code: '1A', raw: '1', flags: ['LEGACY_FLAM_GAS_1'] }
      : { code: m[1]!, raw: m[1]!, flags: [] }) },
  { re: /Pyr\. Gas/y, classCode: 'FLAM_GAS', category: () => ({ code: 'Pyrophoric', raw: 'Pyr. Gas', flags: [] }) },
  { re: /Chem\. Unst\. Gas\s+([AB])\b/y, classCode: 'FLAM_GAS', category: (m) => ({ code: `Chemically unstable ${m[1]}`, raw: m[1]!, flags: [] }) },
  { re: /Aerosol\s+([123])\b/y, classCode: 'AEROSOL', category: plain },
  { re: /Ox\. Gas\s+(1)\b/y, classCode: 'OX_GAS', category: plain },
  { re: /Press\. Gas/y, classCode: 'GAS_PRESSURE', category: () => ({ code: null, raw: null, flags: [] }) },
  { re: /Flam\. Liq\.\s+([1-4])\b/y, classCode: 'FLAM_LIQ', category: plain },
  { re: /Flam\. Sol\.\s+([12])\b/y, classCode: 'FLAM_SOL', category: plain },
  { re: /Self-react\.\s+(CD|EF|[A-G])\b/y, classCode: 'SELF_REACTIVE', category: (m) => typeMerged(m[1]!) },
  { re: /Pyr\. Liq\.\s+(1)\b/y, classCode: 'PYRO_LIQ', category: plain },
  { re: /Pyr\. Sol\.\s+(1)\b/y, classCode: 'PYRO_SOL', category: plain },
  { re: /Self-heat\.\s+([12])\b/y, classCode: 'SELF_HEATING', category: plain },
  { re: /Water-react\.\s+([123])\b/y, classCode: 'WATER_REACTIVE', category: plain },
  { re: /Ox\. Liq\.\s+([123])\b/y, classCode: 'OX_LIQ', category: plain },
  { re: /Ox\. Sol\.\s+([123])\b/y, classCode: 'OX_SOL', category: plain },
  { re: /Org\. Perox\.\s+(CD|EF|[A-G])\b/y, classCode: 'ORG_PEROXIDE', category: (m) => typeMerged(m[1]!) },
  { re: /Met\. Corr\.\s+(1)\b/y, classCode: 'CORR_METAL', category: plain },
  { re: /Desen\. Expl\.\s+([1-4])\b/y, classCode: 'DESENS_EXPLOSIVE', category: plain },
  // ── здоровье ──────────────────────────────────────────────────────────────
  // Путь (oral/dermal/inhal) Annex VI в коде класса не печатает — его даёт H-код.
  { re: /Acute Tox\.\s*([1-5])\b/y, classCode: 'ACUTE_TOX', category: plain },
  // «Skin Corr. 1» без подкатегории — родительская категория реестра «1» (№102, s78)
  { re: /Skin Corr\.\s+(1A|1B|1C|1)\b/y, classCode: 'SKIN_CORR_IRRIT', category: plain },
  { re: /Skin Irrit\.\s+(2)\b/y, classCode: 'SKIN_CORR_IRRIT', category: plain },
  { re: /Eye Dam\.\s+(1)\b/y, classCode: 'EYE_DAMAGE_IRRIT', category: plain },
  { re: /Eye Irrit\.\s+(2A|2B|2)\b/y, classCode: 'EYE_DAMAGE_IRRIT', category: (m) => (m[1] === '2'
      ? { code: '2A', raw: '2', flags: ['EYE_IRRIT_2_AS_2A'] }
      : { code: m[1]!, raw: m[1]!, flags: [] }) },
  { re: /Resp\. Sens\.\s+(1A|1B|1)\b/y, classCode: 'RESP_SENS', category: plain },
  { re: /Skin\.? Sens\.\s+(1A|1B|1)\b/y, classCode: 'SKIN_SENS', category: plain },
  { re: /Muta\.\s+(1A|1B|2)\b/y, classCode: 'MUTAGEN', category: plain },
  { re: /Carc\.\s+(1A|1B|2)\b/y, classCode: 'CARCINOGEN', category: plain },
  { re: /Repr\.\s+(1A|1B|2)\b/y, classCode: 'REPRO_TOX', category: plain },
  { re: /Lact\./y, classCode: 'REPRO_TOX', category: fixed('Lactation') },
  // STOT SE 3: «3» (H335) или «3 narcotic» (H336) — решает H-код, см. annex6Classification.ts
  { re: /STOT SE\s+([123])\b/y, classCode: 'STOT_SE', category: plain },
  { re: /STOT RE\s+([12])\b/y, classCode: 'STOT_RE', category: plain },
  { re: /Asp\. Tox\.\s+(1)\b/y, classCode: 'ASPIRATION', category: plain },
  { re: /ED HH\s+([12])\b/y, classCode: 'ED_HH', category: plain },
  // ── среда ─────────────────────────────────────────────────────────────────
  { re: /Aquatic Acute\s+(1)\b/y, classCode: 'AQUATIC_ACUTE', category: plain },
  { re: /Aquatic Chronic\s+([1-4])\b/y, classCode: 'AQUATIC_CHRONIC', category: plain },
  { re: /ED ENV\s+([12])\b/y, classCode: 'ED_ENV', category: plain },
  { re: /PBT\b/y, classCode: 'PBT_VPVB', category: fixed('PBT') },
  { re: /vPvB\b/y, classCode: 'PBT_VPVB', category: fixed('vPvB') },
  { re: /PMT\b/y, classCode: 'PMT_VPVM', category: fixed('PMT') },
  { re: /vPvM\b/y, classCode: 'PMT_VPVM', category: fixed('vPvM') },
  { re: /Ozone\s+(1)\b/y, classCode: 'OZONE', category: plain },
];

const MARKER_RE = /\*{1,4}/y;
const WS_RE = /[\s,;]+/y;

/** Склейка ячеек колонки (3): одна строка, один пробел, правка опечаток. */
export function normalizeClassCat(cells: ReadonlyArray<string>): { text: string; typoFixed: boolean } {
  let text = cells.map((c) => c.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  let typoFixed = false;
  for (const [printed, read] of SOURCE_TYPOS) {
    printed.lastIndex = 0;
    if (printed.test(text)) { text = text.replace(printed, read); typoFixed = true; }
  }
  return { text, typoFixed };
}

/**
 * Разбор колонки (3) в токены классов. Ячейки склеиваются, потому что
 * источник рвёт один код на две ячейки («Aquatic» | «Chronic 3»,
 * «Carc. 1B Muta.» | «1B Repr. 2») и, наоборот, кладёт несколько в одну.
 */
export function tokenizeClassCat(cells: ReadonlyArray<string>): TokenizeResult {
  const { text, typoFixed } = normalizeClassCat(cells);
  const tokens: ClassToken[] = [];
  const unparsed: string[] = [];
  let bareTestRequired = false;
  let pos = 0;
  let bad = '';
  const flushBad = () => { if (bad.trim()) unparsed.push(bad.trim()); bad = ''; };

  while (pos < text.length) {
    WS_RE.lastIndex = pos;
    if (WS_RE.test(text)) { pos = WS_RE.lastIndex; continue; }

    MARKER_RE.lastIndex = pos;
    const mk = MARKER_RE.exec(text);
    if (mk) {
      const last = tokens[tokens.length - 1];
      if (mk[0] === '****') {
        if (last && bad === '') last.testRequired = true; else bareTestRequired = true;
      } else if (mk[0] === '*') {
        if (last && bad === '') last.star = true; else bad += mk[0];
      } else {
        // ** / *** относятся к H-кодам (1.2.2, 1.2.3); в колонке (3) они не по месту.
        if (last && bad === '') last.flags.push('MARKER_MISPLACED'); else bad += mk[0];
      }
      pos = MARKER_RE.lastIndex;
      continue;
    }

    let matched = false;
    for (const rule of ABBREV_RULES) {
      rule.re.lastIndex = pos;
      const m = rule.re.exec(text);
      if (!m) continue;
      flushBad();
      const cat = rule.category(m);
      const flags: TokenFlag[] = [...cat.flags];
      if (typoFixed) flags.push('TYPO_FIXED');
      tokens.push({
        classCode: rule.classCode,
        categoryCode: cat.code,
        categoryRaw: cat.raw,
        raw: m[0].trim(),
        star: false,
        testRequired: false,
        flags,
      });
      pos = rule.re.lastIndex;
      matched = true;
      break;
    }
    if (matched) continue;

    // Неизвестный кусок: забираем до следующего пробела, чтобы не зациклиться.
    const next = text.indexOf(' ', pos);
    const chunk = next === -1 ? text.slice(pos) : text.slice(pos, next);
    bad += (bad ? ' ' : '') + chunk;
    pos = next === -1 ? text.length : next;
  }
  flushBad();
  return { tokens, unparsed, bareTestRequired, normalized: text };
}
