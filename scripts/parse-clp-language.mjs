// scripts/parse-clp-language.mjs
//
// Разбор ЯЗЫКОВОЙ версии консолидированного CLP: Annex I и Annex VI Part 3.
//
// Один проход по одному файлу даёт две вещи:
//   1. СИГНАЛЬНЫЕ СЛОВА (Annex I) — «Danger» и «Warning» на этом языке.
//   2. ИМЕНА ВЕЩЕСТВ (Annex VI Part 3) — колонка имени, ключ index_number.
//
// ⚠⚠ ОБА ПРИЛОЖЕНИЯ ЛЕЖАТ В ОДНОМ ДОКУМЕНТЕ. Это и есть причина, по которой
// загрузок 23, а не 24 + 23: Annex I и Annex VI — части одной языковой версии.
//
// ⚠ НА NODE, А НЕ НА PYTHON, И ЭТО НЕ ВКУСОВЩИНА. На машине Сергея питона нет
// ни под именем `python` (стоит заглушка магазина приложений: печатает «Python»
// и выходит), ни под `py`. Проект уже требует Node и `tsx` для сборки и всех
// проверок — второй язык в конвейере означал бы, что половина пути ломается на
// машине, где его не поставили. Одна среда лучше двух.
//
// Запуск:
//   node scripts/parse-clp-language.mjs de
//   node scripts/parse-clp-language.mjs de fr nl
//   node scripts/parse-clp-language.mjs all
//
// Вход:  .tmp-eurlex/clp-consolidated-<lang>.html  (английский — clp-consolidated.html)
// Выход: .tmp-eurlex/parsed-<lang>.json
//
// ⚠⚠ АНГЛИЙСКИЙ ФАЙЛ ОБЯЗАТЕЛЕН — он служит ЭТАЛОНОМ СТРУКТУРЫ, а не источником
// перевода. Без него разбор не запускается вовсе: проверить, что мы вынули из
// чужого языка именно сигнальное слово, а не соседнюю ячейку, можно только
// сравнением с версией, где ответ известен.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const TMP = '.tmp-eurlex';

