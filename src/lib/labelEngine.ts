// src/lib/labelEngine.ts
// Движок этикетки: считает раскладку в МИЛЛИМЕТРАХ и отдаёт список примитивов.
// Из одного списка рисуются и превью (SVG), и печать (PDF).
//
// ⚠⚠ Почему не «строим сразу SVG, а PDF получаем растеризацией», как было раньше:
// прежний путь рисовал SVG на canvas и клал PNG в PDF. При 4 px/мм и удвоении на
// canvas это ~200 dpi, и текст 2 мм высотой на этикетке 52 × 74 мм печатается
// мылом. Здесь текст в PDF рисуется НАТИВНО (вектор, бесконечное разрешение), и
// растеризуются только пиктограммы — картинки, которым 600 dpi достаточно.
//
// ⚠ Единица раскладки — миллиметр, а не пиксель. SVG выпускается с width/height в
// мм и viewBox в тех же единицах, поэтому файл физически корректен: открыл в
// Illustrator — этикетка ровно того размера, что заказана.

import {
  JURISDICTIONS, elementsFor, sizeTierForLitres, smallPackageRuleFor,
  requiredPictogramSideMm,
  type JurisdictionKey, type LabelPurpose, type LabelElement,
} from './jurisdictions';

// ── Примитивы раскладки ─────────────────────────────────────────────────────

export type DrawText = {
  t: 'text';
  x: number; y: number; // мм, y — базовая линия
  s: string;
  size: number;         // мм, высота кегля
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  color: string;
  anchor?: 'start' | 'middle';
};
export type DrawRect = {
  t: 'rect';
  x: number; y: number; w: number; h: number;
  stroke?: string; strokeW?: number; fill?: string; radius?: number; dash?: number;
};
export type DrawLine = {
  t: 'line';
  x1: number; y1: number; x2: number; y2: number;
  stroke: string; strokeW: number; dash?: number;
};
/** Пиктограмма: исходный SVG, который вставляется в превью и растеризуется в PDF. */
export type DrawSvg = { t: 'svg'; x: number; y: number; size: number; svg: string; code: string };
/** Растровый логотип пользователя (PNG/JPEG data URL). */
export type DrawImage = { t: 'image'; x: number; y: number; w: number; h: number; href: string };

export type DrawItem = DrawText | DrawRect | DrawLine | DrawSvg | DrawImage;

export type LabelLayout = {
  widthMm: number;
  heightMm: number;
  items: DrawItem[];
  fit: LabelFit;
  issues: ComplianceIssue[];
  pictogramMm: number;
};

export type LabelFit = {
  /** Всё содержимое поместилось при читаемом кегле. */
  fits: boolean;
  /** Минимальная высота при заказанной ширине, при которой всё влезает. */
  neededHeightMm: number;
  /** Размер пиктограммы, который получился. */
  pictogramMm: number;
  /** Требуемый регламентом минимум стороны пиктограммы; null — нормы нет. */
  requiredPictogramMm: number | null;
  /** Заказанный размер меньше предписанного таблицей; null — таблицы нет. */
  belowMinimum: boolean | null;
  minimumLabel: string | null;
  /** Кегль основного текста, мм. */
  bodyMm: number;
};

/** Замечание о соответствии: чего не хватает и по какой норме. */
export type ComplianceIssue = {
  level: 'error' | 'warning' | 'info';
  text: string;
  citation?: string;
};

// ── Вход ────────────────────────────────────────────────────────────────────

export type Statement = { code: string; text: string };

/** Второй язык этикетки — для Канады обязателен, в остальных местах опция. */
export type SecondLanguageBlock = {
  langTag: string;      // «FR», «ES»
  signalWord: string | null;
  hStatements: Statement[];
  pStatements: Statement[];
  combinedPText?: string;
};

export type LabelInput = {
  productName: string;
  casNumber?: string;
  ecNumber?: string | null;
  nominalQty?: string;
  batchNumber?: string;
  ufiCode?: string;
  signalWord: string | null;
  pictograms: { code: string; svg: string }[];
  hStatements: Statement[];
  pStatements: Statement[];
  pFormat: 'codes' | 'combined';
  combinedPText?: string;
  hiddenPCount?: number;
  supplier: { name?: string; address?: string; phone?: string };
  logo?: { dataUrl: string; aspect: number };
  second?: SecondLanguageBlock;
  /** Служебные строки внизу: отсылка к внешней упаковке, наличие SDS и т. п. */
  notes?: string[];
};

export type LabelOptions = {
  jurisdiction: JurisdictionKey;
  purpose: LabelPurpose;
  widthMm: number;
  heightMm: number;
  /** Объём тары в литрах — им выбирается ярус минимальных размеров CLP. */
  containerLitres?: number;
  /** Объём тары в миллилитрах — им проверяются послабления для малой тары. */
  containerMl?: number;
};

// ── Метрика текста ──────────────────────────────────────────────────────────
// Helvetica/Arial: средняя ширина знака в долях кегля. Точную ширину даёт только
// сам шрифт, но раскладка должна совпадать между SVG и PDF, поэтому обе стороны
// считают ОДНОЙ И ТОЙ ЖЕ формулой. Небольшой запас лучше перелива.
const CW_REGULAR = 0.52;
const CW_BOLD = 0.56;
const CW_MONO = 0.60;

