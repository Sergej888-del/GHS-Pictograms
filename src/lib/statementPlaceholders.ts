// src/lib/statementPlaceholders.ts
// Заполняемые пропуски в тексте фраз CLP Annex III.
//
// ⚠⚠ ЧТО ТАКОЕ УГЛОВЫЕ СКОБКИ. В официальном тексте части фраз стоит вставка
// вида «<state route of exposure if …>». Это УКАЗАНИЕ ПОСТАВЩИКУ, а не текст на
// этикетку: поставщик обязан либо заполнить его (назвать путь воздействия,
// перечислить затронутые органы), либо опустить, если условие не выполняется.
// Напечатанная дословно, такая строка несёт на таре инструкцию вместо сведений
// об опасности — ровно этот дефект был найден на живой этикетке анилина
// (claude/h-statement-placeholders.md). Задето 1 584 вещества из 4 178.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠⚠ ПОРЯДОК ПРОПУСКОВ В РАЗНЫХ ЯЗЫКАХ РАЗНЫЙ, И ЭТО НЕ ОПЕЧАТКА.
//
//   EN H372: Causes damage to organs <ОРГАНЫ> through … exposure <ПУТЬ>.
//   HU H372: … esetén <ПУТЬ> károsítja a szerveket <ОРГАНЫ>.
//   HU H370: … <ОРГАНЫ> … <ПУТЬ>.        ← у ТОГО ЖЕ языка порядок другой
//
// Поэтому сопоставлять «слот №1 английского = слот №1 немецкого» нельзя, и
// хранить надо РОЛЬ слота, а не его номер. Иначе поставщик, назвавший органы,
// увидит их в венгерской строке на месте пути воздействия.
//
// ⭐ КАК РОЛИ ОПРЕДЕЛЕНЫ. Не на глаз и не переводом: текст пропуска «путь
// воздействия» встречается отдельно в H340/H341/H350/H351, где он ЕДИНСТВЕННЫЙ,
// и служит образцом. В каждом языке слоты двухслотовой фразы сверены с этим
// образцом по триграммному сходству (pg_trgm). Замер по всем 142 двухслотовым
// строкам: минимальный отрыв «своего» слота от «чужого» — 0,464. Спутать нечего.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠⚠ ЗНАЧЕНИЕ НЕ ПЕРЕВОДИТСЯ И НЕ ПЕРЕНОСИТСЯ МЕЖДУ ЯЗЫКАМИ. «liver and kidneys»
// внутри немецкой строки — такой же дефект, как непечатаемая скобка, только
// незаметнее. Для каждого языка этикетки поставщик вводит своё значение; мы не
// переводим ни фразы, ни то, что ввёл поставщик.
//
// Источник: EUR-Lex / Publications Office, CELEX 02008R1272, Annex III и VI.

/** Что именно поставщик обязан назвать в этом пропуске. */
export type PlaceholderRole =
  /** Путь воздействия — указывается, только если доказано, что другие пути не опасны. */
  | 'route'
  /** Затронутые органы — указываются, если известны. */
  | 'organs'
  /** Конкретный эффект (репротоксичность) — указывается, если известен. */
  | 'effect'
  /** Имя сенсибилизирующего вещества (EUH208) — назвать ОБЯЗАНЫ. */
  | 'sensitiser';

/**
 * Куда попадает введённое значение.
 *
 * ⭐⭐ `suffix` — НЕ НАША ВЫДУМКА, А КОНВЕНЦИЯ САМОГО РЕГЛАМЕНТА. В Annex VI
 * специфика печатается скобками после кода: `H372 (blood)`, `H373 (liver)`,
 * `H371 (nervous system; oral, inhalation)` — точка с запятой делит органы и
 * путь. Замер по английскому консолидированному тексту: у H373 таких вставок
 * 33 различных, у H372 — 21.
 *
 * ⚠⚠ Почему не подстановка внутрь предложения: пропуск «or state all organs
 * affected» означает ЗАМЕНУ слова «organs», а не вставку после него. Заменить
 * слово мы не можем — для этого надо знать, какое именно слово заменяется в
 * каждом из 24 языков. Подстановка «как есть» даёт грамматический мусор:
 * «Causes damage to organs liver, kidneys through prolonged … exposure
 * inhalation.» — и это видно только отрисовкой, в коде выглядит безобидно.
 *
 * `inline` остаётся ровно за EUH208: там пропуск — обычное дополнение
 * («Contains <имя>»), подстановка грамматична во всех 24 языках, проверено
 * отрисовкой (венгерский приклеивает падежное «-t», ирландский ставит имя
 * первым — регламент разместил слот правильно).
 */
