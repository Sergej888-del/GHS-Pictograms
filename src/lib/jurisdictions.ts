// src/lib/jurisdictions.ts
// Правила маркировки четырёх юрисдикций в одном месте: что обязательно на
// этикетке, какие размеры предписаны, на каком языке, что можно опустить на
// малой таре. Движок этикетки (`labelArtifact.ts`) и весь UI берут правила
// ОТСЮДА и не знают ни одной нормы наизусть.
//
// Полный разбор с цитатами и ссылками на первоисточники, включая то, что
// проверить не удалось — claude/label-maker-regulatory-facts.md.
//
// ⚠⚠ Три вещи, на которых легко ошибиться:
//
// 1. У OSHA и WHMIS числовых минимумов размера НЕТ ВООБЩЕ — ни для этикетки, ни
//    для пиктограммы. Единственное требование — читаемость. Показывать в этих
//    режимах «ниже минимума» нельзя: минимума не существует, и такое сообщение
//    будет выдумкой. Отсюда два вида `sizeRule`.
// 2. Тексты H-фраз у OSHA и у CLP РАЗНЫЕ — не только «vapors/vapours», но и по
//    составу (H320 есть только у OSHA, H316 только у CLP). Отсюда
//    `statementSource`.
// 3. В Канаде английский И французский обязательны оба (HPR s. 6.2). Это не
//    удобство и не опция — одноязычная этикетка там незаконна.

export type JurisdictionKey = 'clp' | 'gbclp' | 'osha' | 'whmis';

/** Что именно строим. Набор обязательных элементов зависит от этого. */
export type LabelPurpose =
  /** Этикетка поставщика на отгружаемой таре — полный набор элементов. */
  | 'supplier'
  /** Цеховая (вторичная) тара: перелив внутри предприятия. */
  | 'workplace'
  /** Малая тара, где полный набор физически не помещается. */
  | 'small';

export type LabelElement =
  | 'productIdentifier'
  | 'signalWord'
  | 'hazardStatements'
  | 'pictograms'
  | 'precautionaryStatements'
  | 'supplier'
  | 'outerPackageNote'
  | 'sdsAvailableNote';

/** Ярус минимальных размеров по объёму тары (CLP Annex I, Table 1.3). */
export type SizeTier = {
  key: string;
  /** Верхняя граница объёма тары в литрах; `null` — всё, что выше. */
  maxLitres: number | null;
  capacityLabel: string;
  examples: string;
  labelMinW: number; // мм
  labelMinH: number; // мм
  /**
   * ⭐⭐ СТОРОНЫ ЭТИКЕТКИ — ТРЕБОВАНИЕ ИЛИ ЦЕЛЬ «ПО ВОЗМОЖНОСТИ».
   *
   * Table 1.3 говорит о ярусах РАЗНЫМИ словами, и разница юридическая:
   *
   *   ≤ 3 л   → «**If possible**, at least 52 × 74»
   *   > 3 л   → «At least 74 × 105» / «At least 105 × 148» / «At least 148 × 210»
   *
   * ⚠⚠ Это ровно та же конструкция, что у пиктограммы в том же ярусе («Not
   * smaller than 10 × 10 / If possible, at least 16 × 16»), и для пиктограммы
   * код её различал с самого начала (`pictogramMm` против `pictogramFloorMm`),
   * а для этикетки — нет. Из-за этого инструмент писал «below the 52 × 74 mm
   * minimum» про норму, которой в этом ярусе НЕ СУЩЕСТВУЕТ.
   *
   * ⚠ У ≤ 3 л пола нет вовсе: там, где 52 × 74 физически не помещается,
   * работают ст. 29(1)–(2) и Annex I §1.5.1–1.5.2 (бирка, внешняя упаковка,
   * сокращённый набор), а не «нарушение таблицы».
   */
  labelSidesBinding: boolean;
  /** Целевая сторона пиктограммы, мм. */
  pictogramMm: number;
  /** Абсолютный пол стороны пиктограммы, мм. */
  pictogramFloorMm: number;
};

