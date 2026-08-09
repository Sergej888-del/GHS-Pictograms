// src/lib/labelMakerCta.ts
//
// Текст блока «собрать этикетку» на 225 страницах H- и P-фраз — СОБИРАЕТСЯ ИЗ
// ДАННЫХ САМОЙ ФРАЗЫ, а не набран 225 раз руками.
//
// ⚠⚠ ПОЧЕМУ НЕ ОДИН ТЕКСТ НА ВСЕХ И НЕ 225 РЕДАКЦИЙ. Один текст на 225 страниц —
// это шаблонный блок, который поисковик видит именно таким. 225 рукописных
// редакций никто никогда не перечитает, а значит они разойдутся с данными в
// первый же импорт. Здесь текст — функция от строки базы: поменялась строка —
// поменялся текст, и разойтись им негде.
//
// ⚠⚠ И ГЛАВНОЕ, РАДИ ЧЕГО ЭТОТ ФАЙЛ ВООБЩЕ ЗАВЕДЁН: у части кодов элементы
// этикетки ЗАВИСЯТ ОТ КАТЕГОРИИ, а страница фразы категорию продукта не знает.
// H228 — «Flammable solid»: категория 1 берёт Danger, категория 2 — Warning.
// Подставить в конструктор одно из двух значит напечатать на этикетке чужое
// сигнальное слово. Замер по базе: таких кодов 6 по сигнальному слову и 1 по
// пиктограмме (H221). Правило одно — ГДЕ КАТЕГОРИИ НЕ СОГЛАСНЫ, НЕ ПОДСТАВЛЯЕМ
// НИЧЕГО и говорим об этом словами.
//
// ⚠ H241 выглядит как разночтение, но им не является: категория одна («Type B»),
// а пиктограмм у неё две — GHS01 и GHS02, и обе обязательны. Поэтому согласие
// считается ПО НАБОРУ пиктограмм у категории, а не по отдельной пиктограмме.

import {
  labelMakerHref,
  isPStatementParam,
  normalizeJurisdiction,
  LABEL_MAKER_BASE,
  type LabelMakerParams,
  type SignalParam,
} from './labelMakerLink';

/**
 * Имена классов блока — В ОДНОМ МЕСТЕ, как `LM_PARAM` для имён параметров.
 *
 * ⚠⚠ ЗАЧЕМ. Блок рисуют ДВА файла: `LabelMakerCta.astro` на статических
 * страницах и `LabelMakerCtaBlock.tsx` внутри React-островов, где адрес
 * известен только после пересчёта. Разойдись у них имена классов — один из двух
 * блоков потерял бы оформление целиком и остался бы голым текстом, а увидеть это
 * можно было бы только глазами на конкретной странице. Стили при этом
 * по-прежнему живут в `hub.css` в единственном экземпляре.
 */
export const LMC_CLASS = {
  root: 'lmc',
  wide: 'lmc-wide',
  inline: 'lmc-inline',
  badge: 'lmc-badge',
  title: 'lmc-title',
  copy: 'lmc-copy',
  cta: 'lmc-cta',
  note: 'lmc-note',
} as const;

/**
 * Имена девяти пиктограмм. ⚠ Раньше эта таблица лежала прямо в
 * `src/pages/h-statements/[code].astro`; здесь она затем, чтобы подпись под
 * картинкой и подпись в тексте блока не могли разойтись.
 */
export const PICTOGRAM_NAME: Record<string, string> = {
  GHS01: 'exploding bomb',
  GHS02: 'flame',
  GHS03: 'flame over circle',
  GHS04: 'gas cylinder',
  GHS05: 'corrosion',
  GHS06: 'skull and crossbones',
  GHS07: 'exclamation mark',
  GHS08: 'health hazard',
  GHS09: 'environment',
};

/** Строка `hazard_category_mapping` — ровно те три поля, что нужны этикетке. */
export type HazardMapRow = {
  category_code: string;
  pictogram_code: string | null;
  signal_word: string | null;
};

/** Что база говорит о сигнальном слове кода. */
export type SignalReading =
  | { kind: 'one'; word: string }
  | { kind: 'split' }
  | { kind: 'none' };

/** Что база говорит о пиктограммах кода. */
export type PictogramReading =
  | { kind: 'set'; codes: string[] }
  | { kind: 'split' }
  | { kind: 'none' };

function uniqSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

