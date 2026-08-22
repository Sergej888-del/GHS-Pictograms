// Проверка модуля A1 — движка острой токсичности `src/lib/ate.ts` — без
// сборки Astro и без базы (фикстуры в коде).
//
//   npm run check:ate
//   (= node --experimental-strip-types scripts/check-ate.ts)
//
// Основание: CLP Annex I 3.1 (консолидация 2026-05-01 — тот же текст, что в
// `clp_generic_limits`): Table 3.1.1 (пороги), Table 3.1.2 (point estimates),
// Table 1.1 (generic cut-off 0,1 % для категорий 1–3), 3.1.3.3 (релевантность
// 1 %), 3.1.3.6.1 (формула аддитивности), 3.1.3.6.2.3 (коррекция при неизвестных
// > 10 %). Аудит №100 (s79): три состояния компонента, точная категория A0,
// гармонизированные ATE, звёздочка, формы ингаляции, ключи правил.
//
// ⚠ 20 тестов session 9 в репозиторий не попадали (гонялись через esbuild в
// сессии) — этот файл их заменяет и расширяет.
import {
  categoryFor, pointEstimate, hCodeForRoute, isAmbiguousH, normalizeAteForm, tableKey, isLowerEdgePointEstimate,
  resolveRoute, isRelevant, computeRoute, rollUp,
  CUTOFFS, POINT_ESTIMATE, RULE_KEYS, RELEVANCE_CUTOFF, RELEVANCE_CUTOFF_CAT1_3,
  type CompInput, type Resolved, type Route, type InhalForm,
} from '../src/lib/ate.ts';