const LANGS = ['bg', 'es', 'cs', 'da', 'de', 'et', 'el', 'en', 'fr', 'ga', 'hr', 'it',
  'lv', 'lt', 'hu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'fi', 'sv'];

const HCODE = /\bH\s?\d{3}\b/;
const INDEX_NO = /^\d{3}-\d{3}-\d{2}-\d$/;

/**
 * ⚠⚠ НОМЕРА В РЕГЛАМЕНТЕ НАБРАНЫ РАЗНЫМИ ТИРЕ, И ЭТО МОЛЧА ТЕРЯЕТ ЗАПИСИ.
 *
 * В эстонской версии индексный номер ацетоноподобной записи выглядит как
 * `006–015-00–9`: первый и третий разделители — длинное тире U+2013, а не
 * дефис-минус. Строгое `^\d{3}-\d{3}-\d{2}-\d$` такую строку не принимает,
 * и запись просто не попадает в разбор.
 *
 * Цена ошибки была замерена: **151 запись у эстонского, 146 у финского, 132 у
 * шведского, 48 у литовского**. И хуже всего, что отчёт называл это «нет в et:
 * 151» — то есть выглядело как свойство регламента, а не как наша регулярка.
 * Такой отчёт опаснее отсутствия отчёта: он выдаёт дефект за факт.
 *
 * ⚠ Приводится к ASCII-дефису ТОЛЬКО в числовых колонках (индекс, EC, CAS) —
 * там тире может быть лишь разделителем. В имени вещества тире значимо
 * (`N,N'-bis`, `1,4-dioxane`), и нормализовать его нельзя.
 */
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;
const normNumber = (s) => s.replace(DASHES, '-').replace(/\s+/g, '');
// ⚠ Метки правок EUR-Lex (▼M19, ►C4) попадают в ячейки и сигнальным словом не
// являются. Их надо отбросить ДО подсчёта, иначе «различных значений» станет
// не два, а восемь, и проверка на два слова провалится на верном файле.
const AMEND = /^[▼►]\s*[A-Z]?\d*$/;

/**
 * ⚠⚠ Метки правок EUR-Lex надо чистить ИЗ ТЕКСТА ячейки, а не только выбрасывать
 * ячейки, состоящие из метки целиком. В словенской версии сигнальное слово
 * приходит как «►C9 Nevarno ◄» — то есть то же слово, но не равное себе, и
 * проверка «ровно одно слово на уровень» валилась на верном файле.
 * ⚠ Закрывающая метка `◄` отдельная: она без буквы и цифры.
 */
const stripMarkers = (s) => s.replace(/[▼►]\s*[A-Z]?\d*/g, '').replace(/◄/g, '').replace(/\s+/g, ' ').trim();

/**
 * ⚠⚠ ОТКРЫВАЮЩИЕ И ЗАКРЫВАЮЩИЕ КАВЫЧКИ РАЗВЕДЕНЫ, И ЭТО ОБЯЗАТЕЛЬНО.
 *
 * Считать кавычкой любой знак нельзя: французский апостроф в «d’avertissement»
 * и «L’étiquette» — это U+2019, тот самый знак, которым английский, венгерский
 * и румынский кавычку ЗАКРЫВАЮТ. Как открывающий он не годится.
 *
 * ⚠ Датский закрывает кавычку ЗЕРКАЛЬНО: «»Fare«» — открывает `»`, закрывает
 * `«`. Поэтому оба знака стоят в обоих наборах.
 * ⚠ ASCII-кавычек здесь нет вовсе, иначе в разбор попадут значения атрибутов
 * (`id="art_20"`, `class="eli-subdivision"`).
 */
const Q_OPEN = '«»„“”‘’';
const Q_CLOSE = '»«”“’';
/**
 * ⚠⚠ ВНУТРИ КАВЫЧЕК НЕ ДОЛЖНО БЫТЬ ПРОБЕЛА, И ЭТО РЕШАЕТ ГЛАВНЫЙ КОНФЛИКТ.
 *
 * Мальтийская версия ставит `’Periklu’` — U+2019 и открывает, и закрывает. Но
 * тот же знак во французском — апостроф: `L’étiquette comporte la mention
 * d’avertissement`. Если пустить U+2019 в открывающие без запрета на пробел,
 * французский даст ложную пару «’avertissement 1. L’».
 *
 * Сигнальное слово — ОДНО СЛОВО во всех двадцати двух версиях, где оно найдено
 * («Niebezpieczeństwo», «Nebezpečenstvo», «Ettevaatust»). Запрет пробела внутри
 * отбрасывает все французские апострофные пары и оставляет мальтийскую.
 */
const QUOTED = new RegExp(`[${Q_OPEN}]([^\\s${Q_OPEN}${Q_CLOSE}]{2,44})[${Q_CLOSE}]`, 'g');

/**
 * Блок статьи по СТРУКТУРНОМУ идентификатору EUR-Lex: `id="art_20"` … `id="art_21"`.
 *
 * ⭐⭐ Это лучший якорь во всём документе: он не зависит ни от языка, ни от
 * кавычек, ни от вёрстки. Искать «Article 20» текстом бессмысленно — на 24
 * языках это «Artikel 20», «20. pants», «Άρθρο 20», «20. cikk».
 */
function articleBlock(html, n) {
  const start = html.search(new RegExp(`id="art_${n}"`));
  if (start < 0) return null;
  const end = html.search(new RegExp(`id="art_${n + 1}"`));
  return html.slice(start, end > start ? end : start + 30000);
}

const plainText = (h) => cellText(h);

const fileFor = (lang) => join(TMP, lang === 'en' ? 'clp-consolidated.html' : `clp-consolidated-${lang}.html`);

/** Мнемоники HTML, которые реально встречаются в тексте регламента. */
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
 * ⚠ Таблицы, ряды и ячейки достаются регулярками, а не разбором DOM.
 * Документ на 28 МБ, вложенных таблиц в нём нет, а тянуть парсер HTML в проект
 * ради двух скриптов — лишняя зависимость. Проверка правильности разбора не в
 * теории, а в сверке с английской версией: если бы регулярки резали не то,
 * распределение 44/32 не воспроизвелось бы.
 */
function* iterTables(html) {
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html)) !== null) yield m[1];
}

function iterRows(tbl) {
  const out = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tbl)) !== null) out.push(m[1]);
  return out;
}

function rowCells(row) {
  const out = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(row)) !== null) out.push(cellText(m[1]));
  return out;
}

// ── Annex I: сигнальные слова ────────────────────────────────────────────────

