// src/lib/labelLanguages.ts
// Второй язык этикетки: список языков и загрузка официальных текстов фраз.
//
// ⚠⚠ ТЕКСТЫ НЕ ПЕРЕВОДЯТСЯ И НЕ ПОДБИРАЮТСЯ — они берутся из регламента. H- и
// EUH-фразы напечатаны в CLP Annex III, P-фразы в Annex IV, каждая сразу на всех
// 24 официальных языках. Мы их только достаём из таблицы `statement_translations`
// по коду. Ни машинный перевод, ни «похожая формулировка» здесь недопустимы:
// на этикетке стоит текст, у которого есть юридически установленная редакция.
//
// ⭐ СИГНАЛЬНЫЕ СЛОВА ТЕПЕРЬ ЕСТЬ (session 48): 46 строк, 23 языка, annex = 'I',
// коды `SIGNAL_DANGER` и `SIGNAL_WARNING`. Они лежали не в Annex III/IV, а в
// таблицах элементов этикетки Annex I, и брать их пришлось из языковых версий
// регламента — по одной загрузке на язык.
//
// ⚠⚠ НАЗНАЧЕНИЕ УРОВНЯ ДОКАЗАНО, А НЕ ПЕРЕВЕДЕНО. В части языковых версий сам
// регламент противоречив: в греческой на позиции Warning стоит «Προσοχή» в 16
// таблицах и «Προειδοποίηση» в 11, в латышской два разных НАБОРА слов. Слово
// взято из Art. 20(3) — правила приоритета, где оба слова стоят в фиксированном
// порядке, — а таблицы Annex I служат сверкой. Большинством голосов такие вещи
// не решаются: на этикетке стоит обязательный элемент.
//
// ⚠⚠ ИРЛАНДСКОГО СИГНАЛЬНОГО СЛОВА НЕТ И НЕ БУДЕТ. Консолидированного CLP на
// ирландском не существует вовсе (все адреса CELLAR отдают 404), при том что
// ирландские тексты H- и P-фраз есть: они напечатаны внутри многоязычных таблиц
// Annex III и IV. Поэтому ирландский годится ВТОРЫМ языком и не годится
// основным: этикетка вышла бы без обязательного элемента. Написать «Contúirt»
// от себя — значит сочинить юридический текст.
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
 * ⚠⚠ ЯЗЫК, КОТОРЫЙ НЕ МОЖЕТ БЫТЬ ОСНОВНЫМ.
 *
 * Ирландский годится ВТОРЫМ языком и не годится основным, и причина не в объёме
 * данных: тексты H- и P-фраз на ирландском у нас есть — они напечатаны внутри
 * многоязычных таблиц Annex III и IV. Нет СИГНАЛЬНОГО СЛОВА: сигнальные слова
 * стоят в таблицах Annex I, а консолидированного CLP на ирландском не
 * существует вовсе (все адреса CELLAR отдают 404).
 *
 * Сигнальное слово — обязательный элемент этикетки (Art. 17(1)(d)). Этикетка,
 * у которой основной язык ирландский, вышла бы без него. Написать «Contúirt» от
 * себя нельзя: это сочинение юридического текста, а не перевод.
 *
 * ⚠ Скрывать ирландский молча тоже нельзя. Человек, поставляющий в Ирландию,
 * обязан узнать ПОЧЕМУ его нет в списке, — иначе он решит, что мы просто чего-то
 * не доделали, и пойдёт искать инструмент, который «умеет ирландский».
 */
export const PRIMARY_LANGUAGE_EXCLUDED = 'GA';

export const PRIMARY_LANGUAGE_EXCLUDED_REASON =
  'Irish cannot be the primary language here. The H and P statement texts exist in Irish — they are printed '
  + 'inside the multilingual tables of CLP Annexes III and IV — but the signal word does not: signal words live '
  + 'in the Annex I tables, and no consolidated CLP text has ever been published in Irish. A signal word is a '
  + 'mandatory label element under Art. 17(1)(d), so an Irish-primary label would be missing one. '
  + 'Irish is still available as the second language. For Ireland, English-primary + Irish-second is what this '
  + 'tool can produce lawfully.';

/**
 * Языки, доступные ОСНОВНЫМ языком этикетки.
 * ⚠ Список строится вычитанием, а не переписыванием: новый официальный язык ЕС
 * попадёт сюда сам, и забыть его будет негде.
 */
export const PRIMARY_LANGUAGES: EuLanguage[] =
  EU_LANGUAGES.filter((l) => l.code !== PRIMARY_LANGUAGE_EXCLUDED);

/**
 * Языки, которые стоит предложить ОСНОВНЫМ для юрисдикции.
 *
 * ⚠ Для OSHA и WHMIS основной язык — английский, и это не предпочтение: 29 CFR
 * 1910.1200(f) и HPR s. 6.2 написаны про английский текст. Предлагать испанский
 * первым в US-режиме значит подсказывать незаконную этикетку.
 */
export function suggestedPrimaryLanguages(jurisdiction: string): string[] {
  if (jurisdiction === 'osha' || jurisdiction === 'whmis' || jurisdiction === 'gbclp') return ['EN'];
  return ['EN', 'DE', 'FR', 'ES', 'IT', 'PL', 'NL'];
}

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
 * Коды сигнальных слов в `statement_translations`.
 *
 * ⚠ Это НЕ коды регламента: у сигнальных слов кода нет вовсе, он придуман нами,
 * чтобы положить их в ту же таблицу, что и фразы. Литералы вынесены сюда,
 * потому что их читают и импорт, и конструктор, и разъехаться им негде.
 */
export const SIGNAL_CODE = { danger: 'SIGNAL_DANGER', warning: 'SIGNAL_WARNING' } as const;

/** Слово для уровня опасности на выбранном языке, или `null`. */
export function signalWordFor(
  texts: TranslationMap,
  level: 'danger' | 'warning' | null,
): string | null {
  if (!level) return null;
  return texts[SIGNAL_CODE[level]] ?? null;
}

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
