// src/lib/labelLanguages.ts
// Второй язык этикетки: список языков и загрузка официальных текстов фраз.
//
// ⚠⚠ ТЕКСТЫ НЕ ПЕРЕВОДЯТСЯ И НЕ ПОДБИРАЮТСЯ — они берутся из регламента. H- и
// EUH-фразы напечатаны в CLP Annex III, P-фразы в Annex IV, каждая сразу на всех
// 24 официальных языках. Мы их только достаём из таблицы `statement_translations`
// по коду. Ни машинный перевод, ни «похожая формулировка» здесь недопустимы:
// на этикетке стоит текст, у которого есть юридически установленная редакция.
//
// ⚠⚠ СИГНАЛЬНОГО СЛОВА ЗДЕСЬ НЕТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ. Официальные переводы
// «Danger» и «Warning» лежат в Annex I, а не в Annex III/IV, и в английской
// версии консолидированного текста они, разумеется, только по-английски. Пока
// они не выгружены из языковых версий Annex I, второй блок печатается БЕЗ
// сигнального слова. Написать «Attention» от себя — значит сочинить обязательный
// элемент этикетки; ошибка вылезет не у нас, а у того, кто её наклеит.
//
// Источник: EUR-Lex / Publications Office, CELEX 02008R1272.
// Лицензия Commission Decision 2011/833/EU — свободное повторное использование
// при указании источника. Юридически аутентичен только текст в электронном
// Official Journal (Reg. 216/2013, Art. 1(2)).

import { supabase } from './supabase';

export type EuLanguage = { code: string; name: string; native: string };

/**
 * 24 официальных языка ЕС в порядке, в котором их печатает регламент.
 * ⚠ Исландского и норвежского здесь нет: они не языки ЕС, и в аннексах их тоже
 * нет — тексты ЕЭП публикует Секретариат ЕАСТ отдельно.
 */
export const EU_LANGUAGES: EuLanguage[] = [
  { code: 'BG', name: 'Bulgarian', native: 'български' },
  { code: 'ES', name: 'Spanish', native: 'español' },
  { code: 'CS', name: 'Czech', native: 'čeština' },
  { code: 'DA', name: 'Danish', native: 'dansk' },
  { code: 'DE', name: 'German', native: 'Deutsch' },
  { code: 'ET', name: 'Estonian', native: 'eesti' },
  { code: 'EL', name: 'Greek', native: 'ελληνικά' },
  { code: 'EN', name: 'English', native: 'English' },
  { code: 'FR', name: 'French', native: 'français' },
  { code: 'GA', name: 'Irish', native: 'Gaeilge' },
  { code: 'HR', name: 'Croatian', native: 'hrvatski' },
  { code: 'IT', name: 'Italian', native: 'italiano' },
  { code: 'LV', name: 'Latvian', native: 'latviešu' },
  { code: 'LT', name: 'Lithuanian', native: 'lietuvių' },
  { code: 'HU', name: 'Hungarian', native: 'magyar' },
  { code: 'MT', name: 'Maltese', native: 'Malti' },
  { code: 'NL', name: 'Dutch', native: 'Nederlands' },
  { code: 'PL', name: 'Polish', native: 'polski' },
  { code: 'PT', name: 'Portuguese', native: 'português' },
  { code: 'RO', name: 'Romanian', native: 'română' },
  { code: 'SK', name: 'Slovak', native: 'slovenčina' },
  { code: 'SL', name: 'Slovenian', native: 'slovenščina' },
  { code: 'FI', name: 'Finnish', native: 'suomi' },
  { code: 'SV', name: 'Swedish', native: 'svenska' },
];

export const LANGUAGE_BY_CODE = new Map(EU_LANGUAGES.map((l) => [l.code, l]));

/**
 * Языки, которые стоит предложить первыми для выбранной юрисдикции.
 *
 * ⚠ Для Канады это FR, и не по популярности: HPR s. 6.2 требует ОБА официальных
 * языка, и одноязычная этикетка поставщика там незаконна.
 */
export function suggestedLanguages(jurisdiction: string): string[] {
  if (jurisdiction === 'whmis') return ['FR'];
  if (jurisdiction === 'osha') return ['ES', 'FR'];
  return ['DE', 'FR', 'ES', 'IT', 'PL', 'NL'];
}

export type TranslationMap = Record<string, string>;

/**
 * Официальные тексты фраз на выбранном языке.
 *
 * Возвращает карту «код → текст». ⚠ Коды, которых в карте НЕТ, перевода не имеют
 * вовсе — это не сбой загрузки. Их официального текста нет в действующих
 * приложениях: часть фраз отменена прежними ATP, часть принята UN GHS, но не ЕС,
 * а суффиксные формы (H350i, H360F, H360FD, H361f и прочие) регламент отдельными
 * строками не публикует — они собираются из H350/H360/H361 по правилам Annex VI.
 *
 * ⚠⚠ Склеивать перевод суффиксной формы из перевода базовой НЕЛЬЗЯ: это
 * сочинение юридического текста. Вызывающий обязан оставить такую фразу на
 * английском и сказать об этом человеку.
 */
export async function fetchTranslations(lang: string, codes: string[]): Promise<TranslationMap> {
  if (!lang || codes.length === 0) return {};
  const unique = [...new Set(codes)];
  const out: TranslationMap = {};

  // ⚠ PostgREST режет ответ на тысяче строк, а список кодов может быть длинным.
  // Партиями по 100 — и по длине URL тоже: `in.(…)` уходит строкой запроса.
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data, error } = await supabase
      .from('statement_translations')
      .select('code, text')
      .eq('lang', lang)
      .in('code', chunk);
    // ⚠⚠ Ошибку НЕ глотаем молча. Таблица без политики RLS отдаёт пустой массив
    // без ошибки, и отличить «переводов нет» от «доступ закрыт» можно только
    // здесь — ровно тот тихий отказ из claude/silent-supabase-failures.md.
    if (error) throw new Error(`statement_translations (${lang}): ${error.message}`);
    for (const row of (data ?? []) as { code: string; text: string }[]) {
      out[row.code] = row.text;
    }
  }
  return out;
}

/** Клеймо источника — условие лицензии EUR-Lex, а не вежливость. */
export const EURLEX_ATTRIBUTION =
  '© European Union, https://eur-lex.europa.eu — only the electronic Official Journal of the European Union is authentic.';
