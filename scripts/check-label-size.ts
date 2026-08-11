// Проверка вердикта о размере этикетки против CLP Annex I, Table 1.3.
//
//   node --experimental-strip-types scripts/check-label-size.ts
//
// ⚠ Импорт с расширением `.ts` — так требует `--experimental-strip-types`.
// Модуль `jurisdictions.ts` чистый: ни одного внешнего импорта, поэтому
// проверка идёт без сборки Astro и без `tsx`.
//
// ⭐⭐ У ЭТОЙ ПРОВЕРКИ ДОЛЖНЫ БЫТЬ ЗУБЫ. Урок session 64: зелёная проверка с
// ложной подписью хуже красной. Поэтому здесь не «вердикт не падает», а
// поимённо перечисленные случаи, каждый из которых СТАРЫЙ КОД проходил
// неправильно. Прогнанная на старом сравнении (`W < minW || H < minH`), эта
// проверка обязана падать — иначе она ничего не проверяет.
//
// Дословный текст Table 1.3, по которому написаны ожидания:
//   Not exceeding 3 litres:                  If possible, at least 52 × 74
//   Greater than 3, not exceeding 50 l:      At least 74 × 105
//   Greater than 50, not exceeding 500 l:    At least 105 × 148
//   Greater than 500 litres:                 At least 148 × 210

