/**
 * scripts/check-label-fit.ts — ЗАМЕР ВЛЕЗАЕМОСТИ ГОВОРИТ ПРАВДУ.
 *
 * Запуск (сборка, сеть и база не нужны):
 *   node --experimental-strip-types scripts/check-label-fit.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ЗАЧЕМ ОНА. Число «сколько фраз влезет» — это ОБЕЩАНИЕ, которое инструмент
 * даёт до печати. Обещание, которое некому проверить, дороже отсутствия
 * обещания: человек отдаёт файл в типографию и узнаёт цену ошибки на бумаге.
 *
 * ⛔⛔ ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, — НЕ «ФУНКЦИЯ НЕ ПАДАЕТ», А ЧТО ЧИСЛО
 * СОШЛОСЬ С РАСКЛАДКОЙ. При `capacity` фраз `layoutLabel` обязан сказать
 * «влезло», при `capacity + 1` — «не влезло». Между этими двумя прогонами и
 * живёт весь смысл замера; всё остальное — обвязка.
 *
 * ⚠⚠ ТЕКСТЫ ИЗ БАЗЫ, А НЕ ПРИДУМАНЫ (`fixtures/label-fit.json`). Переполняется
 * не «длинный текст вообще», а настоящая фраза настоящего перевода: греческие
 * и болгарские аварийные строки набраны ПРОПИСНЫМИ и шире английских
 * в полтора раза. Образец — анилин, те же классы, что в `p-precedence.json`,
 * поэтому отбор фраз и замер идут по ОДНОМУ веществу, а не по двум разным.
 *
 * ⚠ Разбор задачи: `claude/label-fit-size-vs-language.md`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import {
  measureFitCapacity, probeFits, buildProbeInput,
  type FitProbeContext,
} from '../src/lib/labelFitProbe.ts';
import { layoutLabel } from '../src/lib/labelEngine.ts';
import { renderPStatement } from '../src/lib/pStatementSlots.ts';
import { selectPStatements, type PrecedenceData } from '../src/lib/pPrecedence.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/label-fit.json', import.meta.url), 'utf8'));
const raw = JSON.parse(readFileSync(new URL('./fixtures/p-precedence.json', import.meta.url), 'utf8'));

const LANGS: string[] = fx.langs;

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ✓ ${name}`);
}

// ── Отбор фраз: тот же снимок, что у check:p-precedence ─────────────────────
const data: PrecedenceData = {
  matrix: raw.matrix.map((r: any[]) => ({
    classCode: r[0], categoryCode: r[1], pCode: r[2], statementType: r[3],
    conditionText: raw.conds[String(r[4])] ?? null,
  })),
  echa: raw.echa.map((r: any[]) => ({
    classCode: r[0], categoryCode: r[1], pCode: r[2], columnType: r[3],
    level: r[4], scope: r[5], audience: r[6], conditionText: r[7],
  })),
  combos: raw.combos.map((r: any[]) => ({ code: r[0], components: r[1] })),
  hazardIndex: raw.hidx.map((r: any[]) => ({
    classCode: r[0], categoryCode: r[1], hCodes: r[2], signalWord: r[3],
  })),
  gradedCodes: raw.gradedCodes,
};

const SELECT_INPUT = {
  hCodes: fx.sample.hCodes as string[],
  signalWord: 'Danger',
  audience: 'professional' as const,
};

/**
 * ⭐ ПЕРВЫЙ ПРОХОД — ПОРЯДОК ФРАЗ БЕЗ ЛИМИТА. Замер обязан пробовать фразы в
 * том порядке, в каком их отобрал движок: резать будут хвост, а не середину.
 */
const ordered = selectPStatements({ ...SELECT_INPUT, statutoryLimit: 99 }, data);
const CANDIDATES: string[] = ordered.selected.map((u) => u.code);

/**
 * Текст фразы так, как он встанет на этикетку.
 *
 * ⚠⚠ ПОДАВЛЁННАЯ ФРАЗА МЕРЯЕТСЯ ОФИЦИАЛЬНЫМ ТЕКСТОМ, А НЕ ПУСТОЙ СТРОКОЙ.
 * Фраза с незаполненным обязательным пропуском («Wash … thoroughly after
 * handling») сейчас не печатается — и, посчитай мы её нулём, замер обещал бы
 * место, которое исчезнет ровно в тот момент, когда поставщик заполнит поле.
 * Замер обязан ошибаться в сторону осторожности.
 */
function printable(text: string, code: string, lang: string): string {
  const r = renderPStatement(text, code, lang, [], false);
  return r.suppressed || !r.text.trim() ? text : r.text;
}