/** Строки по категориям. Ключи отсортированы — иначе текст блока пляшет от сборки к сборке. */
function byCategory(rows: readonly HazardMapRow[]): { category: string; rows: HazardMapRow[] }[] {
  const m = new Map<string, HazardMapRow[]>();
  for (const r of rows) {
    const got = m.get(r.category_code);
    if (got) got.push(r);
    else m.set(r.category_code, [r]);
  }
  return [...m.keys()].sort().map((category) => ({ category, rows: m.get(category)! }));
}

/**
 * Сигнальное слово, если ВСЕ категории кода согласны. Иначе `split`.
 *
 * ⚠ Категория без слова тоже считается несогласием: «у категории 2 слова нет, у
 * категории 1 — Danger» означает, что из кода слово не выводится.
 */
export function readSignal(rows: readonly HazardMapRow[]): SignalReading {
  const groups = byCategory(rows);
  if (groups.length === 0) return { kind: 'none' };
  const words = groups.map((g) => uniqSorted(g.rows.map((r) => r.signal_word)));
  if (words.every((w) => w.length === 0)) return { kind: 'none' };
  const first = words[0];
  if (first.length !== 1) return { kind: 'split' };
  return words.every((w) => w.length === 1 && w[0] === first[0]) ? { kind: 'one', word: first[0] } : { kind: 'split' };
}

/**
 * Набор пиктограмм, если ВСЕ категории кода дают один и тот же набор.
 *
 * ⚠⚠ Сравниваются НАБОРЫ, а не отдельные коды: у H241 одна категория с двумя
 * пиктограммами — это не спор, это комплект. У H221 наборы разные (`GHS02` у
 * категории 1B, пусто у категории 2) — это спор.
 */
export function readPictograms(rows: readonly HazardMapRow[]): PictogramReading {
  const groups = byCategory(rows);
  if (groups.length === 0) return { kind: 'none' };
  const sets = groups.map((g) => uniqSorted(g.rows.map((r) => r.pictogram_code)).join(','));
  const first = sets[0];
  if (!sets.every((s) => s === first)) return { kind: 'split' };
  return first === '' ? { kind: 'none' } : { kind: 'set', codes: first.split(',') };
}

/** `signal` для адреса конструктора — только при согласии категорий. */
export function signalParamFrom(reading: SignalReading): SignalParam | null {
  if (reading.kind !== 'one') return null;
  const w = reading.word.trim().toLowerCase();
  return w === 'danger' ? 'danger' : w === 'warning' ? 'warning' : null;
}

/**
 * Перечисление через «and» — но ⚠ ТОЛЬКО ЕСЛИ НИ В ОДНОМ ЧЛЕНЕ НЕТ СВОЕГО «and».
 * Категории органических пероксидов называются «Type C and D» и «Type E and F»;
 * «Type C and D and Type E and F» — не английский язык, а склейка. Там, где член
 * уже содержит союз, перечисление идёт запятыми, и читатель видит границы.
 */
function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.some((i) => / and /i.test(i))) return items.join(', ');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** `GHS02 flame` · `GHS01 exploding bomb and GHS02 flame` */
function pictogramPhrase(codes: readonly string[]): string {
  return listAnd(codes.map((c) => (PICTOGRAM_NAME[c] ? `${c} ${PICTOGRAM_NAME[c]}` : c)));
}

/** Маленькие числа словами: «two CLP hazard classes» читается, «2» — считается. */
const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const numWord = (n: number): string => NUM_WORD[n] ?? String(n);

/** Элементы этикетки по категориям — и для текста блока, и для показа на странице. */
export type CategoryElements = { category: string; pictograms: string[]; signals: string[] };

export function categoryElements(rows: readonly HazardMapRow[]): CategoryElements[] {
  return byCategory(rows).map((g) => ({
    category: g.category,
    pictograms: uniqSorted(g.rows.map((r) => r.pictogram_code)),
    signals: uniqSorted(g.rows.map((r) => r.signal_word)),
  }));
}

/**
 * Расходятся ли элементы этикетки между категориями кода.
 *
 * ⚠⚠ ЭТИМ ОДНИМ ОТВЕТОМ ПОЛЬЗУЮТСЯ ОБА МЕСТА — и разбор на странице, и решение
 * «подставлять ли в конструктор». Если бы страница считала расхождение своей
 * формулой, а ссылка своей, они разошлись бы на первом же коде с необычной
 * категорией, и увидеть это можно было бы только глазами на конкретной странице.
 */
