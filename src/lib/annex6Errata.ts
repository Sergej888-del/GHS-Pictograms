// src/lib/annex6Errata.ts
// Ошибки САМОГО регламента в языковых редакциях Annex VI Part 3.
//
// ⚠⚠⚠ ЭТО НЕ СПИСОК НАШИХ ДЕФЕКТОВ И НЕ МЕСТО ДЛЯ ИХ ЗАПЛАТ. Каждая строка
// здесь сверена с первоисточником — файлами `.tmp-eurlex/clp-consolidated-<lang>.html`
// (консолидация CELEX 02008R1272, 23 редакции). В источнике напечатано ровно
// то же, что лежит у нас в базе: наш разбор прочитал регламент верно.
//
// ⚠⚠ ПОЭТОМУ ИМЯ В БАЗЕ НЕ ПРАВИТСЯ. Art. 18(2) отсылает к Annex VI Part 3, а
// не к нашему представлению о нём. Поставщик, который последует за нашей
// «поправкой» вместо регламента, отступит от текста, на который ссылается
// закон, и останется без защиты. Мы вправе ПРЕДУПРЕДИТЬ — переписать не вправе.
//
// ⚠⚠ ФОРМУЛИРОВКА «в консолидированном тексте», А НЕ «в регламенте». Сверка шла
// с консолидацией, а она на EUR-Lex юридической силы не имеет: её собирает Бюро
// публикаций из исходного акта и поправок. Пока исходные акты Официального
// журнала не проверены, утверждать «ошибка в законе» нельзя. ⭐ Метки ►C1…►C9 в
// тех же файлах показывают, что механизм corrigendum к этому приложению уже
// применялся неоднократно.
//
// ⚠ ЗАЧЕМ ОТДЕЛЬНЫЙ ЧИСТЫЙ ФАЙЛ — то же условие, что у `euLanguages.ts`: здесь
// нет ни одного обращения к базе, иначе `scripts/check-dist.ts` (он идёт через
// `tsx`, вне сборки Astro) не смог бы импортировать отсюда ничего. А список
// обязан быть ОДИН: страница печатает пометку по нему, проверка по нему же
// требует её наличия и отсутствия.
//
// Разбор находки: `claude/foreign-name-in-translation-defect.md`.

export type ErratumKind =
  /** Ячейка имени несёт имя ДРУГОЙ записи; EC и CAS в той же строке верны. */
  | 'foreign-name'
  /** Обязательное примечание §1.1.1.4 взято от парной записи — порог перевёрнут. */
  | 'wrong-qualifier'
  /** Опечатка набора: локант, пропущенная буква, переставленный знак. */
  | 'typo';

export type Erratum = {
  kind: ErratumKind;
  /**
   * Что именно не так — своими словами, для читателя.
   * ⚠⚠ У КАЖДОЙ ЗАПИСИ СВОЁ СВИДЕТЕЛЬСТВО, а не общая фраза. Общая фраза
   * («в этой редакции возможна ошибка») бесполезна: человек не сможет ни
   * проверить её, ни решить, касается ли она его. Здесь названо, что напечатано,
   * что говорят идентификаторы той же строки и откуда приехало чужое значение.
   */
  note: string;
};

/**
 * ⚠⚠ НАПРАВЛЕНИЕ ОПРЕДЕЛЯЛОСЬ У КАЖДОЙ ПАРЫ ОТДЕЛЬНО И ОКАЗАЛОСЬ РАЗНЫМ.
 * У `603-221` неверна ПЕРВАЯ запись пары, у `612-253` — ВТОРАЯ, причём в одном
 * и том же литовском издании. Предполагать «испорчена всегда вторая» нельзя.
 *
 * Чем решалось:
 * — у `foreign-name` — колонками EC и CAS той же строки: они верны и называют
 *   вещество однозначно, а имя им противоречит;
 * — у `wrong-qualifier` — скобкой английской редакции: знак и число в ней
 *   языконезависимы (`> 55 %` против `≤ 55 %`).
 */