/**
 * Ряд сигнальных слов КАЖДОЙ таблицы, ключ — подпись из её H-кодов.
 *
 * ⚠⚠ КЛЮЧ — ПОДПИСЬ, А НЕ НОМЕР ТАБЛИЦЫ ПО ПОРЯДКУ. Сверять по порядку нельзя:
 * в болгарской версии подходящих таблиц 36, в греческой 35, в английской 37 — и
 * с первого же расхождения сравниваются ЧУЖИЕ ряды. Именно так «Опасно» и
 * «Внимание» вставали на позиции Warning и Danger одновременно, и язык
 * забраковывался целиком. H-коды языка не имеют, поэтому подпись из них
 * связывает таблицу с её парой в любой версии.
 *
 * ⚠ Ряд сигнальных слов ищется ВЫШЕ ряда H-фраз, ПРОПУСКАЯ ряды-метки: EUR-Lex
 * вставляет `▼B` и `▼M19` отдельными `<tr>`, и в датской версии таких рядов
 * четыре — «ряд непосредственно выше» оказывался меткой, а не словами.
 *
 * ⚠ Потолка длины ячейки здесь НЕТ намеренно. Он был (40 знаков) и отбрасывал
 * верные ряды в языках, где фраза «сигнальное слово не используется» длиннее:
 * румынское «Nu se utilizează niciun cuvânt de avertizare» — 43 знака. Порог,
 * снятый с одного языка, ломает пять других. Лишние ряды безвредны: значение
 * берётся только там, где в АНГЛИЙСКОЙ версии стоит ровно Danger или Warning.
 *
 * ⚠ Неуникальные подписи выбрасываются: связать их однозначно нельзя.
 */
function signalRowsBySignature(html) {
  const seen = new Map();
  for (const tbl of iterTables(html)) {
    const rows = iterRows(tbl);
    const k = rows.findIndex((r) => HCODE.test(cellText(r)));
    if (k <= 0) continue;
    const codes = (cellText(rows[k]).match(/\bH\s?\d{3}\b/g) || []).map((c) => c.replace(/\s/g, ''));
    if (!codes.length) continue;
    const sig = codes.join('|');
    let j = k - 1;
    while (j >= 0 && rowCells(rows[j]).every((c) => !stripMarkers(c))) j--;
    if (j < 0) continue;
    const cells = rowCells(rows[j]).map(stripMarkers).filter(Boolean);
    if (!cells.length) continue;
    if (seen.has(sig)) seen.set(sig, null);
    else seen.set(sig, cells);
  }
  return new Map([...seen].filter(([, v]) => v));
}

/**
 * Пара сигнальных слов из Article 20(3) — ИСТОЧНИК, а не догадка.
 *
 * ⚠⚠ ПОЧЕМУ НЕ ИЗ ТАБЛИЦ ANNEX I. Потому что в части языковых версий сам
 * регламент себе противоречит, и это замерено: в греческой на позиции Warning
 * стоит «Προσοχή» в 16 таблицах и «Προειδοποίηση» в 11; в латышской два разных
 * НАБОРА слов, по девять таблиц каждый; во французской, венгерской и румынской
 * три таблицы из тридцати одной несут другое слово. Выбирать большинством
 * нельзя: большинство — не правовой принцип.
 *
 * Art. 20(3) — правило приоритета: «если на этикетке использовано сигнальное
 * слово X, слово Y не приводится». Ровно два закавыченных слова в фиксированном
 * порядке: сначала Danger, потом Warning. Порядок и есть назначение — знать
 * язык не требуется.
 *
 * ⚠ Регистр здесь НЕ печатный: французский Art. 20(3) даёт «danger» и
 * «attention» строчными, а на этикетке стоит «Attention». Печатную форму берём
 * из таблиц Annex I, а отсюда — какое слово какому уровню отвечает.
 */
function signalFromArticle20(lang, html) {
  const block = articleBlock(html, 20);
  if (!block) {
    throw new Error(`${lang}: в документе нет блока id="art_20" — Article 20 не найдена, брать сигнальные слова неоткуда.`);
  }
  const text = stripMarkers(plainText(block));
  const words = [];
  QUOTED.lastIndex = 0;
  let m;
  while ((m = QUOTED.exec(text)) !== null) words.push(m[1].trim());
  if (words.length !== 2) {
    throw new Error(
      `${lang}: в Article 20 закавыченных слов ${words.length}, а должно быть ровно два ` +
      `(Danger, затем Warning): ${JSON.stringify(words)}. Догадываться нельзя.`);
  }
  return { danger: words[0], warning: words[1] };
}

/**
 * Слова языка: назначение — из Art. 20(3), печатная форма — из таблиц Annex I,
 * и одно СВЕРЯЕТСЯ с другим.
 */