/**
 * CLP Annex I, Table 1.3. Действует в ЕС и, слово в слово, в GB CLP —
 * подтверждено по тексту GB-версии на legislation.gov.uk.
 *
 * ⭐ ДОСЛОВНО, из консолидированного текста (§1.2.1.4 → Table 1.3 «Minimum
 * dimensions of labels and pictograms», колонки «Capacity of the package» ·
 * «Dimensions of the label (in millimetres) for the information required by
 * Article 17» · «Dimensions of each pictogram (in millimetres)»):
 *
 *   Not exceeding 3 litres:                    If possible, at least 52 × 74
 *                                              Not smaller than 10 × 10
 *                                              If possible, at least 16 × 16
 *   Greater than 3 but not exceeding 50 l:     At least 74 × 105 · At least 23 × 23
 *   Greater than 50 but not exceeding 500 l:   At least 105 × 148 · At least 32 × 32
 *   Greater than 500 litres:                   At least 148 × 210 · At least 46 × 46
 *
 * ⚠⚠ ПРО ПЛОЩАДЬ ЭТИКЕТКИ В ТАБЛИЦЕ НЕТ НИ СЛОВА. Площадь появляется только в
 * §1.2.1.3 и только у ПИКТОГРАММЫ («at least one fifteenth of the minimum
 * surface area of the label … not less than 1 cm²»). Любой расчёт годности
 * этикетки по площади — НАША оценка, и подписывать её соответствием нельзя.
 *
 * ⚠ Для ≤ 3 л регламент говорит «не меньше 10 × 10, по возможности 16 × 16»:
 * 16 — цель, 10 — пол. У остальных ярусов цель и пол совпадают.
 */
export const CLP_SIZE_TIERS: SizeTier[] = [
  { key: 'le3', maxLitres: 3, capacityLabel: '≤ 3 L', examples: 'bottles, cans, aerosols', labelMinW: 52, labelMinH: 74, labelSidesBinding: false, pictogramMm: 16, pictogramFloorMm: 10 },
  { key: 'gt3le50', maxLitres: 50, capacityLabel: '> 3–50 L', examples: 'jerrycans, pails', labelMinW: 74, labelMinH: 105, labelSidesBinding: true, pictogramMm: 23, pictogramFloorMm: 23 },
  { key: 'gt50le500', maxLitres: 500, capacityLabel: '> 50–500 L', examples: 'drums', labelMinW: 105, labelMinH: 148, labelSidesBinding: true, pictogramMm: 32, pictogramFloorMm: 32 },
  { key: 'gt500', maxLitres: null, capacityLabel: '> 500 L', examples: 'IBCs, tanks', labelMinW: 148, labelMinH: 210, labelSidesBinding: true, pictogramMm: 46, pictogramFloorMm: 46 },
];

/**
 * Общее правило CLP Annex I §1.2.1, отдельное от Table 1.3: каждая пиктограмма
 * занимает не менее одной пятнадцатой минимальной площади этикетки и в любом
 * случае не менее 1 см².
 *
 * ⚠⚠ Это ВТОРОЕ ограничение, а не пересказ таблицы. На нестандартно широкой и
 * низкой этикетке таблица может быть соблюдена, а это правило — нет.
 */
export const CLP_PICTOGRAM_AREA_FRACTION = 1 / 15;
export const CLP_PICTOGRAM_MIN_AREA_MM2 = 100; // 1 см²

export type SizeRule =
  /** Предписанная таблица минимумов (ЕС, GB). */
  | { kind: 'table'; tiers: SizeTier[]; areaRule: true }
  /** Числовых норм нет — только читаемость (США, Канада). */
  | { kind: 'legibility' };

/** Правила малой тары — у каждой юрисдикции свои пороги и свои послабления. */
export type SmallPackageRule = {
  /** Порог в миллилитрах. */
  ml: number;
  /** Какие элементы остаются обязательными на самой таре. */
  keep: LabelElement[];
  note: string;
  citation: string;
};