const ERRATA: Record<string, Record<string, Erratum>> = {
  // ── Имя другой записи ────────────────────────────────────────────────────
  '017-026-00-3': {
    IT: { kind: 'foreign-name', note: 'The Italian edition prints the name of the preceding entry (017-023-00-7) here. The EC and CAS numbers in the same row, 233-162-8 and 10049-04-4, are chlorine dioxide and are correct.' },
  },
  '019-001-00-2': {
    IT: { kind: 'foreign-name', note: 'The Italian edition prints "diossido di cloro", the name of entry 017-026-01-0, for this entry. The EC and CAS numbers in the same row, 231-119-8 and 7440-09-7, are potassium and are correct.' },
  },
  '006-018-00-5': {
    IT: { kind: 'foreign-name', note: 'The Italian edition prints the name of aldicarb (entry 006-017-00-X) here. The EC and CAS numbers in the same row identify aminocarb. The two are different substances with different classifications.' },
  },
  '607-536-00-X': {
    IT: { kind: 'foreign-name', note: 'The Italian edition repeats the name of the preceding entry (607-535-00-4). The EC number in the same row, 430-910-7, and CAS 13335-71-2 are correct for this entry.' },
  },
  '016-018-00-7': {
    FR: { kind: 'foreign-name', note: 'The French edition prints "acide chlorosulfonique", the name of the preceding entry (016-017-00-1). The EC and CAS numbers in the same row, 232-149-4 and 7789-21-1, are fluorosulphonic acid and are correct.' },
  },
  '607-692-00-9': {
    FR: { kind: 'foreign-name', note: 'The French edition prints "sels de magnésium" where the entry is the zinc salt. The EC number in the same row, 446-470-4, is correct for the zinc salt.' },
  },
  '608-066-00-8': {
    LT: { kind: 'foreign-name', note: 'The Lithuanian edition prints the name of the bromoxynil salts (entry 608-065-00-2). This entry is the ioxynil salts, and the classification in the same row differs from the bromoxynil one.' },
  },
  '612-104-00-9': {
    MT: { kind: 'foreign-name', note: 'The Maltese edition prints "butiraldeid", the name of entry 605-006-00-2, for this entry. The EC and CAS numbers in the same row, 204-679-6 and 124-09-4, are hexamethylenediamine and are correct. Butyraldehyde is a flammable liquid; this substance is corrosive to skin.' },
  },
  '006-082-00-4': {
    MT: { kind: 'foreign-name', note: 'The Maltese edition prints the dibutyl name of the preceding entry (006-081-00-9). The EC and CAS numbers in the same row, 238-270-9 and 14324-55-1, are the diethyl compound and are correct.' },
  },
  '607-132-00-3': {
    MT: { kind: 'foreign-name', note: 'The Maltese edition prints the diethylamino name of entry 607-127-00-6. The EC and CAS numbers in the same row, 220-688-8 and 2867-47-2, are the dimethylamino compound and are correct.' },
  },
  '607-260-00-X': {
    MT: { kind: 'foreign-name', note: 'The Maltese edition prints the methyl ester name of entry 607-224-00-3. The EC and CAS numbers in the same row, 404-490-0 and 39562-16-8, are the ethyl ester and are correct.' },
  },
  '042-003-00-X': {
    ET: { kind: 'foreign-name', note: 'The Estonian edition repeats the name of the preceding entry (042-002-00-4), which is the ditetradecyl compound. The EC number in the same row, 404-860-1, is correct for this entry.' },
  },
  '601-087-00-3': {
    PL: { kind: 'foreign-name', note: 'The Polish edition prints the name of entry 601-031-00-8, which is specifically the pent-1-ene isomer. The EC and CAS numbers in the same row, 246-690-9 and 25167-70-8, are the isomer mixture and are correct.' },
  },

  // ── Перевёрнутое обязательное примечание §1.1.1.4 ────────────────────────
  '007-004-00-1': {
    BG: { kind: 'wrong-qualifier', note: 'The Bulgarian edition prints the qualifier "[C ≤ 70 %]" here, which belongs to the paired entry 007-030-00-3. Every other edition prints "[C > 70 %]", and the classification in this same row is the one for the concentrated acid.' },
  },
  '612-122-01-4': {
    SV: { kind: 'wrong-qualifier', note: 'The Swedish edition prints "[> 55 % i vattenlösning]", the qualifier of the paired entry 612-122-00-7. Every other edition prints "≤ 55 %" for this entry, and the classification in this same row is the one for the weaker solution.' },
  },
  '615-050-00-4': {
    CS: { kind: 'wrong-qualifier', note: 'The Czech edition prints "< 0,1 %" of respirable particles, the qualifier of the paired entry 615-049-00-9. Every other edition prints "≥ 0,1 %" for this entry, and the classification in this same row is the stricter one.' },
  },
  '603-221-00-6': {
    LT: { kind: 'wrong-qualifier', note: 'The Lithuanian edition prints "≥ 0,1 % 4-chloroaniline", the qualifier of the paired entry 603-221-01-3. Every other edition prints "< 0,1 %" for this entry.' },
    LV: { kind: 'wrong-qualifier', note: 'The Latvian edition prints "≥ 0,1 % 4-chloroaniline", the qualifier of the paired entry 603-221-01-3. Every other edition prints "< 0,1 %" for this entry.' },
  },
  '612-253-01-7': {
    LT: { kind: 'wrong-qualifier', note: 'The Lithuanian edition prints "< 0,5 % formamide", the qualifier of the paired entry 612-253-00-X. Every other edition prints "≥ 0,5 %" for this entry.' },
    LV: { kind: 'wrong-qualifier', note: 'The Latvian edition prints "< 0,5 % formamide", the qualifier of the paired entry 612-253-00-X. Every other edition prints "≥ 0,5 %" for this entry.' },
  },
  '613-286-00-2': {
    ET: { kind: 'wrong-qualifier', note: 'The Estonian edition prints "≥ 0,5 % N,N-dimethylformamide", the qualifier of the paired entry 613-286-01-X. Every other edition prints "< 0,5 %" for this entry.' },
  },
  '613-116-00-7': {
    DA: { kind: 'wrong-qualifier', note: 'The Danish edition prints "< 0,1 % (w/w) of respirable particles", the qualifier of the paired entry 613-116-01-4. Every other edition prints "≥ 0,1 %" for this entry. The Danish edition also drops the square brackets that mark the qualifier.' },
  },
  '613-043-00-0': {
    SK: { kind: 'wrong-qualifier', note: 'The Slovak edition describes this entry as "vodný roztok" (aqueous solution), which is the paired entry 613-043-01-8. Every other edition calls this entry the powder.' },
  },

  // ── Опечатки набора ──────────────────────────────────────────────────────
  '601-088-00-9': {
    PL: { kind: 'typo', note: 'The Polish edition prints the locant 2 ("2-winylocykloheksen"). All twenty-two other editions, and the CAS number 100-40-3 in the same row, give the 4-vinyl isomer.' },
  },
  '015-011-00-6': {
    PL: { kind: 'typo', note: 'The Polish edition prints "kwas ortofosorowy" — the letter f is missing from "ortofosforowy".' },
  },
  '612-034-01-6': {
    FR: { kind: 'typo', note: 'The French edition prints "[≥ % 20 eau]" — the per cent sign and the number are transposed; it should read "≥ 20 % eau".' },
  },
  '612-001-01-6': {
    NL: { kind: 'typo', note: 'The Dutch edition drops the per cent sign from the third designation ("tri-methylamine … [3]"); the first two designations in the same cell keep it.' },
  },
  '016-064-00-8': {
    IT: { kind: 'typo', note: 'The Italian edition leaves the second designation untranslated: "sodium bisulphite" is the English wording, printed inside the Italian cell.' },
  },
  '607-091-00-1': {
    SV: { kind: 'typo', note: 'The Swedish edition prints the placeholder and the per cent sign twice: "... % . %".' },
  },
};

