// scripts/parse-clp-annex6-codes.mjs
//
// Разбор ДВУХ пунктов Annex VI Part 1 консолидированного CLP по 23 языковым
// версиям, лежащим в `.tmp-eurlex`:
//
//   §1.1.2.1.2 «Коды указаний на опасность» — ДЕВЯТЬ суффиксных H-кодов
//              (H350i, H360F, H360D, H361f, H361d, H360FD, H361fd, H360Fd,
//              H360Df) с официальной формулировкой. ЭТО ДАННЫЕ К ЗАЛИВКЕ.
//
//   §1.1.2.2  «Коды маркировки» — сокращение сигнального слова и само слово
//              («‘Dgr’ for ‘Danger’ or ‘Wng’ for ‘Warning’»).
//              ⭐⭐ ЭТО НЕ ДАННЫЕ, А ТРЕТЬЯ СВЕРКА. Слова уже лежат в
//              `statement_translations` с session 51, взятые из таблиц Annex I
//              и подтверждённые Art. 20(3). Здесь регламент называет их в
//              ТРЕТИЙ раз, в другом приложении и другой конструкцией. Совпало —
//              значит две прежние выемки не разделяли общей ошибки.
//
// ⚠⚠ ЗАЧЕМ ВООБЩЕ ЭТОТ РАЗБОР. Импортёр переводов читал Annex III и Annex IV.
// Суффиксные формы там не напечатаны — они стоят ЗДЕСЬ, и `h_statements.
// source_ref` это прямо говорит («CLP Annex VI 1.1.2.1.2»). Пока их нет,
// немецкая этикетка вещества с H360FD выходит БЕЗ ТЕКСТА ФРАЗЫ, а H360FD
// стоит по всему Annex VI Part 3 у гармонизированных веществ.
//
// ⚠ Ирландского консолидированного CLP не существует (см.
// `claude/primary-label-language.md`), поэтому языков 23, а не 24, и это не
// пробел разбора. Строк к заливке: 9 × 23 = 207.
//
// Запуск (из корня ghspictograms, СЕТЬ НЕ НУЖНА):
//   node scripts/parse-clp-annex6-codes.mjs
//
// Вход:  .tmp-eurlex/clp-consolidated-<lang>.html  (английский — clp-consolidated.html)
// Выход: .tmp-eurlex/parsed-annex6.json
//
// ⚠⚠ АНГЛИЙСКИЙ ФАЙЛ — ЭТАЛОН СТРУКТУРЫ, А НЕ ИСТОЧНИК ПЕРЕВОДА. Без него
// разбор не запускается: убедиться, что из чужого языка вынута именно таблица
// суффиксных кодов, а не соседняя, можно только сверкой с версией, где ответ
// известен заранее.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TMP = '.tmp-eurlex';
const OUT = join(TMP, 'parsed-annex6.json');

/** 23 языковые версии консолидированного CLP. GA отсутствует у EUR-Lex. */
const LANGS = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr',
  'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'];

const fileFor = (lang) => join(TMP, lang === 'en' ? 'clp-consolidated.html' : `clp-consolidated-${lang}.html`);

// ── Общее с parse-clp-language.mjs ──────────────────────────────────────────
// ⚠ Скопировано, а не импортировано, намеренно: тот файл — про Annex I и
// Annex VI Part 3, здесь Part 1. Общий модуль связал бы два разбора, у которых
// нет ни одного общего правила, кроме «HTML EUR-Lex устроен так».

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&apos;': "'", '&times;': '×', '&#160;': ' ', '&ndash;': '–', '&mdash;': '—',
  '&laquo;': '«', '&raquo;': '»', '&bdquo;': '„', '&ldquo;': '“', '&rdquo;': '”',
  '&lsquo;': '‘', '&rsquo;': '’', '&deg;': '°', '&plusmn;': '±', '&middot;': '·',
};

function unescapeHtml(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => ENTITIES[m] ?? m);
}

function cellText(fragment) {
  return unescapeHtml(fragment.replace(/<[^>]+>/g, ' '))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ⚠⚠ Метки правок EUR-Lex (▼M4, ▼B, ►C4 … ◄) стоят ВНУТРИ разбираемого куска.
 * В немецкой версии заголовок §1.1.2.1.2 обёрнут в ►C4, а перед таблицей стоит
 * ▼B. Не вычистив их, получим код «▼B H350i» и текст с хвостом «◄».
 */
const stripMarkers = (s) => s
  .replace(/[▼►]\s*[A-Z]?\d*/g, '')
  .replace(/◄/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function* iterTables(html) {
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html)) !== null) yield m[1];
}

function rowCells(row) {
  const out = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(row)) !== null) out.push(stripMarkers(cellText(m[1])));
  return out;
}

function tableRows(tbl) {
  const out = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tbl)) !== null) out.push(rowCells(m[1]));
  return out;
}

// ── §1.1.2.1.2: девять суффиксных H-кодов ───────────────────────────────────

