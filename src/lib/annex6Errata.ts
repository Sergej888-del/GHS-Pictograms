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
// ⭐⭐⭐ SESSION 58: РАЗВИЛКА ЗАКРЫТА — ОШИБКИ СТОЯТ В САМОМ ОЖ. Каждая из 29
// строк сверена с текстом акта, которым она введена, и совпала с ним. Значит
// дефект не в сборке консолидации, а в опубликованном законе, и лечится он
// corrigendum. Поэтому у каждой записи теперь есть `source`: акт, выпуск
// Официального журнала и НОМЕР ПОЛОСЫ — читатель может открыть и посмотреть.
//
// ⭐⭐ Возражение «текст акта на EUR-Lex — такая же сборка Бюро публикаций, как
// консолидация» снял сам ОП: корриджендум 32018R0669R(01) (JO L 233, 10.9.2019,
// p. 26) цитирует полосу 42 ОЖ L 115 дословно, и цитата совпадает со скачанным
// текстом акта посимвольно. Полоса 42 в PDF несёт колонтитул `L 115/42`.
//
// ⚠ Номера полос НЕ ВПИСАНЫ РУКАМИ: они выведены из PDF-факсимиле актов и
// сверяются заново `scripts/build-errata-dossier.ts` при каждом прогоне.
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
  /**
   * Составное имя: ОДНА из составляющих принадлежит другой записи, остальные
   * верны.
   *
   * ⚠⚠ ОТДЕЛЬНЫЙ ВИД, А НЕ РАЗНОВИДНОСТЬ `foreign-name`. Заголовок «здесь
   * напечатано имя другой записи» был бы неправдой: у цирама первая
   * составляющая, `żiram (ISO)`, верна, и человек, сверяющий её, решил бы, что
   * мы ошиблись. Пометка, соврав про половину ячейки, перестаёт работать и во
   * второй половине.
   *
   * ⭐ Вид заведён не ради одной записи: слепое пятно точного сравнения
   * (`claude/composite-name-blind-spot.md`) держит 22 кандидата ровно такой
   * формы.
   */
  | 'foreign-designation'
  /** Обязательное примечание §1.1.1.4 взято от парной записи — порог перевёрнут. */
  | 'wrong-qualifier'
  /** Опечатка набора: локант, пропущенная буква, переставленный знак. */
  | 'typo';

/**
 * Откуда строка пришла в регламент: акт, выпуск ОЖ, полоса.
 *
 * ⚠⚠ ЭТО НЕ УКРАШЕНИЕ, А ПРОВЕРЯЕМОСТЬ. Без полосы читателю нечего открыть:
 * акт 2018/669 занимает 755 полос, и «где-то там» — не ссылка. С полосой любой
 * может убедиться сам, а мы обязаны дать ему такую возможность, раз обвиняем
 * официальный текст.
 */