type RoleMode = 'suffix' | 'inline';

const ROLE_MODE: Record<PlaceholderRole, RoleMode> = {
  route: 'suffix',
  organs: 'suffix',
  effect: 'suffix',
  sensitiser: 'inline',
};

/**
 * Роли, без которых фразу печатать НЕЛЬЗЯ ВОВСЕ.
 *
 * ⚠⚠ Опущенный EUH208 даёт «Съдържа. Може да предизвика алергична реакция» —
 * «Содержит. Может вызвать аллергию». Пустая фраза хуже отсутствующей: она
 * занимает место обязательного сведения и выглядит заполненной.
 */
const REQUIRED_ROLES: PlaceholderRole[] = ['sensitiser'];

/**
 * Роли слотов по порядку появления в тексте — общий порядок для всех языков.
 * ⚠ Длина массива равна числу пропусков в тексте фразы.
 */
export const PLACEHOLDER_SLOTS: Record<string, PlaceholderRole[]> = {
  EUH208: ['sensitiser'],
  H340: ['route'],
  H341: ['route'],
  H350: ['route'],
  H351: ['route'],
  H360: ['effect', 'route'],
  H361: ['effect', 'route'],
  H370: ['organs', 'route'],
  H371: ['organs', 'route'],
  H372: ['organs', 'route'],
  H373: ['organs', 'route'],
};

/**
 * Языки, где порядок слотов отличается от общего.
 *
 * ⚠⚠ Список ЗАМЕРЕН, а не составлен: это ВСЕ отступления среди 264 строк
 * (11 кодов × 24 языка). Венгерский ставит обстоятельство впереди сказуемого, и
 * в H372/H373 пропуск пути воздействия оказывается первым. В венгерских же
 * H370/H371 порядок общий — то есть правило «венгерский всегда наоборот» было
 * бы столь же неверным, сколь и «порядок везде одинаков».
 */
export const PLACEHOLDER_SLOT_OVERRIDES: Record<string, Record<string, PlaceholderRole[]>> = {
  H372: { HU: ['route', 'organs'] },
  H373: { HU: ['route', 'organs'] },
};

/** Роли слотов для пары «код + язык», или null, если пропусков у кода нет. */
export function slotRoles(code: string, lang: string): PlaceholderRole[] | null {
  const base = PLACEHOLDER_SLOTS[code];
  if (!base) return null;
  return PLACEHOLDER_SLOT_OVERRIDES[code]?.[String(lang ?? '').toUpperCase()] ?? base;
}

/** Есть ли у кода заполняемые пропуски. */
export function hasPlaceholders(code: string): boolean {
  return Boolean(PLACEHOLDER_SLOTS[code]);
}

/**
 * Порядок ролей в панели ввода и в скобках после кода.
 *
 * ⚠ Задан здесь, а не выведен из данных: поля не должны переставляться от того,
 * какое вещество выбрано. Порядок «что задето, потом как воздействует» повторяет
 * `H371 (nervous system; oral, inhalation)` из Annex VI.
 */
const ROLE_ORDER: PlaceholderRole[] = ['sensitiser', 'organs', 'effect', 'route'];

/** Какие поля ввода показать для набора кодов. */
export function rolesForCodes(codes: string[], lang = 'EN'): PlaceholderRole[] {
  const seen = new Set<PlaceholderRole>();
  for (const c of codes) for (const r of slotRoles(c, lang) ?? []) seen.add(r);
  return ROLE_ORDER.filter((r) => seen.has(r));
}

export function roleIsRequired(role: PlaceholderRole): boolean {
  return REQUIRED_ROLES.includes(role);
}

/** Значения, которые ввёл поставщик. Пустая строка равносильна «не заполнено». */
export type PlaceholderValues = Partial<Record<PlaceholderRole, string>>;

export type RenderedStatement = {
  /** Код с уточнением, как в Annex VI: «H372 (liver, kidneys; inhalation)». */
  code: string;
  /** Текст фразы. ⚠ Гарантированно без «<» и «>». */
  text: string;
  /** Роли, которые поставщик заполнил. */
  filled: PlaceholderRole[];
  /** Роли, которые остались пустыми — обязанность не исполнена. */
  omitted: PlaceholderRole[];
  /**
   * ⚠⚠ Фразу печатать нельзя: не заполнено то, без чего она бессмысленна.
   * Вызывающий обязан выбросить такую строку с этикетки, а не печатать «text».
   */
  suppressed: boolean;
};

