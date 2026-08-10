// src/lib/labelMakerLink.ts
// Контракт адреса конструктора этикеток: ОДИН файл строит ссылки и ОН ЖЕ их
// разбирает.
//
// ⚠⚠ ПОЧЕМУ ОДИН ФАЙЛ, А НЕ ДВА. Session 38: страницы веществ ссылались на
// ATE-калькулятор с `?cas=`, а калькулятор читал `?substance=`. Ссылка вела на
// живую страницу, параметр был синтаксически безупречен, сборка и все проверки
// зелёные — и калькулятор открывался ПУСТЫМ со всех 3 650 страниц. Поймать это
// можно было только глазами. Имя параметра — контракт между двумя файлами;
// пока он размножен копипастой, он однажды разойдётся. Здесь он один.
//
// ⚠⚠ ИМЕНА `jur` И `pstat` ВЫБРАНЫ НЕ СЛУЧАЙНО: `j` и `p` НА САЙТЕ УЖЕ ЗАНЯТЫ.
// `src/components/PictogramSelector.tsx` пишет в свой адрес `?j=` и `?p=`, где
//   `j` = 'UN_GHS' | 'EU_CLP' | 'GB_CLP' | 'OSHA_HCS'  (у нас ключи другие),
//   `p` = закодированный блоб выбранных классов, а вовсе не P-фразы.
// Одно и то же имя параметра, означающее на двух страницах сайта две разные
// вещи, — это тот же дефект, что в session 38, только отложенный.
//
// ⚠ Тексты на сайте английские, комментарии русские — как везде в проекте.

import type { JurisdictionKey, LabelPurpose } from './jurisdictions';

/** База раздела. Ветки и шаблоны — подпути от неё. */
export const LABEL_MAKER_BASE = '/ghs-label-maker/';

/**
 * Имена параметров в одном месте. В коде обращаться ТОЛЬКО через них: строковый
 * литерал `'jur'`, набранный руками во втором файле, — это уже вторая редакция
 * контракта.
 */
export const LM_PARAM = {
  cas: 'cas',
  jurisdiction: 'jur',
  purpose: 'purpose',
  stock: 'stock',
  lang: 'lang',
  h: 'h',
  p: 'pstat',
  pictogram: 'pic',
  signal: 'signal',
  from: 'from',
} as const;

/**
 * Параметры, которые обязаны пережить выбор вещества внутри конструктора.
 *
 * ⚠⚠ `from` СЮДА НЕ ВХОДИТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ. Липкий параметр — настройка
 * ЭТИКЕТКИ, он едет с человеком и остаётся в адресе конструктора. `from` —
 * маршрут: он нужен ровно один раз, чтобы вернуть человека на ту страницу
 * раздела, с которой он ушёл за веществом, и в адресе конструктора после
 * возврата ему делать нечего. Смешать их значит носить за собой мусор и
 * однажды вернуть человека не туда, откуда он пришёл.
 */
export const LM_STICKY_PARAMS: readonly string[] = [
  LM_PARAM.jurisdiction,
  LM_PARAM.purpose,
  LM_PARAM.stock,
  LM_PARAM.lang,
];

export type SignalParam = 'danger' | 'warning' | 'none';

export type LabelMakerParams = {
  cas?: string | null;
  jurisdiction?: JurisdictionKey | null;
  purpose?: LabelPurpose | null;
  stock?: string | null;
  lang?: string | null;
  h?: string[];
  p?: string[];
  pictograms?: string[];
  signal?: SignalParam | null;
  /**
   * Куда вернуть человека после выбора вещества.
   *
   * ⚠⚠⚠ ПОЛЕ ТОЛЬКО НА ЗАПИСЬ. `parseLabelMakerParams` его НЕ ВОЗВРАЩАЕТ
   * намеренно: значение приходит из адресной строки, и всякий, кто прочитал бы
   * его отсюда, получил бы готовый открытый редирект с нашего домена. Читать
   * адрес возврата можно единственным способом — `readReturnBase`, который без
   * списка известных страниц раздела не отдаёт ничего.
   */
  from?: string | null;
};

// ── Словари значений ────────────────────────────────────────────────────────