export type Jurisdiction = {
  key: JurisdictionKey;
  /** Короткое имя для чипа на этикетке и в UI. */
  tag: string;
  name: string;
  region: 'us' | 'eu';
  /**
   * Код той же юрисдикции в таблице `jurisdiction` (её читает Pictogram Selector).
   * ⚠ Имена там свои и менять их нельзя — это ключи в базе. Поле нужно, чтобы
   * подбор классификации и сборка этикетки открывались в одной юрисдикции.
   * У Канады пары нет: Selector её не поддерживает.
   */
  selectorCode: string | null;
  /** Единица по умолчанию в интерфейсе. */
  unit: 'mm' | 'in';
  sizeRule: SizeRule;
  /** Откуда берутся тексты H- и P-фраз. */
  statementSource: 'clp' | 'osha';
  /** Языки, обязательные ВСЕ ОДНОВРЕМЕННО на одной этикетке. */
  requiredLanguages: string[];
  /** Разрешён ли дополнительный язык рядом с обязательным. */
  extraLanguageAllowed: boolean;
  languageNote: string;
  /** Обязательные элементы этикетки поставщика. */
  supplierElements: LabelElement[];
  /** Обязательные элементы цеховой (вторичной) этикетки. */
  workplaceElements: LabelElement[];
  workplaceNote: string;
  /** Пороги малой тары, от большего к меньшему. */
  smallPackage: SmallPackageRule[];
  /** Нужен ли UFI (EU CLP Annex VIII). */
  requiresUfi: boolean;
  /** Требование держать пиктограммы, сигнальное слово и H-фразы одним блоком. */
  groupingCitation: string;
  /** Что писать под этикеткой мелким шрифтом. */
  disclaimer: string;
  citations: { label: string; url: string }[];
};

const CLP_SUPPLIER_ELEMENTS: LabelElement[] = [
  'productIdentifier', 'pictograms', 'signalWord',
  'hazardStatements', 'precautionaryStatements', 'supplier',
];