/**
 * Заголовок пометки — СВОЙ У КАЖДОГО ВИДА.
 *
 * ⚠⚠ Общий заголовок был бы неправдой у двух видов из трёх. «Это не имя данного
 * вещества» верно там, где ячейка несёт имя другой записи, — но при опечатке имя
 * ТО САМОЕ, просто набрано с ошибкой, а при перевёрнутом примечании верно и имя,
 * и лишь условие в скобке взято от парной записи. Читатель, которому сказали
 * «не то вещество» про опечатку в одной букве, потеряет доверие к пометке там,
 * где она важна.
 */
export const ERRATUM_LEAD: Record<ErratumKind, string> = {
  'foreign-name': 'This edition prints another entry’s name here.',
  'wrong-qualifier': 'This edition prints the paired entry’s qualifier here.',
  typo: 'This edition has a typographic error here.',
};

/** Ошибка регламента у этой записи в этой редакции, или `null`. */
export function erratumFor(indexNumber: string, lang: string): Erratum | null {
  const byLang = ERRATA[indexNumber];
  if (!byLang) return null;
  return byLang[(lang ?? '').trim().toUpperCase()] ?? null;
}

/**
 * Коды редакций, у которых эта запись помечена, в алфавитном порядке.
 * ⚠ Нужен проверке: она сверяет НАБОР помеченных строк в обе стороны — лишняя
 * пометка такой же дефект, как недостающая.
 */
export function erratumLanguages(indexNumber: string): string[] {
  const byLang = ERRATA[indexNumber];
  return byLang ? Object.keys(byLang).sort() : [];
}

/** Все записи со свидетельствами — для проверки и для будущей страницы-разбора. */
export const ERRATA_INDEX_NUMBERS: string[] = Object.keys(ERRATA).sort();

/** Сколько всего свидетельств: записей × редакций. */
export const ERRATA_COUNT: number = Object.values(ERRATA)
  .reduce((n, byLang) => n + Object.keys(byLang).length, 0);

/**
 * Подпись под таблицей, когда хоть одна строка помечена.
 * ⚠ Стоит здесь, а не в разметке, чтобы проверка искала ТОТ ЖЕ текст.
 */
export const ERRATA_TABLE_NOTE =
  'One or more lines above are flagged. In those language editions the consolidated CLP text '
  + 'itself prints something that the rest of the regulation contradicts — a name belonging to a '
  + 'different entry, or the qualifier of a paired entry. The lines are reproduced as printed, '
  + 'because Art. 18(2) points at Annex VI and not at our reading of it; the note beside each one '
  + 'says what the row’s own EC and CAS numbers identify.';