const JURISDICTION_KEYS: readonly JurisdictionKey[] = ['osha', 'clp', 'whmis', 'gbclp'];
const PURPOSE_KEYS: readonly LabelPurpose[] = ['supplier', 'workplace', 'small'];
const SIGNAL_KEYS: readonly SignalParam[] = ['danger', 'warning', 'none'];

/**
 * Словарь пиктограммного селектора → наши ключи юрисдикций.
 *
 * ⚠⚠ `UN_GHS` СООТВЕТСТВИЯ НЕ ИМЕЕТ, И ЭТО НЕ ПРОБЕЛ, А ФАКТ. У конструктора
 * режима «UN GHS» нет — есть четыре национальных. Подставлять вместо него `clp`
 * НЕЛЬЗЯ: UN GHS и EU CLP расходятся по обязательности водной среды и по
 * EUH-фразам, которых в модельном регламенте нет вовсе. Ссылка из селектора в
 * режиме UN GHS уходит БЕЗ юрисдикции, и человек выбирает её сам.
 *
 * ⚠ Обратное отображение тоже неполно: WHMIS у селектора нет. Это не чинится
 * параметром — это надо просто знать.
 */
const SELECTOR_JURISDICTION: Record<string, JurisdictionKey> = {
  EU_CLP: 'clp',
  GB_CLP: 'gbclp',
  OSHA_HCS: 'osha',
};

/**
 * Приводит юрисдикцию к нашему ключу. Принимает и наш словарь, и словарь
 * селектора. Неизвестное значение — `null`, а НЕ умолчание: молча подставить
 * OSHA человеку, который пришёл по ссылке с `clp`, хуже, чем не подставить
 * ничего.
 */
export function normalizeJurisdiction(raw: string | null | undefined): JurisdictionKey | null {
  if (!raw) return null;
  const v = raw.trim();
  if ((JURISDICTION_KEYS as readonly string[]).includes(v)) return v as JurisdictionKey;
  const mapped = SELECTOR_JURISDICTION[v.toUpperCase()];
  return mapped ?? null;
}

export function normalizePurpose(raw: string | null | undefined): LabelPurpose | null {
  if (!raw) return null;
  const v = raw.trim();
  return (PURPOSE_KEYS as readonly string[]).includes(v) ? (v as LabelPurpose) : null;
}

export function normalizeSignal(raw: string | null | undefined): SignalParam | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return (SIGNAL_KEYS as readonly string[]).includes(v) ? (v as SignalParam) : null;
}

/** Сигнальное слово так, как его ждёт движок этикетки. */
export function signalWordFromParam(s: SignalParam | null): string | null | undefined {
  if (s === 'danger') return 'Danger';
  if (s === 'warning') return 'Warning';
  if (s === 'none') return null;
  return undefined; // параметра не было — не трогаем умолчание
}

// ── Формы кодов ─────────────────────────────────────────────────────────────

/**
 * ⚠⚠ КОДЫ H НЕ ПРИВОДЯТСЯ К ВЕРХНЕМУ РЕГИСТРУ, И ЭТО НЕ ПРИДИРКА.
 * В перечне живут `H350i`, `H360D`, `H360Df`, `H360F`, `H360Fd`, `H360FD`,
 * `H361d`, `H361f`, `H361fd` — девять кодов, у которых регистр суффикса НЕСЁТ
 * СМЫСЛ: `F` — фертильность, `D` — развитие плода, прописная буква — доказанное
 * действие, строчная — предполагаемое.
 *
 * Замер по базе: `H360Fd` и `H360FD` в нижнем регистре ОДИНАКОВЫ — `h360fd`.
 * А фразы у них разные: `H360FD` — «может нанести вред фертильности; может
 * нанести вред нерождённому ребёнку», `H360Fd` — «…ПРЕДПОЛОЖИТЕЛЬНО наносит
 * вред нерождённому ребёнку». `toUpperCase()` или выбор наугад поставил бы на
 * этикетку не ту опасность. Поэтому здесь только проверка формы, а разрешение в
 * настоящий код идёт по загруженному перечню — `resolveStatementCode` ниже.
 *
 * ⚠ Первая буква регистронезависима: ссылку мог набрать человек строчными.
 * Значение имеет ТОЛЬКО суффикс, и его мы не трогаем.
 */