function charsPerLine(widthMm: number, sizeMm: number, kind: 'regular' | 'bold' | 'mono' = 'regular'): number {
  const cw = kind === 'bold' ? CW_BOLD : kind === 'mono' ? CW_MONO : CW_REGULAR;
  return Math.max(6, Math.floor(widthMm / (sizeMm * cw)));
}

/** Перенос по словам с жёстким разрывом слишком длинных слов (IUPAC-имена). */
function wrap(text: string, maxChars: number): string[] {
  const raw = String(text ?? '').split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (const w of raw) {
    if (w.length <= maxChars) words.push(w);
    else for (let i = 0; i < w.length; i += maxChars) words.push(w.slice(i, i + maxChars));
  }
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// ── Константы вида ──────────────────────────────────────────────────────────
const INK = '#111827';
const INK_SOFT = '#4b5563';
const INK_FAINT = '#9ca3af';
const RULE = '#d1d5db';
const DANGER = '#dc2626';
const WARNING = '#b45309';

/** Нижняя граница читаемого кегля. Ниже этого этикетку не печатают. */
const MIN_BODY_MM = 1.4;
/**
 * Сторона пиктограммы в кеглях основного текста. Отношение подобрано по живым
 * этикеткам: при тексте 2 мм пиктограмма выходит 16 мм — ровно минимум CLP
 * Table 1.3 для тары до 3 л. Держать это отношение постоянным важнее, чем
 * любое отдельное число: именно оно делает крупную этикетку похожей на мелкую.
 */
const PIC_TO_BODY = 8;
const LINE = 1.32; // межстрочный, доли кегля

function signalColor(word: string | null): string {
  if (!word) return INK_SOFT;
  return /danger/i.test(word) ? DANGER : WARNING;
}

// ── Раскладка ───────────────────────────────────────────────────────────────

export function layoutLabel(input: LabelInput, opt: LabelOptions): LabelLayout {
  const j = JURISDICTIONS[opt.jurisdiction];
  const W = Math.max(10, opt.widthMm);
  const H = Math.max(10, opt.heightMm);

  // Поля пропорциональны размеру: на визитке 3 мм полей — это треть площади.
  const pad = clamp(W * 0.035, 1.2, 4);
  const borderW = clamp(W * 0.012, 0.4, 1.2);

  const tier = typeof opt.containerLitres === 'number' ? sizeTierForLitres(j, opt.containerLitres) : null;
  const requiredPic = tier ? requiredPictogramSideMm(tier) : null;

  /**
   * ⚠⚠ Пиктограмма считается ОТ КЕГЛЯ, а не от ширины этикетки.
   *
   * Пока она считалась от ширины, а кегль имел собственный потолок, на большой
   * этикетке получалась дичь: пиктограмма 65 мм и текст 4 мм рядом. Теперь у
   * пиктограммы и текста одно отношение на всех размерах, и этикетка на бочку
   * выглядит как та же этикетка, только крупнее.
   *
   * Ограничения сверху и снизу остаются: не мельче предписанного регламентом
   * минимума и не шире 40 % этикетки.
   */
  const picFor = (body: number) =>
    Math.min(Math.max(body * PIC_TO_BODY, requiredPic ?? 4), W * 0.4);

  const pics = input.pictograms.filter((p) => p.svg && p.svg.trim());
  const required = elementsFor(j, opt.purpose, opt.containerMl);
  const showPics = required.includes('pictograms') && pics.length > 0;
  const showSignal = required.includes('signalWord') && !!input.signalWord;
  const showH = required.includes('hazardStatements') && input.hStatements.length > 0;
  const showP = required.includes('precautionaryStatements')
    && (input.pStatements.length > 0 || (input.pFormat === 'combined' && !!input.combinedPText));
  const showSupplier = required.includes('supplier');

  // ── Подбор кегля ──────────────────────────────────────────────────────────
  // Строим раскладку при минимальном кегле: если не влезло — не влезет никак.
  // Если влезло с запасом, кегль увеличивается, пока содержимое не заполнит лист.
  const composeWith = (body: number, gapExtra: number, preferTwoCol: boolean) =>
    compose(input, opt, {
      W, H, pad, borderW, picMm: picFor(body), body, gapExtra, preferTwoCol,
      showPics, showSignal, showH, showP, showSupplier,
      pics, jurisdictionTag: j.tag,
    });

  /**
   * ⚠⚠ Раскладка не угадывается по пропорциям этикетки, а ВЫБИРАЕТСЯ ЗАМЕРОМ:
   * строятся обе и берётся более низкая. Прежнее правило «шире, чем 1,2 к 1 —
   * значит рейка слева» давало на 5 × 3½ in вертикальную рейку из двух
   * пиктограмм, рядом три коротких H-фразы, и половина блока оставалась пустой.
   * Высота — честный критерий: чем ниже раскладка, тем крупнее влезет текст.
   */
  const build = (body: number, gapExtra = 0) => {
    const a = composeWith(body, gapExtra, true);
    const b = composeWith(body, gapExtra, false);
    return a.height <= b.height ? a : b;
  };

  // ⚠ Потолок кегля пропорционален самой этикетке, а не задан числом. Прежняя
  // константа 4,2 мм и была причиной пустых полей: на листе 216 × 279 мм текст
  // упирался в неё, содержимое оставалось полоской посередине, а всё остальное
  // — воздух.
  const maxBody = clamp(Math.min(W, H) / 11, MIN_BODY_MM, 11);

  const atMin = build(MIN_BODY_MM);
  let chosen = atMin;
  let body = MIN_BODY_MM;
  const fits = atMin.height <= H;

  if (fits) {
    // Бинарный поиск по кеглю: высота растёт быстрее линейного (крупный шрифт
    // переносится чаще), поэтому пропорция не годится, а перебор — годится.
    let lo = MIN_BODY_MM, hi = maxBody;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const trial = build(mid);
      if (trial.height <= H) { lo = mid; chosen = trial; body = mid; }
      else hi = mid;
    }
  }

  // ⚠⚠ Остаток высоты РАЗДАЁТСЯ МЕЖДУ СЕКЦИЯМИ, а не сваливается полем сверху и
  // снизу. Когда кегль упёрся в потолок (мало содержимого на крупной этикетке),
  // центрирование оставляло сверху и снизу по пустой ладони, и этикетка читалась
  // как незаполненная. Теперь воздух распределяется по стыкам блоков, как на
  // настоящей печатной этикетке.
  if (fits && chosen.height < H) {
    const slack = H - chosen.height;
    const joints = Math.max(1, chosen.sections - 1);
    const perJoint = slack / joints;
    // Не раздвигаем сверх разумного: гигантские дыры между строками читаются
    // хуже, чем небольшое поле снизу.
    const capped = Math.min(perJoint, body * 6);
    if (capped > 0.2) {
      const spread = build(body, capped);
      if (spread.height <= H) chosen = spread;
    }
  }

  // Остаток после раздачи центрируется — так поля сверху и снизу равны.
  const offY = fits ? Math.max(0, (H - chosen.height) / 2) : 0;
  const items = offY > 0 ? chosen.items.map((it) => shiftY(it, offY)) : chosen.items;

  const frame: DrawItem[] = [
    { t: 'rect', x: 0, y: 0, w: W, h: fits ? H : chosen.height, fill: '#ffffff' },
    {
      t: 'rect', x: borderW / 2, y: borderW / 2,
      w: W - borderW, h: (fits ? H : chosen.height) - borderW,
      stroke: DANGER, strokeW: borderW,
    },
  ];

  const belowMinimum = tier ? (W < tier.labelMinW - 0.5 || H < tier.labelMinH - 0.5) : null;

  return {
    widthMm: W,
    heightMm: fits ? H : chosen.height,
    items: [...frame, ...items],
    pictogramMm: picFor(body),
    fit: {
      fits,
      neededHeightMm: Math.ceil(atMin.height * 10) / 10,
      pictogramMm: Math.round(picFor(body) * 10) / 10,
      requiredPictogramMm: requiredPic ? Math.round(requiredPic * 10) / 10 : null,
      belowMinimum,
      minimumLabel: tier ? `${tier.labelMinW} × ${tier.labelMinH} mm` : null,
      bodyMm: Math.round(body * 100) / 100,
    },
    issues: checkCompliance(input, opt),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function shiftY(it: DrawItem, dy: number): DrawItem {
  switch (it.t) {
    case 'text': return { ...it, y: it.y + dy };
    case 'rect': return { ...it, y: it.y + dy };
    case 'line': return { ...it, y1: it.y1 + dy, y2: it.y2 + dy };
    case 'svg': return { ...it, y: it.y + dy };
    case 'image': return { ...it, y: it.y + dy };
  }
}

type ComposeCtx = {
  W: number; H: number; pad: number; borderW: number; picMm: number; body: number;
  /** Добавка к отступу между секциями — ею раздаётся лишняя высота. */
  gapExtra: number;
  /** Пробуемая раскладка: пиктограммы рейкой слева или рядом сверху. */
  preferTwoCol: boolean;
  showPics: boolean; showSignal: boolean; showH: boolean; showP: boolean; showSupplier: boolean;
  pics: { code: string; svg: string }[];
  jurisdictionTag: string;
};

/**
 * Сборка содержимого при заданном кегле. Возвращает примитивы и фактическую высоту.
 *
 * ⚠⚠ Обязательные элементы (пиктограммы, сигнальное слово, H-фразы) обводятся
 * ОДНОЙ рамкой. Это не украшение: CLP Art. 32(1), OSHA (f)(3) и HPR s. 3.3
 * одинаково требуют, чтобы эти элементы стояли вместе. Прежний макет разносил
 * пиктограммы и H-фразы по разным колонкам, и визуально они читались как
 * отдельные блоки.
 */
function compose(
  input: LabelInput, opt: LabelOptions, c: ComposeCtx,
): { items: DrawItem[]; height: number; sections: number } {
  const items: DrawItem[] = [];
  const { W, pad, body } = c;
  const inner = W - pad * 2;
  let y = pad;
  // Сколько блоков на этикетке — по числу стыков между ними раздаётся лишняя
  // высота. Идентификатор продукта считается всегда.
  let sections = 1;

  const lh = body * LINE;
  const nameSize = body * 1.5;
  const metaSize = body * 0.92;
  const secSize = body * 0.78;

  // ── Идентификатор продукта ───────────────────────────────────────────────
  const nameLines = wrap(input.productName || '', charsPerLine(inner, nameSize, 'bold'));
  for (const ln of nameLines) {
    y += nameSize;
    items.push({ t: 'text', x: pad, y, s: ln, size: nameSize, bold: true, color: INK });
    y += nameSize * (LINE - 1);
  }

  // CAS / EC / количество / партия / UFI — компактной строкой-другой.
  const metaBits: string[] = [];
  if (input.casNumber) metaBits.push(`CAS ${input.casNumber}`);
  if (input.ecNumber) metaBits.push(`EC ${input.ecNumber}`);
  if (input.nominalQty) metaBits.push(input.nominalQty);
  if (input.batchNumber) metaBits.push(`Batch ${input.batchNumber}`);
  if (metaBits.length) {
    for (const ln of wrap(metaBits.join('  ·  '), charsPerLine(inner, metaSize))) {
      y += metaSize + metaSize * (LINE - 1) * 0.6;
      items.push({ t: 'text', x: pad, y, s: ln, size: metaSize, color: INK_SOFT });
    }
  }
  if (input.ufiCode) {
    y += metaSize + metaSize * (LINE - 1) * 0.6;
    items.push({ t: 'text', x: pad, y, s: `UFI: ${input.ufiCode}`, size: metaSize, mono: true, color: INK });
  }

  // ── Сгруппированный блок обязательных элементов ──────────────────────────
  // ⚠⚠ На широкой этикетке (4 × 2 in — самый ходовой формат в США) стопка не
  // работает: пиктограммы съедают всю высоту, а справа остаётся пустое поле.
  // Там пиктограммы уходят в левую рейку, а сигнальное слово и H-фразы встают
  // справа от неё. Ниже — обычная стопка.
  const groupTop = y + body * 0.7 + (c.showPics || c.showSignal || c.showH ? c.gapExtra : 0);
  const gPad = body * 0.5;
  const gLeft = pad + gPad;
  const gRight = W - pad - gPad;
  const gInner = gRight - gLeft;
  const picGap = c.picMm * 0.12;
  const codeW = body * 3.4;

  // ⚠ Число столбцов в рейке считается ОТ ВЫСОТЫ ЭТИКЕТКИ, а не берётся числом.
  // На 4 × 2 in две пиктограммы, поставленные друг под друга, дают рейку 47 мм
  // при высоте этикетки 50,8 — и содержимое перестаёт помещаться. Рейке отводится
  // не больше двух третей высоты, остальное добирается столбцами.
  const maxRailRows = Math.max(1, Math.floor((c.H * 0.66 + picGap) / (c.picMm + picGap)));
  const railCols = Math.max(1, Math.ceil(c.pics.length / maxRailRows));
  const railW = c.showPics ? railCols * c.picMm + (railCols - 1) * picGap : 0;
  // Рейка возможна, только если текстовой колонке остаётся на что жить.
  const canTwoCol = c.showPics && gInner - railW - picGap * 2 >= Math.max(34, gInner * 0.4);
  const twoCol = canTwoCol && c.preferTwoCol;

  const textLeft = twoCol ? gLeft + railW + picGap * 2 : gLeft;
  const textWidth = twoCol ? gRight - textLeft : gInner;

  const contentTop = groupTop + body * 0.6;
  let gy = contentTop;      // курсор текстовой колонки
  let railBottom = contentTop;

  if (c.showPics) {
    const perRow = twoCol
      ? railCols
      : Math.max(1, Math.floor((gInner + picGap) / (c.picMm + picGap)));
    let rowTop = contentTop;
    let rowBottom = contentTop;
    c.pics.forEach((p, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) rowTop = rowBottom + picGap;
      const px = gLeft + col * (c.picMm + picGap);
      items.push({ t: 'svg', x: px, y: rowTop, size: c.picMm, svg: p.svg, code: p.code });
      rowBottom = Math.max(rowBottom, rowTop + c.picMm);
    });
    railBottom = rowBottom;
    if (!twoCol) gy = rowBottom;
  }

  // Сигнальное слово — крупно, своим цветом, на своей строке.
  if (c.showSignal && input.signalWord) {
    // Сигнальное слово крупнее основного текста ровно вдвое, но не шире колонки.
    const sw = Math.min(body * 2.1, textWidth / (input.signalWord.length * CW_BOLD));
    gy += body * 0.5 + sw;
    items.push({
      t: 'text', x: textLeft, y: gy, s: input.signalWord.toUpperCase(),
      size: sw, bold: true, color: signalColor(input.signalWord),
    });
    if (input.second?.signalWord) {
      gy += sw * 0.95;
      items.push({
        t: 'text', x: textLeft, y: gy, s: input.second.signalWord.toUpperCase(),
        size: sw * 0.82, bold: true, color: signalColor(input.second.signalWord),
      });
    }
  }

  // H-фразы.
  if (c.showH) {
    gy += body * 0.6;
    for (const h of input.hStatements) {
      gy += lh;
      items.push({ t: 'text', x: textLeft, y: gy, s: h.code, size: body, bold: true, color: INK });
      const lines = wrap(h.text, charsPerLine(textWidth - codeW, body));
      lines.forEach((ln, i) => {
        items.push({ t: 'text', x: textLeft + codeW, y: gy + i * lh, s: ln, size: body, color: INK });
      });
      gy += (lines.length - 1) * lh;
      // Второй язык — сразу под фразой, тем же кеглем, но приглушённо, чтобы
      // читатель видел пару, а не два независимых списка.
      const alt = input.second?.hStatements.find((x) => x.code === h.code);
      if (alt) {
        const altLines = wrap(alt.text, charsPerLine(textWidth - codeW, body));
        altLines.forEach((ln, i) => {
          items.push({ t: 'text', x: textLeft + codeW, y: gy + (i + 1) * lh, s: ln, size: body, italic: true, color: INK_SOFT });
        });
        gy += altLines.length * lh;
      }
    }
  }

  const hasGroup = c.showPics || c.showSignal || c.showH;
  const groupBottom = hasGroup ? Math.max(gy, railBottom) + gPad : groupTop;

  // Рамка группы обводит обязательные элементы. Заливки у неё нет, поэтому
  // порядок относительно текста роли не играет — обводка ничего не перекрывает.
  const groupFrame: DrawRect[] = hasGroup
    ? [{
        t: 'rect', x: pad - body * 0.15, y: groupTop,
        w: inner + body * 0.3, h: groupBottom - groupTop,
        stroke: '#e5e7eb', strokeW: Math.max(0.15, body * 0.06), radius: body * 0.3,
      }]
    : [];

  y = groupBottom;

  // ── P-фразы ───────────────────────────────────────────────────────────────
  if (c.showP) {
    sections++;
    y += body * 0.7 + secSize + c.gapExtra;
    items.push({ t: 'text', x: pad, y, s: 'PRECAUTIONARY', size: secSize, bold: true, color: INK_FAINT });
    if (input.pFormat === 'combined' && input.combinedPText) {
      for (const ln of wrap(input.combinedPText, charsPerLine(inner, body))) {
        y += lh;
        items.push({ t: 'text', x: pad, y, s: ln, size: body, color: INK });
      }
      if (input.second?.combinedPText) {
        for (const ln of wrap(input.second.combinedPText, charsPerLine(inner, body))) {
          y += lh;
          items.push({ t: 'text', x: pad, y, s: ln, size: body, italic: true, color: INK_SOFT });
        }
      }
    } else {
      /**
       * ⚠ На широкой этикетке P-фразы идут В ДВЕ КОЛОНКИ. Строка во всю ширину
       * 100-миллиметровой этикетки — это под сотню знаков, и глаз теряет начало
       * следующей строки. Полиграфическая норма — 45–75 знаков в строке.
       */
      const colGapP = body * 2;
      const colWP = (inner - colGapP) / 2;
      // ⚠ Решает не ширина в миллиметрах, а СКОЛЬКО ЗНАКОВ влезает в строку.
      // На листе Letter кегль вырастает до 8 мм, и в колонку помещается 18
      // знаков — это столбик из обрывков, а не текст. Ниже тридцати знаков
      // колонки не делим.
      const MIN_CHARS_PER_COLUMN = 30;
      const twoColP = input.pStatements.length >= 3
        && charsPerLine(colWP - codeW, body) >= MIN_CHARS_PER_COLUMN;
      const width = twoColP ? colWP : inner;
      const chars = charsPerLine(width - codeW, body);

      /** Одна фраза со своими строками — и своим переводом, если он есть. */
      const blocks = input.pStatements.map((p) => {
        const lines = wrap(p.text, chars);
        const alt = input.second?.pStatements.find((x) => x.code === p.code);
        const altLines = alt ? wrap(alt.text, chars) : [];
        return { p, lines, altLines, rows: lines.length + altLines.length };
      });

      const drawBlock = (b: (typeof blocks)[number], x0: number, startY: number): number => {
        let yy = startY + lh;
        items.push({ t: 'text', x: x0, y: yy, s: b.p.code, size: body, bold: true, color: INK });
        b.lines.forEach((ln, i) => {
          items.push({ t: 'text', x: x0 + codeW, y: yy + i * lh, s: ln, size: body, color: INK });
        });
        yy += (b.lines.length - 1) * lh;
        b.altLines.forEach((ln, i) => {
          items.push({ t: 'text', x: x0 + codeW, y: yy + (i + 1) * lh, s: ln, size: body, italic: true, color: INK_SOFT });
        });
        return yy + b.altLines.length * lh;
      };

      if (twoColP) {
        // ⚠ Колонки балансируются по ЧИСЛУ СТРОК, а не по числу фраз: одна
        // трёхстрочная фраза весит столько же, сколько три однострочных.
        const total = blocks.reduce((n, b) => n + b.rows, 0);
        const left: typeof blocks = [];
        const right: typeof blocks = [];
        let acc = 0;
        for (const b of blocks) {
          if (acc + b.rows / 2 <= total / 2) { left.push(b); acc += b.rows; }
          else right.push(b);
        }
        let yl = y;
        for (const b of left) yl = drawBlock(b, pad, yl);
        let yr = y;
        for (const b of right) yr = drawBlock(b, pad + colWP + colGapP, yr);
        y = Math.max(yl, yr);
      } else {
        for (const b of blocks) y = drawBlock(b, pad, y);
      }
    }
    if (input.hiddenPCount && input.hiddenPCount > 0) {
      y += lh;
      items.push({ t: 'text', x: pad, y, s: `+${input.hiddenPCount} more — see SDS`, size: metaSize, color: WARNING });
    }
  }

  // ── Служебные строки ─────────────────────────────────────────────────────
  if ((input.notes ?? []).length) { sections++; y += c.gapExtra; }
  for (const note of input.notes ?? []) {
    for (const ln of wrap(note, charsPerLine(inner, metaSize))) {
      y += metaSize * LINE;
      items.push({ t: 'text', x: pad, y, s: ln, size: metaSize, bold: true, color: INK });
    }
  }

  // ── Поставщик ────────────────────────────────────────────────────────────
  if (c.showSupplier) {
    const sup = [input.supplier?.name, input.supplier?.address, input.supplier?.phone].filter(Boolean).join('  ·  ');
    if (sup) {
      sections++;
      y += body * 0.7 + c.gapExtra;
      items.push({ t: 'line', x1: pad, y1: y, x2: W - pad, y2: y, stroke: RULE, strokeW: 0.2, dash: body * 0.5 });
      let textX = pad;
      let logoBottom = y;
      if (input.logo?.dataUrl) {
        const aspect = input.logo.aspect > 0 ? input.logo.aspect : 1;
        let lh2 = Math.min(body * 3.2, c.H * 0.14);
        let lw = lh2 * aspect;
        const maxLw = inner * 0.32;
        if (lw > maxLw) { lw = maxLw; lh2 = lw / aspect; }
        items.push({ t: 'image', x: pad, y: y + body * 0.4, w: lw, h: lh2, href: input.logo.dataUrl });
        logoBottom = y + body * 0.4 + lh2;
        textX = pad + lw + body;
      }
      const supW = W - pad - textX;
      let sy = y + body * 0.4 + metaSize;
      for (const ln of wrap(sup, charsPerLine(supW, metaSize))) {
        items.push({ t: 'text', x: textX, y: sy, s: ln, size: metaSize, color: INK_SOFT });
        sy += metaSize * LINE;
      }
      y = Math.max(logoBottom, sy - metaSize * LINE);
    }
  }

  if (c.showPics || c.showSignal || c.showH) sections++;
  return { items: [...groupFrame, ...items], height: y + pad, sections };
}

// ── Проверка соответствия ───────────────────────────────────────────────────
/**
 * Чего не хватает на этикетке по правилам выбранной юрисдикции. Это отдельная
 * ценность инструмента: генераторы конкурентов молча печатают что дали.
 */
export function checkCompliance(input: LabelInput, opt: LabelOptions): ComplianceIssue[] {
  const j = JURISDICTIONS[opt.jurisdiction];
  const out: ComplianceIssue[] = [];
  const required = elementsFor(j, opt.purpose, opt.containerMl);

  const has: Record<LabelElement, boolean> = {
    productIdentifier: !!input.productName?.trim(),
    signalWord: !!input.signalWord,
    hazardStatements: input.hStatements.length > 0,
    pictograms: input.pictograms.some((p) => p.svg?.trim()),
    precautionaryStatements: input.pStatements.length > 0 || !!input.combinedPText,
    supplier: !!(input.supplier?.name?.trim() && input.supplier?.address?.trim() && input.supplier?.phone?.trim()),
    outerPackageNote: (input.notes ?? []).length > 0,
    sdsAvailableNote: (input.notes ?? []).length > 0,
  };

  const humanName: Record<LabelElement, string> = {
    productIdentifier: 'product identifier',
    signalWord: 'signal word',
    hazardStatements: 'hazard statements',
    pictograms: 'pictograms',
    precautionaryStatements: 'precautionary statements',
    supplier: 'supplier name, address and phone',
    outerPackageNote: 'statement that full label information is on the outer package',
    sdsAvailableNote: 'statement that a safety data sheet is available in the workplace',
  };

  for (const el of required) {
    // Отсутствие пиктограмм и сигнального слова — законная ситуация: у веществ
    // без классификации их и не должно быть. Ошибкой это назвать нельзя.
    if (!has[el]) {
      const soft = el === 'pictograms' || el === 'signalWord';
      out.push({
        level: soft ? 'info' : 'error',
        text: soft
          ? `No ${humanName[el]} — correct only if the substance is not classified for that hazard`
          : `Missing: ${humanName[el]}`,
        citation: el === 'supplier' && j.key === 'osha'
          ? '29 CFR 1910.1200(f)(1)(vi) — a U.S. address and U.S. phone number are required'
          : undefined,
      });
    }
  }

  if (j.requiredLanguages.length > 1 && !input.second) {
    out.push({
      level: 'error',
      text: `Both languages are required: ${j.requiredLanguages.join(' + ').toUpperCase()}. A unilingual supplier label is not valid.`,
      citation: 'HPR s. 6.2',
    });
  }

  if (j.requiresUfi && !input.ufiCode && opt.purpose === 'supplier') {
    out.push({
      level: 'warning',
      text: 'Mixtures subject to poison-centre notification need a UFI code on the label',
      citation: 'CLP Annex VIII',
    });
  }

  if (typeof opt.containerMl === 'number') {
    const rule = smallPackageRuleFor(j, opt.containerMl);
    if (rule && opt.purpose !== 'small') {
      out.push({ level: 'info', text: rule.note, citation: rule.citation });
    }
  }

  return out;
}

// ── Рендер в SVG ────────────────────────────────────────────────────────────

const FONT = "Arial, Helvetica, 'Helvetica Neue', sans-serif";
const FONT_MONO = "'Courier New', Courier, monospace";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Вставка пиктограммы: с корневого <svg> снимаются width/height/x/y и
 * preserveAspectRatio, потому что они там уже могут быть (у GHS01 — в пунктах),
 * и повторное объявление делает документ невалидным.
 */
function placePictogram(svgContent: string, x: number, y: number, size: number): string {
  const s = String(svgContent).trim();
  const m = s.match(/^<svg\b[^>]*>/i);
  if (!m) return '';
  const open = m[0]
    .replace(/\s(?:width|height|x|y|preserveAspectRatio)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(?:width|height|x|y|preserveAspectRatio)\s*=\s*'[^']*'/gi, '')
    .replace(/^<svg\b/i, `<svg x="${r(x)}" y="${r(y)}" width="${r(size)}" height="${r(size)}" preserveAspectRatio="xMidYMid meet"`);
  return open + s.slice(m[0].length);
}

function r(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

export function renderSvg(layout: LabelLayout): string {
  const parts: string[] = [];
  for (const it of layout.items) {
    switch (it.t) {
      case 'rect':
        parts.push(
          `<rect x="${r(it.x)}" y="${r(it.y)}" width="${r(it.w)}" height="${r(it.h)}"` +
          (it.radius ? ` rx="${r(it.radius)}"` : '') +
          ` fill="${it.fill ?? 'none'}"` +
          (it.stroke ? ` stroke="${it.stroke}" stroke-width="${r(it.strokeW ?? 0.2)}"` : '') +
          (it.dash ? ` stroke-dasharray="${r(it.dash)} ${r(it.dash)}"` : '') +
          `/>`
        );
        break;
      case 'line':
        parts.push(
          `<line x1="${r(it.x1)}" y1="${r(it.y1)}" x2="${r(it.x2)}" y2="${r(it.y2)}" stroke="${it.stroke}" stroke-width="${r(it.strokeW)}"` +
          (it.dash ? ` stroke-dasharray="${r(it.dash)} ${r(it.dash)}"` : '') + `/>`
        );
        break;
      case 'text':
        parts.push(
          `<text x="${r(it.x)}" y="${r(it.y)}" font-family="${it.mono ? FONT_MONO : FONT}"` +
          ` font-size="${r(it.size)}"` +
          (it.bold ? ' font-weight="700"' : '') +
          (it.italic ? ' font-style="italic"' : '') +
          (it.anchor === 'middle' ? ' text-anchor="middle"' : '') +
          ` fill="${it.color}">${esc(it.s)}</text>`
        );
        break;
      case 'svg':
        parts.push(placePictogram(it.svg, it.x, it.y, it.size));
        break;
      case 'image':
        parts.push(`<image x="${r(it.x)}" y="${r(it.y)}" width="${r(it.w)}" height="${r(it.h)}" preserveAspectRatio="xMidYMid meet" href="${it.href}"/>`);
        break;
    }
  }
  // ⚠ width/height в миллиметрах, viewBox в тех же единицах: файл открывается в
  // редакторе ровно того физического размера, что заказан.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r(layout.widthMm)}mm" height="${r(layout.heightMm)}mm"` +
    ` viewBox="0 0 ${r(layout.widthMm)} ${r(layout.heightMm)}" font-family="${FONT}">` +
    parts.join('') + `</svg>`
  );
}

// ── Скачивание ──────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadLabelSvg(layout: LabelLayout, filename: string) {
  triggerDownload(new Blob([renderSvg(layout)], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

/** Растеризация одной пиктограммы в PNG высокого разрешения — только для PDF. */
async function rasterisePictogram(svg: string, sizeMm: number, dpi = 600): Promise<string> {
  const px = Math.max(64, Math.round((sizeMm / 25.4) * dpi));
  const wrapped = svg.replace(/^<svg\b/i, `<svg width="${px}" height="${px}"`);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wrapped);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('pictogram render failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, px, px);
  return canvas.toDataURL('image/png');
}

/**
 * PDF ровно того физического размера, что и этикетка. Текст — нативный вектор
 * jsPDF, пиктограммы — PNG 600 dpi.
 *
 * ⚠ jsPDF ставит текст по базовой линии при `baseline: 'alphabetic'`, что
 * совпадает с координатой y в нашей раскладке. Менять базовую линию нельзя —
 * разъедется с превью.
 */
// ── Юникод в PDF ────────────────────────────────────────────────────────────
//
// ⚠⚠ СТАНДАРТНЫЕ ШРИФТЫ jsPDF КОДИРУЮТСЯ В WinAnsi (CP1252). Это западная
// латиница и больше ничего. Ломается НЕ ТОЛЬКО греческий и болгарский:
// польские «ą ż ł», чешские «ř č ě», венгерские «ő ű», румынские «ș ț»,
// латышские «ū ģ», мальтийские «ġ ħ» в CP1252 отсутствуют. По нашим 5 712
// переводам таких знаков 175 из 306 встречающихся.
//
// ⚠⚠ И ЛОМАЕТСЯ ОНО МОЛЧА. jsPDF не бросает исключение — он печатает мусор или
// пустоту, превью в SVG при этом остаётся правильным, потому что его рисует
// браузер своими шрифтами. То есть автор этикетки видит нормальный текст, а на
// бумагу выходит дырка. Поэтому шрифт подставляется автоматически, а не по
// галочке в интерфейсе.

/** Знак укладывается в CP1252 — то есть стандартный шрифт его напечатает. */
function isWinAnsi(s: string): boolean {
  // Диапазоны CP1252: ASCII, NBSP…ÿ и горстка знаков в 0x80–0x9F.
  const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) continue;
    if (c >= 0xa0 && c <= 0xff) continue;
    if (EXTRA.includes(ch)) continue;
    if (ch === '\n' || ch === '\t') continue;
    return false;
  }
  return true;
}

/** Нужен ли раскладке юникодный шрифт. */
export function layoutNeedsUnicodeFont(layout: LabelLayout): boolean {
  return layout.items.some((it) => it.t === 'text' && !isWinAnsi(it.s));
}

/**
 * Регистрирует Noto Sans в документе, если он нужен, и возвращает имя семейства.
 *
 * ⚠ Файл на 265 КБ грузится ДИНАМИЧЕСКИМ импортом и только при необходимости:
 * английская или французская этикетка его не выкачивает вовсе.
 *
 * ⚠ Курсива в наборе нет — «italic» отдаётся обычным начертанием. На этикетке
 * курсив не используется, а падать из-за незарегистрированного стиля нельзя.
 */
async function ensureUnicodeFont(pdf: any, layout: LabelLayout): Promise<string | null> {
  if (!layoutNeedsUnicodeFont(layout)) return null;
  const { NOTO_SANS_REGULAR_B64, NOTO_SANS_BOLD_B64 } = await import('./fonts/notoSansSubset');
  pdf.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_B64);
  pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  pdf.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_B64);
  pdf.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'italic');
  return 'NotoSans';
}

