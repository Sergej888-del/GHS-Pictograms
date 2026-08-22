// src/lib/annex6RowErrata.ts
// Ошибки САМОГО регламента внутри ОДНОЙ строки Annex VI Table 3: напечатанный
// код H-фразы не соответствует напечатанному классу опасности той же строки.
//
// ⚠⚠ ЭТО ДРУГОЙ ВИД ОШИБКИ, ЧЕМ В `annex6Errata.ts`. Там — расхождения МЕЖДУ
// языковыми редакциями (в одной редакции имя чужой записи). Здесь строка
// одинакова во всех 23 редакциях (сверено session 76 по 23 файлам
// `.tmp-eurlex/clp-consolidated-<lang>.html`), и ошибка стоит в ней с самого
// базового регламента 2008 года (`.tmp-eurlex/act-32008R1272-en.pdf`,
// OJ L 353, 31.12.2008, Table 3.1), а Table 3.2 того же акта показывает,
// что имелось в виду. Лечится она только корриджендумом.
//
// ⚠⚠⚠ АКТ, НА КОТОРЫЙ ССЫЛАЕМСЯ, — 2018/669, А НЕ 2008/1272, И ЭТО ПРОВЕРЕНО,
// А НЕ ВЫБРАНО. Первая редакция этого файла писала «строка без метки ▼M,
// с 2008 года не тронута» — по грубому поиску метки текстом. Разбор меток
// `<p class="modref">` (тем же `markerBefore`, что у досье) показал: все шесть
// строк стоят под ▼M16 = 32018R0669. Регламент 2018/669 заменил Table 3
// целиком (ради имён на 24 языках) и перепечатал эти строки с той же ошибкой.
// Значит текст, действующий сегодня, введён актом 2018/669 (OJ L 115,
// 4.5.2018), и корриджендум адресуется ему; акт 2008 года — происхождение
// ошибки и довод (Table 3.2), а не адресат. Обе ссылки печатаются.
//
// ⚠⚠⚠ ЭТО НЕ СПИСОК НАШИХ ДЕФЕКТОВ. Session 74 насчитала «346 расхождений
// H-кодов» между `annex6_table3` и `substances`; session 76 после честной
// нормализации (убрать скобки с органами, звёздочки, порядок) получила 8.
// Две из восьми были нашими и исправлены в базе (613-259-00-5 потерянный H410;
// 649-378-00-4 лишний H224 из session 8). Остальные шесть — здесь.
//
// ⭐ Session 78: ещё ТРИ найдены обратной сверкой A0 (`scripts/check-classifier.ts`,
// «каждая пара класс+категория → свой H-код в строке»). Сравнение s76 шло
// H-код ↔ H-код и такие строки видеть не могло: там класс расходится с
// кодом ВНУТРИ одной строки при одинаковых кодах в обеих таблицах
// (012-002-00-9 Self-heat. 1 с H252; 607-225-00-9 Self-react. C с H241;
// 602-091-00-8 H411 без класса). Все три — с акта 2008 года, перепечатаны 2018/669.
// ⚠ s79: 602-091-00-8 переведена в `class-missing` (строго по классу), H411 снят.
//
// ⭐⭐⭐ ПРАВИЛО, ПО КОТОРОМУ ВЫБРАНО, ЧТО ПЕЧАТАТЬ (решение Сергея, session 76):
// база и страница показывают H-фразы, которые СЛЕДУЮТ ИЗ НАПЕЧАТАННЫХ КЛАССОВ
// по таблицам Annex I, а расхождение с напечатанной колонкой H-кодов называется
// пометкой рядом. Почему класс, а не код: класс и категория — это и есть
// гармонизированная классификация (Art. 36–37, Annex VI Part 1 п. 1.1.2.1.1),
// а код фразы выводится из них по Annex I; у трёх записей из шести колонки
// пиктограмм и EUH той же строки и Table 3.2 того же акта тоже согласуются
// с классом, а не с кодом.
//
// ⚠⚠ ПОЭТОМУ МЫ НЕ «ИСПРАВЛЯЕМ РЕГЛАМЕНТ». Поставщик, которому Art. 18(2)
// указывает на Annex VI, должен видеть, ЧТО ТАМ НАПЕЧАТАНО, — пометка печатает
// и напечатанное, и основание, и номер полосы ОЖ, где это можно проверить.
//
// ⚠ Номера полос НЕ ВПИСАНЫ РУКАМИ: они выведены из PDF-факсимиле обоих актов
// (`pdftotext -layout`, страница PDF = полоса ОЖ, проверено по колонтитулам
// `L 115/42`, `L 353/1`, `/500`, `/1000`) и сверяются заново
// `scripts/build-errata-dossier.ts` — вместе с меткой ▼M16 и ячейками строки.
//
// ⚠ Файл намеренно без обращений к базе — его импортирует `scripts/check-dist.ts`.