/**
 * ⚠ Пробелы вокруг содержимого гуляют между языками: болгарский печатает
 * «< или да се посочат … >», испанский «<indíquense …>». Регулярка подрезает
 * их сама, сравнивать посимвольно нельзя.
 */
const SLOT_RE = /<\s*([^<>]*?)\s*>/g;

/** Сколько пропусков в тексте на самом деле. */
export function countSlots(text: string): number {
  return (String(text ?? '').match(SLOT_RE) ?? []).length;
}

/**
 * Прибрать пробелы и знаки после того, как пропуск убран или заменён.
 *
 * ⚠ Убрать «<…>» и остановиться нельзя: остаются двойной пробел
 * («organs␣␣through») и пробел перед точкой («Съдържа␣.»). В коде это незаметно,
 * на этикетке видно глазом.
 */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

/**
 * Собрать печатаемую фразу: текст без указаний поставщику и код с уточнением.
 *
 * Пропуск роли `suffix` из предложения ИСЧЕЗАЕТ всегда — заполнен он или нет;
 * заполненное значение уходит в скобки после кода. Пропуск роли `inline`
 * заменяется значением, а если значения нет и роль обязательная, вся фраза
 * помечается `suppressed`.
 */
export function renderStatement(
  text: string,
  code: string,
  lang: string,
  values: PlaceholderValues = {},
): RenderedStatement {
  const src = String(text ?? '');
  const roles = slotRoles(code, lang);
  const filled: PlaceholderRole[] = [];
  const omitted: PlaceholderRole[] = [];
  let suppressed = false;

  if (!roles) return { code, text: tidy(src), filled, omitted, suppressed };

  const val = (r: PlaceholderRole) => String(values[r] ?? '').trim();

  let i = 0;
  const body = src.replace(SLOT_RE, () => {
    const role = roles[i++];
    // ⚠ Пропусков в тексте больше, чем ролей в карте: язык обновился, а карта
    // нет. Печатать указание поставщику всё равно нельзя — убираем.
    if (!role) return '';
    const v = val(role);
    if (v) filled.push(role); else omitted.push(role);
    if (ROLE_MODE[role] === 'inline') {
      if (!v && roleIsRequired(role)) suppressed = true;
      return v;
    }
    return '';
  });

  // Уточнение в скобках — только по ролям ЭТОГО кода и только заполненные.
  const spec = ROLE_ORDER
    .filter((r) => roles.includes(r) && ROLE_MODE[r] === 'suffix' && val(r))
    .map((r) => val(r));

  return {
    code: spec.length ? `${code} (${spec.join('; ')})` : code,
    text: tidy(body),
    filled,
    omitted,
    suppressed,
  };
}

/**
 * Страховка последнего рубежа.
 *
 * ⚠⚠ Ни одна строка на этикетке не имеет права содержать «<» или «>». Проверка
 * стоит ОТДЕЛЬНО от `renderStatement`, потому что ловит и то, чего мы не
 * предусмотрели: незакрытую скобку в самом регламенте (такая нашлась —
 * венгерский H373), код, которого нет в карте, текст из будущего импорта.
 */
export function containsPlaceholderMarks(s: string): boolean {
  return /[<>]/.test(String(s ?? ''));
}

/**
 * Что сказать в панели соответствия про незаполненную роль.
 *
 * ⚠ Формулировка называет ОБЯЗАННОСТЬ, а не наше действие: «этикетка их не
 * называет» проверяемо, «мы не смогли подставить» — нет. Зачищенный английский
 * текст молча терял требование регламента; панель возвращает его на место.
 */
export const ROLE_OBLIGATION: Record<PlaceholderRole, string> = {
  organs:
    'CLP Annex III requires the affected organs to be named where they are known. This label does not name them.',
  effect:
    'CLP Annex III requires the specific effect to be named where it is known. This label does not name it.',
  route:
    'CLP Annex III allows the route of exposure to be stated only where it is conclusively proven that no other route causes the hazard. This label states no route.',
  sensitiser:
    'EUH208 requires the sensitising substance to be named. Without the name the statement carries no information and is not printed.',
};
