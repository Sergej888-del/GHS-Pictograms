/**
 * scripts/check-label-width.ts — НИ ОДНА СТРОКА НЕ ВЫЛЕЗАЕТ ЗА КРАЙ ЭТИКЕТКИ.
 *
 * Запуск (сборка и сеть не нужны, база не нужна):
 *   npm run check:label-width
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ЗАЧЕМ ОНА. До session 64 движок считал переносы по ОДНОЙ средней ширине
 * знака (`CW_REGULAR = 0.52`) на все 24 языка. Замер показал, что этого мало
 * ровно там, где ошибиться нельзя: аварийные фразы набраны ПРОПИСНЫМИ —
 * «IF SWALLOWED:», «ПРИ ПОГЛЪЩАНЕ:», «W PRZYPADKU DOSTANIA SIĘ DO DRÓG
 * ODDECHOWYCH:» — а прописные шире строчных в полтора раза.
 *
 * Прогон старого движка на этих фразах: **14 строк за краем этикетки**,
 * худшая — польская, на 12,26 мм за правым краем 99-миллиметровой этикетки.
 * После правки — ноль. Эта проверка держит ноль.
 *
 * ⚠⚠ ТЕКСТЫ ИЗ БАЗЫ, А НЕ ПРИДУМАНЫ. Для каждого из 24 языков взята его
 * САМАЯ ШИРОКАЯ переносимая фраза (по замеру em на знак среди фраз длиннее
 * 40 знаков). Придуманная строка такого класса дефектов не ловит: он живёт
 * в настоящих прописных настоящих переводов.
 *
 * ⚠ Меряется тем же `textWidthMm`, каким движок считает переносы. Своя формула
 * подтверждала бы не то, что печатается, — урок session 48.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { layoutLabel, textWidthMm, type LabelInput } from '../src/lib/labelEngine.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/label-width.json', import.meta.url), 'utf8'));
const WORST: [string, string, string, string | null][] = fx.worst;

/** Ходовые размеры: от самой мелкой до листовой. */
const SIZES: [number, number, string][] = [
  [52, 30, '52×30'],
  [70, 40, '70×40'],
  [99.06, 60, '99×60'],
  [148, 105, '148×105'],
];

function inputFor(code: string, text: string, signal: string | null): LabelInput {
  return {
    productName: 'Nitrobenzene',
    casNumber: '98-95-3',
    signalWord: signal,
    signalLevel: 'danger',
    pictograms: [],
    hStatements: [],
    pStatements: [{ code, text }],
    pFormat: 'codes',
    supplier: { name: 'Acme Chemicals GmbH', address: 'Industriestrasse 14, 60311 Frankfurt am Main' },
  };
}

let failed = 0;
let checked = 0;

for (const [lang, code, text, signal] of WORST) {
  for (const [w, h, size] of SIZES) {
    const layout = layoutLabel(inputFor(code, text, signal), {
      jurisdiction: 'clp', purpose: 'supplier', widthMm: w, heightMm: h,
    });
    for (const it of layout.items as any[]) {
      if (it.t !== 'text' || !it.s) continue;
      checked++;
      const kind = it.mono ? 'mono' : it.bold ? 'bold' : 'regular';
      const right = it.x + textWidthMm(it.s, it.size, kind);
      if (right > w + 1e-9) {
        failed++;
        console.log(`  ⛔ ${lang} ${size}: за краем на ${(right - w).toFixed(2)} мм — «${it.s.slice(0, 60)}»`);
      }
    }
  }
}

console.log(
  failed
    ? `\n⛔ строк за краем: ${failed} из ${checked} проверенных`
    : `\n✅ ни одна из ${checked} строк не вышла за край (24 языка × ${SIZES.length} размера)`,
);
process.exit(failed ? 1 : 0);