export type RowErratumKind =
  /**
   * Напечатан код ДРУГОЙ фразы, чем та, что Annex I закрепляет за напечатанным
   * классом (H270 при Water-react. 1; H201 при Unst. Expl).
   */
  | 'statement-mismatch'
  /** Класс напечатан, а закреплённая за ним фраза в колонке кодов пропущена. */
  | 'statement-missing'
  /**
   * Код фразы напечатан, а класса, за которым он закреплён, в строке нет.
   * ⚠ Сюда же 602-091-00-8, хотя Table 3.2 подтверждает пропущенный класс:
   * вид `class-omitted` («выводим класс из кода») жил одну сессию (s78) и снят
   * решением s79 — база строго по напечатанному классу, без исключений.
   */
  | 'class-missing';

export type RowErratumSource = {
  /** CELEX акта, которым введён действующий текст строки. ⚠ У всех шести — 32018R0669. */
  act: string;
  /** Выпуск Официального журнала этого акта. */
  oj: string;
  /** Полоса ОЖ, на которой напечатана строка в акте 2018/669. */
  page: number;
  /** Происхождение: тот же текст в базовом регламенте 2008 года. */
  origin: {
    /** CELEX базового регламента. */
    act: string;
    /** Выпуск ОЖ базового регламента. */
    oj: string;
    /** Полоса ОЖ строки в Table 3.1 акта 2008 года. */
    page31: number;
    /**
     * Полоса ОЖ той же записи в Table 3.2 (классификация по 67/548/EEC, тот же
     * акт). ⚠ Table 3.2 отменена Регламентом 2016/1179, но в акте 2008 года она
     * есть и показывает, что законодатель имел в виду: R-фразы переводятся в
     * классы CLP по Annex VII.
     */
    page32: number;
  };
};

export type RowErratum = {
  kind: RowErratumKind;
  /** Классы опасности, как напечатаны в колонке (3) строки. */
  printedClasses: string[];
  /** Коды H-фраз, как напечатаны в колонке (4) строки. */
  printedStatements: string[];
  /** Коды H-фраз, которые печатаем МЫ, — следуют из напечатанных классов. */
  shownStatements: string[];
  /** Классификация той же записи в Table 3.2 базового регламента 2008 г., дословно. */
  table32: string;
  /**
   * Что именно не так — для читателя, своими словами.
   * ⚠⚠ У КАЖДОЙ ЗАПИСИ СВОЁ СВИДЕТЕЛЬСТВО: что напечатано, какая таблица
   * Annex I закрепляет фразу за классом, что говорят остальные колонки
   * той же строки и Table 3.2 того же акта.
   */
  note: string;
  source: RowErratumSource;
};

/** Действующий текст всех девяти строк — Регламент 2018/669. */
const ACT_2018 = '32018R0669';
const OJ_2018 = 'OJ L 115, 4.5.2018';
/** Происхождение всех девяти — базовый регламент. */
const ACT_2008 = '32008R1272';
const OJ_2008 = 'OJ L 353, 31.12.2008';

/**
 * ⚠ Замеры в свидетельствах («1 102 of the 1 103 rows…») сняты session 76 по
 * `annex6_table3` — срезу консолидации CELEX 02008R1272 от 2026-05-01. При
 * новой консолидации пересчитать: запросы в `claude/annex6-row-errata.md`.
 */