export type ErratumSource = {
  /** CELEX акта, которым введена строка, — например `32018R0669`. */
  act: string;
  /** Выпуск Официального журнала: `OJ L 115, 4.5.2018`. */
  oj: string;
  /** Полоса ОЖ, на которой напечатана запись. */
  page: number;
};

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
  /** Акт, выпуск и полоса ОЖ. ⚠ Выводится из файлов, не вписывается руками. */
  source: ErratumSource;
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
    IT: {
      kind: 'foreign-name',
      note: 'The Italian edition prints the name of the preceding entry (017-023-00-7) here. The EC and CAS numbers in the same row, 233-162-8 and 10049-04-4, are chlorine dioxide and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 87 },
    },
  },
  '019-001-00-2': {
    IT: {
      kind: 'foreign-name',
      note: 'The Italian edition prints "diossido di cloro", the name of entry 017-026-01-0, for this entry. The EC and CAS numbers in the same row, 231-119-8 and 7440-09-7, are potassium and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 88 },
    },
  },
  '006-018-00-5': {
    IT: {
      kind: 'foreign-name',
      note: 'The Italian edition prints the name of aldicarb (entry 006-017-00-X) here. The EC and CAS numbers in the same row identify aminocarb. The two are different substances with different classifications.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 12 },
    },
  },
  '607-536-00-X': {
    IT: {
      kind: 'foreign-name',
      note: 'The Italian edition repeats the name of the preceding entry (607-535-00-4). The EC number in the same row, 430-910-7, and CAS 13335-71-2 are correct for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 310 },
    },
  },
  '016-018-00-7': {
    FR: {
      kind: 'foreign-name',
      note: 'The French edition prints "acide chlorosulfonique", the name of the preceding entry (016-017-00-1). The EC and CAS numbers in the same row, 232-149-4 and 7789-21-1, are fluorosulphonic acid and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 72 },
    },
  },
  '607-692-00-9': {
    FR: {
      kind: 'foreign-name',
      note: 'The French edition prints "sels de magnésium" where the entry is the zinc salt. The EC number in the same row, 446-470-4, is correct for the zinc salt.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 332 },
    },
  },
  '608-066-00-8': {
    LT: {
      kind: 'foreign-name',
      note: 'The Lithuanian edition prints the name of the bromoxynil salts (entry 608-065-00-2). This entry is the ioxynil salts, and the classification in the same row differs from the bromoxynil one.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 344 },
    },
  },
  '612-104-00-9': {
    MT: {
      kind: 'foreign-name',
      note: 'The Maltese edition prints "butiraldeid", the name of entry 605-006-00-2, for this entry. The EC and CAS numbers in the same row, 204-679-6 and 124-09-4, are hexamethylenediamine and are correct. Butyraldehyde is a flammable liquid; this substance is corrosive to skin.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 417 },
    },
  },
  // ⚠⚠ ЗДЕСЬ НЕВЕРНА ТОЛЬКО ВТОРАЯ СОСТАВЛЯЮЩАЯ. Найдена в session 59
  // перекрёстной проверкой генератора досье: механический поиск того же имени
  // указал на ТРЕТЬЮ запись, о которой курирование session 57 не знало.
  // Точное сравнение имён её пропускало по построению — имя составное.
  '006-012-00-2': {
    MT: {
      kind: 'foreign-designation',
      note: 'The Maltese edition prints the dibutyl name of entry 006-081-00-9 as the second designation here. The first designation, żiram (ISO), is correct. CAS 137-30-4 in the same row is the dimethyl compound, and twenty-two of the twenty-three editions print the dimethyl name.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 11 },
    },
  },
  '006-082-00-4': {
    MT: {
      kind: 'foreign-name',
      note: 'The Maltese edition prints the dibutyl name of the preceding entry (006-081-00-9). The EC and CAS numbers in the same row, 238-270-9 and 14324-55-1, are the diethyl compound and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 21 },
    },
  },
  '607-132-00-3': {
    MT: {
      kind: 'foreign-name',
      note: 'The Maltese edition prints the diethylamino name of entry 607-127-00-6. The EC and CAS numbers in the same row, 220-688-8 and 2867-47-2, are the dimethylamino compound and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 258 },
    },
  },
  '607-260-00-X': {
    MT: {
      kind: 'foreign-name',
      note: 'The Maltese edition prints the methyl ester name of entry 607-224-00-3. The EC and CAS numbers in the same row, 404-490-0 and 39562-16-8, are the ethyl ester and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 273 },
    },
  },
  '042-003-00-X': {
    ET: {
      kind: 'foreign-name',
      note: 'The Estonian edition repeats the name of the preceding entry (042-002-00-4), which is the ditetradecyl compound. The EC number in the same row, 404-860-1, is correct for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 122 },
    },
  },
  '601-087-00-3': {
    PL: {
      kind: 'foreign-name',
      note: 'The Polish edition prints the name of entry 601-031-00-8, which is specifically the pent-1-ene isomer. The EC and CAS numbers in the same row, 246-690-9 and 25167-70-8, are the isomer mixture and are correct.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 155 },
    },
  },

  // ── Перевёрнутое обязательное примечание §1.1.1.4 ────────────────────────
  '007-004-00-1': {
    BG: {
      kind: 'wrong-qualifier',
      note: 'The Bulgarian edition prints the qualifier "[C ≤ 70 %]" here, which belongs to the paired entry 007-030-00-3. Every other edition prints "[C > 70 %]", and the classification in this same row is the one for the concentrated acid.',
      source: { act: '32020R1182', oj: 'OJ L 261, 11.8.2020', page: 11 },
    },
  },
  '612-122-01-4': {
    SV: {
      kind: 'wrong-qualifier',
      note: 'The Swedish edition prints "[> 55 % i vattenlösning]", the qualifier of the paired entry 612-122-00-7. Every other edition prints "≤ 55 %" for this entry, and the classification in this same row is the one for the weaker solution.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 421 },
    },
  },
  '615-050-00-4': {
    CS: {
      kind: 'wrong-qualifier',
      note: 'The Czech edition prints "< 0,1 %" of respirable particles, the qualifier of the paired entry 615-049-00-9. Every other edition prints "≥ 0,1 %" for this entry, and the classification in this same row is the stricter one.',
      source: { act: '32022R0692', oj: 'OJ L 129, 3.5.2022', page: 11 },
    },
  },
  '603-221-00-6': {
    LT: {
      kind: 'wrong-qualifier',
      note: 'The Lithuanian edition prints "≥ 0,1 % 4-chloroaniline", the qualifier of the paired entry 603-221-01-3. Every other edition prints "< 0,1 %" for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 203 },
    },
    LV: {
      kind: 'wrong-qualifier',
      note: 'The Latvian edition prints "≥ 0,1 % 4-chloroaniline", the qualifier of the paired entry 603-221-01-3. Every other edition prints "< 0,1 %" for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 203 },
    },
  },
  '612-253-01-7': {
    LT: {
      kind: 'wrong-qualifier',
      note: 'The Lithuanian edition prints "< 0,5 % formamide", the qualifier of the paired entry 612-253-00-X. Every other edition prints "≥ 0,5 %" for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 443 },
    },
    LV: {
      kind: 'wrong-qualifier',
      note: 'The Latvian edition prints "< 0,5 % formamide", the qualifier of the paired entry 612-253-00-X. Every other edition prints "≥ 0,5 %" for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 443 },
    },
  },
  '613-286-00-2': {
    ET: {
      kind: 'wrong-qualifier',
      note: 'The Estonian edition prints "≥ 0,5 % N,N-dimethylformamide", the qualifier of the paired entry 613-286-01-X. Every other edition prints "< 0,5 %" for this entry.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 491 },
    },
  },
  '613-116-00-7': {
    DA: {
      kind: 'wrong-qualifier',
      note: 'The Danish edition prints "< 0,1 % (w/w) of respirable particles", the qualifier of the paired entry 613-116-01-4. Every other edition prints "≥ 0,1 %" for this entry. The Danish edition also drops the square brackets that mark the qualifier.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 467 },
    },
  },
  '613-043-00-0': {
    SK: {
      kind: 'wrong-qualifier',
      note: 'The Slovak edition describes this entry as "vodný roztok" (aqueous solution), which is the paired entry 613-043-01-8. Every other edition calls this entry the powder.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 455 },
    },
  },

  // ── Опечатки набора ──────────────────────────────────────────────────────
  '601-088-00-9': {
    PL: {
      kind: 'typo',
      note: 'The Polish edition prints the locant 2 ("2-winylocykloheksen"). All twenty-two other editions, and the CAS number 100-40-3 in the same row, give the 4-vinyl isomer.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 156 },
    },
  },
  '015-011-00-6': {
    PL: {
      kind: 'typo',
      note: 'The Polish edition prints "kwas ortofosorowy" — the letter f is missing from "ortofosforowy".',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 42 },
    },
  },
  '612-034-01-6': {
    FR: {
      kind: 'typo',
      note: 'The French edition prints "[≥ % 20 eau]" — the per cent sign and the number are transposed; it should read "≥ 20 % eau".',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 404 },
    },
  },
  '612-001-01-6': {
    NL: {
      kind: 'typo',
      note: 'The Dutch edition drops the per cent sign from the third designation ("tri-methylamine … [3]"); the first two designations in the same cell keep it.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 397 },
    },
  },
  '016-064-00-8': {
    IT: {
      kind: 'typo',
      note: 'The Italian edition leaves the second designation untranslated: "sodium bisulphite" is the English wording, printed inside the Italian cell.',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 79 },
    },
  },
  '607-091-00-1': {
    SV: {
      kind: 'typo',
      note: 'The Swedish edition prints the placeholder and the per cent sign twice: "... % . %".',
      source: { act: '32018R0669', oj: 'OJ L 115, 4.5.2018', page: 252 },
    },
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
  'foreign-designation': 'This edition prints another entry’s name as one of the designations here.',
  'wrong-qualifier': 'This edition prints the paired entry’s qualifier here.',
  typo: 'This edition has a typographic error here.',
};