/**
 * Суффиксный код: три цифры и один-два буквенных знака.
 *
 * ⚠⚠ РЕГИСТР СУФФИКСА ЗНАЧИМ И НОРМАЛИЗАЦИИ НЕ ПОДЛЕЖИТ. `H360Fd` и `H360fD`
 * — это РАЗНЫЕ утверждения: заглавная буква означает доказанный эффект,
 * строчная — предполагаемый. Привести к одному регистру значило бы поменять
 * юридический смысл фразы. Поэтому шаблон различает регистр, а сверка кодов
 * между языками идёт строка-в-строку.
 */
const SUFFIX_CODE = /^H\d{3}[A-Za-z]{1,2}$/;

/**
 * Кусок документа между заголовком §1.1.2.1.2 и заголовком §1.1.2.2.
 *
 * ⚠ Якорь — НОМЕР ПУНКТА, а не его название: «Hazard statement codes» на
 * 23 языках выглядит 23 способами, а «1.1.2.1.2» одинаково везде. Номер
 * встречается в файле трижды (заголовок, ссылка в тексте, оглавление), поэтому
 * берётся не первое вхождение, а ЕДИНСТВЕННОЕ, за которым в пределах куска
 * лежит таблица нужной формы. Требование единственности — и есть проверка:
 * если подходящих кусков окажется два, разбор остановится, а не выберет.
 */
function sectionSlice(html) {
  const found = [];
  const re = /1\.1\.2\.1\.2/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const from = m.index;
    const nextIdx = html.indexOf('1.1.2.2', from + 9);
    // ⚠ Потолок в 40 000 знаков — не порог «на глаз», а защита от вырожденного
    // случая: в оглавлении между двумя номерами пунктов лежит весь документ.
    // Замеренная длина настоящего куска — 2 400–3 600 знаков на всех языках.
    const to = nextIdx > from && nextIdx - from < 40000 ? nextIdx : -1;
    if (to < 0) continue;
    found.push({ from, to, html: html.slice(from, to) });
  }
  return found;
}

function suffixCodesFrom(slice) {
  const tables = [];
  for (const tbl of iterTables(slice)) {
    const rows = tableRows(tbl).filter((cells) => cells.length === 2 && cells[0] && cells[1]);
    const codeRows = rows.filter((cells) => SUFFIX_CODE.test(cells[0]));
    // ⚠ Требуется, чтобы КАЖДЫЙ ряд таблицы был рядом суффиксного кода. Таблица,
    // где подходит часть рядов, — это другая таблица, попавшая под руку.
    if (rows.length && codeRows.length === rows.length) tables.push(rows);
  }
  return tables;
}

/** §1.1.2.1.2 одного языка: список пар [код, текст] либо исключение. */
function parseSuffixCodes(lang, html) {
  const slices = sectionSlice(html);
  const candidates = [];
  for (const s of slices) {
    for (const rows of suffixCodesFrom(s.html)) candidates.push({ at: s.from, rows });
  }
  if (candidates.length !== 1) {
    throw new Error(
      `${lang}: §1.1.2.1.2 — подходящих таблиц ${candidates.length}, а должна быть ровно одна ` +
      `(смещения: ${candidates.map((c) => c.at).join(', ') || 'нет'}). Выбирать нельзя.`);
  }
  return candidates[0].rows;
}

// ── §1.1.2.2: сигнальные слова как ТРЕТЬЯ сверка ────────────────────────────

/**
 * ⚠⚠ КАВЫЧКИ РАЗВЕДЕНЫ НА ОТКРЫВАЮЩИЕ И ЗАКРЫВАЮЩИЕ — правило взято из
 * `parse-clp-language.mjs` вместе с причиной: французский апостроф в
 * «d’avertissement» — тот же знак U+2019, которым английский и венгерский
 * кавычку ЗАКРЫВАЮТ, и как открывающий он не годится. Датский закрывает
 * зеркально («»Fare«»), поэтому оба знака стоят в обоих наборах.
 * ⚠ ASCII-кавычек здесь нет намеренно: иначе в разбор попадут значения
 * атрибутов из HTML.
 */
const Q_OPEN = '«»„“”‘’';
const Q_CLOSE = '»«”“’';
/**
 * ⚠ Запрет пробела внутри кавычек оставлен, но верхняя граница длины поднята
 * до 44 знаков: здесь в кавычки берётся и СОКРАЩЕНИЕ («Achtg.», «Dgr»), и само
 * слово («Niebezpieczeństwo»), а сокращение содержит точку.
 */
const QUOTED = new RegExp(`[${Q_OPEN}]([^\\s${Q_OPEN}${Q_CLOSE}]{2,44})[${Q_CLOSE}]`, 'g');

