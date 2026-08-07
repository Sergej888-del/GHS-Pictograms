// src/lib/substanceIdentifiers.ts
// ОДНО правило формы идентификаторов вещества — на все страницы и инструменты.
//
// ⚠⚠ ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Колонка Annex VI «International Chemical
// Identification» у групповых записей хранит идентификаторы ВСЕХ форм в одной
// ячейке, а импорт режет её по длине поля (20 знаков):
//
//   cas_number = 71-41-0[1]584-02-1[2       ← составной И усечённый
//   ec_number  = 200-752-1[1]209-526-       ← такого номера не существует
//   ec_number  = -                          ← у 37 записей вместо номера прочерк
//
// Замер 2026-08-07 по 4 178 записям: 159 негодных `cas_number` (156 со
// скобкой), 189 негодных `ec_number` (150 со скобкой). `index_number` цел.
//
// ⚠⚠ ЭТОТ ДЕФЕКТ ЧИНИЛИ ТРИЖДЫ И КАЖДЫЙ РАЗ В ОДНОМ МЕСТЕ. Session 42 — имя и
// CAS на этикетке, session 43 — ничего (не заметили), session 44 — EC там же.
// Каждый раз разбирали симптом на той странице, где его увидели глазами, а
// причина одна на всех: одна колонка портит все идентификаторы одинаково.
// Поэтому правило живёт здесь, а не копией в каждом файле.
//
// ⚠ Правило одно: ФОРМА. Ни контрольная сумма, ни справочник — см. ниже, почему.

/** CAS: от двух до семи цифр, две цифры, контрольная. */
export const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/**
 * EC: три цифры, три цифры, контрольная. Одна форма на все реестры — EINECS
 * (2xx–3xx), ELINCS (4xx), NLP (5xx) и List numbers ECHA (6xx–9xx).
 *
 * ⚠⚠ КОНТРОЛЬНУЮ ЦИФРУ НЕ ПРОВЕРЯЕМ, хотя у EINECS она считается по mod 11.
 * Замер: из 3 716 номеров годной формы её проходят 3 664, а 52 — нет, и все 52
 * из диапазона 4xx (ELINCS), где схема другая. Проверка контрольной цифры
 * стёрла бы полсотни ВЕРНЫХ номеров — ровно та беда, от которой этот модуль
 * защищает.
 */
export const EC_SHAPE = /^\d{3}-\d{3}-\d$/;

/** Индексный номер Annex VI: контрольный знак бывает цифрой и буквой X. */
export const INDEX_SHAPE = /^\d{3}-\d{3}-\d{2}-[\dX]$/;

export function casShapeOk(v: string | null | undefined): boolean {
  return CAS_SHAPE.test((v ?? '').trim());
}

export function ecShapeOk(v: string | null | undefined): boolean {
  return EC_SHAPE.test((v ?? '').trim());
}

export function indexShapeOk(v: string | null | undefined): boolean {
  return INDEX_SHAPE.test((v ?? '').trim());
}

/**
 * Номера всех форм записи по порядку: «12267-73-1[1]1330-43-4[2]» → [...].
 * Куски, не прошедшие форму (усечённые обрезкой колонки, прочерки), выпадают.
 */
export function idFormsFrom(raw: string | null | undefined, shape: RegExp): string[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
  if (shape.test(s)) return [s];
  if (!/\[\d+\]/.test(s)) return [];
  const parts = s.split(/\[(\d+)\]/);
  const out: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const value = parts[i].trim();
    if (shape.test(value)) out.push(value);
  }
  return out;
}

/**
 * CAS, который МОЖНО ПОКАЗАТЬ. Пустая строка означает «показывать нечего» —
 * это не потеря данных, а отказ печатать номер, которого не существует.
 *
 * ⚠ У групповой записи возвращается номер ПЕРВОЙ формы: имя записи тоже
 * показывается первой формы (`display_name_short` обрезан до неё), и пара
 * «имя + номер» остаётся согласованной.
 */
export function casForDisplay(raw: string | null | undefined): string {
  return idFormsFrom(raw, CAS_SHAPE)[0] ?? '';
}

/** EC, который можно показать. Пустая строка — показывать нечего. */
export function ecForDisplay(raw: string | null | undefined): string {
  return idFormsFrom(raw, EC_SHAPE)[0] ?? '';
}