// ── Состояние находки ───────────────────────────────────────────────────────

/**
 * Что с находкой стало к сегодняшнему дню.
 *
 * ⚠⚠⚠ БЕЗ ЭТОГО СТРАНИЦА НАЧНЁТ ВРАТЬ ПРИ ПЕРВОМ ЖЕ ИСПРАВЛЕНИИ. Список
 * ошибок, не знающий, что одну из них уже поправили корриджендумом, — это не
 * устаревшая страница, а страница, обвиняющая законодателя в том, чего он уже
 * не делает. Прецедент прямо перед глазами: `32018R0669R(01)` исправил имя
 * записи `015-011-00-6` во ФРАНЦУЗСКОЙ редакции на полосе 42, и если бы мы
 * держали и её, наш список был бы неверен восемь лет.
 */
export type ErratumStatus =
  /** Никому не сообщено. */
  | { kind: 'unreported' }
  /** Сообщено: дата отправки и канал. */
  | { kind: 'submitted'; date: string; channel: string }
  /** Исправлено корриджендумом: чем именно и на какой полосе. */
  | { kind: 'corrected'; act: string; oj: string; page: number };

/**
 * Состояние ПОДАЧИ ЦЕЛИКОМ.
 *
 * ⚠⚠ ОНО ОДНО НА ВСЕ НАХОДКИ, И ЭТО НЕ УПРОЩЕНИЕ. Подача уходит одним файлом и
 * одним письмом; расписывать дату у каждой из тридцати строк значило бы
 * завести тридцать мест, где она может разойтись. Отдельная судьба бывает
 * только у исправленной записи — для неё и заведены переопределения ниже.
 *
 * ⚠⚠⚠ `date: null` ОЗНАЧАЕТ «ЕЩЁ НЕ ОТПРАВЛЕНО», и страница-разбор обязана это
 * учитывать: решение Сергея — публиковать ПОСЛЕ отправки. Проставить дату
 * здесь — единственное действие, которое переводит все находки в «сообщено».
 */