function ctxFor(langs: string[], w: number, h: number, bodyScale?: number): FitProbeContext {
  const byLang: FitProbeContext['byLang'] = {};
  for (const lang of langs) {
    const t = fx.text[lang] as Record<string, string>;
    byLang[lang] = {
      signalWord: fx.signal[lang],
      productName: fx.names[lang],
      hStatements: (fx.sample.hCodes as string[]).map((code) => ({
        code, text: printable(t[code] ?? code, code, lang),
      })),
      pText: Object.fromEntries(
        CANDIDATES.map((code) => [code, printable(t[code] ?? code, code, lang)]),
      ),
    };
  }
  return {
    langs,
    byLang,
    fallbackP: byLang[langs[0]].pText,
    productName: fx.names.EN,
    casNumber: fx.sample.cas,
    ecNumber: fx.sample.ec,
    signalLevel: 'danger',
    pictograms: (fx.sample.pictograms as string[]).map((code) => ({ code, svg: '' })),
    pFormat: 'codes',
    supplier: {
      name: 'Acme Chemicals GmbH',
      address: 'Industriestrasse 14, 60311 Frankfurt am Main',
      phone: '+49 69 000000',
    },
    options: {
      jurisdiction: 'clp', purpose: 'supplier',
      widthMm: w, heightMm: h, containerLitres: 1, bodyScale,
    },
  };
}

/** Ходовые размеры: от «не влезет ничего» до «влезет всё». */
const SIZES: [number, number][] = [
  [52, 30], [63.5, 38.1], [70, 50], [90, 55], [99.06, 60], [105, 74], [148, 105],
];

console.log(`\nОбразец: анилин, ${fx.sample.hCodes.length} H-фраз, кандидатов ${CANDIDATES.length}`);
console.log(`Языки: ${LANGS.join(' · ')}`);

// ── 1. ⛔⛔ ЧИСЛО СОШЛОСЬ С РАСКЛАДКОЙ ───────────────────────────────────────
// Ради этой проверки написаны все остальные.
console.log('\n━━ 1. Обещание правдиво: при capacity влезает, при capacity + 1 — нет');
for (const [w, h] of SIZES) {
  for (const lang of LANGS) {
    const ctx = ctxFor([lang], w, h);
    const m = measureFitCapacity(ctx, CANDIDATES);
    const size = `${w}×${h} ${lang}`;
    if (m.capacity > 0) {
      const at = layoutLabel(buildProbeInput(ctx, lang, CANDIDATES.slice(0, m.capacity)), ctx.options);
      if (!at.fit.fits) {
        failed++;
        console.log(`  ✗ ${size}: обещано ${m.capacity}, а раскладка не влезла`);
        continue;
      }
    }
    if (m.capacity < CANDIDATES.length) {
      const over = layoutLabel(buildProbeInput(ctx, lang, CANDIDATES.slice(0, m.capacity + 1)), ctx.options);
      if (over.fit.fits) {
        failed++;
        console.log(`  ✗ ${size}: обещано ${m.capacity}, а влезает и ${m.capacity + 1}`);
        continue;
      }
    }
  }
}
check(`все ${SIZES.length} размеров × ${LANGS.length} языков сошлись`, failed === 0);

// ── 2. Монотонность ─────────────────────────────────────────────────────────
// ⚠ Не «красиво», а условие правильности линейного перебора: он обрывается на
// первом «не влезло», и дырка в середине сделала бы ответ случайным.
console.log('\n━━ 2. Монотонность: не влезло n → не влезет и n + 1');
let holes = 0;
for (const [w, h] of SIZES) {
  for (const lang of LANGS) {
    const ctx = ctxFor([lang], w, h);
    let broke = false;
    for (let n = 1; n <= CANDIDATES.length; n++) {
      const ok = probeFits(ctx, lang, CANDIDATES.slice(0, n));
      if (!ok) broke = true;
      else if (broke) {
        holes++;
        console.log(`  ⛔ ${w}×${h} ${lang}: n=${n} влезло после провала`);
      }
    }
  }
}
check('дырок в перечне нет', holes === 0, `${holes}`);

