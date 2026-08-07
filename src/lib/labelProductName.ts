// src/lib/labelProductName.ts
// Разбор имени вещества на варианты для этикетки.
//
// ⚠⚠ ЗАЧЕМ ЭТО НУЖНО. Колонка Annex VI «International Chemical Identification»
// у групповых записей содержит не одно имя, а СПИСОК форм с маркерами:
//
//   tetraboron disodium heptaoxide, hydrate [1]
//   disodium tetraborate, anhydrous [2]
//   orthoboric acid, sodium salt [3]
//   …
//
// и `display_name_short` у таких записей повторяет весь список целиком — разрез
// `annex_vi_first()` здесь не срабатывает. На этикетку уезжали все пять имён
// подряд. CAS у таких записей тоже составной: «12267-73-1[1]1330-43-4[2]…».
//
// ⚠⚠ АВТОМАТИЧЕСКИ ВЫБИРАТЬ ПЕРВЫЙ КУСОК НЕЛЬЗЯ ВСЕГДА. У 68 записей строка
// имеет вид «reaction mass of: A; B; C» — это КОМПОНЕНТЫ СМЕСИ, а не синонимы,
// и печатать на этикетке один из них значит соврать о содержимом упаковки.
// Такие строки не разбираются вовсе (см. `substanceName.ts`, session 34).
//
// Поэтому: варианты предлагаются, выбор за человеком, поле остаётся свободным.

export type NameVariant = {
  /** Имя для печати. */
  name: string;
  /** CAS этой формы, если он выделяется из составного значения. */
  cas?: string;
  /** Номер формы в записи Annex VI: [1], [2] … */
  index?: number;
};

const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** Строки, которые перечисляют компоненты, а не синонимы одного вещества. */
function isMixtureListing(s: string): boolean {
  return /reaction mass of|mixture of|\bcontaining\b/i.test(s);
}

/** Куски вида «имя [N]» → [{ name, index }]. */
function splitIndexed(raw: string): NameVariant[] {
  const s = raw.replace(/\r\n|\r|\n/g, ' ').trim();
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
  const s = raw.replace(/\r\n|\r|\n/g, ' ').trim();
  if (!s.includes(';')) return [];
  return s
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
    .map((name) => ({ name }));
}

/** CAS по номерам форм: «12267-73-1[1]1330-43-4[2]» → { 1: …, 2: … }. */
function splitIndexedCas(raw: string | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  const s = (raw ?? '').trim();
  if (!s || !/\[\d+\]/.test(s)) return out;
  const parts = s.split(/\[(\d+)\]/);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const cas = parts[i].trim();
    const index = Number(parts[i + 1]);
    // ⚠ Значение в базе усечено по длине колонки, и у дальних форм CAS
    // приходит обрезанным («1330-43»). Берём только те, что прошли проверку
    // формы: неполный CAS на этикетке хуже, чем его отсутствие.
    if (CAS_SHAPE.test(cas)) out.set(index, cas);
  }
  return out;
}

export type NameSource = {
  common_name?: string | null;
  display_name_short?: string | null;
  iupac_name?: string | null;
  cas_number?: string | null;
};

/**
 * Варианты имени для поля «Product name», от предпочтительного к прочим.
 * Первый элемент — то, что подставляется по умолчанию.
 */
export function productNameVariants(s: NameSource): NameVariant[] {
  const out: NameVariant[] = [];
  const seen = new Set<string>();
  const push = (v: NameVariant) => {
    const key = v.name.toLowerCase();
    if (!v.name || seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  const casByIndex = splitIndexedCas(s.cas_number);
  const plainCas = CAS_SHAPE.test((s.cas_number ?? '').trim()) ? (s.cas_number ?? '').trim() : undefined;

  const curated = s.common_name?.trim();
  if (curated) push({ name: curated, cas: plainCas });

  for (const raw of [s.display_name_short, s.iupac_name]) {
    const text = raw?.trim();
    if (!text) continue;
    if (isMixtureListing(text)) {
      // Список компонентов печатается целиком и не разбирается.
      push({ name: text.replace(/\r\n|\r|\n/g, ' ').trim(), cas: plainCas });
      continue;
    }
    const indexed = splitIndexed(text);
    if (indexed.length > 1) {
      for (const v of indexed) push({ ...v, cas: v.index ? casByIndex.get(v.index) : plainCas });
      continue;
    }
    const bySemi = splitSemicolons(text);
    if (bySemi.length > 1) {
      for (const v of bySemi) push({ ...v, cas: plainCas });
      continue;
    }
    push({ name: text.replace(/\r\n|\r|\n/g, ' ').trim(), cas: plainCas });
  }

  return out;
}

/** Имя, подставляемое на этикетку по умолчанию. */
export function defaultProductName(s: NameSource): string {
  return productNameVariants(s)[0]?.name ?? '';
}