const H_SHAPE = /^(?:[Ee][Uu][Hh]\d{3}[A-Za-z]?|[Hh]\d{3}[A-Za-z]{0,2})$/;
const P_SHAPE = /^[Pp]\d{3}$/;
const PICTOGRAM_SHAPE = /^[Gg][Hh][Ss]0[1-9]$/;

/**
 * Годится ли код для параметра `pstat`.
 *
 * ⚠⚠ КОМБИНИРОВАННЫЕ КОДЫ НЕ ГОДЯТСЯ, И ЭТО НЕ ПРОБЕЛ РАЗБОРЩИКА. `P301+P310` —
 * это ОДИН элемент этикетки по Annex IV, а конструктор отмечает фразы по
 * отдельности; передать такую пару параметром значит либо потерять её молча,
 * либо напечатать два элемента вместо одного.
 *
 * ⚠ Функция экспортирована затем, чтобы тот, кто ОБЪЯСНЯЕТ читателю пропуск,
 * считал его ТОЙ ЖЕ формулой, которая его делает. Свой `/^P\d{3}$/`, набранный
 * во втором файле, однажды разойдётся с этим — и текст скажет «ничего не
 * потеряно» при потерянной фразе.
 */
export function isPStatementParam(code: string): boolean {
  return P_SHAPE.test(code);
}