export function categoryElementsDiffer(rows: readonly HazardMapRow[]): boolean {
  return readSignal(rows).kind === 'split' || readPictograms(rows).kind === 'split';
}

/**
 * Разбор по категориям строкой: `1 — GHS02 flame, Danger; 2 — GHS02 flame, Warning`.
 * ⚠ «no pictogram» и «no signal word» пишутся словами, а не пропускаются:
 * пропуск читался бы как «мы не знаем», а мы знаем — их там нет.
 */
function categoryBreakdown(rows: readonly HazardMapRow[]): string {
  return categoryElements(rows)
    .map(
      (g) =>
        `${g.category} — ${g.pictograms.length ? pictogramPhrase(g.pictograms) : 'no pictogram'}, ` +
        `${g.signals.length ? g.signals.join('/') : 'no signal word'}`,
    )
    .join('; ');
}

/** Готовый блок: заголовок, текст, мелкая оговорка и параметры адреса. */
export type CtaContent = {
  title: string;
  copy: string;
  cta: string;
  note?: string;
  params: LabelMakerParams;
};

export type HCtaInput = {
  code: string;
  /** ⚠ Классов может быть ДВА: H240–H242 — самореактивные И органические пероксиды. */
  hazardClasses: readonly string[];
  categories: readonly string[];
  rows: readonly HazardMapRow[];
};

/** Блок для страницы H- или EUH-кода. */
export function hStatementCta(input: HCtaInput): CtaContent {
  const { code, hazardClasses, categories, rows } = input;
  const signal = readSignal(rows);
  const pics = readPictograms(rows);

  const catPhrase =
    categories.length > 0 ? `${categories.length > 1 ? 'categories' : 'category'} ${listAnd(categories)}` : '';

  const sentences: string[] = [];

  if (hazardClasses.length === 1) {
    sentences.push(`${code} belongs to the CLP hazard class ${hazardClasses[0]}${catPhrase ? `, ${catPhrase}` : ''}.`);
  } else if (hazardClasses.length > 1) {
    sentences.push(
      `${code} appears in ${numWord(hazardClasses.length)} CLP hazard classes — ${hazardClasses.join('; ')} — ` +
        `${catPhrase ? `in ${catPhrase}` : 'across their categories'}.`,
    );
  }

  const carries: string[] = [];
  if (pics.kind === 'set') {
    carries.push(`adds the ${pictogramPhrase(pics.codes)} pictogram${pics.codes.length > 1 ? 's' : ''}`);
  }
  if (signal.kind === 'one') carries.push(`sets the signal word to ${signal.word}`);

  sentences.push(
    carries.length === 2
      ? `Opening the label maker from here ticks ${code}, ${carries[0]} and ${carries[1]}.`
      : carries.length === 1
        ? `Opening the label maker from here ticks ${code} and ${carries[0]}.`
        : `Opening the label maker from here ticks ${code}.`,
  );
  sentences.push('Add a product name, pick a label size, and it prints a vector PDF at full scale — no sign-up.');

  // ⚠⚠ Оговорка появляется РОВНО ТОГДА, когда мы что-то не подставили, и
  // объясняет почему. Молчаливый пропуск читался бы как недоработка.
  let note: string | undefined;
  if (signal.kind === 'split' || pics.kind === 'split') {
    const both = signal.kind === 'split' && pics.kind === 'split';
    const what = both ? 'The pictogram and the signal word are' : signal.kind === 'split' ? 'The signal word is' : 'The pictogram is';
    note =
      `${what} left blank on purpose, because ${both ? 'they differ' : 'it differs'} by category: ${categoryBreakdown(rows)}. ` +
      `The statement on its own does not say which category a product falls into; the classification does.`;
  } else if (rows.length === 0) {
    note =
      `No hazard class is recorded against ${code} here, so there is no pictogram or signal word to carry over. ` +
      `Pick them in the label maker — they follow from the classification of the product, not from the statement.`;
  }

  return {
    title: `Put ${code} on a label`,
    copy: sentences.join(' '),
    cta: `Build a label with ${code} →`,
    note,
    params: {
      h: [code],
      pictograms: pics.kind === 'set' ? [...pics.codes] : [],
      signal: signalParamFrom(signal),
    },
  };
}