export const JURISDICTIONS: Record<JurisdictionKey, Jurisdiction> = {
  // ── Европейский союз ─────────────────────────────────────────────────────
  clp: {
    key: 'clp',
    tag: 'EU CLP',
    selectorCode: 'EU_CLP',
    name: 'European Union — CLP (EC) 1272/2008',
    region: 'eu',
    unit: 'mm',
    sizeRule: { kind: 'table', tiers: CLP_SIZE_TIERS, areaRule: true },
    statementSource: 'clp',
    requiredLanguages: [],
    extraLanguageAllowed: true,
    languageNote:
      'The label must be in the official language of the country where the product is placed on the market (Art. 17(2)). More than one language is allowed if all of them carry the same information.',
    supplierElements: CLP_SUPPLIER_ELEMENTS,
    workplaceElements: ['productIdentifier', 'pictograms', 'signalWord', 'hazardStatements'],
    workplaceNote:
      'CLP governs placing on the market, not decanting inside a plant. Workplace container labelling falls under Directive 98/24/EC and national occupational safety rules.',
    smallPackage: [],
    requiresUfi: true,
    groupingCitation: 'CLP Art. 32(1) — pictograms, signal word and hazard statements are grouped together',
    disclaimer:
      'Reference layout only. The supplier is responsible for CLP compliance. Only the electronic Official Journal is legally authentic.',
    citations: [
      { label: 'CLP (EC) 1272/2008 — consolidated text', url: 'https://eur-lex.europa.eu/eli/reg/2008/1272/' },
      { label: 'Annex I, Table 1.3 — minimum dimensions', url: 'https://eur-lex.europa.eu/eli/reg/2008/1272/' },
    ],
  },

  // ── Великобритания ───────────────────────────────────────────────────────
  gbclp: {
    key: 'gbclp',
    tag: 'GB CLP',
    selectorCode: 'GB_CLP',
    name: 'Great Britain — assimilated CLP',
    region: 'eu',
    unit: 'mm',
    // ⚠ Таблица минимумов в GB-версии слово в слово совпадает с EU CLP.
    sizeRule: { kind: 'table', tiers: CLP_SIZE_TIERS, areaRule: true },
    statementSource: 'clp',
    requiredLanguages: ['en'],
    extraLanguageAllowed: true,
    languageNote:
      'GB Art. 17(2): “The label shall be written in English.” Other languages are allowed provided all of them carry the same information.',
    supplierElements: CLP_SUPPLIER_ELEMENTS,
    workplaceElements: ['productIdentifier', 'pictograms', 'signalWord', 'hazardStatements'],
    workplaceNote: 'Workplace container labelling is governed by COSHH, not by GB CLP.',
    smallPackage: [],
    // ⚠⚠ Annex VIII отменён в GB с 1 января 2024 — UFI не требуется.
    // В Северной Ирландии действует EU CLP, и там UFI обязателен.
    requiresUfi: false,
    groupingCitation: 'GB CLP Art. 32(1)',
    disclaimer:
      'Reference layout only. A label for the GB market needs a GB supplier address. Northern Ireland follows EU CLP.',
    citations: [
      { label: 'Assimilated CLP on legislation.gov.uk', url: 'https://www.legislation.gov.uk/eur/2008/1272/' },
      { label: 'HSE — classification and labelling after Brexit', url: 'https://www.hse.gov.uk/chemical-classification/legal/clp-regulation.htm' },
    ],
  },

  // ── Соединённые Штаты ────────────────────────────────────────────────────
  osha: {
    key: 'osha',
    tag: 'OSHA HCS',
    selectorCode: 'OSHA_HCS',
    name: 'United States — OSHA Hazard Communication Standard, 29 CFR 1910.1200',
    region: 'us',
    unit: 'in',
    // ⚠⚠ Числовых минимумов у OSHA нет. Единственная норма о размере — красная
    // рамка пиктограммы «sufficiently wide to be clearly visible» (Appendix C,
    // C.2.3.1). Никаких дюймов и миллиметров в стандарте не встречается.
    sizeRule: { kind: 'legibility' },
    statementSource: 'osha',
    requiredLanguages: ['en'],
    extraLanguageAllowed: true,
    languageNote:
      '§1910.1200(f)(2): the label is in English; other languages may also be included. For workplace containers, (f)(10) allows a second language “as long as the information is presented in English as well”.',
    // ⚠ (f)(1)(vi) после правила 2024 года требует именно США-адрес и США-телефон.
    supplierElements: CLP_SUPPLIER_ELEMENTS,
    // ⚠ (f)(6)(ii): достаточно идентификатора продукта и слов, картинок или
    // символов, дающих общую информацию об опасностях. Пиктограммы НЕ обязательны.
    workplaceElements: ['productIdentifier', 'hazardStatements'],
    workplaceNote:
      '§1910.1200(f)(6) gives a choice: either the elements of (f)(1)(i)–(v) — that is, without the supplier block — or the product identifier plus words, pictures or symbols conveying general hazard information. A portable container for the immediate use of the employee who fills it needs no label at all under (f)(8).',
    smallPackage: [
      {
        ml: 100,
        keep: ['productIdentifier', 'pictograms', 'signalWord', 'supplier', 'outerPackageNote'],
        note: 'Containers of 100 ml or less: hazard and precautionary statements may be omitted, but the label must state that full label information is on the immediate outer package. Available only where a pull-out label, fold-back label or tag is not feasible.',
        citation: '29 CFR 1910.1200(f)(12)(ii)',
      },
      {
        ml: 3,
        keep: ['productIdentifier'],
        note: 'Containers of 3 ml or less: the product identifier alone — and only where any label would interfere with normal use of the container.',
        citation: '29 CFR 1910.1200(f)(12)(iii)',
      },
    ],
    requiresUfi: false,
    groupingCitation: '29 CFR 1910.1200(f)(3) — signal word, hazard statements and pictograms are located together',
    disclaimer:
      'Reference layout only. The chemical manufacturer, importer or employer is responsible for HCS compliance.',
    citations: [
      { label: '29 CFR 1910.1200 on eCFR', url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/section-1910.1200' },
      { label: 'Appendix C — label element texts', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200AppC' },
      { label: '2024 final rule, 89 FR 44144', url: 'https://www.federalregister.gov/documents/2024/05/20/2024-08568/hazard-communication-standard' },
    ],
  },

  // ── Канада ───────────────────────────────────────────────────────────────
  whmis: {
    key: 'whmis',
    tag: 'WHMIS',
    selectorCode: null,
    name: 'Canada — WHMIS, Hazardous Products Regulations SOR/2015-17',
    region: 'us',
    unit: 'in',
    // ⚠ s. 3.1 прямо оговаривает «except with respect to size» — размеров нет.
    sizeRule: { kind: 'legibility' },
    statementSource: 'clp',
    // ⚠⚠ Оба языка обязательны одновременно (HPR s. 6.2).
    requiredLanguages: ['en', 'fr'],
    extraLanguageAllowed: true,
    languageNote:
      'HPR s. 6.2: label elements must appear in BOTH official languages of Canada. Either a single bilingual label, or two unilingual parts that together constitute one bilingual label.',
    supplierElements: CLP_SUPPLIER_ELEMENTS,
    workplaceElements: ['productIdentifier', 'hazardStatements', 'sdsAvailableNote'],
    workplaceNote:
      'Workplace labels are governed by occupational health and safety law, not by the HPR. Federally (COHSR s. 10.41): product identifier, hazard information, and a statement that a safety data sheet is available in the workplace.',
    smallPackage: [
      {
        ml: 100,
        keep: ['productIdentifier', 'pictograms', 'signalWord', 'supplier'],
        note: 'Containers of 100 ml or less: hazard and precautionary statements may be omitted. Pictogram, signal word, both identifiers and bilingualism still apply.',
        citation: 'HPR s. 5.4(1)',
      },
      {
        ml: 3,
        keep: ['productIdentifier', 'pictograms', 'signalWord', 'supplier'],
        note: 'Containers of 3 ml or less: the durability requirement is lifted — a removable or fold-back label is acceptable.',
        citation: 'HPR s. 5.4(2)',
      },
    ],
    requiresUfi: false,
    groupingCitation: 'HPR s. 3.3 — pictogram, signal word and hazard statement are grouped together',
    disclaimer:
      'Reference layout only. A Canadian supplier label must carry both English and French (HPR s. 6.2).',
    citations: [
      { label: 'Hazardous Products Regulations SOR/2015-17', url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2015-17/' },
      { label: 'HPR s. 6.2 — bilingual requirement', url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2015-17/section-6.2.html' },
    ],
  },
};

export const JURISDICTION_ORDER: JurisdictionKey[] = ['osha', 'clp', 'whmis', 'gbclp'];

/**
 * Ярус, РЕКОМЕНДУЕМЫЙ по объёму тары, независимо от юрисдикции.
 *
 * ⚠⚠ Не путать с `sizeTierForLitres`. Тот отдаёт юридический минимум и молчит
 * там, где норм нет (США, Канада). Этот отдаёт ориентир ВСЕГДА: у OSHA и WHMIS
 * размерных норм нет, но человеку всё равно нужно понимать, какая наклейка
 * подходит под канистру, а какая под бочку. Единственная существующая в мире
 * таблица «объём тары → размер этикетки» — CLP Annex I, Table 1.3, её и берём.
 *
 * ⚠ В интерфейсе такой ориентир обязан быть подписан как НАША РЕКОМЕНДАЦИЯ, а
 * не как требование закона, иначе мы выдумываем норму за регулятора.
 */
export function recommendedTierForLitres(litres: number): SizeTier {
  return CLP_SIZE_TIERS.find((t) => t.maxLitres === null || litres <= t.maxLitres)
    ?? CLP_SIZE_TIERS[CLP_SIZE_TIERS.length - 1];
}

/** Ярус минимальных размеров по объёму тары в литрах. `null`, если норм нет. */
export function sizeTierForLitres(j: Jurisdiction, litres: number): SizeTier | null {
  if (j.sizeRule.kind !== 'table') return null;
  return j.sizeRule.tiers.find((t) => t.maxLitres === null || litres <= t.maxLitres)
    ?? j.sizeRule.tiers[j.sizeRule.tiers.length - 1];
}

/**
 * Послабление для малой тары, если объём под порог подходит. Пороги перебираются
 * от меньшего к большему: 2 мл должны попасть в правило «≤ 3 мл», а не в «≤ 100 мл».
 */
export function smallPackageRuleFor(j: Jurisdiction, ml: number): SmallPackageRule | null {
  const sorted = [...j.smallPackage].sort((a, b) => a.ml - b.ml);
  return sorted.find((r) => ml <= r.ml) ?? null;
}

/** Обязательные элементы для выбранной цели этикетки. */
export function elementsFor(j: Jurisdiction, purpose: LabelPurpose, ml?: number): LabelElement[] {
  if (purpose === 'workplace') return j.workplaceElements;
  if (purpose === 'small' && typeof ml === 'number') {
    const rule = smallPackageRuleFor(j, ml);
    if (rule) return rule.keep;
  }
  return j.supplierElements;
}

/**
 * Проверка размера пиктограммы против ОБОИХ правил CLP: стороны из Table 1.3 и
 * доли площади из §1.2.1. Возвращает требуемую сторону в мм.
 *
 * ⚠ Второе правило считается от МИНИМАЛЬНОЙ площади этикетки для яруса, а не от
 * фактической: иначе на большой этикетке требование к пиктограмме росло бы
 * бесконечно, чего регламент не предусматривает.
 */
export function requiredPictogramSideMm(tier: SizeTier): number {
  const minLabelArea = tier.labelMinW * tier.labelMinH;
  const byArea = Math.sqrt(Math.max(minLabelArea * CLP_PICTOGRAM_AREA_FRACTION, CLP_PICTOGRAM_MIN_AREA_MM2));
  return Math.max(tier.pictogramMm, byArea);
}

/** Допуск на округление размеров, мм. 4 × 2 in — это 101,6 × 50,8, а не 102 × 51. */
const SIZE_EPS_MM = 0.5;

/**
 * ⭐⭐ ВЕРДИКТ О РАЗМЕРЕ ЭТИКЕТКИ ПРОТИВ Table 1.3 — ОДИН НА ВЕСЬ ПРОЕКТ.
 *
 * До session 65 сравнений было ЧЕТЫРЕ, и все разные: `labelEngine` сравнивал
 * жёстко по осям, конструктор — с разворотом и запасным расчётом по площади,
 * страницы шаблонов — по площади, `labelArtifact` — снова жёстко по осям. Один
 * и тот же формат получал у них РАЗНЫЕ ответы.
 *
 * ⚠⚠ ДВЕ ВЕЩИ, НА КОТОРЫХ ЗДЕСЬ ЛЕГКО СОВРАТЬ:
 *
 * ① **Ориентация не нормирована.** Таблица даёт ПАРУ размеров («At least
 *    74 × 105») и нигде не говорит, который из них ширина. Этикетка 105 × 74
 *    имеет ровно эти размеры — просто в другую сторону. Поэтому сравниваем
 *    отсортированные пары: короткая сторона против короткой, длинная против
 *    длинной. Сравнение по осям отбраковывало законный альбомный формат.
 *
 * ② **«If possible» — не минимум.** У яруса ≤ 3 л недобор до 52 × 74 НЕ
 *    является нарушением (`breach === false`), и называть его «below the
 *    minimum» нельзя: минимума там нет. У ярусов > 3 л тот же недобор —
 *    нарушение.
 *
 * ⚠ Площадь здесь НЕ участвует: в Table 1.3 её нет. Оценка по площади живёт
 * отдельно, называется нашей рекомендацией и в вердикт о соответствии не
 * входит (см. `fitsTierByArea` в конструкторе).
 */
export type LabelSizeVerdict = {
  /** Стороны яруса выдержаны как пара размеров, без учёта ориентации. */
  meetsSides: boolean;
  /** ⛔ Нарушение таблицы. Только там, где ярус говорит «At least». */
  breach: boolean;
  /** ⚠ Недобор до «по возможности». Не нарушение — только у яруса ≤ 3 л. */
  belowIfPossible: boolean;
  /**
   * Стороны выдержаны, только если этикетку повернуть.
   * ⚠ Само по себе не дефект: у конструктора есть кнопка Rotate, а разворот
   * пары размеров таблице не противоречит. Но сказать об этом человеку надо —
   * заготовка у него на столе лежит в одну определённую сторону.
   */
  onlyRotated: boolean;
  /** Чего не хватает по каждой стороне, мм. `null`, если хватает всего. */
  shortByMm: { shortSide: number; longSide: number } | null;
  /** Пара яруса как она напечатана в таблице: «52 × 74 mm». */
  tierLabel: string;
  /** Дословная формулировка яруса — идёт в интерфейс как есть. */
  wording: string;
};

export function labelSizeVerdict(tier: SizeTier, widthMm: number, heightMm: number): LabelSizeVerdict {
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);
  const tShort = Math.min(tier.labelMinW, tier.labelMinH);
  const tLong = Math.max(tier.labelMinW, tier.labelMinH);

  const meetsSides = short >= tShort - SIZE_EPS_MM && long >= tLong - SIZE_EPS_MM;
  const asDrawn = widthMm >= tier.labelMinW - SIZE_EPS_MM && heightMm >= tier.labelMinH - SIZE_EPS_MM;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    meetsSides,
    breach: tier.labelSidesBinding && !meetsSides,
    belowIfPossible: !tier.labelSidesBinding && !meetsSides,
    onlyRotated: meetsSides && !asDrawn,
    shortByMm: meetsSides
      ? null
      : { shortSide: round(Math.max(0, tShort - short)), longSide: round(Math.max(0, tLong - long)) },
    tierLabel: `${tier.labelMinW} × ${tier.labelMinH} mm`,
    wording: tier.labelSidesBinding
      ? `at least ${tier.labelMinW} × ${tier.labelMinH} mm`
      : `if possible, at least ${tier.labelMinW} × ${tier.labelMinH} mm`,
  };
}
