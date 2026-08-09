// src/lib/statementTranslations.ts
//
// Официальные формулировки H- и P-фраз на 24 языках ЕС — и, что не менее важно,
// ОБЪЯСНЕНИЕ ДЛЯ ТЕХ КОДОВ, У КОТОРЫХ ИХ НЕТ.
//
// ⚠⚠ ПОЧЕМУ ОБЪЯСНЕНИЕ ВАЖНЕЕ САМОЙ ТАБЛИЦЫ. Замер session 52: из 117 P-кодов
// переводы есть у 97, а у 20 нет. Молча не показать секцию на этих двадцати —
// значит сказать читателю «мы не доделали». На девятнадцати из двадцати это
// неправда: перевода нет ПОТОМУ ЧТО НЕТ ТЕКСТА В РЕГЛАМЕНТЕ.
//
//   10 кодов (P203, P236, P265, P316–P319, P322, P323, P354) — коды UN GHS
//      Rev.11, которых ЕС не принял. Языковых версий Annex IV для них нет и быть
//      не может: Annex IV печатает то, что в регламенте есть.
//    8 кодов (P221, P281, P285, P307, P309, P341, P374, P422) — ИЗЪЯТЫ из CLP.
//      Действующая сводная редакция их формулировку больше не печатает.
//    1 код (P350) — мёртв с UN GHS Rev.3, нет нигде.
//   ⚠⚠ 1 код (P503) — current И в CLP, И в UN GHS. Вот ЭТО наш пробел, а не
//      факт о регламенте, и говорить о нём надо иначе, чем о первых девятнадцати.
//
// ⭐ То же правило, что с ирландским языком в session 51: причину объясняем на
// экране, а не решаем молчаливым вырезанием из списка.
//
// ⚠ Причина берётся ИЗ СТАТУСА В ЮРИСДИКЦИИ, который на странице уже загружен,
// а не из списка кодов, набранного здесь руками. Список разошёлся бы с базой на
// первой же ATP.

import { EU_LANGUAGES, type EuLanguage } from './labelLanguages';

/** Строка `statement_translations`. */
export type TranslationRow = {
  lang: string;
  text: string;
  source_ref: string | null;
  /** `II` · `III` · `IV` · `VI` — где в регламенте напечатана эта формулировка. */
  annex?: string | null;
};

export type TranslationLine = { language: EuLanguage; text: string };

/**
 * Раскладывает строки базы В ПОРЯДКЕ, В КОТОРОМ ЯЗЫКИ ПЕЧАТАЕТ САМ РЕГЛАМЕНТ.
 *
 * ⚠ Не по алфавиту английских названий: порядок EUR-Lex (BG, ES, CS, DA, DE …)
 * — это порядок официальных языков ЕС, и читатель, сверяющий нашу таблицу с
 * PDF регламента, идёт по строкам сверху вниз.
 * ⚠ `lang` в базе — `character`, то есть может прийти дополненным пробелами.
 */
export function orderedTranslations(rows: readonly TranslationRow[]): TranslationLine[] {
  const byLang = new Map<string, string>();
  for (const r of rows) {
    const code = (r.lang ?? '').trim().toUpperCase();
    const text = (r.text ?? '').trim();
    if (code && text && !byLang.has(code)) byLang.set(code, text);
  }
  const out: TranslationLine[] = [];
  for (const language of EU_LANGUAGES) {
    const text = byLang.get(language.code);
    if (text) out.push({ language, text });
  }
  return out;
}

/**
 * Как называется место в регламенте, откуда взята формулировка.
 *
 * ⚠⚠ ЭТО НЕ КОСМЕТИКА ПОДПИСИ. Девять суффиксных кодов (H350i, H360F, H360D,
 * H361f, H361d, H360FD, H361fd, H360Fd, H360Df) напечатаны НЕ в Annex III, а в
 * Annex VI Part 1, п. 1.1.2.1.2 — отдельным списком «дополнительных кодов».
 * Страница до session 53 подписывала их «Annex III», потому что номер аннекса
 * вычислялся из ВИДА КОДА (`H…` → III), а не брался из строки базы. Читатель,
 * пошедший сверять текст с Annex III, не нашёл бы там ни одного из девяти.
 *
 * ⭐ То же правило, что с причиной отсутствия перевода: факт о регламенте
 * берётся из данных, а не выводится из формы кода.
 */
export function annexLabel(annex: string | null | undefined): string {
  const a = (annex ?? '').trim().toUpperCase();
  if (a === 'VI') return 'Annex VI, Part 1, section 1.1.2.1.2';
  if (a === 'II' || a === 'III' || a === 'IV') return `Annex ${a}`;
  // ⚠ Неизвестное значение не выдумываем: подпись обязана быть проверяемой.
  return a ? `Annex ${a}` : 'the consolidated regulation';
}