const ROW_ERRATA: Record<string, RowErratum> = {
  // ── Код другой фразы ──────────────────────────────────────────────────────
  '009-017-00-8': {
    kind: 'statement-mismatch',
    printedClasses: ['Flam. Sol. 1', 'Water-react. 1', 'Skin Corr. 1A', 'Acute Tox. 4 *'],
    printedStatements: ['H228', 'H270', 'H314', 'H332'],
    shownStatements: ['H228', 'H260', 'H314', 'H332'],
    table32: 'F; R11-14/15 — C; R35 — Xn; R20',
    note: 'Table 3.1 prints H270, the oxidising-gas statement, against the hazard class Water-react. 1. Under Annex I, Table 2.12.1, Water-react. 1 carries H260. The same row prints GHS02 without GHS03 and the supplementary statement EUH014, both of which belong with H260, and Table 3.2 of the original Regulation (EC) No 1272/2008 classifies the substance R14/15 (reacts violently with water, liberating extremely flammable gases). Of the 26 rows classified Water-react. 1, this is the only one that does not print H260. This page shows H260.',
    source: { act: ACT_2018, oj: OJ_2018, page: 33, origin: { act: ACT_2008, oj: OJ_2008, page31: 365, page32: 941 } },
  },
  '609-010-00-5': {
    kind: 'statement-mismatch',
    printedClasses: ['Unst. Expl', 'Acute Tox. 3 *', 'Acute Tox. 3 *', 'Acute Tox. 3 *'],
    printedStatements: ['H201', 'H331', 'H311', 'H301'],
    shownStatements: ['H200', 'H331', 'H311', 'H301'],
    table32: 'E; R3 — T; R23/24/25',
    note: 'Table 3.1 prints H201, the statement of explosives of Division 1.1, against the hazard class Unst. Expl. Under Annex I, Table 2.1.2, an unstable explosive carries H200; H201 belongs to Division 1.1, which is not the class printed here. The other two rows of Annex VI classified Unst. Expl print H200. This page shows H200.',
    source: { act: ACT_2018, oj: OJ_2018, page: 346, origin: { act: ACT_2008, oj: OJ_2008, page31: 604, page32: 1126 } },
  },

  // ── Класс есть, фразы нет ─────────────────────────────────────────────────
  '006-014-00-3': {
    kind: 'statement-missing',
    printedClasses: ['Acute Tox. 4 *', 'STOT SE 3', 'Skin Sens. 1', 'Aquatic Acute 1', 'Aquatic Chronic 1'],
    printedStatements: ['H302', 'H335', 'H317', 'H410'],
    shownStatements: ['H302', 'H335', 'H317', 'H400', 'H410'],
    table32: 'Xn; R22 — Xi; R37 — R43 — N; R50-53',
    note: 'Table 3.1 lists the hazard class Aquatic Acute 1 but prints no H400 in the classification column; only H410 appears. Under Annex I, Table 4.1.4, Aquatic Acute 1 carries H400, and Table 3.2 of the original Regulation (EC) No 1272/2008 classifies the substance N; R50-53, which converts to both Aquatic Acute 1 and Aquatic Chronic 1 under Annex VII. Of the 1 103 rows classified Aquatic Acute 1, this is the only one without H400. This page shows H400 together with H410.',
    source: { act: ACT_2018, oj: OJ_2018, page: 12, origin: { act: ACT_2008, oj: OJ_2008, page31: 345, page32: 927 } },
  },

  // ── Фраза есть, класса нет ────────────────────────────────────────────────
  //
  // ⭐⭐ ТРИ ЗАПИСИ ОДНОГО ВЕЩЕСТВА (Foots oil — парафиновый нефтяной остаток
  // C20–C50) и одного происхождения ошибки. В Table 3.2 того же акта у всех
  // трёх ровно одна классификация: Carc. Cat. 2; R45 — ни R12 (газ), ни R46
  // (мутаген), ни R65 (аспирация). В Table 3.1 у 649-175/176 напечатаны
  // классы и коды ПРЕДЫДУЩЕЙ строки 649-174-00-5 (refinery gas: Flam. Gas 1,
  // Press. Gas, Carc. 1A, Muta. 1B, H220 H350 H340) с выпавшим Muta. 1B, а у
  // 649-315 — H304 строки 649-316-00-6 без её Asp. Tox. 1.
  //
  // ⚠⚠ МЫ ПЕЧАТАЕМ ТО, ЧТО СЛЕДУЕТ ИЗ НАПЕЧАТАННЫХ КЛАССОВ (H220 по Flam. Gas 1,
  // H350 по Carc. 1B), хотя для остатка C20–C50 класс «воспламеняющийся газ»
  // очевидно чужой. Снять его — значит переписать регламент; пометка говорит
  // читателю, откуда он взялся и где это проверить.
  '649-175-00-0': {
    kind: 'class-missing',
    printedClasses: ['Flam. Gas 1', 'Press. Gas', 'Carc. 1B'],
    printedStatements: ['H220', 'H350', 'H340'],
    shownStatements: ['H220', 'H350'],
    table32: 'Carc. Cat. 2; R45',
    note: 'Table 3.1 prints H340, the germ-cell mutagenicity statement, but lists no Muta. class in this row; under Annex I, Table 3.5.3, H340 belongs to Muta. 1A or 1B. The printed physical-hazard classes, Flam. Gas 1 and Press. Gas, and the statements H220, H350 and H340 are those of the preceding entry, 649-174-00-5, a refinery gas, whereas this entry describes a C20–C50 hydrocarbon residue. Table 3.2 of the original Regulation (EC) No 1272/2008 classifies the entry Carc. Cat. 2; R45 only. This page shows the statements that follow from the printed classes, H220 and H350, and does not show H340.',
    source: { act: ACT_2018, oj: OJ_2018, page: 632, origin: { act: ACT_2008, oj: OJ_2008, page31: 816, page32: 1280 } },
  },
  '649-176-00-6': {
    kind: 'class-missing',
    printedClasses: ['Flam. Gas 1', 'Press. Gas', 'Carc. 1B'],
    printedStatements: ['H220', 'H350', 'H340'],
    shownStatements: ['H220', 'H350'],
    table32: 'Carc. Cat. 2; R45',
    note: 'Table 3.1 prints H340, the germ-cell mutagenicity statement, but lists no Muta. class in this row; under Annex I, Table 3.5.3, H340 belongs to Muta. 1A or 1B. The printed physical-hazard classes, Flam. Gas 1 and Press. Gas, and the statements H220, H350 and H340 are those of entry 649-174-00-5, a refinery gas, two rows above, whereas this entry describes a C20–C50 hydrocarbon residue. Table 3.2 of the original Regulation (EC) No 1272/2008 classifies the entry Carc. Cat. 2; R45 only. This page shows the statements that follow from the printed classes, H220 and H350, and does not show H340.',
    source: { act: ACT_2018, oj: OJ_2018, page: 633, origin: { act: ACT_2008, oj: OJ_2008, page31: 816, page32: 1280 } },
  },
  '649-315-00-0': {
    kind: 'class-missing',
    printedClasses: ['Carc. 1B'],
    printedStatements: ['H350', 'H304'],
    shownStatements: ['H350'],
    table32: 'Carc. Cat. 2; R45',
    note: 'Table 3.1 prints H304, the aspiration-hazard statement, but lists no Asp. Tox. 1 in this row; under Annex I, Table 3.10.2, H304 belongs to Asp. Tox. 1. The following entry, 649-316-00-6, prints the same two statements with Asp. Tox. 1 in its class column. Table 3.2 of the original Regulation (EC) No 1272/2008 classifies this entry Carc. Cat. 2; R45 only, without R65. This page shows the statement that follows from the printed class, H350, and does not show H304.',
    source: { act: ACT_2018, oj: OJ_2018, page: 674, origin: { act: ACT_2008, oj: OJ_2008, page31: 852, page32: 1304 } },
  },

  // ── Найдены обратной сверкой A0 (session 78) ──────────────────────────────
  //
  // ⚠ Замеры («4 of the 5 rows…») сняты s78 по `annex6_table3`
  // (консолидация 2026-05-01); полосы ОЖ — из `act-32018R0669-en.txt` и
  // `act-32008R1272-en.txt` (`pdftotext -layout`, страница = полоса, колонтитул
  // «L 353/475» на p. 475 сверен), метка строки — ▼M16 по `<p class="modref">`.
  '012-002-00-9': {
    kind: 'statement-mismatch',
    printedClasses: ['Flam. Sol. 1', 'Water-react. 2', 'Self-heat. 1'],
    printedStatements: ['H228', 'H261', 'H252'],
    shownStatements: ['H228', 'H261', 'H251'],
    table32: 'F; R11-15',
    note: 'Table 3.1 prints H252, the statement of self-heating substances of Category 2, against the hazard class Self-heat. 1. Under Annex I, Table 2.11.1, Self-heat. 1 carries H251 (“Self-heating: may catch fire”) with the signal word Danger; H252 belongs to Category 2 (“Self-heating in large quantities; may catch fire”, Warning). The same row prints the signal word Danger. Of the 5 rows of Annex VI classified Self-heat. 1, this is the only one that does not print H251. This page shows H251.',
    source: { act: ACT_2018, oj: OJ_2018, page: 34, origin: { act: ACT_2008, oj: OJ_2008, page31: 366, page32: 942 } },
  },
  '607-225-00-9': {
    kind: 'statement-mismatch',
    printedClasses: ['Self-React. C ****', 'STOT RE 2 *', 'Eye Dam. 1', 'Skin Sens. 1'],
    printedStatements: ['H241', 'H373 **', 'H318', 'H317'],
    shownStatements: ['H242', 'H373', 'H318', 'H317'],
    table32: 'E; R2 — Xn; R48/22 — Xi; R41 — R43',
    note: 'Table 3.1 prints H241, the statement of self-reactive substances of Type B, against the hazard class Self-react. C. Under Annex I, Table 2.8.1, Types C and D carry H242 (“Heating may cause a fire”); H241 belongs to Type B, which also requires the pictogram GHS01 — the same row prints GHS02 only, as Type C does. The reference **** means the type itself is to be confirmed by testing (Annex VI, 1.2.4). Of the 12 rows of Annex VI classified Self-react. C, this is the only one that does not print H242. This page shows H242.',
    source: { act: ACT_2018, oj: OJ_2018, page: 268, origin: { act: ACT_2008, oj: OJ_2008, page31: 558, page32: 1090 } },
  },
  // ⚠⚠ Решение Сергея, session 79: СТРОГО ПО КЛАССУ, как у 649-175/176/315.
  // В s78 эта строка была заведена как отдельный вид `class-omitted` («класс
  // пропущен, но Table 3.2 его подтверждает → выводим класс из кода»). Вид
  // снят: единственная запись переведена в `class-missing`, H411 не печатаем,
  // пара Aquatic Chronic 2 в A0 не выводится. Довод Table 3.2 (N; R51-53)
  // остаётся в свидетельстве — это материал для корриджендума, не для базы.
  // Колонка пиктограмм строки согласуется с этим решением: GHS09 не напечатан.
  '602-091-00-8': {
    kind: 'class-missing',
    printedClasses: ['Acute Tox. 4 *', 'STOT RE 2 *', 'Skin Irrit. 2'],
    printedStatements: ['H302', 'H373 **', 'H315', 'H411'],
    shownStatements: ['H302', 'H373', 'H315'],
    table32: 'Xn; R22-48/20/22 — Xi; R38 — N; R51-53',
    note: 'Table 3.1 prints H411, the statement of chronic aquatic hazard Category 2, in both the classification and the labelling columns, but lists no Aquatic Chronic class in this row; under Annex I, Table 4.1.0, H411 belongs to Aquatic Chronic 2. The pictogram column of the same row prints no GHS09, which Aquatic Chronic 2 would require. Table 3.2 of the original Regulation (EC) No 1272/2008 classifies the substance N; R51-53, which converts to Aquatic Chronic 2 under Annex VII, so the class name, not the code, appears to have been dropped. Of the 581 rows of Annex VI that print H411, this is the only one without Aquatic Chronic 2 in the class column. This page shows the statements that follow from the printed classes, H302, H373 and H315, and does not show H411.',
    source: { act: ACT_2018, oj: OJ_2018, page: 172, origin: { act: ACT_2008, oj: OJ_2008, page31: 475, page32: 1024 } },
  },
};

