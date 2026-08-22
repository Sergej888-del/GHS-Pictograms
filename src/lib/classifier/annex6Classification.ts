// src/lib/classifier/annex6Classification.ts
// A0 — строительный блок классификатора смесей: пары «класс + категория реестра»
// для каждой строки Annex VI Table 3, выведенные из колонки (3) «Hazard Class
// and Category Code(s)» и колонки (4) «Hazard statement Code(s)».
//
// ⚠⚠⚠ ЧИСТЫЙ МОДУЛЬ: ни одного обращения к базе (как `pPrecedence.ts`).
// Данные приходят снимком; прогон — `scripts/check-classifier.ts`
// (`node --experimental-strip-types`), заполнение таблицы —
// `scripts/build-annex6-classification.ts` (service-ключ).
//
// ⭐⭐⭐ ПРАВИЛО ИСТОЧНИКА ПАРЫ (решение Сергея, s76, `annex6RowErrata.ts`):
// КЛАСС и КАТЕГОРИЯ берутся из колонки (3) — это и есть гармонизированная
// классификация (Art. 36–37, Annex VI 1.1.2.1.1). H-код колонки (4) нужен для:
//   · пути Acute Tox. (oral / dermal / inhal — Annex VI печатает только
//     «Acute Tox. 4», путь виден лишь по H302 / H312 / H332);
//   · STOT SE 3 → «3» (H335) или «3 narcotic» (H336);
//   · обратной сверки: у каждой пары должен быть свой H-код в строке, иначе
//     строка обязана быть в `ROW_ERRATA` (6 ошибок регламента) — иного
//     «none» не бывает (урок s76: пустая ячейка — подозреваемый).
//
// ⚠ Annex VI НЕ печатает категорию у Press. Gas (Note U: выбирает поставщик
// по состоянию газа) и у «Expl. ****» (1.2.4: тип подтвердить испытанием) —
// такие пары идут с `categoryCode: null` и флагом, а не молча.
//
// ⚠ Суффиксы H-кодов (H350i, H360FD, H361d…) сохраняются в `hCodeFull`;
// `hCode` — четырёхзначная основа, как в реестре (откат как в `pPrecedence` §2.2).
// Органы в скобках («H372 (nervous system)») — в `organs`, маркеры `**`/`***`
// на H-коде — в `hMarker` (Annex VI 1.2.2 / 1.2.3).

import { tokenizeClassCat, type ClassToken, type TokenFlag } from './annex6Abbrev.ts';

/** Строка `annex6_table3`, как её читает скрипт. */
export type Annex6Row = {
  index_number: string;
  class_cat_raw: string[];
  hazard_h_raw: string[];
};

/** Строка реестра: `hazard_category_mapping ⋈ hazard_class_catalog`. */
export type RegistryRow = {
  classCode: string;
  categoryCode: string;
  /** H-код, закреплённый за парой (может быть `null`: Expl. 1.6, Type G). */
  hCode: string | null;
};

/** Ошибка регламента в строке (из `annex6RowErrata.ts`), в узком виде для парсера. */
export type RowErratumLite = {
  kind: 'statement-mismatch' | 'statement-missing' | 'class-missing';
  /** Коды, которые СЛЕДУЮТ из напечатанных классов (что показываем). */
  shownStatements: string[];
  /** Коды, как напечатаны в колонке (4). */
  printedStatements: string[];
};

export type PairFlag =
  | TokenFlag
  /** Пара без H-кода в строке, потому что Annex VI его не печатает (Press. Gas, Expl. 1.6, Type G, «Expl. ****»). */
  | 'NO_H_IN_ANNEX6'
  /** Пара без H-кода, строка — в `ROW_ERRATA` (statement-missing / mismatch): код взят из `shownStatements`. */
  | 'ERRATA_ROW'
  /** Пара без H-кода и без errata — ДЕФЕКТ данных или словаря; в выдаче не должно быть. */
  | 'H_MISSING'
  /** Acute Tox.: путь не удалось определить (нет подходящего H30x/H31x/H33x). */
  | 'ROUTE_UNKNOWN'
  /** H-код в строке не совпадает с кодом реестра для этой пары (не errata). */
  | 'H_MISMATCH'
  /** Категория «3 narcotic» выбрана по H336. */
  | 'NARCOTIC_BY_H336';