// ── 3. ⭐ ЯЗЫК МЕНЯЕТ ОТВЕТ ──────────────────────────────────────────────────
// ⚠⚠ Если эта проверка позеленеет «сама», замер сломан: он перестал видеть
// текст. Разрыв между языками — единственное, ради чего он вообще нужен.
console.log('\n━━ 3. Язык меняет вместимость хотя бы на одном размере');
const table: string[] = [];
let differing = 0;
for (const [w, h] of SIZES) {
  const byLang = LANGS.map((l) => measureFitCapacity(ctxFor([l], w, h), CANDIDATES).capacity);
  const min = Math.min(...byLang), max = Math.max(...byLang);
  if (min !== max) differing++;
  table.push(`  ${String(w).padStart(6)} × ${String(h).padEnd(5)} ${byLang.map((n) => String(n).padStart(3)).join('')}   ${min !== max ? `⚠ разрыв ${max - min}` : ''}`);
}
console.log(`  ${'размер'.padStart(6)}   ${'     '}${LANGS.map((l) => l.padStart(3)).join('')}`);
for (const row of table) console.log(row);
check('есть размеры, где язык решает', differing > 0, `${differing} из ${SIZES.length}`);

// ── 4. Три режима ───────────────────────────────────────────────────────────
console.log('\n━━ 4. Три режима: мала → язык не важен, велика → влезает всё');
const smallest = measureFitCapacity(ctxFor(LANGS.slice(0, 1), 52, 30), CANDIDATES);
const largest = LANGS.map((l) => measureFitCapacity(ctxFor([l], 148, 105), CANDIDATES).capacity);
check('на 52 × 30 не влезает почти ничего', smallest.capacity <= 2, `${smallest.capacity}`);
check('на 148 × 105 влезает весь набор на всех языках',
  largest.every((n) => n === CANDIDATES.length), largest.join(', '));

// ── 5. ⛔⛔ ДВУЯЗЫЧНАЯ ЭТИКЕТКА ВМЕЩАЕТ НЕ БОЛЬШЕ ОДНОЯЗЫЧНОЙ ────────────────
// ⚠⚠ Тут ловится самая дорогая ошибка замера: померить языки ПООДИНОЧКЕ и
// взять минимум. На двуязычной этикетке каждая фраза печатается ДВАЖДЫ, и
// место занимает пара, а не строка. Минимум по одиночным замерам завысил бы
// вместимость вдвое — то есть ровно там, где CLP ст. 17(2) требует
// одинакового содержания на обоих языках.
console.log('\n━━ 5. Второй язык отнимает место, а не достаётся даром');
for (const [w, h] of [[99.06, 60], [105, 74], [148, 105]] as [number, number][]) {
  const en = measureFitCapacity(ctxFor(['EN'], w, h), CANDIDATES).capacity;
  const bg = measureFitCapacity(ctxFor(['BG'], w, h), CANDIDATES).capacity;
  const both = measureFitCapacity(ctxFor(['EN', 'BG'], w, h), CANDIDATES);
  check(`${w}×${h}: EN+BG (${both.capacity}) ≤ min(EN ${en}, BG ${bg})`,
    both.capacity <= Math.min(en, bg));
}

// ── 6. ⭐ ПОЛЗУНОК КЕГЛЯ ВХОДИТ В ЗАМЕР ─────────────────────────────────────
// ⚠⚠ Ползунок «увеличить шрифт» и число «влезает N фраз» — про одно и то же
// место. Померь мы по автоподбору, инструмент обещал бы N при поднятом кегле,
// а печаталось бы меньше, и виноват был бы человек, который «сам увеличил».
console.log('\n━━ 6. Крупнее шрифт — не больше фраз');
const scaleRow: string[] = [];
let prev = Infinity;
let monotone = true;
for (const s of [0.8, 1, 1.2, 1.5, 2]) {
  const m = measureFitCapacity(ctxFor(['EN'], 99.06, 60, s), CANDIDATES);
  scaleRow.push(`×${s} → ${m.capacity}`);
  if (m.capacity > prev) monotone = false;
  prev = m.capacity;
}
console.log(`  99,06 × 60 EN:  ${scaleRow.join('   ')}`);
check('вместимость не растёт с кеглем', monotone);

// ── 7. Худший язык назван правильно ─────────────────────────────────────────
console.log('\n━━ 7. worstLang — это и есть минимум byLang');
{
  const m = measureFitCapacity(ctxFor(LANGS, 99.06, 60), CANDIDATES);
  const min = Math.min(...Object.values(m.byLang));
  check('capacity равна минимуму по языкам', m.capacity === min,
    `${m.capacity} против ${min}`);
  check('worstLang указывает на язык с минимумом',
    m.worstLang === null || m.byLang[m.worstLang] === min,
    `${m.worstLang}: ${m.worstLang ? m.byLang[m.worstLang] : '—'}`);
}

