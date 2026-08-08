// src/lib/labelNameForms.ts
// Имя вещества на ВЫБРАННОМ языке этикетки: формы, синонимы, примечания.
//
// ⚠⚠ ИМЕНА БЕРУТСЯ ИЗ `substance_name_translations`, А НЕ ИЗ `substances` —
// ВКЛЮЧАЯ АНГЛИЙСКИЙ. Это не вопрос удобства: две наши загрузки Annex VI читают
// одну и ту же колонку регламента по-разному, и замер 2026-08-08 по 4 178
// записям дал 2 074 расхождения. Почти всюду вторая таблица лучше:
//
//   substances.display_name_short : «isopentyl formate [1] pentyl formate [2]»
//   substance_name_translations   : ["isopentyl formate", "pentyl formate"]
//
// В `substances` до сих пор лежит весь групповой список одной строкой, а иногда
// и обрезанный по длине колонки («Gases (petroleum, light steam-cracked,
// butadiene conc.…»). Таблица переводов разобрана на формы и примечания, и
// разбор проверен по 23 языкам поимённо.
//
// ⚠ У 3 записей строки переводов нет вовсе (005-022-00-4, 606-156-00-1,
// 649-282-00-2 — они есть в двадцати языковых версиях и отсутствуют в
// английской). Там вызывающий обязан откатиться к `substances`.
//
// ⚠⚠ ПЕРЕВОДИТЬ ЗДЕСЬ НЕЧЕГО И НЕЛЬЗЯ. Имя на каждом языке напечатано в самом
// Annex VI — мы его только достаём. Ни машинный перевод, ни «то же имя другими
// буквами» недопустимы: у имени на этикетке есть установленная редакция.

import { supabase } from './supabase';

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

type Row = {
  index_number: string;
  lang: string;
  name: string;
  kind: string;
  forms: string[] | null;
  members: Record<string, string> | null;
  synonyms: string[] | null;
  annotations: NameAnnotation[] | null;
};

/**
 * Имена записи Annex VI на одном языке.
 *
 * ⚠⚠ Ошибку НЕ проглатываем. Таблица без политики RLS отдаёт пустой массив без
 * ошибки, и «у этой записи нет имени на немецком» выглядит точно так же, как
 * «доступ к таблице закрыт» — см. claude/silent-supabase-failures.md.
 * `null` возвращается только тогда, когда строки действительно нет.
 */
export async function fetchLocalisedNames(
  indexNumber: string,
  lang: string,
): Promise<LocalisedNames | null> {
  if (!indexNumber || !lang) return null;
  const { data, error } = await supabase
    .from('substance_name_translations')
    .select('index_number, lang, name, kind, forms, members, synonyms, annotations')
    .eq('index_number', indexNumber)
    .eq('lang', lang.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`substance_name_translations (${lang}): ${error.message}`);
  if (!data) return null;
  const row = data as Row;
  // ⚠ Порядок тот же, каким разбор строил `forms`: по возрастанию номера
  // маркера. Считаем его здесь заново, а не полагаемся на порядок ключей JSON.
  const memberNumbers = Object.keys(row.members ?? {})
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return {
    lang: row.lang,
    indexNumber: row.index_number,
    cell: row.name ?? '',
    kind: row.kind === 'group' ? 'group' : 'single',
    forms: row.forms ?? [],
    memberNumbers,
    synonyms: row.synonyms ?? [],
    annotations: row.annotations ?? [],
  };
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
