// src/lib/nameForms.ts
// Правила ЧТЕНИЯ записи Annex VI Part 3: формы имени, синонимы, примечания.
//
// ⚠⚠ ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ВСЁ В labelNameForms.ts. Здесь нет ни одного
// обращения к базе, и это условие, а не стиль. `labelNameForms.ts` импортирует
// `./supabase`, а тот на верхнем уровне читает `import.meta.env` и падает вне
// сборки Astro. Значит `scripts/check-dist.ts` (он идёт через tsx) не может
// импортировать оттуда НИЧЕГО — даже чистую функцию. А проверка обязана считать
// имена ТЕМ ЖЕ кодом, которым их печатает страница: свой разбор в проверке
// сверял бы наше ожидание с нашим же ожиданием.
//
// ⚠⚠ ПЕРЕВОДИТЬ ЗДЕСЬ НЕЧЕГО И НЕЛЬЗЯ. Имя на каждом языке напечатано в самом
// Annex VI — мы его только достаём. Ни машинный перевод, ни «то же имя другими
// буквами» недопустимы: у имени на этикетке есть установленная редакция.

// ⚠⚠ Порядок языков берётся из ОДНОГО списка — того же, которым конструктор
// подписывает выбор языка этикетки. Свой список здесь однажды разошёлся бы с
// тем молча (и уже расходился, см. `buildOfficialNames`).
import { EU_LANGUAGE_ORDER } from './euLanguages';

export type NameAnnotationKind =
  | 'composition' | 'form' | 'description' | 'note' | 'abbreviation' | 'scope' | 'unclear';

export type NameAnnotation = { kind: NameAnnotationKind; text: string };

export type LocalisedNames = {
  lang: string;
  indexNumber: string;
  /**
   * Ячейка регламента КАК ЕСТЬ.
   * ⚠⚠ Единственный надёжный текст у записей, разбор которых помечен `unclear`:
   * там формы предлагать нельзя, а показать человеку первоисточник — можно.
   */
  cell: string;
  kind: 'group' | 'single';
  /** Формы записи: у групповой — по маркерам [1] [2], у одиночной одна. */
  forms: string[];
  /**
   * Номера маркеров, по одному на форму, в том же порядке.
   *
   * ⚠⚠ НУЖНЫ РАДИ CAS И EC. Колонки Annex VI хранят номера формы по её маркеру
   * («71-41-0[1]584-02-1[2]»), и связать имя с номером можно ТОЛЬКО через эту
   * цифру. Сопоставление по порядку в списке подставило бы форме чужой CAS —
   * а неверный номер на бумаге читается как верный и отправляет читателя не в
   * ту карточку вещества.
   * ⚠ У одиночной записи пуст: маркеров там нет вовсе.
   */
  memberNumbers: number[];
  /** Синонимы одиночной записи. ⚠ У групповой пустой: там формы, а не синонимы. */
  synonyms: string[];
  annotations: NameAnnotation[];
};

/**
 * ⭐⭐ ПЕЧАТАЕТСЯ НА ЭТИКЕТКЕ ВСЕГДА, КАКУЮ БЫ ФОРМУ ЧЕЛОВЕК НИ ВЫБРАЛ.
 *
 * Annex VI Part 1 п. 1.1.1.4: ссылка на примесь «is then to be considered as a
 * part of the name, and must be included on the label». 491 запись.
 * ⚠ Это ЕДИНСТВЕННЫЙ класс, который печатается. Остальные — сведения о записи.
 */
export const PRINTED_KINDS = new Set<NameAnnotationKind>(['composition']);

/**
 * Показывается подсказкой «это та самая запись», но НЕ печатается.
 *
 * ⚠⚠ Подсказка здесь не украшение. У 10 пар индексных номеров примечание —
 * ЕДИНСТВЕННОЕ различие между РАЗНЫМИ классификациями: `piperazine [solid]`
 * (612-057-00-4) и `piperazine [liquid]` (612-057-01-1) — одно и то же имя и
 * разные наборы H-фраз. Без подсказки человек не отличит свою запись от чужой.
 */