export type ClassificationPair = {
  indexNumber: string;
  /** Порядок в колонке (3), с 1. */
  seq: number;
  classCode: string;
  categoryCode: string | null;
  categoryRaw: string | null;
  /** Четырёхзначная основа («H360»); `null` — см. флаги. */
  hCode: string | null;
  /** Как напечатано, с суффиксом («H360Df», «H350i»). */
  hCodeFull: string | null;
  /** Текст в скобках после H-кода — органы/путь («nervous system; oral, inhalation»). */
  organs: string | null;
  /** `**` (1.2.2) или `***` (1.2.3) на H-коде; `*` — одиночная звезда на H-коде (608-055-00-8). */
  hMarker: string | null;
  /** `*` — минимальная классификация (1.2.1). */
  star: boolean;
  /** `****` — физопасность подтвердить испытанием (1.2.4). */
  testRequired: boolean;
  /** Как напечатан класс (после правки опечатки). */
  raw: string;
  flags: PairFlag[];
};

export type RowFlag =
  /** Колонка (3) содержит куски, которых словарь не знает. */
  | 'UNPARSED'
  /** Голые `****` без класса: физопасность не установлена (1.2.4), класса нет. */
  | 'PHYS_TEST_REQUIRED'
  /** В колонке (4) остались H-коды, не занятые ни одной парой, и строка не в errata `class-missing`. */
  | 'H_UNMATCHED'
  /** Строка — в `ROW_ERRATA`. */
  | 'ERRATA_ROW'
  /** В колонке (4) есть голые `****` (дублирует 1.2.4 колонки (3)). */
  | 'H_TEST_REQUIRED';

export type RowResult = {
  indexNumber: string;
  pairs: ClassificationPair[];
  rowFlags: RowFlag[];
  unparsed: string[];
  /** H-коды колонки (4), оставшиеся без пары (основа + суффикс). */
  unmatchedH: string[];
  normalizedClassCat: string;
  normalizedH: string;
};

/* ── H-коды колонки (4) ──────────────────────────────────────────────────── */

export type HToken = {
  full: string;
  base: string;
  marker: string | null;
  organs: string | null;
  used: boolean;
};

const H_RE = /\b((?:EU)?H\d{3})([A-Za-z]{0,2})\b/g;

/**
 * Колонка (4) склеивается в одну строку: источник рвёт «H372 (nervous» |
 * «system) H317» на две ячейки и кладёт «H373 ** H317» в одну.
 */
