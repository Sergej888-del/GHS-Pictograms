/**
 * scripts/check-label-width.ts — НИ ОДНА СТРОКА НЕ ВЫЛЕЗАЕТ ЗА КРАЙ ЭТИКЕТКИ.
 *
 * Запуск (сборка и сеть не нужны, база не нужна):
 *   node --experimental-strip-types scripts/check-label-width.ts
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

/**
 * ⭐⭐ РУЧНАЯ ПОПРАВКА КЕГЛЯ НЕ ЛОМАЕТ ГРАНИЦУ И НЕ ОБХОДИТ ПОЛ.
 *
 * ⚠ Ползунок трогает единственное число, от которого зависит вся раскладка.
 * Проверять его надо тем же утверждением, что и всё остальное: текст обязан
 * остаться внутри ширины при ЛЮБОМ значении, включая заведомо дикие.
 *
 * ⚠⚠ И отдельно — что нижняя граница НЕ обходится. `MIN_BODY_MM` — наш порог
 * читаемости, а не норма регламента (CLP числового минимума кегля не задаёт,
 * ст. 31(3) требование качественное). Именно поэтому он должен держаться
 * кодом: настройка, которая позволяет напечатать нечитаемую этикетку, хуже
 * отсутствия настройки.
 */
console.log('\nручная поправка кегля:');
let scaleFailed = 0;
let scaleChecked = 0;
const MIN_BODY_MM = 1.4;
const BODY_CEILING = 24;
for (const [lang, code, text, signal] of WORST.slice(0, 8)) {
  for (const [w, h] of SIZES) {
    for (const s of [0.1, 0.5, 0.9, 1, 1.2, 2, 10]) {
      const l = layoutLabel(inputFor(code, text, signal), {
        jurisdiction: 'clp', purpose: 'supplier', widthMm: w, heightMm: h, bodyScale: s,
      });
      scaleChecked++;
      if (l.fit.bodyMm < MIN_BODY_MM - 1e-9) {
        scaleFailed++; console.log(`  ⛔ ${lang} ${w}×${h} ×${s}: кегль ${l.fit.bodyMm} мм — ниже пола ${MIN_BODY_MM}`);
      }
      if (l.fit.bodyMm > BODY_CEILING + 1e-9) {
        scaleFailed++; console.log(`  ⛔ ${lang} ${w}×${h} ×${s}: кегль ${l.fit.bodyMm} мм — выше потолка ${BODY_CEILING}`);
      }
      for (const it of l.items as any[]) {
        if (it.t !== 'text' || !it.s) continue;
        const kind = it.mono ? 'mono' : it.bold ? 'bold' : 'regular';
        if (it.x + textWidthMm(it.s, it.size, kind) > w + 1e-9) {
          scaleFailed++;
          console.log(`  ⛔ ${lang} ${w}×${h} ×${s}: за краем — «${it.s.slice(0, 50)}»`);
          break;
        }
      }
    }
  }
}
/** ⚠ Обещанный запас обязан быть правдой: на нём этикетка ещё влезает. */
for (const [w, h] of SIZES) {
  const opt = { jurisdiction: 'clp' as const, purpose: 'supplier' as const, widthMm: w, heightMm: h };
  const base = layoutLabel(inputFor('P280', 'Wear protective gloves.', 'Danger'), opt);
  const cap = base.fit.maxFittingBodyMm;
  if (cap == null) continue;
  scaleChecked++;
  const at = layoutLabel(inputFor('P280', 'Wear protective gloves.', 'Danger'), { ...opt, bodyScale: cap / base.fit.autoBodyMm });
  if (!at.fit.fits) {
    scaleFailed++;
    console.log(`  ⛔ ${w}×${h}: обещан запас до ${cap} мм, а на нём этикетка уже не влезает`);
  }
}
console.log(
  scaleFailed
    ? `⛔ провалов поправки: ${scaleFailed} из ${scaleChecked}`
    : `✅ ${scaleChecked} прогонов поправки: пол и потолок держатся, текст внутри, обещанный запас правдив`,
);

process.exit(failed + scaleFailed ? 1 : 0);