export const HINT_KINDS = new Set<NameAnnotationKind>([
  'form', 'description', 'note', 'abbreviation', 'scope',
]);

/** ⚠⚠ Разбор ячейки ненадёжен — формы предлагать как готовые имена нельзя. */
export const UNRELIABLE_KIND: NameAnnotationKind = 'unclear';

/**
 * Что дописывается к имени на этикетке.
 *
 * ⚠⚠ КВАДРАТНЫЕ СКОБКИ ВОЗВРАЩАЮТСЯ НА МЕСТО, А НЕ ПРИДУМЫВАЮТСЯ. Разбор снял
 * их с конца ячейки (`nitric acid …% [C > 70 %]` → форма плюс примечание), и
 * приписывание обратно восстанавливает ровно тот текст, что стоит в регламенте.
 * ⚠ Примечания в КРУГЛЫХ скобках разбор не снимает вовсе — они остаются внутри
 * имени (`butane (containing ≥ 0,1 % butadiene)`), и дописывать тут нечего.
 */
export function printedNameSuffix(annotations: NameAnnotation[]): string {
  const printed = annotations.filter((a) => PRINTED_KINDS.has(a.kind));
  return printed.map((a) => ` [${a.text}]`).join('');
}

/** Полное имя для печати: выбранная форма плюс обязательное примечание. */
export function nameForLabel(form: string, annotations: NameAnnotation[]): string {
  return `${form}${printedNameSuffix(annotations)}`.trim();
}

/** Подсказки «это та самая запись». ⚠ На этикетку не идут. */
export function identityHints(annotations: NameAnnotation[]): NameAnnotation[] {
  return annotations.filter((a) => HINT_KINDS.has(a.kind));
}

/** Причина, по которой формам этой записи верить нельзя, или `null`. */
export function unreliableReason(annotations: NameAnnotation[]): string | null {
  const a = annotations.find((x) => x.kind === UNRELIABLE_KIND);
  return a ? a.text : null;
}

/**
 * Форма записи вместе с её собственными CAS и EC.
 *
 * ⚠⚠ НОМЕРА БЕРУТСЯ ИЗ `nameVariants` ПО НОМЕРУ МАРКЕРА, А НЕ ПО ПОРЯДКУ.
 * Имена приходят из таблицы переводов, номера — из разбора колонок `substances`
 * (`labelProductName.ts`), и единственное, что их связывает, — цифра в скобках.
 * ⚠ Совпадения нет — номера пустые. Пустое поле честнее чужого номера: по
 * регламенту идентификатор необязателен (Art. 18(2) требует ИМЯ), а неверный
 * отправляет читателя не в ту карточку вещества.
 */
export type FormChoice = { name: string; index?: number; cas?: string; ec?: string };

export function formChoices(
  n: LocalisedNames,
  numbered: { index?: number; cas?: string; ec?: string }[] = [],
): FormChoice[] {
  if (unreliableReason(n.annotations)) return [];
  const byIndex = new Map<number, { cas?: string; ec?: string }>();
  for (const v of numbered) {
    if (v.index && !byIndex.has(v.index)) byIndex.set(v.index, { cas: v.cas, ec: v.ec });
  }
  const out: FormChoice[] = [];
  const seen = new Set<string>();
  n.forms.forEach((raw, i) => {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    const index = n.memberNumbers[i];
    const ids = index ? byIndex.get(index) : undefined;
    out.push({ name, index, cas: ids?.cas, ec: ids?.ec });
  });
  // ⚠ Синонимы одиночной записи идут БЕЗ номеров: у одиночной записи номер один
  // на всю запись, и он уже стоит в полях. Дописывать его к каждому синониму
  // значило бы утверждать, что синонимы — разные вещества.
  for (const raw of n.synonyms) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name });
  }
  return out;
}

