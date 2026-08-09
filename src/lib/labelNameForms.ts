// src/lib/labelNameForms.ts
// Имя вещества на ВЫБРАННОМ языке этикетки: загрузка строки из базы.
//
// ⚠⚠ ПРАВИЛА РАЗБОРА ЖИВУТ В `./nameForms` И ОТСЮДА ТОЛЬКО РЕЭКСПОРТИРУЮТСЯ.
// Разделение сделано в session 56 и держится на одном условии: `nameForms.ts`
// не знает про базу, поэтому его может импортировать `scripts/check-dist.ts`
// (он идёт через tsx, а `./supabase` на верхнем уровне читает `import.meta.env`
// и вне сборки Astro падает). Проверка обязана считать имена ТЕМ ЖЕ кодом,
// которым их печатает страница.
// ⚠ Для вызывающих ничего не изменилось: `import { … } from './labelNameForms'`
// продолжает отдавать и правила, и загрузку.
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

import { supabase } from './supabase';
import type { LocalisedNames, NameAnnotation } from './nameForms';

export * from './nameForms';

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