function signalWords(lang, html, refRows) {
  const defined = signalFromArticle20(lang, html);
  const mine = signalRowsBySignature(html);
  const common = [...refRows.keys()].filter((k) => mine.has(k));

  // Подсчёт форм на позициях, где в АНГЛИЙСКОЙ версии стоит ровно Danger/Warning.
  const tally = { danger: new Map(), warning: new Map() };
  let skipped = 0;
  for (const sig of common) {
    const a = refRows.get(sig), b = mine.get(sig);
    if (a.length !== b.length) { skipped++; continue; }
    for (let i = 0; i < a.length; i++) {
      const key = /^danger$/i.test(a[i]) ? 'danger' : /^warning$/i.test(a[i]) ? 'warning' : null;
      if (!key) continue;
      tally[key].set(b[i], (tally[key].get(b[i]) ?? 0) + 1);
    }
  }

  const out = {};
  for (const key of ['danger', 'warning']) {
    const variants = [...tally[key].entries()].sort((x, y) => y[1] - x[1]);
    const total = variants.reduce((n, [, c]) => n + c, 0);
    const defWord = defined[key];
    const match = variants.find(([w]) => w.toLowerCase() === defWord.toLowerCase());
    if (!match) {
      throw new Error(
        `${lang}: Article 20 называет ${key} «${defWord}», но в таблицах Annex I такого слова НЕТ ` +
        `(${variants.map(([w, c]) => `«${w}»×${c}`).join(' ')}). Расхождение источника и применения — ` +
        `разбирать нельзя, надо смотреть глазами.`);
    }
    // ⭐ Печатная форма — та, что стоит в таблицах: там регистр этикеточный.
    out[key] = { text: match[0], cells: match[1], defined: defWord, variants: variants.length, total };
  }

  const note = (k) => out[k].variants > 1
    ? ` ⚠ в таблицах ещё ${out[k].variants - 1} вариант(а), см. отчёт`
    : '';
  console.log(`  Annex I: "${out.danger.text}" ×${out.danger.cells}${note('danger')}  ·  ` +
    `"${out.warning.text}" ×${out.warning.cells}${note('warning')}`);
  console.log(`    Art. 20(3): danger «${defined.danger}» · warning «${defined.warning}» — сошлось` +
    (skipped ? `  (таблиц с разным числом ячеек: ${skipped})` : ''));
  return { ...out, article20: defined, tablesCompared: common.length, tablesSkipped: skipped };
}

// ── Annex VI Part 3: имена веществ ──────────────────────────────────────────

const MARKER = /\[(\d{1,2})\]/g;

/**
 * Разбор ячейки имени на формы.
 *
 * ⚠⚠ ДВА СОВЕРШЕННО РАЗНЫХ СЛУЧАЯ, И ПУТАТЬ ИХ НЕЛЬЗЯ.
 *
 * 1. ЕСТЬ МАРКЕРЫ `[1] [2] [3]` — это ГРУППОВАЯ ЗАПИСЬ: под одним индексным
 *    номером идут РАЗНЫЕ вещества, и номер маркера привязывает имя к своей
 *    позиции в колонках EC и CAS. Значит формы делятся ПО МАРКЕРАМ, а не по
 *    точке с запятой, и соответствие между языками по НОМЕРУ МАРКЕРА
 *    гарантировано — в отличие от порядка.
 *
 *    ⭐ Это снимает задачу, которая в claude/substance-names-translation.md
 *    записана как нерешаемая («соответствие форм между языками по порядку не
 *    гарантировано»). По порядку — действительно нет. По маркеру — да.
 *
 * 2. МАРКЕРОВ НЕТ — это ОДНО вещество, а точки с запятой разделяют СИНОНИМЫ.
 *    ⚠⚠ И здесь число форм между языками ЗАКОННО РАЗНОЕ: немецкая версия даёт
 *    «Kohlenstoffmonoxid; Kohlenmonoxid; Kohlenoxid» там, где английская даёт
 *    одно «carbon monoxide». Это содержание регламента, а не ошибка разбора,
 *    и требовать совпадения числа синонимов — значит забраковать 412 верных
 *    записей из 4 014.
 *
 * ⚠ Квадратные скобки с ТЕКСТОМ (`[komplexe Kombination von Kohlenwasserstoffen…]`)
 * — описание записи, а не маркер: маркер состоит только из цифр.
 */