/**
 * Почему ирландского в таблице либо нет, либо он есть, но основным быть не может.
 *
 * ⚠⚠ ПРИЧИНА РАЗНАЯ У РАЗНЫХ АННЕКСОВ, И ОДНИМ ТЕКСТОМ ЕЁ НЕ ОПИСАТЬ.
 *
 * · Annex III и IV печатают фразы МНОГОЯЗЫЧНЫМИ таблицами — ирландская строка
 *   там есть, и в нашей таблице языков 24. Ирландский всё равно не может быть
 *   ОСНОВНЫМ языком этикетки, но по другой причине: сигнальное слово стоит в
 *   Annex I, а консолидированного CLP на ирландском не публиковали никогда.
 *
 * · Annex VI Part 1 — не многоязычная таблица, а обычный текст раздела. Он
 *   существует только внутри языковой версии сводного регламента, а её на
 *   ирландском нет. Значит, у девяти суффиксных кодов ирландской формулировки
 *   нет НИГДЕ, и языков в таблице 23.
 *
 * ⚠ Пустая строка вместо объяснения читалась бы как «мы не доделали» — ровно то,
 * ради чего заведён этот файл.
 */
export function irishCoverageNote(hasIrish: boolean, annex: string | null | undefined): string {
  if (hasIrish) {
    return 'Irish is one of the 24 official languages and its H and P texts are printed inside the '
      + 'multilingual Annex tables, but no consolidated CLP has ever been published in Irish — which is '
      + 'why an Irish-primary label cannot be built here.';
  }
  return `Irish is the 24th official language and it is missing from this table, which is a fact about the `
    + `regulation rather than a gap on our side. The wording of this code is set out in ${annexLabel(annex)}, `
    + `a section of running text rather than one of the multilingual tables — and section text exists only `
    + `inside a language version of the consolidated regulation. None has ever been published in Irish, so no `
    + `Irish wording of this code exists anywhere. The same absence is why an Irish-primary label cannot be `
    + `built here.`;
}

export type MissingReason = {
  /** Короткая причина для подзаголовка секции. */
  headline: string;
  /** Развёрнутое объяснение. */
  body: string;
  /** ⚠⚠ true — это НАШ пробел, а не факт о регламенте. Подаётся иначе. */
  ours: boolean;
};

/**
 * Почему у кода нет официальных переводов.
 *
 * `euStatus` — `p_statement_jurisdiction.status` / `h_statement_jurisdiction.status`
 * для `EU_CLP`: `current` | `withdrawn` | `absent` (или `undefined`, если строки нет).
 */
export function missingTranslationReason(code: string, euStatus: string | undefined): MissingReason {
  // ⚠ Здесь строк базы НЕТ, поэтому аннекс приходится выводить из вида кода —
  // единственное место, где это допустимо. ⚠⚠ Суффиксная форма (`H360FD`,
  // `H350i`) названа отдельно: она стоит в Annex VI Part 1, а не в Annex III, и
  // без этой ветки объяснение отправляло бы читателя не в тот раздел.
  const isSuffix = /^H\d{3}[A-Za-z]{1,2}$/.test(code);
  const annex = isSuffix
    ? annexLabel('VI')
    : code.startsWith('P') ? 'Annex IV' : code.startsWith('EUH') ? 'Annex II' : 'Annex III';
  // ⚠⚠ Языковых версий у Annex VI Part 1 не 24, а 23: сводного CLP на ирландском
  // нет, а раздел существует только внутри сводной редакции. Написать «во всех
  // 24 языковых версиях» про эти коды значило бы пообещать текст, которого нет.
  const versions = isSuffix ? '23 language versions' : 'all 24 language versions';

  if (euStatus === 'absent' || euStatus === undefined) {
    return {
      ours: false,
      headline: `${code} is not part of EU CLP, so it has no official EU wording`,
      // ⚠ Это не «мы не нашли», а «его там нет». Разница существенная: читатель,
      // которому нужен немецкий текст, должен понять, что искать его негде.
      body:
        `The 24 language versions print what the regulation itself contains, and ${code} is a UN GHS code the European Union has not adopted. `
        + `CLP ${annex} therefore carries no wording for it in any language, English included — the English sentence above is the UN model text. `
        + `A supplier placing a product on the EU market uses the CLP codes; ${code} belongs to jurisdictions that follow the UN text more closely.`,
    };
  }

  if (euStatus === 'withdrawn') {
    return {
      ours: false,
      headline: `${code} was deleted from CLP ${annex}, so there is no current official wording`,
      body:
        `The consolidated regulation no longer prints this code, and the language versions follow it — a deleted code loses its official wording in all 24 languages at once. `
        + `That does not make the code meaningless: labels printed before the deletion legally carried it, and safety data sheets still quote it. `
        + `See the legal-status table below for the edition that removed it and for the code that replaced it, if there is one.`,
    };
  }

  // ⚠⚠ euStatus === 'current' — а перевода нет. Это единственный случай, когда
  // виноваты мы. Замер session 52: такой ровно один среди P-кодов — P503, и
  // причина найдена: в HTML EUR-Lex между строкой P502 и строкой P503 вставлена
  // отдельная строка таблицы с маркером поправки `▼M19`, на которой спотыкается
  // импортёр. P503 — последний код таблицы, поэтому пострадал он один.
  return {
    ours: true,
    headline: `We do not yet hold the official translations of ${code}`,
    body:
      `This code is current under EU CLP, so the wording does exist in ${versions} of ${annex} — we simply have not imported it correctly yet. `
      + `This is a gap on our side, not in the regulation. Until it is filled, take the wording from the language version of the regulation itself rather than translating the English sentence above: `
      + `the official text is a legal wording, not a translation choice.`,
  };
}