let failed = 0;
let total = 0;
function check(name: string, cond: boolean, detail = '') {
  total++;
  if (!cond) { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ✓ ${name}`);
}
const near = (a: number | null, b: number, eps = 0.01) => a != null && Math.abs(a - b) <= eps;

/** Компонент в одну строку. */
function comp(p: Partial<CompInput> & { conc?: number }): CompInput {
  return { concentration: p.conc ?? 0, hCodes: p.hCodes ?? null, dbAteOral: p.dbAteOral ?? null, manual: p.manual ?? {},
    annex6: p.annex6, annex6Ate: p.annex6Ate, knownNonhazard: p.knownNonhazard };
}
/** Разрешить один путь и сразу собрать вход для computeRoute. */
function row(c: CompInput, route: Route, form: InhalForm = 'vapour'): { conc: number; resolved: Resolved } {
  return { conc: c.concentration, resolved: resolveRoute(c, route, form) };
}
function mix(route: Route, form: InhalForm, ...cs: CompInput[]) {
  return computeRoute(cs.map((c) => row(c, route, form)), route, tableKey(route, form));
}

console.log('A1 · ate.ts — аудит №100 (s79)\n');

// ── 1. таблицы ──────────────────────────────────────────────────────────────
console.log('1. Table 3.1.1 / 3.1.2');
check('oral: 5 → 1, 5.01 → 2, 50 → 2, 300 → 3, 2000 → 4, 2001 → null, 0 → null',
  categoryFor(5, 'oral') === 1 && categoryFor(5.01, 'oral') === 2 && categoryFor(50, 'oral') === 2
  && categoryFor(300, 'oral') === 3 && categoryFor(2000, 'oral') === 4 && categoryFor(2001, 'oral') === null && categoryFor(0, 'oral') === null);
check('dermal: 50 → 1, 200 → 2, 1000 → 3, 2000 → 4', categoryFor(50, 'dermal') === 1 && categoryFor(200, 'dermal') === 2 && categoryFor(1000, 'dermal') === 3 && categoryFor(2000, 'dermal') === 4);
check('gas ppmV: 100 → 1, 500 → 2, 2500 → 3, 20000 → 4', categoryFor(100, 'gas') === 1 && categoryFor(500, 'gas') === 2 && categoryFor(2500, 'gas') === 3 && categoryFor(20000, 'gas') === 4);
check('vapour mg/L: 0.5 → 1, 2 → 2, 10 → 3, 20 → 4, 20.1 → null', categoryFor(0.5, 'vapour') === 1 && categoryFor(2, 'vapour') === 2 && categoryFor(10, 'vapour') === 3 && categoryFor(20, 'vapour') === 4 && categoryFor(20.1, 'vapour') === null);
check('dust/mist mg/L: 0.05 → 1, 0.5 → 2, 1 → 3, 5 → 4', categoryFor(0.05, 'dust_mist') === 1 && categoryFor(0.5, 'dust_mist') === 2 && categoryFor(1, 'dust_mist') === 3 && categoryFor(5, 'dust_mist') === 4);
check('point estimates: oral 0.5/5/100/500 · dermal 5/50/300/1100 · gas 10/100/700/4500 · vapour 0.05/0.5/3/11 · dust 0.005/0.05/0.5/1.5',
  [0.5, 5, 100, 500].every((v, i) => POINT_ESTIMATE.oral[i + 1] === v) && [5, 50, 300, 1100].every((v, i) => POINT_ESTIMATE.dermal[i + 1] === v)
  && [10, 100, 700, 4500].every((v, i) => POINT_ESTIMATE.gas[i + 1] === v) && [0.05, 0.5, 3, 11].every((v, i) => POINT_ESTIMATE.vapour[i + 1] === v)
  && [0.005, 0.05, 0.5, 1.5].every((v, i) => POINT_ESTIMATE.dust_mist[i + 1] === v));
// ⚠ Особенность самого GHS/CLP: point estimate категории 2 (oral 5, dermal 50,
// gas 100, vapour 0,5, dust 0,05) стоит РОВНО на верхней границе категории 1
// («ATE ≤ 5»), а у dusts/mists и cat 3 (0,5) — на границе cat 2. Смесь из
// 100 % компонента cat 2 по Table 3.1.2 даёт ATEmix = 5 → cat 1 по Table 3.1.1.
// Это текст регламента, не наш дефект (движок s9 вёл себя так же). Лечение —
// `isLowerEdgePointEstimate` в computeRoute (раздел 4 ниже): истинный ATE строго
// больше краевого point estimate → категория компонента, не строже.
// Проверка фиксирует факт, чтобы никто не «починил» таблицу под тест.
check('каждый point estimate либо в своей категории, либо ровно на верхней границе категории выше (cat 2 везде; dust cat 3) — особенность GHS',
  (Object.keys(CUTOFFS) as (keyof typeof CUTOFFS)[]).every((k) => [1, 2, 3, 4].every((cat) => {
    const pe = pointEstimate(k, cat)!;
    const got = categoryFor(pe, k);
    return got === cat || (got === cat - 1 && pe === CUTOFFS[k][cat - 2]!.max);
  }))
  && categoryFor(pointEstimate('oral', 2)!, 'oral') === 1 && categoryFor(pointEstimate('dust_mist', 3)!, 'dust_mist') === 2);
check('hCodeForRoute: [H301,H330] oral → H301, dermal → null; isAmbiguousH H300 да, H301 нет',
  hCodeForRoute(['H301', 'H330'], 'oral') === 'H301' && hCodeForRoute(['H301', 'H330'], 'dermal') === null && isAmbiguousH('H300') && !isAmbiguousH('H301'));
check('normalizeAteForm: 6 форм Annex VI → 3 формы движка, чужое → null',
  normalizeAteForm('dusts or mists') === 'dust_mist' && normalizeAteForm('dusts and mists') === 'dust_mist' && normalizeAteForm('vapours') === 'vapour'
  && normalizeAteForm('vapour') === 'vapour' && normalizeAteForm('Vapours') === 'vapour' && normalizeAteForm('gases') === 'gas'
  && normalizeAteForm('anhydrate') === null && normalizeAteForm(null) === null);
check('пороги релевантности: 1 % и 0,1 %', RELEVANCE_CUTOFF === 1 && RELEVANCE_CUTOFF_CAT1_3 === 0.1);
check('isLowerEdgePointEstimate: cat 2 на всех путях, dust cat 3 — да; cat 1/3/4 остальные — нет',
  (['oral', 'dermal', 'gas', 'vapour', 'dust_mist'] as const).every((k) => isLowerEdgePointEstimate(k, 2))
  && isLowerEdgePointEstimate('dust_mist', 3) && !isLowerEdgePointEstimate('oral', 3) && !isLowerEdgePointEstimate('oral', 1) && !isLowerEdgePointEstimate('vapour', 4));

// ── 2. resolveRoute — приоритет источников ──────────────────────────────────
console.log('\n2. resolveRoute — приоритет источников');
const h300 = comp({ conc: 10, hCodes: ['H300'] });
let r = resolveRoute(h300, 'oral', 'vapour');
check('H300 без пары A0 → converted, cat 1, ATE 0.5, ambiguous (как до s79)', r.source === 'converted' && r.cat === 1 && r.ate === 0.5 && r.ambiguous && r.state === 'known');
r = resolveRoute(comp({ conc: 10, hCodes: ['H300'], annex6: [{ route: 'oral', cat: 2, star: true }] }), 'oral', 'vapour');
check('H300 + пара A0 «Acute Tox. 2 *» → annex6-cat, cat 2, ATE 5, не ambiguous, STAR',
  r.source === 'annex6-cat' && r.cat === 2 && r.ate === 5 && !r.ambiguous && r.star && r.warnings.includes('STAR'), JSON.stringify(r));
r = resolveRoute(comp({ conc: 10, hCodes: ['H302'], annex6: [{ route: 'oral', cat: 4, star: false }], annex6Ate: [{ route: 'oral', value: 730, unit: 'mg/kg bw', form: null, raw: 'oral: ATE = 730 mg/kg bw' }] }), 'oral', 'vapour');
check('гармонизированный ATE приоритетнее категории: 730 mg/kg → annex6-ate, cat 4, провенанс с raw',
  r.source === 'annex6-ate' && r.ate === 730 && r.cat === 4 && r.provenance.includes('730') && r.provenance.includes('Annex VI'), JSON.stringify(r));
r = resolveRoute(comp({ conc: 10, hCodes: ['H302'], annex6Ate: [{ route: 'oral', value: 730, unit: 'mg/kg bw', form: null }], manual: { oral: { cat: 3 } } }), 'oral', 'vapour');
check('manual cat бьёт Annex VI: cat 3 → ATE 100', r.source === 'manual-cat' && r.cat === 3 && r.ate === 100);
r = resolveRoute(comp({ conc: 10, hCodes: ['H302'], annex6Ate: [{ route: 'oral', value: 730, unit: 'mg/kg bw', form: null }], manual: { oral: { ate: 1500 } } }), 'oral', 'vapour');
check('manual ATE бьёт всё: 1500 → cat 4, source manual', r.source === 'manual' && r.ate === 1500 && r.cat === 4);
r = resolveRoute(comp({ conc: 10, hCodes: ['H301'], dbAteOral: 1 }), 'oral', 'vapour');
check('ate_oral = 1.00 (мусор) игнорируется → converted cat 3, ATE 100', r.source === 'converted' && r.ate === 100 && r.cat === 3);
r = resolveRoute(comp({ conc: 10, hCodes: ['H301'] }), 'dermal', 'vapour');
check('нет данных по пути и нет утверждения → unknown', r.source === 'unknown' && r.state === 'unknown' && r.ate === null);
r = resolveRoute(comp({ conc: 10, hCodes: ['H301'], knownNonhazard: true }), 'dermal', 'vapour');
check('knownNonhazard: путь без данных → nonhazard (не unknown)', r.source === 'nonhazard' && r.state === 'nonhazard' && r.ate === null);
r = resolveRoute(comp({ conc: 10, hCodes: ['H301'], knownNonhazard: true }), 'oral', 'vapour');
check('knownNonhazard НЕ перебивает путь с данными: oral H301 остаётся known', r.source === 'converted' && r.state === 'known');
r = resolveRoute(comp({ conc: 10, hCodes: ['H330'] }), 'inhalation', 'gas');
check('H330 при форме gas → point estimate в ppmV: 10', r.ate === 10 && r.cat === 1 && tableKey('inhalation', 'gas') === 'gas');

// ── 3. гармонизированные ATE — формы и единицы ──────────────────────────────
console.log('\n3. Annex VI ATE — формы ингаляции и единицы');
const dust = comp({ conc: 10, hCodes: ['H330'], annex6: [{ route: 'inhalation', cat: 2, star: false }],
  annex6Ate: [{ route: 'inhalation', value: 0.05, unit: 'mg/L', form: 'dusts or mists', raw: 'inhalation: ATE = 0.05 mg/L (dusts or mists)' }] });
r = resolveRoute(dust, 'inhalation', 'dust_mist');
check('023-001-00-8: 0.05 mg/L (dusts or mists) при форме dust_mist → annex6-ate, cat 1', r.source === 'annex6-ate' && r.ate === 0.05 && r.cat === 1 && r.warnings.length === 0, JSON.stringify(r));
r = resolveRoute(dust, 'inhalation', 'vapour');
check('та же строка при форме vapour → значение НЕ применяется: FORM_MISMATCH, откат к категории A0 (cat 2 → 0.5 mg/L vapour)',
  r.source === 'annex6-cat' && r.cat === 2 && r.ate === 0.5 && r.warnings.includes('FORM_MISMATCH'), JSON.stringify(r));
r = resolveRoute(comp({ conc: 10, hCodes: ['H331'], annex6Ate: [{ route: 'inhalation', value: 700, unit: null, form: 'gases', raw: 'inhalation: ATE = 700  (gases)' }] }), 'inhalation', 'gas');
check('603-023-00-X: «ATE = 700 (gases)» без единицы → ppmV по форме, UNIT_INFERRED, cat 3', r.source === 'annex6-ate' && r.ate === 700 && r.cat === 3 && r.warnings.includes('UNIT_INFERRED'), JSON.stringify(r));
r = resolveRoute(comp({ conc: 10, hCodes: ['H331'], annex6Ate: [{ route: 'inhalation', value: 3, unit: 'mg/L', form: 'gases' }] }), 'inhalation', 'gas');
check('mg/L при форме gases (чужая единица, без молярной массы) → не применяется, FORM_MISMATCH, откат к H331 → 700 ppmV',
  r.source === 'converted' && r.ate === 700 && r.warnings.includes('FORM_MISMATCH'), JSON.stringify(r));
r = resolveRoute(comp({ conc: 10, hCodes: ['H302'], annex6Ate: [{ route: 'oral', value: 853, unit: 'mg/kg bw', form: 'anhydrate' }, { route: 'oral', value: 1098, unit: 'mg/kg bw', form: 'tetrahydrate' }] }), 'oral', 'vapour');
check('028-018-00-4: два oral-значения (anhydrate 853 / tetrahydrate 1098) → меньшее, MULTI_VALUE', r.ate === 853 && r.warnings.includes('MULTI_VALUE'), JSON.stringify(r));
r = resolveRoute(comp({ conc: 10, hCodes: ['H302'], annex6Ate: [{ route: 'oral', value: 0, unit: 'mg/kg bw', form: null }] }), 'oral', 'vapour');
check('ATE ≤ 0 в Annex VI-строке не считается значением → откат к H302', r.source === 'converted' && r.cat === 4);

// ── 4. computeRoute — формула, релевантность, три состояния ─────────────────
console.log('\n4. computeRoute — 3.1.3.6.1 / 3.1.3.6.2.3 / Table 1.1');
const A = comp({ conc: 40, manual: { oral: { ate: 100 } } });
const B = comp({ conc: 60, manual: { oral: { ate: 1000 } } });
let rr = mix('oral', 'vapour', A, B);
check('40 % ATE 100 + 60 % ATE 1000 → 100/(0.4+0.06) = 217.4 → cat 3 · H301 · rule 3.1.3.6.1',
  near(rr.ateMix, 217.39) && rr.category === 3 && rr.hCode === 'H301' && rr.ruleKey === RULE_KEYS.formula && !rr.corrected && rr.knownCount === 2, JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 60, manual: { oral: { ate: 200 } } }), comp({ conc: 40 }));
check('60 % ATE 200 + 40 % unknown → коррекция: 60/0.3 = 200 → cat 3 (без коррекции было бы 333 → cat 4) · UNKNOWN_GT10 · rule -GT10',
  near(rr.ateMix, 200) && rr.category === 3 && rr.corrected && rr.unknownConc === 40 && rr.ruleKey === RULE_KEYS.formulaCorrected && rr.warnings.includes('UNKNOWN_GT10'), JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 92, manual: { oral: { ate: 200 } } }), comp({ conc: 8 }));
check('92 % ATE 200 + 8 % unknown (≤ 10 %) → без коррекции: 100/0.46 = 217.4 · rule -LE10',
  near(rr.ateMix, 217.39) && !rr.corrected && rr.unknownConc === 8 && rr.ruleKey === RULE_KEYS.formulaUncorrected, JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 70, manual: { oral: { ate: 100 } } }), comp({ conc: 30, knownNonhazard: true }));
check('§6.1 п.1: 70 % ATE 100 + 30 % воды (nonhazard) → БЕЗ коррекции: 100/0.7 = 142.9 → cat 3; nonhazardConc 30',
  near(rr.ateMix, 142.86) && !rr.corrected && rr.unknownConc === 0 && rr.nonhazardConc === 30 && rr.ruleKey === RULE_KEYS.formula, JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 70, manual: { oral: { ate: 100 } } }), comp({ conc: 30 }));
check('…а та же вода как unknown (дефолт) → коррекция 70/0.7 = 100 → cat 3, provisional', near(rr.ateMix, 100) && rr.corrected, JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 0.5, manual: { oral: { ate: 0.5 } } }), comp({ conc: 99.5, knownNonhazard: true }));
check('Table 1.1: 0,5 % категории 1 (ATE 0.5) → релевантен с 0,1 %: 100/(0.5/0.5) = 100 → cat 3 · CAT1_3_BELOW_1PCT',
  near(rr.ateMix, 100) && rr.category === 3 && rr.warnings.includes('CAT1_3_BELOW_1PCT'), JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 0.05, manual: { oral: { ate: 0.5 } } }), comp({ conc: 99.95, knownNonhazard: true }));
check('0,05 % категории 1 → ниже 0,1 %: не классифицируется', rr.ateMix === null && rr.knownCount === 0);
rr = mix('oral', 'vapour', comp({ conc: 0.5, manual: { oral: { ate: 1500 } } }), comp({ conc: 99.5, knownNonhazard: true }));
check('0,5 % категории 4 → порог 1 %: не релевантен, не классифицируется', rr.ateMix === null && rr.knownCount === 0);
rr = mix('oral', 'vapour', comp({ conc: 99.5, manual: { oral: { ate: 100 } } }), comp({ conc: 0.5 }));
check('0,5 % unknown → в ΣC_unknown не входит (3.1.3.6.2.3 считает неизвестные с 1 %)', rr.unknownConc === 0 && !rr.corrected);
rr = mix('oral', 'vapour', comp({ conc: 50, manual: { oral: { ate: 5000 } } }), comp({ conc: 50, knownNonhazard: true }));
check('известное ATE выше потолка cat 4 (5000) входит в формулу: 100/0.01 = 10000 → не классифицируется, knownCount 1',
  near(rr.ateMix, 10000) && rr.category === null && rr.hCode === null && rr.knownCount === 1, JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 100 }));
check('ни одного известного → ateMix null, ruleKey null, unknownConc 100', rr.ateMix === null && rr.ruleKey === null && rr.unknownConc === 100);
rr = mix('inhalation', 'gas', comp({ conc: 50, hCodes: ['H330'] }), comp({ conc: 50, hCodes: ['H332'] }));
check('ингаляция gas: 50 % H330 (10 ppmV) + 50 % H332 (4500) → 100/(5+0.0111) = 19.96 → cat 1 · H330',
  near(rr.ateMix, 19.96) && rr.category === 1 && rr.hCode === 'H330' && rr.key === 'gas', JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 50, hCodes: ['H300'], annex6: [{ route: 'oral', cat: 2, star: true }] }), comp({ conc: 50, knownNonhazard: true }));
check('звёздочка компонента → STAR на пути', rr.warnings.includes('STAR') && near(rr.ateMix, 10) && rr.category === 2, JSON.stringify(rr));
// ── граница Table 3.1.2 (point estimate на нижнем краю диапазона) ───────────
const hfOral = comp({ conc: 100, hCodes: ['H300'], annex6: [{ route: 'oral', cat: 2, star: true }] });
rr = mix('oral', 'vapour', hfOral);
check('100 % компонента Annex VI cat 2 (HF): ATEmix = 5 ровно на границе → категория 2 (не 1), EDGE_POINT_ESTIMATE, H300',
  near(rr.ateMix, 5) && rr.category === 2 && rr.hCode === 'H300' && rr.warnings.includes('EDGE_POINT_ESTIMATE'), JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 70, hCodes: ['H300'], annex6: [{ route: 'oral', cat: 2, star: true }] }), comp({ conc: 30 }));
check('70 % HF + 30 % unknown: коррекция 70/14 = 5 → всё равно категория 2 (EDGE + UNKNOWN_GT10)',
  near(rr.ateMix, 5) && rr.category === 2 && rr.warnings.includes('EDGE_POINT_ESTIMATE') && rr.warnings.includes('UNKNOWN_GT10'), JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 50, annex6: [{ route: 'oral', cat: 2, star: false }] }), comp({ conc: 50, hCodes: ['H300'], annex6: [{ route: 'oral', cat: 2, star: false }] }));
check('50 % + 50 % двух веществ cat 2 → 5 → категория 2', near(rr.ateMix, 5) && rr.category === 2);
rr = mix('oral', 'vapour', comp({ conc: 99, annex6: [{ route: 'oral', cat: 2, star: false }] }), comp({ conc: 1, knownNonhazard: true }));
check('99 % cat 2 + 1 % nonhazard → 5.05 → категория 2 без EDGE', near(rr.ateMix, 5.05) && rr.category === 2 && !rr.warnings.includes('EDGE_POINT_ESTIMATE'));
rr = mix('oral', 'vapour', comp({ conc: 100, manual: { oral: { ate: 5 } } }));
check('измеренное ATE = 5 ровно (manual) → категория 1 по букве Table 3.1.1, без EDGE', rr.category === 1 && !rr.warnings.includes('EDGE_POINT_ESTIMATE'));
rr = mix('oral', 'vapour', comp({ conc: 100, manual: { oral: { cat: 2 } } }));
check('manual Category 2 на 100 % → категория 2 (категория — диапазон, не число)', rr.category === 2 && rr.warnings.includes('EDGE_POINT_ESTIMATE'));
rr = mix('inhalation', 'dust_mist', comp({ conc: 100, hCodes: ['H331'] }));
check('dusts/mists: 100 % H331 (pe 0.5 = граница cat 2) → категория 3, EDGE', near(rr.ateMix, 0.5) && rr.category === 3 && rr.hCode === 'H331' && rr.warnings.includes('EDGE_POINT_ESTIMATE'), JSON.stringify(rr));
rr = mix('oral', 'vapour', comp({ conc: 100, hCodes: ['H301'] }));
check('100 % H301 (pe 100 внутри диапазона) → категория 3 без EDGE', rr.category === 3 && !rr.warnings.includes('EDGE_POINT_ESTIMATE'));

check('isRelevant: nonhazard никогда; unknown с 1 %; cat 3 с 0,1 %; cat 4 с 1 %',
  !isRelevant(50, resolveRoute(comp({ conc: 50, knownNonhazard: true }), 'oral', 'vapour'))
  && !isRelevant(0.9, resolveRoute(comp({ conc: 0.9 }), 'oral', 'vapour')) && isRelevant(1, resolveRoute(comp({ conc: 1 }), 'oral', 'vapour'))
  && isRelevant(0.1, resolveRoute(comp({ conc: 0.1, hCodes: ['H301'] }), 'oral', 'vapour'))
  && !isRelevant(0.9, resolveRoute(comp({ conc: 0.9, hCodes: ['H302'] }), 'oral', 'vapour')));

// ── 5. rollUp ───────────────────────────────────────────────────────────────
console.log('\n5. rollUp');
const oral3 = mix('oral', 'vapour', A, B);
const dermalNone = mix('dermal', 'vapour', A, B);
const inhal4 = mix('inhalation', 'vapour', comp({ conc: 100, hCodes: ['H332'] }));
let roll = rollUp([oral3, dermalNone, inhal4]);
check('oral cat 3 + inhal cat 4 → worst 3 · Danger · GHS06 · H301,H332', roll.worstCategory === 3 && roll.signalWord === 'Danger' && roll.pictogram === 'GHS06' && roll.hCodes.join(',') === 'H301,H332', JSON.stringify(roll.hCodes));
check('P-коды — объединение по путям (oral 3 ∪ inhal 4), одиночные по номеру, комбинированные после (как на проде)',
  roll.pCodes.join(' ') === 'P261 P264 P270 P271 P312 P321 P330 P405 P501 P301+P310 P304+P340', roll.pCodes.join(' '));
roll = rollUp([inhal4]);
check('только cat 4 → Warning · GHS07', roll.worstCategory === 4 && roll.signalWord === 'Warning' && roll.pictogram === 'GHS07');
roll = rollUp([dermalNone]);
check('ничего не классифицировано → null/null/null, пусто', roll.worstCategory === null && roll.signalWord === null && roll.pictogram === null && roll.hCodes.length === 0 && roll.pCodes.length === 0 && !roll.provisional);
roll = rollUp([mix('oral', 'vapour', comp({ conc: 60, manual: { oral: { ate: 200 } } }), comp({ conc: 40 }))]);
check('коррекция на пути → provisional, warnings [UNKNOWN_GT10]', roll.provisional && roll.warnings.join(',') === 'UNKNOWN_GT10');

console.log(`\n${failed ? `✗ ПРОВАЛЕНО: ${failed} из ${total}` : `✓ A1 зелёный — ${total} проверок`}`);
process.exit(failed ? 1 : 0);