function splitName(cellRaw) {
  const cell = cellRaw.trim();
  MARKER.lastIndex = 0;
  if (MARKER.test(cell)) {
    MARKER.lastIndex = 0;
    const members = {};
    let pos = 0, m;
    while ((m = MARKER.exec(cell)) !== null) {
      const chunk = cell.slice(pos, m.index).trim().replace(/;+$/, '').trim();
      if (chunk) members[Number(m[1])] = chunk;
      pos = m.index + m[0].length;
    }
    const keys = Object.keys(members).map(Number).sort((a, b) => a - b);
    return { kind: 'group', members, forms: keys.map((k) => members[k]), synonyms: [] };
  }
  const parts = cell.split(';').map((x) => x.trim()).filter(Boolean);
  return { kind: 'single', members: {}, forms: parts.slice(0, 1), synonyms: parts };
}

/**
 * {index_number: {...}} из Table 3.
 *
 * ⚠ Строка узнаётся по ФОРМЕ ПЕРВОЙ ЯЧЕЙКИ (индексный номер `NNN-NNN-NN-N`), а
 * не по заголовку таблицы: заголовок на 24 языках разный, а форма номера — нет.
 */
function annex6Names(html) {
  const out = new Map();
  for (const tbl of iterTables(html)) {
    for (const row of iterRows(tbl)) {
      const cells = rowCells(row);
      if (cells.length < 4) continue;
      const idx = normNumber(cells[0]);
      if (!INDEX_NO.test(idx)) continue;
      const name = cells[1];
      if (!name) continue;
      out.set(idx, {
        name,
        ec: cells[2] ? normNumber(cells[2]) : null,
        cas: cells[3] ? normNumber(cells[3]) : null,
        ...splitName(name),
      });
    }
  }
  return out;
}