export function tokenizeH(cells: ReadonlyArray<string>): { tokens: HToken[]; bareTestRequired: boolean; normalized: string } {
  const text = cells.map((c) => c.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const tokens: HToken[] = [];
  const matches = [...text.matchAll(H_RE)];
  let bareTestRequired = false;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    const tail = text.slice(start, end).trim();
    // хвост: маркеры и скобки с органами, в любом порядке
    let marker: string | null = null;
    const organs: string[] = [];
    let rest = tail;
    for (;;) {
      const mk = /^\*{1,4}/.exec(rest);
      if (mk) { if (mk[0] === '****') bareTestRequired = true; else marker = marker ?? mk[0]; rest = rest.slice(mk[0].length).trim(); continue; }
      const br = /^\(([^()]*)\)/.exec(rest);
      if (br) { organs.push(br[1]!.trim()); rest = rest.slice(br[0].length).trim(); continue; }
      // хвост без закрывающей скобки (обрезанная ячейка «H372 (nervous») — берём как есть
      const open = /^\(([^()]*)$/.exec(rest);
      if (open) { organs.push(open[1]!.trim()); rest = ''; continue; }
      break;
    }
    tokens.push({
      full: m[1]! + m[2]!,
      base: m[1]!,
      marker,
      organs: organs.length ? organs.join('; ') : null,
      used: false,
    });
  }
  // голые **** ДО первого H-кода («**** H400») или без кодов вовсе («****»)
  const head = matches.length ? text.slice(0, matches[0]!.index!) : text;
  if (/(^|\s)\*{4}(\s|$)/.test(head)) bareTestRequired = true;
  return { tokens, bareTestRequired, normalized: text };
}

/* ── ожидаемые H-коды по паре ────────────────────────────────────────────── */

const ACUTE_BY_CAT: Record<string, string[]> = {
  '1': ['H300', 'H310', 'H330'],
  '2': ['H300', 'H310', 'H330'],
  '3': ['H301', 'H311', 'H331'],
  '4': ['H302', 'H312', 'H332'],
  '5': ['H303', 'H313', 'H333'],
};
const ROUTE_BY_H: Record<string, string> = {
  H300: 'ACUTE_TOX_ORAL', H301: 'ACUTE_TOX_ORAL', H302: 'ACUTE_TOX_ORAL', H303: 'ACUTE_TOX_ORAL',
  H310: 'ACUTE_TOX_DERMAL', H311: 'ACUTE_TOX_DERMAL', H312: 'ACUTE_TOX_DERMAL', H313: 'ACUTE_TOX_DERMAL',
  H330: 'ACUTE_TOX_INHAL', H331: 'ACUTE_TOX_INHAL', H332: 'ACUTE_TOX_INHAL', H333: 'ACUTE_TOX_INHAL',
};

function expectedH(tok: ClassToken, reg: RegistryIndex): string[] {
  if (tok.classCode === 'ACUTE_TOX') return ACUTE_BY_CAT[tok.categoryRaw ?? ''] ?? [];
  if (tok.classCode === 'STOT_SE' && tok.categoryCode === '3') return ['H335', 'H336'];
  if (tok.classCode === 'EXPLOSIVES' && tok.categoryCode === null) return ['H200', 'H201', 'H202', 'H203', 'H204', 'H205'];
  if (tok.classCode === 'GAS_PRESSURE') return ['H280', 'H281'];
  if (tok.classCode === 'SKIN_CORR_IRRIT' && tok.categoryCode === '1') return ['H314'];
  const h = reg.hFor(tok.classCode, tok.categoryCode);
  return h ? [h] : [];
}

/* ── реестр ──────────────────────────────────────────────────────────────── */

export class RegistryIndex {
  private readonly byPair = new Map<string, string | null>();
  private readonly byClass = new Map<string, Set<string>>();
  constructor(rows: ReadonlyArray<RegistryRow>) {
    for (const r of rows) {
      const k = `${r.classCode}|${r.categoryCode}`;
      if (!this.byPair.has(k) || this.byPair.get(k) == null) this.byPair.set(k, r.hCode);
      if (!this.byClass.has(r.classCode)) this.byClass.set(r.classCode, new Set());
      this.byClass.get(r.classCode)!.add(r.categoryCode);
    }
  }
  has(classCode: string, categoryCode: string | null): boolean {
    return categoryCode != null && this.byPair.has(`${classCode}|${categoryCode}`);
  }
  hasClass(classCode: string): boolean { return this.byClass.has(classCode); }
  hFor(classCode: string, categoryCode: string | null): string | null {
    if (categoryCode == null) return null;
    return this.byPair.get(`${classCode}|${categoryCode}`) ?? null;
  }
}

/* ── разбор строки ───────────────────────────────────────────────────────── */

export function parseAnnex6Row(
  row: Annex6Row,
  registry: RegistryIndex,
  erratum: RowErratumLite | null,
): RowResult {
  const cc = tokenizeClassCat(row.class_cat_raw);
  const hh = tokenizeH(row.hazard_h_raw);
  const rowFlags: RowFlag[] = [];
  if (cc.unparsed.length) rowFlags.push('UNPARSED');
  if (cc.bareTestRequired) rowFlags.push('PHYS_TEST_REQUIRED');
  if (hh.bareTestRequired) rowFlags.push('H_TEST_REQUIRED');
  if (erratum) rowFlags.push('ERRATA_ROW');

  // Коды, которые errata ВЕЛИТ показать вместо/в дополнение к напечатанным
  // (statement-missing: H400 при Aquatic Acute 1; mismatch: H260 вместо H270).
  const errataExtra = erratum && erratum.kind !== 'class-missing'
    ? erratum.shownStatements.filter((c) => !erratum.printedStatements.includes(c))
    : [];
  // Напечатанные коды, которые errata велит НЕ показывать (class-missing: H340 без Muta.;
  // mismatch: H270 при Water-react. 1).
  const errataDrop = erratum
    ? erratum.printedStatements.filter((c) => !erratum.shownStatements.includes(c))
    : [];

  const pairs: ClassificationPair[] = [];
  // ⚠ Пары выводятся ТОЛЬКО из колонки (3). Вид errata `class-omitted` (s78:
  // «класс пропущен, выводим из кода») снят решением s79 — строго по классу;
  // напечатанный код без класса остаётся в `unmatchedH` как ожидаемый остаток.
  cc.tokens.forEach((tok, i) => {
    const want = expectedH(tok, registry);
    const flags: PairFlag[] = [...tok.flags];
    let classCode = tok.classCode;
    let categoryCode = tok.categoryCode;
    let h: HToken | null = null;

    // первый незанятый H-код строки из ожидаемого набора — в порядке печати
    for (const t of hh.tokens) {
      if (!t.used && want.includes(t.base)) { h = t; break; }
    }
    if (h) h.used = true;

    let hCode: string | null = h?.base ?? null;
    if (!h) {
      const fromErrata = errataExtra.find((c) => want.includes(c));
      if (fromErrata) { hCode = fromErrata; flags.push('ERRATA_ROW'); }
      else if (tok.classCode === 'GAS_PRESSURE' || (tok.classCode === 'EXPLOSIVES' && (tok.categoryCode === null || tok.categoryCode === '1.6'))
        || ((tok.classCode === 'SELF_REACTIVE' || tok.classCode === 'ORG_PEROXIDE') && tok.categoryCode === 'Type G')) {
        flags.push('NO_H_IN_ANNEX6');
      } else {
        flags.push('H_MISSING');
      }
    }

    // Acute Tox.: путь из H-кода
    if (classCode === 'ACUTE_TOX') {
      const route = hCode ? ROUTE_BY_H[hCode] : undefined;
      if (route) classCode = route; else flags.push('ROUTE_UNKNOWN');
    }
    // STOT SE 3 narcotic — по H336
    if (classCode === 'STOT_SE' && categoryCode === '3' && hCode === 'H336') {
      categoryCode = '3 narcotic';
      flags.push('NARCOTIC_BY_H336');
    }
    // сверка с реестром: у пары есть строка, и её H-код — тот же
    if (categoryCode != null && classCode !== 'ACUTE_TOX') {
      if (!registry.has(classCode, categoryCode)) {
        if (!flags.includes('REGISTRY_GAP')) flags.push('REGISTRY_GAP');
      } else {
        const regH = registry.hFor(classCode, categoryCode);
        if (regH && hCode && regH !== hCode) flags.push('H_MISMATCH');
      }
    }

    pairs.push({
      indexNumber: row.index_number,
      seq: i + 1,
      classCode,
      categoryCode,
      categoryRaw: tok.categoryRaw,
      hCode,
      hCodeFull: h?.full ?? (hCode ?? null),
      organs: h?.organs ?? null,
      hMarker: h?.marker ?? null,
      star: tok.star,
      testRequired: tok.testRequired,
      raw: tok.raw,
      flags,
    });
  });

  const unmatchedH = hh.tokens.filter((t) => !t.used).map((t) => t.full);
  // errata class-missing: напечатан код без класса — это ОЖИДАЕМЫЙ остаток
  const unexpected = unmatchedH.filter((c) => !errataDrop.includes(c.replace(/[a-z]+$/i, '')) && !errataDrop.includes(c));
  if (unexpected.length) rowFlags.push('H_UNMATCHED');

  return {
    indexNumber: row.index_number,
    pairs,
    rowFlags,
    unparsed: cc.unparsed,
    unmatchedH,
    normalizedClassCat: cc.normalized,
    normalizedH: hh.normalized,
  };
}

/** Версия парсера — пишется в таблицу; менять при любой правке словаря или правил. */
export const ANNEX6_CLASSIFICATION_PARSER_VERSION = 'a0-parser 1.1 (s79: class-omitted retired)';
