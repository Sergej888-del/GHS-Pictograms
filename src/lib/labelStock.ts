// src/lib/labelStock.ts
// Реальные форматы самоклеящихся этикеток для пресетов конструктора.
//
// ⚠⚠ Хранится ГЕОМЕТРИЯ, а не код вендора. Один формат 4 × 2 in покрывает Avery
// 60505, Avery 60525, Avery 5163, Presta 94207, OnlineLabels OL3540 и OL125
// одновременно — коды идут в `aliases`. Иначе список превращается в каталог и
// устаревает на каждой смене артикула у производителя.
//
// ⚠ Ориентация: Avery печатает размер как «2 x 4» (высота × ширина). Здесь всегда
// СНАЧАЛА ШИРИНА, потом высота, в той ориентации, в которой этикетка лежит на
// листе. То есть Avery 60505 «2 x 4» — это { w: 4, h: 2 }.
//
// ⚠ Точность: у американских форматов родная единица — дюйм, у европейских —
// миллиметр. Пересчёт делается один раз, из родной единицы, ровно по 25.4 мм/дюйм.
// Хранить и то и другое числами руками нельзя: 2⅝ in — это 66.675 мм, а каталоги
// пишут 66.7, и пресет начинает не совпадать сам с собой.
//
// Источники размеров:
//   avery.com/templates/category/ghs-chemical-labels
//   onlinelabels.com/uses/chemical-resistant-labels
//   avery.co.uk (серия L7xxx), herma.com (линейка для опасных веществ)
// Разбор и то, что проверить не удалось — claude/label-maker-regulatory-facts.md §6.

export const MM_PER_INCH = 25.4;

export type SheetKind = 'letter' | 'legal' | 'a4' | 'a3' | 'roll';
export type StockRegion = 'us' | 'eu';

export type LabelStockItem = {
  id: string;
  /** Ширина в родной единице (см. `unit`). */
  w: number;
  /** Высота в родной единице. */
  h: number;
  unit: 'in' | 'mm';
  /** Штук на листе. `null` — рулон. */
  perSheet: number | null;
  sheet: SheetKind;
  /** Материал химстойкий (винил / полиэстер уровня BS5609), а не бумага. */
  chemical: boolean;
  region: StockRegion;
  /** Коды вендоров с этой же геометрией. */
  aliases: string[];
  /** Под какую тару этот формат продаётся — со слов вендора, НЕ норма права. */
  use?: string;
};