/** Сверка с английской версией. ⚠ Что расхождение, а что норма — см. ниже. */
function compareNames(lang, mine, ref) {
  const onlyRef = [...ref.keys()].filter((k) => !mine.has(k)).sort();
  const onlyMine = [...mine.keys()].filter((k) => !ref.has(k)).sort();
  const both = [...ref.keys()].filter((k) => mine.has(k)).sort();

  // ⚠⚠ ЖЁСТКАЯ ПРОВЕРКА только для ГРУППОВЫХ записей: набор номеров маркеров
  // обязан совпасть. Маркер привязывает имя к своей позиции в колонках EC и CAS,
  // и если в одной версии маркеров три, а в другой четыре, имя уедет к чужому
  // CAS. Это настоящая ошибка, и подгонять её нельзя.
  const markerKeys = (v) => Object.keys(v.members).map(Number).sort((a, b) => a - b).join(',');
  const markerMismatch = both.filter((i) =>
    ref.get(i).kind === 'group' && mine.get(i).kind === 'group' &&
    markerKeys(ref.get(i)) !== markerKeys(mine.get(i)));
  // ⚠ Смена типа записи (группа ↔ одиночная) — тоже ошибка структуры.
  const kindMismatch = both.filter((i) => ref.get(i).kind !== mine.get(i).kind);
  // ⚠ А вот разное число СИНОНИМОВ у одиночной записи — норма, не ошибка.
  const synDiff = both.filter((i) =>
    ref.get(i).kind === 'single' && mine.get(i).kind === 'single' &&
    ref.get(i).synonyms.length !== mine.get(i).synonyms.length);
  const identical = both.filter((i) => mine.get(i).name.toLowerCase() === ref.get(i).name.toLowerCase());

  let groups = 0;
  for (const v of mine.values()) if (v.kind === 'group') groups++;

  const head = (list, n = 5) => list.slice(0, n).join(', ') + (list.length > n ? ' …' : '');
  console.log(`  Annex VI: ${mine.size} записей (в английской ${ref.size}, общих ${both.length}), групповых ${groups}`);
  if (onlyRef.length) console.log(`    ⚠ нет в ${lang}: ${onlyRef.length} — ${head(onlyRef)}`);
  if (onlyMine.length) console.log(`    ⚠ лишние в ${lang}: ${onlyMine.length} — ${head(onlyMine)}`);
  if (kindMismatch.length) console.log(`    ✖ ТИП ЗАПИСИ РАЗОШЁЛСЯ (группа ↔ одиночная): ${kindMismatch.length} — ${head(kindMismatch)}`);
  if (markerMismatch.length) console.log(`    ✖ НАБОР МАРКЕРОВ РАЗОШЁЛСЯ: ${markerMismatch.length} — ${head(markerMismatch)}`);
  if (!kindMismatch.length && !markerMismatch.length) console.log('    ✔ у всех групповых записей набор маркеров совпал с английским');
  console.log(`    разное число синонимов у одиночных записей: ${synDiff.length} — это содержание регламента, не ошибка`);
  const share = both.length ? (100 * identical.length) / both.length : 0;
  console.log(`    имён, дословно равных английскому: ${identical.length} (${share.toFixed(1)} %)`);
  if (lang !== 'en' && share > 90) {
    console.log('    ✖✖ БОЛЬШЕ 90 % ИМЁН СОВПАДАЮТ С АНГЛИЙСКИМИ — почти наверняка CELLAR отдал');
    console.log('       английскую версию. Проверь Accept-Language (нужен код из трёх букв) и перекачай.');
  }
  return {
    only_in_reference: onlyRef,
    only_in_language: onlyMine,
    kind_mismatch: kindMismatch,
    marker_mismatch: markerMismatch,
    synonym_count_differs: synDiff.length,
    identical_to_english: identical.length,
    identical_share_pct: Math.round(share * 10) / 10,
  };
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  const args = process.argv.slice(2).map((a) => a.toLowerCase()).filter(Boolean);
  if (!args.length) {
    console.error('Укажи языки: de  |  de fr nl  |  all');
    process.exitCode = 1;
    return;
  }
  const langs = args.includes('all') ? LANGS : args;
  const unknown = langs.filter((l) => !LANGS.includes(l));
  if (unknown.length) {
    console.error(`✖ Неизвестный язык: ${unknown.join(', ')}\n  Доступны: ${LANGS.join(' ')}`);
    process.exitCode = 1;
    return;
  }

  const refFile = fileFor('en');
  if (!(await exists(refFile))) {
    console.error(
      `✖ Нет эталона ${refFile}. Английская версия обязательна: она задаёт структуру,\n` +
      `  по которой проверяется всё остальное.\n` +
      `  node --use-system-ca scripts/download-clp-annexes.mjs en`);
    process.exitCode = 1;
    return;
  }
  console.log(`Эталон структуры: ${refFile}`);
  const refHtml = await readFile(refFile, 'utf8');
  const refRows = signalRowsBySignature(refHtml);
  const refNames = annex6Names(refHtml);
  console.log(`  уникальных подписей таблиц: ${refRows.size} · записей Annex VI: ${refNames.size}\n`);

  const failed = [];
  for (const lang of langs) {
    const f = fileFor(lang);
    if (!(await exists(f))) {
      console.log(`${lang}: файла нет (${f}) — пропускаю.\n`);
      continue;
    }
    console.log(`${lang}:`);
    try {
      const html = await readFile(f, 'utf8');
      const words = signalWords(lang, html, refRows);
      const names = annex6Names(html);
      const report = compareNames(lang, names, refNames);

      const out = {
        lang: lang.toUpperCase(),
        source: f,
        signal_words: [
          { code: 'SIGNAL_DANGER', annex: 'I', lang: lang.toUpperCase(), text: words.danger.text,
            article20: words.article20.danger, table_cells: words.danger.cells, table_variants: words.danger.variants },
          { code: 'SIGNAL_WARNING', annex: 'I', lang: lang.toUpperCase(), text: words.warning.text,
            article20: words.article20.warning, table_cells: words.warning.cells, table_variants: words.warning.variants },
        ],
        substance_names: [...names.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([i, v]) => ({
          index_number: i, lang: lang.toUpperCase(), name: v.name,
          kind: v.kind, forms: v.forms, members: v.members, synonyms: v.synonyms,
        })),
        report,
      };
      const dest = join(TMP, `parsed-${lang}.json`);
      await writeFile(dest, JSON.stringify(out, null, 1), 'utf8');
      const mb = (await stat(dest)).size / 1024 / 1024;
      console.log(`  → ${dest} (${mb.toFixed(1)} МБ)\n`);
    } catch (e) {
      // ⚠ Один сбойный язык не должен останавливать остальные 22: отчёт по нему
      // виден, а работа продолжается. Иначе один плохой файл прячет 22 хороших.
      console.error(`  ✖ ${e.message}\n`);
      failed.push(lang);
    }
  }

  if (failed.length) {
    console.error(`══ не разобрано: ${failed.join(' ')}`);
    process.exitCode = 1;
  } else {
    console.log('══ все языки разобраны');
  }
}

main();