export async function downloadLabelPdf(layout: LabelLayout, filename: string) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    unit: 'mm',
    format: [layout.widthMm, layout.heightMm],
    orientation: layout.heightMm >= layout.widthMm ? 'portrait' : 'landscape',
  });
  const uni = await ensureUnicodeFont(pdf, layout);
  await drawLayoutToPdf(pdf, layout, 0, 0, uni);
  pdf.save(filename);
}

/**
 * Отрисовка раскладки в уже созданный документ со сдвигом — нужна для N-up.
 *
 * ⚠ `uniFont` применяется КО ВСЕМУ тексту сразу, а не только к строкам со
 * знаками вне CP1252. Смешивать Helvetica и Noto Sans на одной этикетке нельзя:
 * английская строка и её французский перевод встали бы разными шрифтами, и
 * этикетка выглядела бы собранной из двух разных документов.
 */
export async function drawLayoutToPdf(
  pdf: any, layout: LabelLayout, dx: number, dy: number, uniFont?: string | null,
) {
  const PT_PER_MM = 72 / 25.4;
  for (const it of layout.items) {
    switch (it.t) {
      case 'rect': {
        if (it.fill) {
          pdf.setFillColor(it.fill);
        }
        if (it.stroke) {
          pdf.setDrawColor(it.stroke);
          pdf.setLineWidth(it.strokeW ?? 0.2);
        }
        const style = it.fill && it.stroke ? 'FD' : it.fill ? 'F' : 'S';
        if (it.radius) pdf.roundedRect(dx + it.x, dy + it.y, it.w, it.h, it.radius, it.radius, style);
        else pdf.rect(dx + it.x, dy + it.y, it.w, it.h, style);
        break;
      }
      case 'line':
        pdf.setDrawColor(it.stroke);
        pdf.setLineWidth(it.strokeW);
        if (it.dash) pdf.setLineDashPattern([it.dash, it.dash], 0);
        pdf.line(dx + it.x1, dy + it.y1, dx + it.x2, dy + it.y2);
        if (it.dash) pdf.setLineDashPattern([], 0);
        break;
      case 'text': {
        // ⚠ Моноширинные строки (коды H/P, партия, UFI) остаются на courier: там
        // только ASCII, и юникодного начертания у нас моноширинного нет.
        const family = it.mono ? 'courier' : (uniFont ?? 'helvetica');
        pdf.setFont(family, it.bold ? 'bold' : it.italic ? 'italic' : 'normal');
        // Кегль в jsPDF задаётся в пунктах, а раскладка считает в миллиметрах.
        pdf.setFontSize(it.size * PT_PER_MM);
        pdf.setTextColor(it.color);
        pdf.text(it.s, dx + it.x, dy + it.y, it.anchor === 'middle' ? { align: 'center' } : undefined);
        break;
      }
      case 'svg': {
        const png = await rasterisePictogram(it.svg, it.size);
        pdf.addImage(png, 'PNG', dx + it.x, dy + it.y, it.size, it.size);
        break;
      }
      case 'image':
        pdf.addImage(it.href, dx + it.x, dy + it.y, it.w, it.h);
        break;
    }
  }
}