/**
 * Заголовок пометки — СВОЙ У КАЖДОГО ВИДА, как у `ERRATUM_LEAD`.
 */
export const ROW_ERRATUM_LEAD: Record<RowErratumKind, string> = {
  'statement-mismatch': 'Annex VI prints a different hazard statement code in this row.',
  'statement-missing': 'Annex VI omits a hazard statement code in this row.',
  'class-missing': 'Annex VI prints a hazard statement code without its hazard class in this row.',
};

/**
 * Подпись под таблицей H-фраз, когда строка помечена.
 * ⚠ Стоит здесь, а не в разметке, чтобы проверка искала ТОТ ЖЕ текст.
 */
export const ROW_ERRATA_TABLE_NOTE =
  'The hazard statement codes above follow from the hazard classes printed in this entry’s row of '
  + 'Annex VI, Table 3.1, under the tables of Annex I. In this row the Regulation as published in the '
  + 'Official Journal prints a code that does not match the class beside it — in every language edition, '
  + 'first in 2008 and again when Regulation (EU) 2018/669 re-published the table. The note says what is '
  + 'printed, what the rest of the row and Table 3.2 of the original act say, and cites the Official '
  + 'Journal pages, so the wording can be checked at source. Only the Commission can correct the '
  + 'published text, by corrigendum.';

