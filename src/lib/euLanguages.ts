// src/lib/euLanguages.ts
// Официальные языки ЕС — список и порядок, в котором их печатает регламент.
//
// ⚠⚠ ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Здесь нет ни одного обращения к базе, и это условие,
// а не стиль. `labelLanguages.ts` импортирует `./supabase`, а тот на верхнем
// уровне читает `import.meta.env` и вне сборки Astro падает — значит из него
// не может импортировать ничего ни `nameForms.ts`, ни `scripts/check-dist.ts`.
// А список обязан быть ОДИН: страница печатает языки в этом порядке, проверка
// в этом же порядке их ждёт.
//
// ⚠⚠ ЭТО НЕ ПРИДИРКА, А ПОЙМАННЫЙ ДЕФЕКТ. В первой редакции session 56 порядок
// был необязательным аргументом `buildOfficialNames`: страница его передавала,
// проверка — нет, и одна функция давала двум вызывающим два разных ответа.
// Проверка упала на всех 3 650 страницах со словами «набор тот же, а порядок
// разошёлся». Лечится не аргументом, а тем, что источник порядка один.
//
// ⚠ Для вызывающих ничего не изменилось: `labelLanguages.ts` реэкспортирует
// этот файл целиком.

export type EuLanguage = { code: string; name: string; native: string };

/**
 * 24 официальных языка ЕС в порядке, в котором их печатает регламент.
 * ⚠ Исландского и норвежского здесь нет: они не языки ЕС, и в аннексах их тоже
 * нет — тексты ЕЭП публикует Секретариат ЕАСТ отдельно.
 * ⚠⚠ ПОРЯДОК ЗНАЧИМ. Это не алфавит по английскому названию и не алфавит по
 * коду: так языки перечислены в самом регламенте, и в этом же порядке идут
 * строки блока имён на странице вещества.
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

/** Только коды, в том же порядке. ⚠ Один источник порядка на страницу и проверку. */
export const EU_LANGUAGE_ORDER: string[] = EU_LANGUAGES.map((l) => l.code);