// ── Соединённые Штаты: лист Letter 8½ × 11 и Legal 8½ × 14 ──────────────────
// Химстойкие идут первыми: именно их ищут для маркировки химии, и именно на них
// имеет смысл вести партнёрскую ссылку.
export const LABEL_STOCK_US: LabelStockItem[] = [
  {
    id: 'us-4x6', w: 4, h: 6, unit: 'in', perSheet: 4, sheet: 'legal',
    chemical: true, region: 'us', aliases: ['OnlineLabels OL4412'],
    use: 'drums, IBCs — the most common chemical label size',
  },
  {
    id: 'us-4x4', w: 4, h: 4, unit: 'in', perSheet: 4, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60504', 'Avery 60524', 'OnlineLabels OL3539'],
    use: '55-gallon drums',
  },
  {
    id: 'us-4x2', w: 4, h: 2, unit: 'in', perSheet: 10, sheet: 'letter',
    chemical: true, region: 'us',
    aliases: ['Avery 60505', 'Avery 60525', 'Avery 5163', 'Presta 94207', 'OnlineLabels OL3540', 'OnlineLabels OL125'],
    use: 'jerrycans, bottles, secondary containers',
  },
  {
    id: 'us-5x3.5', w: 5, h: 3.5, unit: 'in', perSheet: 4, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60503', 'Avery 60523', 'Avery 5168', 'Avery 8168', 'OnlineLabels OL3538'],
    use: 'pails, mid-size containers',
  },
  {
    id: 'us-2x2', w: 2, h: 2, unit: 'in', perSheet: 12, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60506', 'Avery 60526', 'OnlineLabels OL3541'],
    use: 'small containers',
  },
  {
    id: 'us-2.5x1', w: 2.5, h: 1, unit: 'in', perSheet: 24, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60517'],
    use: 'lab bottles, flasks, jars',
  },
  {
    id: 'us-1.75x0.5', w: 1.75, h: 0.5, unit: 'in', perSheet: 60, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60518'],
    use: 'vials, test tubes',
  },
  {
    id: 'us-7.75x4.75', w: 7.75, h: 4.75, unit: 'in', perSheet: 2, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60502', 'OnlineLabels OL3537'],
  },
  {
    id: 'us-8.5x5.5', w: 8.5, h: 5.5, unit: 'in', perSheet: 2, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['OnlineLabels OL3589', 'OnlineLabels OL400'],
    use: 'drums',
  },
  {
    id: 'us-8.5x11', w: 8.5, h: 11, unit: 'in', perSheet: 1, sheet: 'letter',
    chemical: true, region: 'us', aliases: ['Avery 60501', 'Avery 60507', 'Avery 60521', 'OnlineLabels OL3536'],
    use: 'drums, pails, totes — full sheet',
  },
  {
    id: 'us-8.5x14', w: 8.5, h: 14, unit: 'in', perSheet: 1, sheet: 'legal',
    chemical: true, region: 'us', aliases: ['Avery 60508', 'OnlineLabels OL4411'],
  },
  // Обычная бумага. Для химии не годится (см. предупреждение про BS5609 в UI),
  // но по этим кодам ищут чаще всего, и в цеху на вторичную тару их клеят.
  {
    id: 'us-2.625x1', w: 2.625, h: 1, unit: 'in', perSheet: 30, sheet: 'letter',
    chemical: false, region: 'us', aliases: ['Avery 5160', 'Avery 5260', 'Avery 8160', 'Presta 94200', 'OnlineLabels OL3590'],
  },
  {
    id: 'us-4x1', w: 4, h: 1, unit: 'in', perSheet: 20, sheet: 'letter',
    chemical: false, region: 'us', aliases: ['Avery 5161'],
  },
  {
    id: 'us-4x1.333', w: 4, h: 1 + 1 / 3, unit: 'in', perSheet: 14, sheet: 'letter',
    chemical: false, region: 'us', aliases: ['Avery 5162'],
  },
  {
    id: 'us-4x3.333', w: 4, h: 3 + 1 / 3, unit: 'in', perSheet: 6, sheet: 'letter',
    chemical: false, region: 'us', aliases: ['Avery 5164'],
  },
  // Рулоны под термотрансферную печать.
  {
    id: 'us-roll-4x6', w: 4, h: 6, unit: 'in', perSheet: null, sheet: 'roll',
    chemical: true, region: 'us', aliases: ['4 × 6 in roll'],
    use: 'drums — the thermal-transfer standard',
  },
  {
    id: 'us-roll-4x2', w: 4, h: 2, unit: 'in', perSheet: null, sheet: 'roll',
    chemical: true, region: 'us', aliases: ['4 × 2 in roll'],
  },
];

// ── Европа: лист A4 210 × 297 мм ────────────────────────────────────────────
// ⚠ Форматы ISO A8…A5 здесь не дублируются: они приходят из CLP Table 1.3 как
// минимальные размеры (см. jurisdictions.ts) и подставляются оттуда.
export const LABEL_STOCK_EU: LabelStockItem[] = [
  {
    id: 'eu-210x148', w: 210, h: 148, unit: 'mm', perSheet: 2, sheet: 'a4',
    chemical: true, region: 'eu', aliases: ['HERMA 58102', 'A5 landscape'],
    use: 'drums, IBCs',
  },
  {
    id: 'eu-210x297', w: 210, h: 297, unit: 'mm', perSheet: 1, sheet: 'a4',
    chemical: true, region: 'eu', aliases: ['A4 full sheet'],
    use: 'large containers',
  },
  {
    id: 'eu-297x420', w: 297, h: 420, unit: 'mm', perSheet: 1, sheet: 'a3',
    chemical: true, region: 'eu', aliases: ['HERMA 9544', 'A3'],
  },
  {
    id: 'eu-199.6x289.05', w: 199.6, h: 289.05, unit: 'mm', perSheet: 1, sheet: 'a4',
    chemical: false, region: 'eu', aliases: ['Avery L7167'],
  },
  {
    id: 'eu-99.06x67.73', w: 99.06, h: 67.73, unit: 'mm', perSheet: 8, sheet: 'a4',
    chemical: false, region: 'eu', aliases: ['Avery L7165'],
  },
  {
    id: 'eu-99.06x38.1', w: 99.06, h: 38.1, unit: 'mm', perSheet: 14, sheet: 'a4',
    chemical: false, region: 'eu', aliases: ['Avery L7163'],
  },
  {
    id: 'eu-63.5x46.56', w: 63.5, h: 46.56, unit: 'mm', perSheet: 18, sheet: 'a4',
    chemical: false, region: 'eu', aliases: ['Avery L7161'],
  },
  {
    id: 'eu-63.5x38.1', w: 63.5, h: 38.1, unit: 'mm', perSheet: 21, sheet: 'a4',
    chemical: false, region: 'eu', aliases: ['Avery L7160'],
  },
  {
    id: 'eu-roll-100x150', w: 100, h: 150, unit: 'mm', perSheet: null, sheet: 'roll',
    chemical: true, region: 'eu', aliases: ['100 × 150 mm roll'],
  },
];