/** Названия категорий P-фраз — те же, что в заголовках хаба `/p-statements/`. */
const P_CATEGORY_WORD: Record<string, string> = {
  general: 'general',
  prevention: 'prevention',
  response: 'response',
  storage: 'storage',
  disposal: 'disposal',
};

/**
 * Что эта категория делает на этикетке. ⚠ Формулировки НЕ повторяют `CAT_BLURB`
 * из шапки страницы: одинаковый текст дважды на одном экране — это дубль,
 * который читатель замечает раньше поисковика.
 */
const P_CATEGORY_ROLE: Record<string, string> = {
  general: 'the group that goes on a label because of who will handle the product, not because of any one hazard class',
  prevention: 'the group that says how to keep the harm from happening at all, and the one that grows fastest as hazard classes add up',
  response: 'the group a reader looks for once something has already happened, which is why where it sits on the label matters as much as how it is worded',
  storage: 'the group that describes the state the container has to be kept in, and the first to be squeezed out when the label runs short of room',
  disposal: 'the group that covers the leftover product and the empty container',
};

export type PCtaInput = {
  code: string;
  category: string;
  /** Сколько веществ Annex VI несут код — 0 для кодов вне гармонизированного перечня. */
  total: number;
};

/** Блок для страницы P-кода. */
export function pStatementCta(input: PCtaInput): CtaContent {
  const { code, category, total } = input;
  const word = P_CATEGORY_WORD[category] ?? category;
  const role = P_CATEGORY_ROLE[category];

  const sentences = [
    `${code} is a ${word} statement${role ? ` — ${role}` : ''}.`,
    `Opening the label maker from here ticks ${code}. Add the hazard side — pictograms, signal word and H-statements — then a product name and a size, and it prints a vector PDF at full scale — no sign-up.`,
  ];

  // ⚠ Число веществ упоминается только когда оно есть: «0 substances carry it»
  // в блоке-приглашении звучит как «код никому не нужен», а это неправда —
  // гармонизированный перечень покрывает вещества, а не смеси.
  if (total > 0) {
    sentences.push(
      `${total.toLocaleString('en-US')} harmonised entr${total === 1 ? 'y' : 'ies'} in CLP Annex VI carr${total === 1 ? 'ies' : 'y'} ${code}; ` +
        `pick ${total === 1 ? 'it' : 'any of them'} by CAS number and the rest of the label fills itself in.`,
    );
  } else {
    sentences.push(
      `No harmonised entry in CLP Annex VI carries ${code}, so this is a code you apply to your own product — the label maker builds that case by hand.`,
    );
  }

  return {
    title: `Put ${code} on a label`,
    copy: sentences.join(' '),
    cta: `Build a label with ${code} →`,
    params: { p: [code] },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Блоки для ДВУХ ИНСТРУМЕНТОВ — пункты A2 и A3 плана.
//
// ⚠⚠ ОТЛИЧИЕ ОТ БЛОКОВ ВЫШЕ, И ОНО ГЛАВНОЕ. Страница фразы знает свой код на
// сборке; инструмент знает свой ответ ТОЛЬКО ПОСЛЕ ПЕРЕСЧЁТА. Поэтому обе
// функции ниже принимают СОСТОЯНИЕ РЕЗУЛЬТАТА, а не выбор человека: на
// селекторе между ними лежит CLP Art. 26, который часть пиктограмм снимает, и
// ссылка, собранная из галочек, увела бы в конструктор набор, уже отменённый
// регламентом на экране рядом.
//
// ⚠⚠ И ОБЕ ВОЗВРАЩАЮТ `null`, КОГДА ПЕРЕДАВАТЬ НЕЧЕГО. Блок «соберите этикетку»
// над пустым результатом — приглашение напечатать пустоту.
// ────────────────────────────────────────────────────────────────────────────

/** `Danger` → `danger`; `null` (слова НЕТ) → `none`; чужая строка → `null`. */
function signalParamFromWord(word: string | null): SignalParam | null {
  if (word === null) return 'none';
  const w = word.trim().toLowerCase();
  return w === 'danger' ? 'danger' : w === 'warning' ? 'warning' : null;
}

/**
 * `the hazard statements H226 and H319` до трёх кодов, дальше — счётом словами.
 * ⚠ Артикль внутри, а не у вызывающего: у формы со счётом его быть не должно
 * («the four hazard statements» обещает читателю определённый, уже названный
 * набор, а мы их как раз не назвали).
 */
function statementPhrase(codes: readonly string[]): string {
  if (codes.length === 0) return '';
  if (codes.length <= 3) return `the hazard statement${codes.length > 1 ? 's' : ''} ${listAnd([...codes])}`;
  return `${numWord(codes.length)} hazard statements`;
}

export type SelectorCtaInput = {
  /** Код юрисдикции СЕЛЕКТОРА: `UN_GHS` | `EU_CLP` | `GB_CLP` | `OSHA_HCS`. */
  jurisdictionCode: string;
  /**
   * Имя юрисдикции ИЗ СТРОКИ БАЗЫ — той самой, что подписывает кнопку выбора.
   * ⚠ Не из константы в коде: session 53 показала, чем кончается подпись,
   * взятая из вида ключа, а не из данных.
   */
  jurisdictionName: string;
  /** Пиктограммы РЕЗУЛЬТАТА — после Art. 26, с пометкой «необязательна». */
  pictograms: readonly { code: string; optional: boolean }[];
  /** Сигнальное слово результата. ⚠⚠ `null` — классификация его НЕ НАЗНАЧАЕТ. */
  signalWord: string | null;
  hCodes: readonly string[];
  /** Сколько правил старшинства сработало. 0 — набор ничем не урезан. */
  appliedRuleCount: number;
};

/** Блок под результатом пиктограммного селектора. `null` — передавать нечего. */
export function pictogramSelectorCta(input: SelectorCtaInput): CtaContent | null {
  const { jurisdictionCode, jurisdictionName, pictograms, signalWord, hCodes, appliedRuleCount } = input;

  const required = pictograms.filter((p) => !p.optional).map((p) => p.code);
  const optional = pictograms.filter((p) => p.optional).map((p) => p.code);

  // ⚠ Порог показа — «есть ли на этикетке хоть один элемент», а не «нажал ли
  // человек хоть что-нибудь». Выбор, который в этой юрисдикции не даёт ни
  // пиктограммы, ни фразы, передавать в конструктор нечем.
  if (pictograms.length === 0 && hCodes.length === 0) return null;

  const jur = normalizeJurisdiction(jurisdictionCode);
  const signal = signalParamFromWord(signalWord);

  const carried: string[] = [];
  if (required.length) {
    carried.push(`the ${pictogramPhrase(required)} pictogram${required.length > 1 ? 's' : ''}`);
  }
  if (signalWord) carried.push(`the signal word ${signalWord}`);
  if (hCodes.length) carried.push(statementPhrase(hCodes));

  const sentences = [`Opening the label maker from here carries over ${listAnd(carried)}.`];
  sentences.push(
    jur
      ? `Add a product name and a label size, and it lays them out to the label rules of ${jurisdictionName} and prints a vector PDF at full scale — no sign-up.`
      : `Add a jurisdiction, a product name and a label size, and it prints a vector PDF at full scale — no sign-up.`,
  );
  // ⚠⚠ «Правила старшинства», а НЕ «CLP Article 26». Правила в базе универсальны
  // (`jurisdiction_id` пуст у всех восьми), и блок этот стоит в том числе в
  // режиме OSHA HCS — сослаться там на статью регламента ЕС значит соврать про
  // регламент из своего же поля, ровно как в session 53.
  if (appliedRuleCount > 0) {
    sentences.push(
      `The pictograms are the set that survives the ${numWord(appliedRuleCount)} precedence ` +
        `rule${appliedRuleCount > 1 ? 's' : ''} applied above, not the raw selection.`,
    );
  }

  // ⚠⚠ Оговорки — ровно про то, чего мы НЕ подставили, и почему. Молчаливый
  // пропуск читался бы как недоработка, а каждый из трёх — решение.
  const notes: string[] = [];
  if (!jur) {
    notes.push(
      `UN GHS is the model regulation and the label maker builds to a national one — OSHA HazCom, EU CLP, ` +
        `GB CLP or WHMIS. The link therefore carries no jurisdiction: pick one there, because the model and ` +
        `the national rules differ on the environmental hazards and on the EUH statements.`,
    );
  }
  if (optional.length) {
    notes.push(
      `${listAnd(optional)} ${optional.length > 1 ? 'are' : 'is'} optional in ${jurisdictionName} for this ` +
        `classification, so ${optional.length > 1 ? 'they are' : 'it is'} shown above but not ticked — that ` +
        `choice stays yours.`,
    );
  }
  if (signalWord === null) {
    notes.push(
      `This classification assigns no signal word, and the link says exactly that rather than leaving the ` +
        `field untouched — the label is built without one.`,
    );
  }

  return {
    title: 'Now put it on a label',
    copy: sentences.join(' '),
    cta: 'Open in the GHS Label Maker →',
    note: notes.length ? notes.join(' ') : undefined,
    params: {
      jurisdiction: jur,
      pictograms: required,
      signal,
      h: [...hCodes],
    },
  };
}

export type AteCtaInput = {
  /** Худшая категория по маршрутам. ⚠⚠ `null` — смесь НЕ КЛАССИФИЦИРОВАНА. */
  worstCategory: number | null;
  signalWord: string | null;
  pictogram: string | null;
  hCodes: readonly string[];
  pCodes: readonly string[];
};

/** Блок под результатом ATE-калькулятора. `null` — классификации нет. */
export function ateMixtureCta(input: AteCtaInput): CtaContent | null {
  const { worstCategory, signalWord, pictogram, hCodes, pCodes } = input;

  // ⚠⚠ «Не классифицировано по острой токсичности» — законный ответ
  // калькулятора, а не пустой результат. Звать с него на этикетку не за чем:
  // передавать нечего, и приглашение читалось бы как «мы что-то не досчитали».
  if (worstCategory === null) return null;

  // ⚠⚠ Комбинированные коды отсеиваются ТОЙ ЖЕ функцией, которой их отсеивает
  // сборщик адреса, — иначе оговорка ниже однажды соврёт о том, что потеряно.
  const carriedP = pCodes.filter(isPStatementParam);
  const droppedP = pCodes.filter((c) => !isPStatementParam(c));

  const carried: string[] = [];
  if (pictogram) carried.push(`the ${pictogramPhrase([pictogram])} pictogram`);
  if (signalWord) carried.push(`the signal word ${signalWord}`);
  if (hCodes.length) carried.push(statementPhrase(hCodes));
  if (carriedP.length) {
    carried.push(`${numWord(carriedP.length)} precautionary statement${carriedP.length > 1 ? 's' : ''}`);
  }

  const sentences = [
    `Category ${worstCategory} is the acute-toxicity outcome of this mixture, and the label maker takes it as it stands: ${listAnd(carried)}.`,
    'Add a product name, pick a label size, and it prints a vector PDF at full scale — no sign-up.',
  ];

  const notes: string[] = [
    `Acute toxicity is one hazard class. Whatever else the mixture is classified for — flammability, ` +
      `corrosion, aspiration, the environment — is not in this result and is not carried over.`,
    `The link carries no jurisdiction: the additivity formula is the same everywhere, but which national ` +
      `rule the label is printed to is a separate choice you make in the label maker.`,
  ];
  if (droppedP.length) {
    notes.push(
      `${listAnd(droppedP)} ${droppedP.length > 1 ? 'are combined codes' : 'is a combined code'}. CLP Annex IV ` +
        `counts a combination as ONE label element, while the label maker ticks statements separately, so ` +
        `${droppedP.length > 1 ? 'they are' : 'it is'} left for you to add there.`,
    );
  }

  return {
    title: 'Put this classification on a label',
    copy: sentences.join(' '),
    cta: 'Open in the GHS Label Maker →',
    note: notes.join(' '),
    params: {
      pictograms: pictogram ? [pictogram] : [],
      signal: signalParamFromWord(signalWord),
      h: [...hCodes],
      p: carriedP,
    },
  };
}

/**
 * Адрес блока. ⚠⚠ ТОЛЬКО ОТСЮДА: литерал `/ghs-label-maker/?h=…`, набранный в
 * `.astro`, — это вторая редакция контракта, а первая живёт в labelMakerLink.ts.
 * Ровно так в session 38 разошлись `?cas=` и `?substance=`.
 *
 * ⚠ `#build` — не украшение: хаб раздела длинный, и без якоря человек попадает
 * на его шапку, а не на инструмент с уже отмеченной фразой.
 */
export function ctaHref(params: LabelMakerParams, base: string = LABEL_MAKER_BASE): string {
  return `${labelMakerHref(params, base)}#build`;
}
