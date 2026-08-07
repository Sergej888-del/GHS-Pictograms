// src/lib/labelProductName.ts
// Разбор ЗАПИСИ Annex VI на формы: имя, CAS, EC.
//
// ⚠⚠ ЗАЧЕМ ЭТО НУЖНО. Колонка Annex VI «International Chemical Identification»
// у групповых записей содержит не одно имя, а СПИСОК форм с маркерами:
//
//   tetraboron disodium heptaoxide, hydrate [1]
//   disodium tetraborate, anhydrous [2]
//   orthoboric acid, sodium salt [3]
//   …
//
// и `display_name_short` у таких записей повторяет его целиком — разрез
// `annex_vi_first()` там не срабатывает. На этикетку уезжали все пять имён
// подряд.
//
// ⚠⚠ ТАК ЖЕ ПОРТЯТСЯ И НОМЕРА, И ЭТО ГЛАВНОЕ. Импорт складывает номера всех
// форм в одну ячейку и обрезает её по длине колонки (20 знаков):
//
//   cas_number = 71-41-0[1]584-02-1[2      ← составной И усечённый
//   ec_number  = 200-752-1[1]209-526-      ← такого EC-номера не существует
//
// Замер 2026-08-07 по 4 178 записям: 159 негодных `cas_number` (156 со
// скобкой), 189 негодных `ec_number` (150 со скобкой). `index_number` цел —
// все 4 178 проходят форму, если считать законной контрольную «X».
//
// ⚠⚠ В session 42 предохранитель поставили ТОЛЬКО на имя и CAS, и только на
// том пути, где человек кликает чип формы: начальные значения полей шли из
// базы сырыми. Один и тот же дефект чинили по симптому дважды. Теперь все три
// идентификатора разбираются здесь, одним правилом, и в компонент приходят
// уже годными.
//
// ⚠⚠ АВТОМАТИЧЕСКИ ВЫБИРАТЬ ПЕРВЫЙ КУСОК НЕЛЬЗЯ ВСЕГДА. У 68 записей строка
// имеет вид «reaction mass of: A; B; C» — это КОМПОНЕНТЫ СМЕСИ, а не синонимы,
// и печатать на этикетке один из них значит соврать о содержимом упаковки.
// Такие строки не разбираются вовсе (см. `substanceName.ts`, session 34).
//
// Поэтому: варианты предлагаются, выбор за человеком, поле остаётся свободным.

import { CAS_SHAPE, EC_SHAPE, casShapeOk, ecShapeOk } from './substanceIdentifiers';

export type NameVariant = {
  /** Имя для печати. */
  name: string;
  /** CAS этой формы, если он выделяется из составного значения. */
  cas?: string;
  /** EC этой формы, если он выделяется из составного значения. */
  ec?: string;
  /** Номер формы в записи Annex VI: [1], [2] … */
  index?: number;
};

const oneLine = (s: string) => s.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s: string) => oneLine(s).toLowerCase();

/** Строки, которые перечисляют компоненты, а не синонимы одного вещества. */
function isMixtureListing(s: string): boolean {
  return /reaction mass of|mixture of|\bcontaining\b/i.test(s);
}

/** Куски вида «имя [N]» → [{ name, index }]. */
function splitIndexed(raw: string): NameVariant[] {
  const s = oneLine(raw);
  if (!/\[\d+\]/.test(s)) return [];
  const out: NameVariant[] = [];
  // Режем ПО МАРКЕРУ, оставляя его номер: имя идёт перед своим номером.
  const parts = s.split(/\[(\d+)\]/);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const name = parts[i].trim().replace(/[;,]$/, '').trim();
    const index = Number(parts[i + 1]);
    if (name) out.push({ name, index });
  }
  // Хвост после последнего маркера — тоже имя, если он есть.
  const tail = parts[parts.length - 1]?.trim();
  if (tail && parts.length % 2 === 1) out.push({ name: tail.replace(/[;,]$/, '').trim() });
  return out.filter((v) => v.name.length > 1);
}

/** Синонимы через точку с запятой: «acetone; propan-2-one; propanone». */
function splitSemicolons(raw: string): NameVariant[] {
  const s = oneLine(raw);
  if (!s.includes(';')) return [];
  return s
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
    .map((name) => ({ name }));
}

/**
 * Идентификаторы по номерам форм: «12267-73-1[1]1330-43-4[2]» → { 1: …, 2: … }.
 *
 * ⚠ Значение в базе усечено по длине колонки, и у дальних форм номер приходит
 * обрезанным («1330-43», «209-526-»). Берём только те куски, что прошли
 * проверку формы: неполный номер на этикетке хуже, чем его отсутствие.
 */