export const SUBMISSION: {
  /** Дата отправки в формате `YYYY-MM-DD`, либо `null`. */
  date: string | null;
  /** Куда отправлено — печатается рядом с датой. */
  channel: string;
} = {
  date: '2026-08-10',
  // ⚠⚠ ТОЛЬКО ECHA. Первая редакция этой строки называла ещё и Бюро
  // публикаций — а туда не отправляли ничего. Страница, приписавшая себе
  // обращение, которого не было, врёт ровно там, где требует доверия.
  // ⚠ Форма ECHA принимает ОДИН файл и не имеет поля для письма: наш
  // сопроводительный текст ушёл листом `Cover note` внутри книги.
  channel: 'ECHA’s reporting form for potential errors in Annex VI to CLP',
};

/**
 * Находки, которые УЖЕ исправлены отдельным актом.
 *
 * ⚠ Сегодня список пуст, и это утверждение, а не заготовка: ни одна из
 * тридцати наших находок корриджендумом не закрыта. Чешскую `615-050-00-4`
 * корриджендум `32022R0692R(01)` пережила — у строки нет метки `►C`, и это
 * проверено, а не предположено (session 58).
 */
const CORRECTED: Record<string, Record<string, Extract<ErratumStatus, { kind: 'corrected' }>>> = {};