/**
 * Лист с раскладкой N-up: одна и та же этикетка сеткой на A4 или Letter.
 * ⚠ Поля листа не выдумываются: сетка центрируется по фактическому остатку, а
 * межэтикеточный зазор берётся нулевым — именно так нарезаны листы Avery и
 * OnlineLabels. Если у пачки зазор есть, пользователь печатает по одной.
 */
export async function downloadLabelSheetPdf(
  layout: LabelLayout,
  sheet: { widthMm: number; heightMm: number; name: string },
  filename: string,
): Promise<{ cols: number; rows: number; perSheet: number }> {
  const { jsPDF } = await import('jspdf');
  const cols = Math.max(1, Math.floor(sheet.widthMm / layout.widthMm));
  const rows = Math.max(1, Math.floor(sheet.heightMm / layout.heightMm));
  const marginX = (sheet.widthMm - cols * layout.widthMm) / 2;
  const marginY = (sheet.heightMm - rows * layout.heightMm) / 2;
  const pdf = new jsPDF({
    unit: 'mm',
    format: [sheet.widthMm, sheet.heightMm],
    orientation: sheet.heightMm >= sheet.widthMm ? 'portrait' : 'landscape',
  });
  // ⚠ Шрифт регистрируется ОДИН раз на документ, а не на каждую этикетку сетки:
  // иначе на листе из тридцати штук файл распухнет на тридцать копий шрифта.
  const uni = await ensureUnicodeFont(pdf, layout);
  for (let r0 = 0; r0 < rows; r0++) {
    for (let c0 = 0; c0 < cols; c0++) {
      await drawLayoutToPdf(pdf, layout, marginX + c0 * layout.widthMm, marginY + r0 * layout.heightMm, uni);
    }
  }
  pdf.save(filename);
  return { cols, rows, perSheet: cols * rows };
}