function splitIndexedIds(raw: string | null | undefined, shape: RegExp): Map<number, string> {
  const out = new Map<number, string>();
  const s = (raw ?? '').trim();
  if (!s || !/\[\d+\]/.test(s)) return out;
  const parts = s.split(/\[(\d+)\]/);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const value = parts[i].trim();
    const index = Number(parts[i + 1]);
    if (shape.test(value)) out.set(index, value);
  }
  return out;
}

/**
 * Норм. имя → номер формы, которой оно принадлежит.
 *
 * ⚠⚠ РАДИ ЧЕГО. У большинства групповых записей `display_name_short` уже
 * обрезан до первой формы — «dalapon», «linalool», «warfarin (ISO)» — и
 * маркера [1] в нём нет, а полный список форм лежит в `iupac_name`. Без этой
 * карты такое имя осталось бы вовсе без номеров: составное значение из базы
 * отброшено, а к форме имя не привязано. Сопоставление строгое — по точному
 * совпадению имени с куском формы, — поэтому чужой номер подставиться не может.
 */
function formByName(variants: NameVariant[]): Map<string, number> {
  const out = new Map<string, number>();
  const put = (key: string, index: number) => {
    if (key.length > 1 && !out.has(key)) out.set(key, index);
  };
  for (const v of variants) {
    if (!v.index) continue;
    put(norm(v.name), v.index);
    for (const seg of v.name.split(';')) put(norm(seg), v.index);
  }
  return out;
}

export type NameSource = {
  common_name?: string | null;
  display_name_short?: string | null;
  iupac_name?: string | null;
  cas_number?: string | null;
  ec_number?: string | null;
};

/**
 * Варианты имени для поля «Product name», от предпочтительного к прочим.
 * Первый элемент — то, что подставляется по умолчанию.
 */
export function productNameVariants(s: NameSource): NameVariant[] {
  const casByIndex = splitIndexedIds(s.cas_number, CAS_SHAPE);
  const ecByIndex = splitIndexedIds(s.ec_number, EC_SHAPE);
  const plainCas = casShapeOk(s.cas_number) ? (s.cas_number ?? '').trim() : undefined;
  const plainEc = ecShapeOk(s.ec_number) ? (s.ec_number ?? '').trim() : undefined;

  // 1. Сначала только имена: номера раздаются вторым проходом, когда виден
  //    весь набор форм.
  const raw: NameVariant[] = [];
  const seen = new Set<string>();
  const push = (v: NameVariant) => {
    const key = norm(v.name);
    if (!v.name || seen.has(key)) return;
    seen.add(key);
    raw.push(v);
  };

  const curated = s.common_name?.trim();
  if (curated) push({ name: curated });

  for (const src of [s.display_name_short, s.iupac_name]) {
    const text = src?.trim();
    if (!text) continue;
    if (isMixtureListing(text)) {
      // Список компонентов печатается целиком и не разбирается.
      push({ name: oneLine(text) });
      continue;
    }
    const indexed = splitIndexed(text);
    if (indexed.length > 1) {
      for (const v of indexed) push(v);
      continue;
    }
    const bySemi = splitSemicolons(text);
    if (bySemi.length > 1) {
      for (const v of bySemi) push(v);
      continue;
    }
    push({ name: oneLine(text) });
  }

  // 2. Номера. У формы — только её собственные; у имени без маркера — общее
  //    значение записи, а если оно негодное, то значение формы, которой это
  //    имя принадлежит по названию.
  const byName = formByName(raw);
  return raw.map((v) => {
    if (v.index) return { ...v, cas: casByIndex.get(v.index), ec: ecByIndex.get(v.index) };
    const index = byName.get(norm(v.name));
    return {
      ...v,
      cas: plainCas ?? (index ? casByIndex.get(index) : undefined),
      ec: plainEc ?? (index ? ecByIndex.get(index) : undefined),
    };
  });
}

/**
 * Что печатается на этикетке до того, как человек что-нибудь выбрал руками.
 *
 * ⚠⚠ ЕДИНСТВЕННАЯ ТОЧКА, ЧЕРЕЗ КОТОРУЮ ЗАПИСЬ ИЗ БАЗЫ ПОПАДАЕТ НА ЭТИКЕТКУ.
 * Пустая строка здесь — не потеря данных, а осознанный отказ печатать номер,
 * которого не существует. Идентификатор по регламенту необязателен (CLP
 * Art. 18(2) требует имя; EC/CAS — дополнение), а неверный номер на бумаге
 * отправляет читателя не в ту карточку вещества.
 */
export function defaultLabelIdentifiers(s: NameSource): { name: string; cas: string; ec: string } {
  const v = productNameVariants(s)[0];
  return { name: v?.name ?? '', cas: v?.cas ?? '', ec: v?.ec ?? '' };
}