/** Ошибка строки регламента у этой записи, или `null`. */
export function rowErratumFor(indexNumber: string | null | undefined): RowErratum | null {
  if (!indexNumber) return null;
  return ROW_ERRATA[indexNumber.trim()] ?? null;
}

/** Все записи со свидетельствами — для проверки и для страницы-разбора. */
export const ROW_ERRATA_INDEX_NUMBERS: string[] = Object.keys(ROW_ERRATA).sort();

/** Сколько всего свидетельств. */
export const ROW_ERRATA_COUNT: number = ROW_ERRATA_INDEX_NUMBERS.length;

/**
 * Ссылка на первоисточник одной строкой:
 * «Regulation (EU) 2018/669, OJ L 115, 4.5.2018, p. 33; first printed in
 * Regulation (EC) No 1272/2008, OJ L 353, 31.12.2008, p. 365 (Table 3.1) and
 * p. 941 (Table 3.2)».
 *
 * ⚠⚠ Две ссылки, и обе нужны: первая — текст, который действует и к которому
 * адресуется корриджендум; вторая — где ошибка возникла и где лежит довод
 * (Table 3.2). Нумерация CELEX до 2015 года: `3` + год + `R` + номер, а
 * обозначение акта — «Regulation (EC) No <номер>/<год>», не «(EU) <год>/<номер>».
 * Разбор в `erratumCitation` из `annex6Errata.ts` рассчитан на акты с 2015 года
 * и для 2008-го дал бы «Regulation (EU) 2008/1272» — поэтому здесь свой разбор,
 * и обозначение выводится из CELEX, а не хранится строкой.
 */
function actName(celex: string): string {
  const m = /^3(\d{4})R(\d{4})$/.exec(celex);
  if (!m) return celex;
  return Number(m[1]) < 2015
    ? `Regulation (EC) No ${Number(m[2])}/${m[1]}`
    : `Regulation (EU) ${m[1]}/${Number(m[2])}`;
}

export function rowErratumCitation(e: RowErratum): string {
  const { source: s } = e;
  return `${actName(s.act)}, ${s.oj}, p. ${s.page}; first printed in ${actName(s.origin.act)}, `
    + `${s.origin.oj}, p. ${s.origin.page31} (Table 3.1) and p. ${s.origin.page32} (Table 3.2)`;
}