/**
 * Что предложить в поле «Product name».
 *
 * Порядок: формы записи, затем синонимы, которых среди форм ещё не было.
 * ⚠⚠ У ГРУППОВОЙ записи формы — РАЗНЫЕ ВЕЩЕСТВА, а не синонимы одного, и
 * подмешивать к ним синонимы нельзя: список бы утверждал, что все эти имена
 * означают содержимое одной упаковки. У групповой записи `synonyms` поэтому
 * всегда пуст, и слияние ниже касается только одиночных.
 *
 * ⚠ Ненадёжная запись не возвращает НИЧЕГО: предложить человеку «and its
 * sodium» как имя хуже, чем не предложить ничего и показать ячейку регламента.
 */
export function nameChoices(n: LocalisedNames): string[] {
  if (unreliableReason(n.annotations)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...n.forms, ...n.synonyms]) {
    const name = v.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// ─────────────── блок «имя записи в языковых редакциях» (session 56) ───────────────
//
// ⚠⚠ ЭТО СПРАВОЧНЫЙ БЛОК, А НЕ ЭТИКЕТКА. Тут не выбирают имя для печати —
// показывают, как запись Annex VI Part 3 названа в каждой языковой редакции
// регламента. Правила разбора те же (выше), а вот отбор другой: на этикетку
// уходит ОДНА выбранная форма, сюда — ВСЕ обозначения ячейки, потому что по
// Art. 18(2) законным идентификатором продукта является любое из них.

/** Колонки, которых хватает и странице, и проверке. ⚠ Один список на оба места. */
export const NAME_TRANSLATION_COLUMNS =
  'index_number, lang, name, kind, forms, synonyms, annotations';

/** Строка `substance_name_translations` в том виде, в каком её отдаёт PostgREST. */
export type NameTranslationRow = {
  index_number: string;
  lang: string;
  name: string;
  kind: string;
  forms: string[] | null;
  synonyms: string[] | null;
  annotations: NameAnnotation[] | null;
};

/**
 * Почему вместо списка обозначений показана ячейка целиком.
 *
 * ⚠⚠ Причина называется словами и попадает на экран. Ячейка с маркерами
 * посреди ровной таблицы имён выглядит как наш недосмотр, и человек либо
 * решит, что данные битые, либо примет `ди- втор -бутиламин` за второе имя
 * своего вещества. И то и другое хуже одной строки объяснения.
 */
export type VerbatimReason = 'group' | 'unclear';

export const VERBATIM_REASON_TEXT: Record<VerbatimReason, string> = {
  group:
    'This language edition of Annex VI files more than one substance under this single entry, '
    + 'so the cell is reproduced as printed: the [1] [2] markers say which name belongs to which '
    + 'member, and the members carry different CAS numbers.',
  unclear:
    'Annex VI writes this entry as a name plus a qualifier that cannot be separated from it '
    + 'mechanically, so the cell is reproduced exactly as the regulation prints it rather than '
    + 'split into names that would each be wrong on their own.',
};

/**
 * ⚠⚠ ЯЗЫК, У КОТОРОГО РЕДАКЦИИ ANNEX VI НЕТ ВОВСЕ.
 *
 * Официальных языков ЕС двадцать четыре, а строк в таблице имён — двадцать три,
 * и это утверждение, а не недоделка. Сводного текста CLP на ирландском не
 * издавалось: все адреса CELLAR отдают 404, значит и Annex VI на ирландском нет,
 * и цитировать нечего.
 *
 * ⚠ Молча показать 23 там, где человек ждёт 24, нельзя: он решит, что мы просто
 * не докачали данные, и пойдёт искать источник, который «умеет ирландский».
 * Поэтому причина стоит рядом с константой и печатается под таблицей.
 * ⚠ Это НЕ то же самое, что `PRIMARY_LANGUAGE_EXCLUDED` в labelLanguages.ts: там
 * ирландский исключён из ОСНОВНЫХ языков этикетки из-за сигнального слова, а
 * тексты H- и P-фраз на нём есть. Здесь причина другая и более общая.
 */
export const ANNEX_VI_LANGUAGE_ABSENT = 'GA';

export const ANNEX_VI_LANGUAGE_ABSENT_REASON =
  'Irish is the twenty-fourth official EU language and has no line here for a different reason: '
  + 'no consolidated CLP text has ever been published in Irish, so there is no Irish edition of '
  + 'Annex VI to quote a name from.';

/** Запись Annex VI на одном языке — так, как её показывает страница вещества. */
export type OfficialName = {
  /** Код языковой редакции регламента: `DE`. */
  code: string;
  /**
   * Обозначения ячейки, в порядке регламента; первое — основное.
   * ⚠ К первому уже дописано обязательное примечание (`nameForLabel`).
   * ⚠⚠ Пусто, когда показывается `verbatim`.
   */
  designations: string[];
  /** Обязательное примечание, дописанное к первому обозначению, или ''. */
  printedSuffix: string;
  /** Ячейка регламента дословно — когда обозначения предлагать нельзя. */
  verbatim: string | null;
  /** Почему показана ячейка целиком; `null` у обычных записей. */
  verbatimReason: VerbatimReason | null;
};

/**
 * Одна строка таблицы переводов → одна строка блока имён.
 *
 * ⚠⚠ ДВА СЛУЧАЯ ПОКАЗЫВАЮТСЯ ЯЧЕЙКОЙ ЦЕЛИКОМ, И ОБА — ПРО ИДЕНТИЧНОСТЬ.
 *
 * 1. `kind = 'group'`. Формы групповой записи — РАЗНЫЕ ВЕЩЕСТВА с разными CAS,
 *    и на странице ОДНОГО вещества список форм утверждал бы, что все они —
 *    имена этого вещества. Замер по 3 650 построенным страницам: таких строк
 *    27 у 5 записей, и четыре из пяти групповые ровно в одной редакции
 *    (`612-049-00-0` — только болгарская: у неё [1] ди-n-бутиламин и
 *    [2] ди-втор-бутиламин, тогда как английская знает одно имя).
 *    ⚠ Связать форму с CAS страницы нечем: маркер живёт в колонках `substances`,
 *    а у построенных страниц CAS одиночный и маркера не несёт.
 * 2. `unclear`. Разбор сам сказал, что не разделил имя и оговорку
 *    (`mecoprop-P (ISO) [1] and its salts; …` — 607-434-00-5, все 23 языка).
 *
 * ⚠ Оба случая уже описаны правилами выше и НЕ являются новым решением: то же
 * самое `formChoices`/`nameChoices` делают для этикетки, возвращая пустой
 * список. Здесь пустого списка мало — человеку показывают первоисточник.
 */
export function officialNameOf(row: NameTranslationRow): OfficialName | null {
  const code = (row.lang ?? '').trim().toUpperCase();
  if (!code) return null;
  const annotations = row.annotations ?? [];
  const cell = (row.name ?? '').trim();

  const verbatim = (reason: VerbatimReason): OfficialName | null =>
    cell ? { code, designations: [], printedSuffix: '', verbatim: cell, verbatimReason: reason } : null;

  // ⚠⚠ ПОРЯДОК ПРОВЕРОК ЗНАЧИМ, И ЭТО НЕ ПРИДИРКА К СТИЛЮ. У `607-434-00-5`
  // (mecoprop-P) стоят ОБА признака: разбор пометил запись групповой по маркерам
  // и одновременно сказал `unclear`. Маркер там у обеих частей один и тот же —
  // `[1]`, — то есть разных членов с разными CAS нет вовсе, и объяснение
  // «запись собирает несколько веществ» было бы прямой неправдой. Поэтому
  // сначала спрашиваем разбор, признаёт ли он себя ненадёжным.
  if (unreliableReason(annotations)) return verbatim('unclear');
  if (row.kind === 'group') return verbatim('group');

  // ⚠⚠ ОБОЗНАЧЕНИЯ — ИЗ `synonyms`, А ФОРМЫ ТОЛЬКО ЗАПАСНЫМ ВАРИАНТОМ. У
  // одиночной записи разбор кладёт в `synonyms` ВЕСЬ список ячейки
  // («acetone; propan-2-one; propanone»), а в `forms` — одно основное имя.
  // Взять `forms` первым значило бы молча выбросить остальные обозначения у
  // 2 176 страниц из 3 650, а по Art. 18(2) законно любое из них.
  const raw = (row.synonyms?.length ? row.synonyms : row.forms) ?? [];
  const designations: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = (item ?? '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    designations.push(name);
  }
  // ⚠ Разбор не дал ни одного обозначения — показываем первоисточник, а не
  // пустую клетку. Пустая клетка читается как «у этой редакции имени нет».
  if (!designations.length) return verbatim('unclear');

  // ⚠⚠ Примечание дописывается к ПЕРВОМУ обозначению тем же `nameForLabel`,
  // которым его печатает конструктор. Дописать ко всем значило бы утверждать,
  // что условие принадлежит каждому имени по отдельности; не дописать вовсе —
  // потерять часть имени, обязательную по Annex VI Part 1 п. 1.1.1.4.
  const printedSuffix = printedNameSuffix(annotations);
  designations[0] = nameForLabel(designations[0], annotations);

  return { code, designations, printedSuffix, verbatim: null, verbatimReason: null };
}

/**
 * Блок имён одной записи Annex VI: по строке на языковую редакцию.
 *
 * ⚠⚠ ИМЕНА НЕ СКЛЕИВАЮТСЯ В ОДНУ СТРОКУ, И ЭТО РЕШЕНИЕ, А НЕ ВЁРСТКА.
 * Разделитель у каждой редакции свой: греческая ставит ано телию `·`, а не
 * точку с запятой. Соединив обозначения нашим знаком, мы напечатали бы имя,
 * которого в регламенте нет, — тот же класс ошибки, из-за которого хвост
 * составной записи оставлен дословным (session 55). Поэтому наружу уходит
 * СПИСОК, а разделитель между его элементами рисует CSS.
 *
 * ⚠⚠ ПОРЯДОК ЗАДАЁТСЯ ЗДЕСЬ И НЕ ПАРАМЕТРИЗУЕТСЯ, И ЭТО ПОЙМАННЫЙ ДЕФЕКТ, А НЕ
 * вкусовщина. В первой редакции он был необязательным аргументом: страница
 * передавала порядок регламента, проверка не передавала ничего и получала
 * порядок строк запроса, то есть алфавитный. Одна функция давала двум
 * вызывающим два разных ответа, и `check:dist` упал на всех 3 650 страницах со
 * словами «набор тот же, а порядок разошёлся».
 * ⭐ Лечится не аргументом, а тем, что источник порядка ОДИН: порядок языков —
 * свойство регламента, а не пожелание вызывающего.
 *
 * ⚠ Языка нет в базе — нет и строки в ответе; ирландского там нет никогда
 * (см. `ANNEX_VI_LANGUAGE_ABSENT`).
 */
export function buildOfficialNames(rows: NameTranslationRow[]): OfficialName[] {
  const byCode = new Map<string, OfficialName>();
  for (const row of rows) {
    const one = officialNameOf(row);
    // ⚠ Первая строка языка выигрывает: дублей в базе быть не должно
    // (ключ `(index_number, lang)`), но молча складывать их в одну ячейку —
    // это как раз тот случай, когда дефект заливки стал бы невидим.
    if (one && !byCode.has(one.code)) byCode.set(one.code, one);
  }
  const out: OfficialName[] = [];
  for (const code of EU_LANGUAGE_ORDER) {
    const one = byCode.get(code);
    if (one) out.push(one);
  }
  return out;
}