/**
 * Из §1.1.2.2 вынимаются ЧЕТЫРЕ закавыченных куска подряд:
 * сокращение Danger, слово Danger, сокращение Warning, слово Warning.
 *
 * ⚠⚠ ПОРЯДОК — ЕДИНСТВЕННОЕ, ЧТО СВЯЗЫВАЕТ ИХ СО СМЫСЛОМ, и он задан самим
 * регламентом: правило приоритета Art. 20(3) называет сначала Danger. Знать
 * язык не требуется — ровно тот же приём, что в `signalFromArticle20`.
 *
 * ⚠ Это СВЕРКА, а не выемка: расхождение здесь не останавливает разбор
 * суффиксных кодов, а печатается вопросом. Останавливать заливку данных из-за
 * несовпадения в постороннем пункте — значит смешивать две разные работы.
 */
function parseSignalMention(lang, html) {
  const slices = [];
  const re = /1\.1\.2\.2/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const from = m.index;
    const nextIdx = html.indexOf('1.1.2.3', from + 7);
    const to = nextIdx > from && nextIdx - from < 40000 ? nextIdx : -1;
    if (to < 0) continue;
    slices.push(stripMarkers(cellText(html.slice(from, to))));
  }
  const results = [];
  for (const text of slices) {
    const words = [];
    QUOTED.lastIndex = 0;
    let q;
    while ((q = QUOTED.exec(text)) !== null) words.push(q[1].trim());
    if (words.length === 4) results.push({ abbrDanger: words[0], danger: words[1], abbrWarning: words[2], warning: words[3] });
  }
  if (results.length !== 1) {
    return { ok: false, note: `кусков §1.1.2.2 с четырьмя закавыченными формами: ${results.length}` };
  }
  return { ok: true, ...results[0] };
}

// ── Прогон ───────────────────────────────────────────────────────────────────

function main() {
  const refHtml = readFileSync(fileFor('en'), 'utf8');
  const refRows = parseSuffixCodes('en', refHtml);
  const refCodes = refRows.map(([code]) => code);
  console.log(`эталон EN: ${refCodes.length} кодов — ${refCodes.join(', ')}\n`);

  const out = { source_ref: 'CELEX:02008R1272-20260501', codes: refCodes, langs: {}, signal_check: {} };
  const problems = [];

  for (const lang of LANGS) {
    let html;
    try {
      html = readFileSync(fileFor(lang), 'utf8');
    } catch (e) {
      problems.push(`${lang}: файл не читается — ${e.message}`);
      continue;
    }

    // ── §1.1.2.1.2 ──
    let rows;
    try {
      rows = parseSuffixCodes(lang, html);
    } catch (e) {
      problems.push(e.message);
      continue;
    }

    const codes = rows.map(([code]) => code);
    // ⚠⚠ Сверка строка-в-строку, а не по множеству: порядок рядов — часть
    // структуры таблицы, и его расхождение означает, что разобрана другая
    // таблица, даже если набор кодов совпал.
    if (codes.length !== refCodes.length || codes.some((c, i) => c !== refCodes[i])) {
      problems.push(
        `${lang}: набор кодов §1.1.2.1.2 расходится с английским.\n` +
        `        EN: ${refCodes.join(', ')}\n` +
        `        ${lang.toUpperCase()}: ${codes.join(', ')}\n` +
        `        ⚠ Это вопрос к регламенту, а не опечатка: класс определяется согласием языков.`);
      continue;
    }

    const texts = {};
    for (const [code, text] of rows) {
      if (!text) { problems.push(`${lang}/${code}: пустой текст`); continue; }
      texts[code] = text;
    }
    out.langs[lang.toUpperCase()] = texts;

    // ── §1.1.2.2, сверка ──
    out.signal_check[lang.toUpperCase()] = parseSignalMention(lang, html);
  }

  // ── Отчёт ────────────────────────────────────────────────────────────────
  const langKeys = Object.keys(out.langs);
  console.log(`языков разобрано: ${langKeys.length} из ${LANGS.length}`);
  console.log(`строк к заливке: ${langKeys.length * refCodes.length}\n`);

  // ⚠ Текст, совпавший с английским дословно, — не обязательно ошибка (мальтийский
  // и ирландский заимствуют), но это ровно тот признак, по которому виден разбор
  // не той таблицы. Печатается всегда.
  const en = out.langs.EN ?? {};
  const identical = langKeys.filter((l) => l !== 'EN' &&
    refCodes.every((c) => out.langs[l][c] === en[c]));
  if (identical.length) console.log(`⚠ дословно совпадают с английским: ${identical.join(', ')}\n`);

  console.log('§1.1.2.2 — сигнальные слова, названные регламентом в третий раз:');
  for (const l of langKeys) {
    const s = out.signal_check[l];
    console.log(s.ok
      ? `  ${l}  ${s.abbrDanger} → ${s.danger}   ·   ${s.abbrWarning} → ${s.warning}`
      : `  ${l}  ⚠ ${s.note}`);
  }

  if (problems.length) {
    console.error(`\n✖ ${problems.length} проблем:`);
    for (const p of problems) console.error('   ' + p);
    process.exit(1);
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✔ записано ${OUT}`);
}

main();