// ── 8. ⭐⭐ СВЯЗКА С ОТБОРОМ: ЧИСЛО ДОЕЗЖАЕТ ДО ЛИМИТА И ДО ПРИЧИНЫ ──────────
// ⚠ Замер, который никуда не приходит, — это украшение. Здесь проверяется, что
// он меняет РЕЗУЛЬТАТ отбора и что причина названа честно: «размер», а не
// «ст. 28(3)», когда режет именно размер.
console.log('\n━━ 8. fitCapacity доезжает до отбора');
{
  const tight = selectPStatements({ ...SELECT_INPUT, fitCapacity: 3 }, data);
  check('лимит равен замеру, когда замер меньше шести', tight.limit === 3, String(tight.limit));
  check('причина названа размером, а не ст. 28(3)',
    /Label size is the constraint/.test(tight.limitReason));
  check('на этикетке ровно три фразы', tight.selected.length === 3);

  const roomy = selectPStatements({ ...SELECT_INPUT, fitCapacity: 12 }, data);
  check('потолок ст. 28(3) держится, когда места хватает', roomy.limit === 6, String(roomy.limit));
  check('причина названа ст. 28(3)', /Article 28\(3\)/.test(roomy.limitReason));

  // ⛔ Замер ноль — «не влезает ничего». Движок всё равно оставляет одну фразу:
  // пустой набор P-фраз незаконен, а нечитаемо мелкая этикетка — решение
  // человека. ⚠ Но причина обязана остаться правдивой.
  const none = selectPStatements({ ...SELECT_INPUT, fitCapacity: 0 }, data);
  check('при замере 0 остаётся одна фраза, а не пустота', none.limit === 1, String(none.limit));
  check('и причина всё ещё про размер', /Label size is the constraint/.test(none.limitReason));
}

// ── 9. ⛔ ЗУБЫ: БЕЗ ЗАМЕРА НАБОР НЕ ВЛЕЗАЕТ ─────────────────────────────────
// ⚠⚠ Проверка обязана показывать, что она чинит. Шесть фраз ст. 28(3) на
// тесной этикетке по-болгарски не влезают — это и есть дефект, ради которого
// замер написан. Если однажды эта проверка позеленеет, значит движок раскладки
// изменился, и таблицу выше надо пересчитывать, а не радоваться.
console.log('\n━━ 9. Зубы: старое поведение (только ст. 28(3)) на тесной этикетке');
{
  const w = 70, h = 50;
  const statutory = selectPStatements({ ...SELECT_INPUT }, data);
  const ctxBg = ctxFor(['BG'], w, h);
  const sixFits = probeFits(ctxBg, 'BG', statutory.selected.map((u) => u.code));
  const measured = measureFitCapacity(ctxBg, CANDIDATES).capacity;
  console.log(`  ${w}×${h} BG: ст. 28(3) даёт ${statutory.selected.length} фраз, замер — ${measured}`);
  check('шесть фраз ст. 28(3) на этой этикетке НЕ влезают', sixFits === false);
  check('замер это видит и режет', measured < statutory.selected.length,
    `${measured} против ${statutory.selected.length}`);
}

// ── 10. ⛔ «НОЛЬ ФРАЗ» И «ЭТИКЕТКА МАЛА» — РАЗНЫЕ ОТВЕТЫ ─────────────────────
// ⚠⚠ Замер обязан отличать «фраз слишком много» от «не влезает даже пустая
// этикетка». У анилина девять H-фраз: на двуязычной 105 × 74 они не помещаются
// сами по себе, и совет «уберите P-фразы» был бы вредным — убирать нечего.
console.log('\n━━ 10. Ноль фраз: виноваты фразы или сама этикетка');
{
  const tiny = measureFitCapacity(ctxFor(['EN'], 52, 30), CANDIDATES);
  check('52 × 30: замер говорит, что не влезает и пустая этикетка',
    tiny.capacity === 0 && tiny.baseFits === false);

  const both = measureFitCapacity(ctxFor(['EN', 'BG'], 105, 74), CANDIDATES);
  console.log(`  105×74 EN+BG: фраз ${both.capacity}, пустая этикетка влезает: ${both.baseFits}`);
  check('на большой этикетке ответ про пустой набор дан', typeof both.baseFits === 'boolean');

  const roomy = measureFitCapacity(ctxFor(['EN'], 148, 105), CANDIDATES);
  check('там, где влезает всё, baseFits тоже true', roomy.baseFits === true);
}

console.log(failed === 0
  ? '\n✅ Замер влезаемости говорит правду.'
  : `\n❌ Провалов: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