import {
  CLP_SIZE_TIERS,
  labelSizeVerdict,
  sizeTierForLitres,
  requiredPictogramSideMm,
  JURISDICTIONS,
} from '../src/lib/jurisdictions.ts';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ✓ ${name}`);
}

const tier = (key: string) => {
  const t = CLP_SIZE_TIERS.find((x) => x.key === key);
  if (!t) throw new Error(`нет яруса ${key}`);
  return t;
};

const LE3 = tier('le3');
const GT3 = tier('gt3le50');
const GT50 = tier('gt50le500');
const GT500 = tier('gt500');

// ── 1. Формулировки ярусов взяты из таблицы, а не назначены ─────────────────
console.log('\n━━ 1. Какие ярусы обязательны');
check('≤ 3 л — НЕ обязателен: «If possible, at least 52 × 74»', LE3.labelSidesBinding === false);
check('> 3–50 л обязателен: «At least 74 × 105»', GT3.labelSidesBinding === true);
check('> 50–500 л обязателен', GT50.labelSidesBinding === true);
check('> 500 л обязателен', GT500.labelSidesBinding === true);
check('только один ярус необязателен',
  CLP_SIZE_TIERS.filter((t) => !t.labelSidesBinding).length === 1);

// ── 2. ⛔ ТОТ САМЫЙ СЛУЧАЙ ИЗ ОЧЕРЕДИ: 4 × 2 in под бутылку ─────────────────
// 101,6 × 50,8 мм, тара ≤ 3 л. Инструмент писал «below the 52 × 74 mm minimum».
console.log('\n━━ 2. 4 × 2 in (101,6 × 50,8) под тару ≤ 3 л');
const v42 = labelSizeVerdict(LE3, 101.6, 50.8);
check('НЕ нарушение — у этого яруса минимума не существует', v42.breach === false);
check('но недобор до «по возможности» назван', v42.belowIfPossible === true);
check('стороны не выдержаны (50,8 < 52)', v42.meetsSides === false);
check('недобор посчитан по короткой стороне: 1,2 мм',
  v42.shortByMm?.shortSide === 1.2, JSON.stringify(v42.shortByMm));
check('по длинной стороне недобора нет (101,6 > 74)',
  v42.shortByMm?.longSide === 0, JSON.stringify(v42.shortByMm));
check('формулировка отдаётся дословной', v42.wording === 'if possible, at least 52 × 74 mm', v42.wording);

// ── 3. ⛔ Ориентация: пара размеров, а не оси ────────────────────────────────
console.log('\n━━ 3. Альбомная ориентация — те же размеры');
const land = labelSizeVerdict(GT3, 105, 74); // ярус говорит «74 × 105»
check('105 × 74 удовлетворяет ярусу 74 × 105', land.meetsSides === true);
check('и это НЕ нарушение', land.breach === false);
check('но помечено как «только повёрнутой»', land.onlyRotated === true);
const port = labelSizeVerdict(GT3, 74, 105);
check('74 × 105 как есть — без пометки о развороте', port.meetsSides && !port.onlyRotated);

// ── 4. ⛔ Узкая лента НЕ проходит обязательный ярус ──────────────────────────
// Прежний расчёт на страницах шаблонов пропускал её по площади.
console.log('\n━━ 4. Лента 210 × 40 под канистру 20 л');
const ribbon = labelSizeVerdict(GT3, 210, 40);
check('нарушение: короткая сторона 40 < 74', ribbon.breach === true);
check('площади при этом хватает — и она НЕ спасает',
  210 * 40 >= GT3.labelMinW * GT3.labelMinH && ribbon.meetsSides === false,
  `площадь ${210 * 40} против ${GT3.labelMinW * GT3.labelMinH}`);
check('недобор 34 мм по короткой стороне', ribbon.shortByMm?.shortSide === 34, JSON.stringify(ribbon.shortByMm));

// ── 5. Ровно по границе и допуск на дюймы ───────────────────────────────────
console.log('\n━━ 5. Границы');
check('ровно 74 × 105 — соответствие', labelSizeVerdict(GT3, 74, 105).meetsSides === true);
check('73 × 105 — нарушение', labelSizeVerdict(GT3, 73, 105).breach === true);
check('допуск 0,5 мм: 73,6 × 105 проходит', labelSizeVerdict(GT3, 73.6, 105).meetsSides === true);
check('4 × 6 in (101,6 × 152,4) проходит ярус > 3–50 л',
  labelSizeVerdict(GT3, 101.6, 152.4).meetsSides === true);
check('4 × 6 in НЕ проходит ярус > 50–500 л (152,4 > 148, но 101,6 < 105)',
  labelSizeVerdict(GT50, 101.6, 152.4).breach === true);

// ── 6. Ни один вердикт не бывает и нарушением, и «по возможности» ───────────
console.log('\n━━ 6. Взаимоисключение флагов на всей сетке');
let both = 0, silent = 0;
for (const t of CLP_SIZE_TIERS) {
  for (let w = 20; w <= 260; w += 3.5) {
    for (let h = 20; h <= 260; h += 3.5) {
      const v = labelSizeVerdict(t, w, h);
      if (v.breach && v.belowIfPossible) both++;
      // Стороны не выдержаны, но ни один флаг не поднят — вердикт молчит.
      if (!v.meetsSides && !v.breach && !v.belowIfPossible) silent++;
      if (v.meetsSides && v.shortByMm !== null) silent++;
    }
  }
}
check('нет случая «и нарушение, и по возможности»', both === 0, String(both));
check('нет случая, когда стороны не выдержаны, а вердикт молчит', silent === 0, String(silent));

// ── 7. Ярус по объёму и пиктограмма — не задеты правкой ─────────────────────
console.log('\n━━ 7. Соседние правила на месте');
const clp = JURISDICTIONS.clp;
check('3 л → ярус ≤ 3 л', sizeTierForLitres(clp, 3)?.key === 'le3');
check('3,001 л → ярус > 3–50 л', sizeTierForLitres(clp, 3.001)?.key === 'gt3le50');
check('у OSHA яруса нет вовсе', sizeTierForLitres(JURISDICTIONS.osha, 1) === null);
check('пиктограмма ≤ 3 л: 16 мм цель, 10 мм пол',
  LE3.pictogramMm === 16 && LE3.pictogramFloorMm === 10);
check('правило площади §1.2.1.3 сильнее стороны у ≤ 3 л: 16,0 мм → 16,0',
  Math.round(requiredPictogramSideMm(LE3) * 10) / 10 === 16,
  String(Math.round(requiredPictogramSideMm(LE3) * 10) / 10));

console.log(failed ? `\n⛔ провалено проверок: ${failed}` : '\n✅ все проверки прошли');
process.exit(failed ? 1 : 0);