export const LABEL_STOCK_ALL: LabelStockItem[] = [...LABEL_STOCK_US, ...LABEL_STOCK_EU];

/** Габариты формата в миллиметрах — единственный размер, которым считает движок. */
export function stockMm(s: LabelStockItem): { w: number; h: number } {
  return s.unit === 'in'
    ? { w: s.w * MM_PER_INCH, h: s.h * MM_PER_INCH }
    : { w: s.w, h: s.h };
}

/**
 * Дюймы дробью, как их печатают производители: 2.625 → «2-5/8», 1.3333 → «1-1/3».
 * ⚠ Десятичная запись «2.63 in» в каталоге Avery не встречается, и пользователь
 * не сопоставит её со своей пачкой наклеек.
 */
export function inchLabel(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  if (frac < 1e-6) return String(whole);
  const denominators = [2, 3, 4, 8, 16];
  for (const d of denominators) {
    const n = Math.round(frac * d);
    if (n > 0 && n < d && Math.abs(frac - n / d) < 1e-6) {
      return whole > 0 ? `${whole}-${n}/${d}` : `${n}/${d}`;
    }
  }
  return v.toFixed(2).replace(/\.?0+$/, '');
}

/** Подпись размера в родной единице формата: «4 × 2 in» или «210 × 148 mm». */
export function stockSizeLabel(s: LabelStockItem): string {
  return s.unit === 'in'
    ? `${inchLabel(s.w)} × ${inchLabel(s.h)} in`
    : `${round1(s.w)} × ${round1(s.h)} mm`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Сколько штук помещается на листе и какого — для подписи «10 шт. на листе Letter». */
export const SHEET_NAME: Record<SheetKind, string> = {
  letter: 'Letter 8½ × 11 in',
  legal: 'Legal 8½ × 14 in',
  a4: 'A4 210 × 297 mm',
  a3: 'A3 297 × 420 mm',
  roll: 'roll',
};

/** Физический размер листа в мм — нужен для раскладки N-up при печати. */
export const SHEET_MM: Record<Exclude<SheetKind, 'roll'>, { w: number; h: number }> = {
  letter: { w: 8.5 * MM_PER_INCH, h: 11 * MM_PER_INCH },
  legal: { w: 8.5 * MM_PER_INCH, h: 14 * MM_PER_INCH },
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
};

/**
 * Форматы для региона, отсортированные так, чтобы химстойкие шли первыми, а внутри
 * группы — от крупных к мелким. Мелкие форматы физически не вмещают полную
 * этикетку поставщика, и подсовывать их первыми — вредный совет.
 */
export function stockFor(region: StockRegion): LabelStockItem[] {
  return LABEL_STOCK_ALL
    .filter((s) => s.region === region)
    .sort((a, b) => {
      if (a.chemical !== b.chemical) return a.chemical ? -1 : 1;
      const am = stockMm(a), bm = stockMm(b);
      return bm.w * bm.h - am.w * am.h;
    });
}
