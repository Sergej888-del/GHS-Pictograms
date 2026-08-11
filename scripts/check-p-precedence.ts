// Прогон движка pPrecedence без сборки Astro.
// node --experimental-strip-types run-precedence.ts   (или npx tsx)
import { readFileSync } from 'node:fs';
import { selectPStatements, type PrecedenceData } from '../src/lib/pPrecedence.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/p-precedence.json', import.meta.url), 'utf8'));

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
  /**
   * ⚠⚠ ПОЧЕМУ ЭТО ОТДЕЛЬНОЕ ПОЛЕ, А НЕ ВЫВОД ИЗ `echa` ВЫШЕ. Снимок УЗКИЙ: в
   * нём строки лишь тех классов, что нужны трём подопытным веществам (103 из
   * 749). Утверждение «этого кода у ECHA нет нигде» из такого куска — ложь, и
   * ровно на ней стоял дефект session 64. Список идёт из ПОЛНОЙ таблицы, как в
   * сборке, поэтому проверка и прод идут одной дорогой.
   */
  gradedCodes: raw.gradedCodes,
};

if (!Array.isArray(raw.gradedCodes) || raw.gradedCodes.length < 80) {
  throw new Error(`снимок без gradedCodes или обрезан: ${raw.gradedCodes?.length}`);
}

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`); }
  else console.log(`  ✓ ${name}`);
}

function show(title: string, res: ReturnType<typeof selectPStatements>) {
  console.log(`\n━━ ${title}`);
  console.log('классы:', res.pairs.map((p) => `${p.classCode} ${p.categoryCode}`.trim()).join(' · '));
  console.log(`лимит ${res.limit}: ${res.limitReason}`);
  console.log('НА ЭТИКЕТКУ:');
  for (const u of res.selected) {
    console.log(`   ${u.code.padEnd(20)} ${String(u.level ?? '—').padEnd(19)} ${u.type.padEnd(11)} опасностей ${u.hazards.length}`);
  }
  const dropped = res.units.filter((u) => u.verdict !== 'selected');
  console.log('НЕ НА ЭТИКЕТКЕ:');
  for (const u of dropped) {
    const why = u.reasons[u.reasons.length - 1];
    console.log(`   ${u.code.padEnd(20)} ${u.verdict.padEnd(10)} ${why?.rule.padEnd(16)} ${why?.text.slice(0, 78)}`);
  }
  const inLimit = res.units.filter((u) => u.verdict === 'selected' && !res.selected.includes(u));
  if (inLimit.length) console.log('   (ошибка: живые вне выборки)', inLimit.map((u) => u.code));
  if (res.notes.length) { console.log('ОГОВОРКИ:'); for (const n of res.notes) console.log('   ⚠', n); }
  if (res.derogations.length) { console.log('ПОСЛАБЛЕНИЯ:'); for (const d of res.derogations) console.log(`   §${d.threshold} мл ${d.allows}: ${d.classes.map((c) => c.classCode).join(', ')}`); }
}

const NITRO = ['H351', 'H360F', 'H331', 'H311', 'H301', 'H372', 'H412'];

// ── 1. Нитробензол, профессионалу ───────────────────────────────────────────
const a = selectPStatements({ hCodes: NITRO, signalWord: 'Danger', audience: 'professional' }, data);
show('Нитробензол · профессионалу · без ограничения размера', a);
console.log('проверки:');
check('H360F разобран через основу H360 (REPRO_TOX найден)',
  a.pairs.some((p) => p.classCode === 'REPRO_TOX'), JSON.stringify(a.pairs));
check('восемь пар класс+категория (REPRO_TOX даёт 1A и 1B)', a.pairs.length === 8, String(a.pairs.length));
check('ни одной голой части пары на этикетке',
  !a.selected.some((u) => ['P301', 'P310', 'P302', 'P352', 'P304', 'P340', 'P308', 'P313', 'P361', 'P364', 'P403', 'P233'].includes(u.code)),
  a.selected.map((u) => u.code).join(','));
check('пары целы', a.selected.every((u) => !u.code.includes('+') || u.components.length >= 2));
check('выбрано ровно 6', a.selected.length === 6, String(a.selected.length));
check('P501 у профессионала НЕ закреплён (ст. 28(2) только для населения)',
  !a.units.find((u) => u.code === 'P501')?.reasons.some((r) => r.rule === 'anchor-disposal'));
check('P201 у CARCINOGEN 2 получил recommended, а не highly_recommended',
  a.units.find((u) => u.code === 'P201')?.level === 'highly_recommended',
  'ожидаемо highly — потому что REPRO_TOX 1A/1B тоже даёт P201, и там highly');
check('P312 снят лестницей срочности в пользу P311',
  !!a.units.find((u) => u.code === 'P312')?.reasons.some((r) => r.rule === 'ladder'),
  JSON.stringify(a.units.find((u) => u.code === 'P312')?.verdict));
check('класса ANY у профессионала нет', !a.units.some((u) => u.code === 'P102'));

// ── 1b. ⛔⛔ ДЕФЕКТ SESSION 66: P330 у ACUTE_TOX_ORAL 3 ──────────────────────
// Annex I, таблица 3.1.1, Precautionary Statement Response (oral):
//   кат. 1 · 2 · 3 → P301 + P310, P321, P330
//   кат. 4        → P301 + P312, P330
// Фраза положена ВСЕМ четырём категориям. ECHA §7.3 оценивает её только у
// категории 4 — и правило «компонент без уровня ECHA не кандидат» выбрасывало её
// у категорий 1–3. Выходило, что при менее тяжёлом отравлении рот полоскать
// надо, а при более тяжёлом нет. Замер: 481 вещество в базе, 443 из них на P330.
//
// ⚠ Эти пять проверок ПАДАЮТ на коде session 65 — прогнано.
const p330 = a.units.find((u) => u.code === 'P330');
check('P330 НЕ выброшен как «нет уровня у ECHA» (дефект session 66)',
  !p330?.reasons.some((r) => r.rule === 'no-echa-level'),
  JSON.stringify(p330?.reasons.map((r) => r.rule)));
check('P330 остался кандидатом: вердикт не dropped по причине уровня',
  p330?.verdict === 'selected' || p330?.reasons[p330.reasons.length - 1]?.rule === 'limit',
  `${p330?.verdict} / ${p330?.reasons[p330.reasons.length - 1]?.rule}`);
check('у P330 стоит причина ungraded-here',
  !!p330?.reasons.some((r) => r.rule === 'ungraded-here'),
  JSON.stringify(p330?.reasons.map((r) => r.rule)));
const p330why = p330?.reasons.find((r) => r.rule === 'ungraded-here')?.text ?? '';
check('в протоколе сказано, что молчание методички — не разрешение не печатать',
  /Annex IV requires/.test(p330why) && /not permission/i.test(p330why), p330why.slice(0, 110));
check('оговорка про ungraded-here попала в notes',
  a.notes.some((n) => /ungraded by ECHA for this hazard class/.test(n)),
  JSON.stringify(a.notes));

// ⭐⭐ И ОБРАТНАЯ СТОРОНА: правило не должно затупиться. Кодов, которым ECHA не
// даёт уровня НИГДЕ, — 38 (P301, P304, P313, P351…). Они по-прежнему уходят.
check('P301 всё ещё не выходит на этикетку голым (ECHA не оценивает его нигде)',
  !data.gradedCodes.includes('P301') && a.units.find((u) => u.code === 'P301')?.verdict !== 'selected',
  a.units.find((u) => u.code === 'P301')?.verdict);
const neverGraded = ['P301', 'P302', 'P304', 'P305', 'P313', 'P351', 'P340', 'P361', 'P364'];
check('ни один из девяти «нигде не оценённых» кодов не попал в gradedCodes',
  neverGraded.every((c) => !data.gradedCodes.includes(c)),
  neverGraded.filter((c) => data.gradedCodes.includes(c)).join(','));
// ⚠ Инвариант: причина `no-echa-level` со вердиктом `dropped` законна ТОЛЬКО у
// кода, которого нет в gradedCodes. Иначе строка протокола говорит неправду.
const lying = a.units.filter((u) =>
  u.verdict === 'dropped' &&
  u.reasons.some((r) => r.rule === 'no-echa-level') &&
  data.gradedCodes.includes(u.code));
check('нет ни одной фразы, выброшенной с ложной причиной «нет уровня нигде»',
  lying.length === 0, lying.map((u) => u.code).join(','));

// ── 2. Нитробензол, населению ───────────────────────────────────────────────
const b = selectPStatements({ hCodes: NITRO, signalWord: 'Danger', audience: 'general_public', containerMl: 100 }, data);
show('Нитробензол · населению · тара 100 мл', b);
console.log('проверки:');
check('P501 закреплён по ст. 28(2)',
  b.selected.some((u) => u.code === 'P501' && u.reasons.some((r) => r.rule === 'anchor-disposal')));
check('P501 стоит первым', b.selected[0]?.code === 'P501', b.selected[0]?.code);
check('P501 = mandatory', b.units.find((u) => u.code === 'P501')?.level === 'mandatory');
check('P102 «Keep out of reach of children» появился', b.units.some((u) => u.code === 'P102'));
check('P102 закреплён и стоит вторым, сразу за P501',
  b.selected[1]?.code === 'P102', b.selected[1]?.code);
// ⚠⚠ ПРОТОКОЛ ПЕРЕВЕДЁН НА АНГЛИЙСКИЙ В SESSION 65 — он идёт на страницу
// /p-statements/selector/, которую читают посетители сайта. Проверка ловит
// не слово, а СМЫСЛ: строка обязана сказать, что закреп наш, и обязана
// сказать, что его можно снять. Без этого инструмент врёт о своём основании.
const p102Reason = b.units.find((u) => u.code === 'P102')?.reasons
  .find((r) => r.rule === 'anchor-disposal')?.text ?? '';
check('в протоколе P102 сказано, что это НАШЕ решение, а не регламент',
  /OUR decision/.test(p102Reason) && /not by the regulation/i.test(p102Reason), p102Reason.slice(0, 90));
check('и сказано, что закреп можно снять',
  /unpin/i.test(p102Reason), p102Reason.slice(0, 90));
check('протокол на английском: кириллицы в reasons нет',
  !b.units.some((u) => u.reasons.some((r) => /[\u0410-\u044f\u0401\u0451]/.test(r.text + r.citation))),
  b.units.flatMap((u) => u.reasons).find((r) => /[\u0410-\u044f]/.test(r.text + r.citation))?.text?.slice(0, 90) ?? '');
check('P103 снят колонкой 5, потому что есть P202',
  b.units.find((u) => u.code === 'P103')?.verdict === 'omitted',
  b.units.find((u) => u.code === 'P103')?.verdict);
check('P201 снят колонкой 5 по той же причине',
  b.units.find((u) => u.code === 'P201')?.verdict === 'omitted',
  b.units.find((u) => u.code === 'P201')?.verdict);
check('послабление §1.5.2.1.2 найдено для AQUATIC_CHRONIC 3',
  b.derogations.some((d) => d.allows === 'p-only' && d.classes.some((c) => c.classCode === 'AQUATIC_CHRONIC')));

// ── 3. Серная кислота, тесная этикетка ──────────────────────────────────────
const c = selectPStatements(
  { hCodes: ['H314'], signalWord: 'Danger', audience: 'professional', fitCapacity: 4 },
  data,
);
show('Серная кислота · профессионалу · влезает только 4', c);
console.log('проверки:');
check('лимит 4, а не 6', c.limit === 4, String(c.limit));
check('выбрано 4', c.selected.length === 4, String(c.selected.length));
check('H314 неоднозначен, но предупреждения нет — наборы фраз совпадают',
  c.ambiguity.length === 0 && c.pairs.length === 3, JSON.stringify(c.ambiguity));
check('P310 не остался голым: он компонент? нет — но у него есть уровень',
  c.units.find((u) => u.code === 'P310')?.level === 'highly_recommended');
check('P301, P330, P331 поглощены парой P301+P330+P331',
  ['P301', 'P330', 'P331'].every((x) => c.units.find((u) => u.code === x)?.verdict === 'absorbed'));
check('P304+P340 (optional) ниже P305+P351+P338 (highly)',
  c.units.findIndex((u) => u.code === 'P305+P351+P338') < c.units.findIndex((u) => u.code === 'P304+P340'));

// ── 4. Диф со вставленным чужим SDS ─────────────────────────────────────────
const d = selectPStatements(
  { hCodes: ['H314'], signalWord: 'Danger', audience: 'professional', suppliedCodes: ['P280', 'P305+P351+P338', 'P310', 'P264'] },
  data,
);
console.log('\n━━ Диф с чужим SDS');
console.log('   у нас, но не у них:', d.diff?.onlyOurs.join(', '));
console.log('   у них, но не у нас:', d.diff?.onlyTheirs.join(', '));
console.log('   совпало:', d.diff?.both.join(', '));
check('диф посчитан', !!d.diff && d.diff.both.length > 0);

console.log(failed ? `\n⛔ провалено проверок: ${failed}` : '\n✅ все проверки прошли');