function splitCodes(raw: string | null | undefined, shape: RegExp, limit = 24): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const piece of raw.split(',')) {
    const v = piece.trim();
    if (!v || !shape.test(v)) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Находит настоящий код в перечне. Сначала точное совпадение; если его нет —
 * совпадение без учёта регистра, но ТОЛЬКО когда оно единственное.
 *
 * ⚠⚠ Неоднозначность здесь реальна, а не теоретическая: `h360fd` без учёта
 * регистра совпадает и с `H360Fd`, и с `H360FD` — а это «предположительно
 * наносит вред нерождённому ребёнку» против «наносит вред». Угадывать в этом
 * месте — значит напечатать на этикетке не ту опасность. Возвращаем `null`.
 */
export function resolveStatementCode(raw: string, known: readonly string[]): string | null {
  if (known.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  const hits = known.filter((c) => c.toLowerCase() === lower);
  return hits.length === 1 ? hits[0] : null;
}

export function resolveStatementCodes(raw: readonly string[], known: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of raw) {
    const hit = resolveStatementCode(code, known);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

// ── Разбор адреса ───────────────────────────────────────────────────────────

/**
 * Разбирает строку запроса. Неизвестные значения ИГНОРИРУЮТСЯ МОЛЧА — адрес
 * пишет человек, и `?jur=eu` вместо `?jur=clp` не должен обнулять страницу.
 *
 * ⚠⚠ ЗДЕСЬ СТРОКОВЫЕ ЛИТЕРАЛЫ, А НЕ `LM_PARAM.cas`, И ЭТО НЕ НЕБРЕЖНОСТЬ.
 * Проверка `subs-deeplink-params` в `check:dist` ищет в СОБРАННОМ бандле
 * острова литерал `get("cas")`. Её сила ровно в том, что она смотрит не на наше
 * ожидание, а на то, что реально поехало в браузер, — иначе она сверяла бы наше
 * ожидание с нашим же ожиданием. Обращение `q.get(LM_PARAM.cas)` сборщик в
 * литерал не разворачивает, и проверка честно упала на первом же прогоне этой
 * правки: «LabelConstructorLoader не читает ?cas=».
 *
 * `satisfies typeof LM_PARAM.<имя>` возвращает единственность источника: литерал
 * ОБЯЗАН совпасть с `LM_PARAM`, иначе не соберутся типы. То есть имя видно
 * бандлу текстом, а разойтись эти два места уже не могут.
 */
export function parseLabelMakerParams(search: string | URLSearchParams): LabelMakerParams {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const cas = q.get('cas' satisfies typeof LM_PARAM.cas);
  return {
    cas: cas && cas.trim() ? cas.trim() : null,
    jurisdiction: normalizeJurisdiction(q.get('jur' satisfies typeof LM_PARAM.jurisdiction)),
    purpose: normalizePurpose(q.get('purpose' satisfies typeof LM_PARAM.purpose)),
    stock: q.get('stock' satisfies typeof LM_PARAM.stock)?.trim() || null,
    lang: q.get('lang' satisfies typeof LM_PARAM.lang)?.trim() || null,
    h: splitCodes(q.get('h' satisfies typeof LM_PARAM.h), H_SHAPE),
    p: splitCodes(q.get('pstat' satisfies typeof LM_PARAM.p), P_SHAPE),
    pictograms: splitCodes(q.get('pic' satisfies typeof LM_PARAM.pictogram), PICTOGRAM_SHAPE, 9),
    signal: normalizeSignal(q.get('signal' satisfies typeof LM_PARAM.signal)),
  };
}

/**
 * Ручной режим включается, когда в адресе есть хоть один элемент классификации.
 *
 * ⚠ `cas` СИЛЬНЕЕ: если пришли и вещество, и коды, показываем вещество. Иначе
 * ссылка «H226 для ацетона» открыла бы пустой ручной режим вместо ацетона.
 */
export function wantsManualMode(p: LabelMakerParams): boolean {
  if (p.cas) return false;
  return (p.h?.length ?? 0) > 0 || (p.p?.length ?? 0) > 0 || (p.pictograms?.length ?? 0) > 0 || p.signal !== null;
}

// ── Сборка адреса ───────────────────────────────────────────────────────────

/**
 * Собирает ссылку в конструктор. `base` — хаб или его ветка/шаблон; со слэшем
 * на конце, как везде на сайте.
 *
 * ⚠ Пустые массивы и `null` не пишутся вовсе: `?h=` в адресе выглядит как
 * «фразы были и их сняли», а не как «фраз не передавали».
 */
export function labelMakerHref(params: LabelMakerParams = {}, base: string = LABEL_MAKER_BASE): string {
  const path = base.endsWith('/') ? base : `${base}/`;
  const q = new URLSearchParams();

  if (params.cas) q.set(LM_PARAM.cas, params.cas);
  const jur = normalizeJurisdiction(params.jurisdiction ?? null);
  if (jur) q.set(LM_PARAM.jurisdiction, jur);
  const purpose = normalizePurpose(params.purpose ?? null);
  if (purpose) q.set(LM_PARAM.purpose, purpose);
  if (params.stock) q.set(LM_PARAM.stock, params.stock);
  if (params.lang) q.set(LM_PARAM.lang, params.lang);

  const h = (params.h ?? []).filter((c) => H_SHAPE.test(c));
  if (h.length) q.set(LM_PARAM.h, h.join(','));
  const p = (params.p ?? []).filter((c) => P_SHAPE.test(c));
  if (p.length) q.set(LM_PARAM.p, p.join(','));
  const pic = (params.pictograms ?? []).filter((c) => PICTOGRAM_SHAPE.test(c));
  if (pic.length) q.set(LM_PARAM.pictogram, pic.join(','));

  const signal = normalizeSignal(params.signal ?? null);
  if (signal) q.set(LM_PARAM.signal, signal);

  if (params.from) q.set(LM_PARAM.from, params.from);

  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Проверка адреса возврата: годится ли он как цель перехода.
 *
 * ⚠⚠⚠ ЗНАЧЕНИЕ ПРИХОДИТ ИЗ АДРЕСНОЙ СТРОКИ, ПОЭТОМУ ПРОВЕРЯЕТСЯ ДВАЖДЫ — по
 * форме и по списку. Подставить сюда `//example.com/` или
 * `/ghs-label-maker/../../wherever/` значит получить открытый редирект с нашего
 * домена: человек видит ссылку на ghspictograms.com, а уезжает на чужой сайт.
 * Одной проверки формы мало (её легко ослабить правкой регулярного выражения),
 * одного списка мало тоже (страница может забыть его передать).
 *
 * ⚠⚠ ПУСТОЙ СПИСОК ЗАПРЕЩАЕТ ВСЁ, А НЕ РАЗРЕШАЕТ. Страница, не передавшая
 * список страниц раздела, обязана вернуть человека на корень — это заметный, но
 * безопасный отказ. Обратное умолчание пустило бы куда угодно ровно в том
 * случае, когда о безопасности забыли.
 */
export function normalizeLabelMakerBase(
  raw: string | null | undefined,
  knownBranchPaths: readonly string[],
): string | null {
  if (!raw) return null;
  const v = raw.trim();
  // ⚠ Только путь от корня сайта: ни схемы, ни хоста, ни протокол-независимого
  // `//host`, ни попыток выйти вверх, ни обратных слэшей (их часть браузеров
  // разбирает как прямые).
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (v.includes('..') || v.includes('\\')) return null;
  const path = v.endsWith('/') ? v : `${v}/`;
  if (!path.startsWith(LABEL_MAKER_BASE)) return null;
  // Ветка — один сегмент от базы, шаблон — два. Больше в разделе нет ничего.
  const rest = path.slice(LABEL_MAKER_BASE.length);
  if (rest && !/^[a-z0-9-]+\/([a-z0-9-]+\/)?$/.test(rest)) return null;
  return knownBranchPaths.includes(path) ? path : null;
}

/**
 * Единственный способ узнать, куда возвращать человека со страницы подбора.
 * Всегда отдаёт годный адрес: неизвестный или подделанный `from` молча
 * превращается в корень раздела.
 */
export function readReturnBase(
  search: string | URLSearchParams,
  knownBranchPaths: readonly string[],
): string {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = q.get('from' satisfies typeof LM_PARAM.from);
  return normalizeLabelMakerBase(raw, knownBranchPaths) ?? LABEL_MAKER_BASE;
}

/** Имя параметра затравки поиска на странице подбора. */
export const LM_PICK_SEED = 'q';

/**
 * Адрес страницы подбора вещества.
 *
 * ⚠⚠⚠ НАСТРОЙКИ БЕРУТСЯ ИЗ АДРЕСА, А ЕСЛИ ИХ ТАМ НЕТ — ИЗ УМОЛЧАНИЙ СТРАНИЦЫ.
 * Это и есть суть правки session 60, и вот чем она вызвана. На четырнадцати
 * ветках раздела (`/eu-clp/`, `/secondary-container-labels/` и прочих)
 * юрисдикция и назначение приходят в остров ПРОПАМИ, а в адресной строке их нет
 * вовсе. Прежний код копировал липкие параметры ТОЛЬКО из адреса — копировать
 * было нечего. Человек, пришедший за цеховой этикеткой, после выбора вещества
 * получал OSHA-этикетку поставщика на корне раздела, и понять, что произошло,
 * по экрану было нельзя.
 *
 * ⚠ Умолчание НЕ ПЕРЕБИВАЕТ адрес: если человек сам выставил юрисдикцию в
 * инструменте, она уже в адресе, и проп страницы её трогать не должен.
 */
export function pickHrefFor(opts: {
  /** `window.location.search` страницы, с которой уходим. */
  search: string;
  /** `window.location.pathname` той же страницы — ветка, шаблон или корень. */
  base: string;
  /** Что человек успел набрать в строке поиска. */
  seed?: string;
  /** Умолчания страницы: то, что пришло в остров пропами. */
  defaults?: {
    jurisdiction?: JurisdictionKey | null;
    purpose?: LabelPurpose | null;
    stock?: string | null;
    lang?: string | null;
  };
}): string {
  const cur = new URLSearchParams(opts.search);
  const q = new URLSearchParams();
  const base = opts.base.endsWith('/') ? opts.base : `${opts.base}/`;

  /**
   * ⚠⚠ НА КОРНЕ РАЗДЕЛА УМОЛЧАНИЯ НЕ ПОДМЕШИВАЮТСЯ, И ЭТО НЕ НЕДОДЕЛКА.
   * На корне проп острова — это умолчание САМОГО КОМПОНЕНТА (`osha`,
   * `supplier`), а не выбор страницы: писать его в адрес значит выдать
   * «человек ничего не выбирал» за «человек выбрал OSHA». Адрес корня остаётся
   * чистым, как и был. На ветке всё наоборот: там проп — это и есть решение
   * страницы, ради которого человек по ссылке и пришёл.
   */
  const onBranch = base !== LABEL_MAKER_BASE;
  const fallback: Record<string, string | null | undefined> = onBranch
    ? {
        [LM_PARAM.jurisdiction]: opts.defaults?.jurisdiction,
        [LM_PARAM.purpose]: opts.defaults?.purpose,
        [LM_PARAM.stock]: opts.defaults?.stock,
        [LM_PARAM.lang]: opts.defaults?.lang,
      }
    : {};
  for (const name of LM_STICKY_PARAMS) {
    const v = cur.get(name) || fallback[name];
    if (v) q.set(name, v);
  }

  if (onBranch) q.set(LM_PARAM.from, base);

  const seed = opts.seed?.trim();
  if (seed) q.set(LM_PICK_SEED, seed);

  const s = q.toString();
  return `${LABEL_MAKER_BASE}pick/${s ? `?${s}` : ''}`;
}

/**
 * Что сохранить в адресе, когда человек внутри конструктора выбрал вещество.
 *
 * ⚠⚠ ДО ЭТОЙ ПРАВКИ `setLabelConstructorUrl` СОБИРАЛА АДРЕС ЗАНОВО из базы и
 * одного `?cas=`, стирая всё остальное. На `/ghs-label-maker/?jur=clp&lang=de`
 * выбор вещества выкидывал человека в OSHA по-английски — ровно в тот момент,
 * когда он наконец нашёл своё вещество. Тот же класс, что чинили в session 43 с
 * жёстким `pushState`.
 */
export function labelMakerUrlAfterSelect(currentSearch: string, base: string, cas: string | null): string {
  const from = new URLSearchParams(currentSearch);
  const q = new URLSearchParams();
  for (const name of LM_STICKY_PARAMS) {
    const v = from.get(name);
    if (v) q.set(name, v);
  }
  if (cas) q.set(LM_PARAM.cas, cas);
  const path = base.endsWith('/') ? base : `${base}/`;
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Проверка ссылки — ею пользуется `check:dist`, чтобы ловить чужие и
 * опечатанные параметры в собранных страницах.
 *
 * Возвращает список претензий; пустой список — ссылка годная.
 */
export function labelMakerHrefProblems(href: string, knownBranchPaths: readonly string[]): string[] {
  const problems: string[] = [];
  const [rawPath, rawQuery = ''] = href.split('#')[0].split('?');
  const path = rawPath.endsWith('/') ? rawPath : `${rawPath}/`;

  if (!path.startsWith(LABEL_MAKER_BASE)) {
    problems.push(`не адрес раздела: ${path}`);
    return problems;
  }
  if (!knownBranchPaths.includes(path)) problems.push(`нет такой страницы раздела: ${path}`);

  // ⚠ `forEach`, а не `for…of q.entries()`: итератор `URLSearchParams` требует
  // `lib: DOM.Iterable`, и на проекте без него сборка падала бы типами.
  const known = new Set<string>(Object.values(LM_PARAM));
  new URLSearchParams(rawQuery).forEach((value, name) => {
    if (!known.has(name)) { problems.push(`чужой параметр «${name}»`); return; }
    if (name === LM_PARAM.jurisdiction && !normalizeJurisdiction(value)) problems.push(`негодная юрисдикция «${value}»`);
    if (name === LM_PARAM.purpose && !normalizePurpose(value)) problems.push(`негодное назначение «${value}»`);
    if (name === LM_PARAM.signal && !normalizeSignal(value)) problems.push(`негодное сигнальное слово «${value}»`);
    if (name === LM_PARAM.h && splitCodes(value, H_SHAPE).length === 0) problems.push(`ни одного годного H-кода в «${value}»`);
    if (name === LM_PARAM.p && splitCodes(value, P_SHAPE).length === 0) problems.push(`ни одного годного P-кода в «${value}»`);
    if (name === LM_PARAM.pictogram && splitCodes(value, PICTOGRAM_SHAPE, 9).length === 0) problems.push(`ни одной годной пиктограммы в «${value}»`);
    // ⚠ Адрес возврата сверяется тем же списком, что и сам путь ссылки: чужая
    // страница в `from` — такой же дефект, как чужая страница в пути.
    if (name === LM_PARAM.from && !normalizeLabelMakerBase(value, knownBranchPaths)) problems.push(`негодный адрес возврата «${value}»`);
  });
  return problems;
}