/**
 * Состояние конкретной находки.
 *
 * ⚠ Порядок проверок значим: исправление СИЛЬНЕЕ отправки. Запись, которую
 * поправили, перестаёт быть ошибкой независимо от того, сообщали мы о ней.
 */
export function erratumStatus(indexNumber: string, lang: string): ErratumStatus {
  const fixed = CORRECTED[indexNumber]?.[(lang ?? '').trim().toUpperCase()];
  if (fixed) return fixed;
  if (SUBMISSION.date) return { kind: 'submitted', date: SUBMISSION.date, channel: SUBMISSION.channel };
  return { kind: 'unreported' };
}

/**
 * Подпись состояния для страницы.
 *
 * ⚠⚠ ЖИВЁТ ЗДЕСЬ, А НЕ В РАЗМЕТКЕ, чтобы проверка искала ТОТ ЖЕ текст, что
 * печатает страница, — как `ERRATUM_LEAD` и `ERRATA_TABLE_NOTE`.
 */
export function erratumStatusLabel(st: ErratumStatus): string {
  if (st.kind === 'corrected') {
    return `Corrected by ${st.act}, ${st.oj}, p. ${st.page}.`;
  }
  if (st.kind === 'submitted') {
    return `Reported ${humanDate(st.date)}. No reply is implied by this note.`;
  }
  return 'Not reported to anyone yet.';
}

/**
 * `2026-08-10` → `10 August 2026`.
 *
 * ⚠ ХРАНИМ ISO, ПЕЧАТАЕМ ПО-ЧЕЛОВЕЧЕСКИ. `10.08.2026` читается британцем как
 * 10 августа, американцем — как несуществующее 8 октября; на странице, которая
 * ссылается на даты Официального журнала, двусмысленной даты быть не должно.
 * ⚠⚠ Разбор строкой, а не `new Date()`: конструктор от `YYYY-MM-DD` даёт
 * полночь UTC, и в часовом поясе западнее Гринвича `toLocaleDateString` вернёт
 * предыдущий день.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export function humanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

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
  'One or more lines above are flagged. In those language editions the Regulation as published '
  + 'in the Official Journal prints something that the rest of the same row contradicts — a name '
  + 'belonging to a different entry, or the qualifier of a paired entry. Each flag cites the '
  + 'amending act and the Official Journal page, so the wording can be checked at source. The '
  + 'lines are reproduced as printed, because Art. 18(2) points at Annex VI and not at our reading '
  + 'of it; the note beside each one says what the row’s own EC and CAS numbers identify.';

/**
 * Ссылка на первоисточник одной строкой: «Regulation (EU) 2018/669, OJ L 115,
 * 4.5.2018, p. 87».
 *
 * ⚠ Обозначение акта выводится ИЗ CELEX, а не хранится отдельной строкой: два
 * поля об одном и том же неизбежно разошлись бы. ⚠⚠ Разбор годится для номеров
 * с 2015 года (`3` + год + `R` + номер) — все три наших акта такие. Появится
 * запись из акта старой нумерации — разбор надо будет расширить, и молчать об
 * этом нельзя: цитата с неверным номером хуже отсутствующей.
 */
export function erratumCitation(e: Erratum): string {
  const m = /^3(\d{4})R(\d{4})$/.exec(e.source.act);
  const act = m
    ? `Regulation (EU) ${m[1]}/${Number(m[2])}`
    : e.source.act;
  return `${act}, ${e.source.oj}, p. ${e.source.page}`;
}
