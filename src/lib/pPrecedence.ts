// src/lib/pPrecedence.ts
//
// ⭐⭐ ОТБОР P-ФРАЗ НА ЭТИКЕТКУ — ОДИН ДВИЖОК НА ИНСТРУМЕНТ И НА LABEL MAKER.
//
// Что он заменяет. В `GHSLabelConstructor.tsx` (строки 210 и 285) отбор шести
// фраз выглядел так:
//
//     () => initialSelectedP ?? pStatements.slice(0, 6).map((p) => p.code)
//
// То есть первые шесть из списка, отсортированного по коду. Ни статьи 28, ни
// пар, ни уровней важности. Пара `P304+P340` при этом рвалась пополам, и на
// этикетку печаталась фраза «В СЛУЧАЕ ВДЫХАНИЯ: обратиться в токсикоцентр»,
// которой в CLP не существует.
//
// ⚠⚠ ГЛАВНОЕ ОГРАНИЧЕНИЕ ЧЕСТНОСТИ, И ОНО ДОЛЖНО СТОЯТЬ В ИНТЕРФЕЙСЕ.
// Ни UN GHS, ни CLP не задают процедуры отбора. Это признаёт сама ECHA:
//
//   «Neither the UN GHS nor the CLP Regulation provides for clear-cut rules on
//    how to select precautionary statements for the label»
//   — Guidance on Labelling and Packaging, v4.2, §7.1
//
// Значит движок НЕ ВПРАВЕ называть свой ответ «правильным по CLP». Он даёт
// воспроизводимый метод, протокол на каждую фразу и решение оставляет человеку.
// Отсюда `PUnit.reasons`: у каждой вошедшей и каждой выпавшей фразы есть строка
// с правилом и ссылкой на первоисточник. Молча выброшенная фраза на этикетке
// по безопасности — худший из возможных исходов.
//
// ⭐ ЧИСТЫЙ МОДУЛЬ. Ни одного обращения к базе и ни одного импорта из
// `labelEngine`. Данные приходят снимком (`PrecedenceData`), замер влезаемости —
// колбэком (`probe`). Это не эстетика: так движок гоняется через `tsx` без
// сборки Astro, а `labelEngine` может импортировать его, не получая цикла.
//
// ── ИСТОЧНИКИ, ПРОЧИТАННЫЕ ДОСЛОВНО ────────────────────────────────────────
// CLP ст. 28(1) — «clearly redundant or unnecessary … shall be omitted»;
// CLP ст. 28(2) — населению одна фраза про утилизацию обязательна;
// CLP ст. 28(3) — «not more than six … unless necessary»;
// CLP ст. 32(2) — ⭐⭐ «The supplier may decide the order of the precautionary
//                 statements on the label» + фразы группируются по языку;
// CLP ст. 17(2) — одни и те же сведения во всех языках этикетки;
// Annex IV chapeau (▼M19) — свёртка фраз поощряется регламентом;
// Annex IV ▼M12 — колонка 5 «убрать X, если есть Y» применяется при отборе;
// Annex I §1.5.2 — законное право не печатать фразы на таре ≤ 125 / 25 / 10 мл;
// ECHA Guidance on Labelling and Packaging v4.2 (03.2021) §7.2–7.3 — шкала
//   важности («traffic light»), правило «пара считается одной фразой»,
//   старшинство по срочности, отброшенные уходят в SDS.

// ── Типы данных из базы ─────────────────────────────────────────────────────

/**
 * Уровень важности ECHA.
 *
 * ⚠ Уровней ПЯТЬ, а не четыре, как написано в §7.2 самой методички. Верхний —
 * `mandatory`: 36 блоков, все в колонке Disposal (P501 ×35, P502 ×1), формула
 * «Mandatory for the general public if the substance is subject to legislation
 * on hazardous waste». Это статья 28(2), расписанная ECHA поштучно по классам.
 *
 * ⚠ `not_to_be_used` в извлечённых данных не встретился ни разу: ECHA просто не
 * заводит блок на фразу, которую печатать не надо. Поэтому его здесь нет —
 * заводить значение, которого в данных не бывает, значит писать мёртвую ветку.
 */
export type EchaLevel = 'mandatory' | 'highly_recommended' | 'recommended' | 'optional';

/** Числовой вес уровня. Больше — важнее. `null` (уровня нет) весит 0. */
const LEVEL_WEIGHT: Record<EchaLevel, number> = {
  mandatory: 4,
  highly_recommended: 3,
  recommended: 2,
  optional: 1,
};

export function levelWeight(l: EchaLevel | null): number {
  return l ? LEVEL_WEIGHT[l] : 0;
}

/**
 * Кому поставляется товар.
 *
 * ⚠ `both` бывает только у СТРОКИ ДАННЫХ ECHA («условие применяется к обеим
 * группам»), но не у входа движка: конкретная этикетка едет либо населению,
 * либо профессионалу, и от этого зависит и закреп ст. 28(2), и класс `ANY`.
 */
export type Audience = 'general_public' | 'professional';
export type RecAudience = Audience | 'both';

export type HazardPair = {
  classCode: string;
  /** У класса `ANY` пусто — это общий раздел Annex IV, а не категория. */
  categoryCode: string;
};

/** Строка `clp_matrix_full`: какая фраза положена какому классу и категории. */
export type MatrixRow = {
  classCode: string;
  categoryCode: string;
  pCode: string;
  /** general | prevention | response | storage | disposal */
  statementType: string;
  /** `clp_condition_of_use.text_en` — колонка 5 Annex IV, как есть. */
  conditionText: string | null;
};

/** Строка `p_statement_combinations` + `p_combination_component`. */
export type ComboRow = {
  code: string;
  /** Компоненты в порядке печати: `P305 + P351 + P338` → три кода. */
  components: string[];
};

/** Строка шкалы ECHA: блок §7.3 разложен по классу, категории и аудитории. */
export type EchaRow = {
  classCode: string;
  categoryCode: string;
  pCode: string;
  /** prevention | response | storage | disposal — колонка таблицы ECHA. */
  columnType: string;
  level: EchaLevel;
  /** `label` — на этикетку, `sds` — только в паспорт безопасности. */
  scope: 'label' | 'sds';
  audience: RecAudience;
  /** Условие ECHA дословно. ⚠ Не пересказывать — печатать в протокол как есть. */
  conditionText: string;
};

/** Связка «класс + категория → H-коды», нужна для разбора классификации. */
export type HazardIndexRow = {
  classCode: string;
  categoryCode: string;
  hCodes: string[];
  signalWord: string | null;
};

export type PrecedenceData = {
  matrix: MatrixRow[];
  combos: ComboRow[];
  echa: EchaRow[];
  hazardIndex: HazardIndexRow[];
  /** Тексты фраз для показа. Код без текста в протокол попадает, на этикетку — нет. */
  text?: Record<string, string>;
};

// ── Вход и выход ────────────────────────────────────────────────────────────

export type PrecedenceInput = {
  /**
   * Классификация напрямую. ⚠ Если задана — H-коды не разбираются: явно
   * названные классы точнее любого вывода.
   */
  pairs?: HazardPair[];
  /** Иначе классы выводятся отсюда. `substances.h_statement_codes` как есть. */
  hCodes?: string[];
  /** Сигнальное слово из базы. Снимает часть неоднозначности H-кода. */
  signalWord?: string | null;
  audience: Audience;
  /** Коды из чужого SDS — движок покажет диф, а не подменит ими свой набор. */
  suppliedCodes?: string[];
  /** Объём тары, мл. Нужен только для проверки послаблений Annex I §1.5.2. */
  containerMl?: number;
  /**
   * Сколько фраз влезает на этикетку по ЗАМЕРУ.
   *
   * ⚠⚠ Считается ДО отбора и по самому тесному языку. CLP ст. 17(2) требует
   * одних и тех же сведений во всех языках этикетки: шесть по-английски и
   * четыре по-гречески — незаконно. Порядок обратен интуитивному:
   * `языки → замер по каждому → лимит = min(6, худший язык) → отбор`.
   * Считает вызывающий (у него настоящий `layoutLabel`), сюда приходит число.
   */
  fitCapacity?: number;
  /**
   * Потолок ст. 28(3). ⚠ Менять только осознанно: «шесть» — цифра регламента,
   * а не удобства. Больше шести законно, «unless necessary to reflect the
   * nature and the severity of the hazards», и это решение человека.
   */
  statutoryLimit?: number;
};

export type ProtocolLine = {
  /** Машинный ключ правила — по нему интерфейс красит строку. */
  rule:
    | 'matrix'          // фраза положена по Annex IV
    | 'consumer-only'   // раздел Annex IV «Consumer products»
    | 'combo-absorbs'   // компонент поглощён своей парой
    | 'no-echa-level'   // у ECHA уровня нет
    | 'omit-if'         // колонка 5: убрать, если есть другая фраза
    | 'duplicate'       // та же фраза от нескольких опасностей
    | 'ladder'          // старшинство по срочности (P310 › P311 › P312 › P313)
    | 'sds-only'        // ECHA относит фразу к SDS, не к этикетке
    | 'anchor-disposal' // закреп ст. 28(2)
    | 'level'           // ранг по шкале ECHA
    | 'coverage'        // сколько опасностей закрывает
    | 'limit'           // не поместилась в лимит
    | 'ambiguous-level' // уровень зависит от условия — решает человек
    | 'ambiguous-class' // H-код читается несколькими классами
    | 'needs-companion' // ECHA даёт фразу «in combination with …», спутника нет
    | 'derogation';     // послабление по объёму тары
  text: string;
  /** Ссылка на первоисточник. Пусто быть не должно — иначе это мнение. */
  citation: string;
};

export type PUnit = {
  /** Код так, как он печатается: одиночный или пара целиком. */
  code: string;
  /** Компоненты пары; у одиночной пусто. */
  components: string[];
  /** general | prevention | response | storage | disposal */
  type: string;
  text: string | null;
  level: EchaLevel | null;
  /**
   * Уровень зависит от условия, которое движок проверить не может (например
   * «highly recommended, если взрывчатое чувствительно к удару»).
   * ⚠ Тогда `level` — верхняя граница, а это поле обязано попасть в интерфейс.
   */
  levelConditional: { best: EchaLevel; worst: EchaLevel; conditions: string[] } | null;
  /** Какие опасности вещества эта единица закрывает. Ключ №4 ранжирования. */
  hazards: HazardPair[];
  /** Условия колонки 5 Annex IV, требующие ответа человека. */
  conditions: string[];
  /**
   * Условия ECHA дословно. ⚠ Хранятся ОТДЕЛЬНО от колонки 5, а не в общей
   * куче: колонка 5 — текст регламента и основание снять фразу, условия ECHA —
   * методичка и основание понизить уровень. Смешать их значит сослаться на
   * регламент там, где говорит методичка.
   */
  echaConditions: string[];
  verdict: 'selected' | 'dropped' | 'absorbed' | 'omitted' | 'sds-only';
  reasons: ProtocolLine[];
  /** Разряд ранжирования; меньше — выше. Только для показа сортировки. */
  rank: number;
};

export type DerogationVerdict = {
  applies: boolean;
  threshold: 125 | 25 | 10;
  /** Что именно разрешено снять. */
  allows: 'h-and-p' | 'p-only' | 'pictogram-signal-h-p' | 'article-17-elements';
  classes: HazardPair[];
  text: string;
  citation: string;
};

export type PrecedenceResult = {
  pairs: HazardPair[];
  /** Неоднозначности разбора H-кодов, если они меняют набор фраз. */
  ambiguity: { hCode: string; candidates: HazardPair[] }[];
  units: PUnit[];
  selected: PUnit[];
  /** Отброшенные. ⭐ Уходят в SDS — так предписывает ECHA §7.2, это не наша выдумка. */
  toSds: PUnit[];
  limit: number;
  limitReason: string;
  derogations: DerogationVerdict[];
  diff: { onlyOurs: string[]; onlyTheirs: string[]; both: string[] } | null;
  /** Честные оговорки о полноте данных. Показывать, а не прятать. */
  notes: string[];
};

// ── Константы, выведенные из первоисточников ────────────────────────────────

/**
 * ⭐⭐ ПЯТЬ КОДОВ БЕЗ УРОВНЯ ECHA, КОТОРЫЕ ВСЁ РАВНО КАНДИДАТЫ.
 *
 * Правило движка звучит так: «код, который является компонентом пары и не имеет
 * своего уровня у ECHA, на этикетку не кандидат». У ECHA действительно нет ни
 * одного блока на 23 кода-компонента (`P301`, `P304`, `P305`, `P313`, `P351`…):
 * она перечисляет только собранную пару.
 *
 * ⚠ Но кодов без уровня в матрице 43, а компонентов среди них 38. Оставшиеся
 * ПЯТЬ — законные кандидаты, и выбросить их значит потерять фразу. Причина
 * отсутствия у каждого своя, и ни одна не означает «не печатать»:
 */
const NO_ECHA_LEVEL_BUT_LEGITIMATE: Record<string, string> = {
  P101: 'общий раздел Annex IV (Consumer products) — таблицы ECHA §7.3 разбирают классы, а не общий раздел',
  P102: 'общий раздел Annex IV (Consumer products) — то же',
  P103: 'общий раздел Annex IV (Consumer products) — то же',
  P212: 'класс Desensitised explosives введён после версии 4.2 методички ECHA (март 2021)',
  P503: 'взрывчатые: у ECHA в колонке Disposal стоит только P501, блока на P503 нет',
};

/**
 * ⭐ Старшинство по срочности — прямой пример ECHA §7.2:
 *
 *   «For a substance classified as acutely toxic and carcinogenic … P310 takes
 *    precedence over P311, P312 and P313.»
 *
 * ⚠⚠ И ОГРАНИЧЕНИЕ, БЕЗ КОТОРОГО ПРАВИЛО ВРЕДИТ. Применять лестницу можно
 * только к фразам с ОДИНАКОВЫМ путём воздействия. `P305+P351+P338` (в глаз) и
 * `P301+P310` (проглочено) обе содержат «медицинскую» часть, но говорят о
 * разном, и снять одну из-за другой — потерять указание для другого пути.
 * Поэтому лестница смотрит на не-медицинские компоненты: они обязаны совпасть.
 */
const MEDICAL_LADDER = ['P310', 'P311', 'P312', 'P313'];

/**
 * Annex I §1.5.2.1.1 — тара ≤ 125 мл: можно снять И H-, И P-фразы.
 * ⚠ Три категории помечены `publicExcluded`: послабление к ним НЕ применяется,
 * если товар поставляется населению. Это не оговорка мелким шрифтом, а условие
 * из текста регламента.
 */
const DEROGATION_125_HP: { classCode: string; categories: string[]; publicExcluded?: boolean }[] = [
  { classCode: 'OX_GAS', categories: ['1'] },
  { classCode: 'GAS_PRESSURE', categories: ['Compressed gas', 'Liquefied gas', 'Refrigerated liquefied gas', 'Dissolved gas'] },
  { classCode: 'FLAM_LIQ', categories: ['2', '3'] },
  { classCode: 'FLAM_SOL', categories: ['1', '2'] },
  { classCode: 'SELF_REACTIVE', categories: ['Type C', 'Type D', 'Type E', 'Type F'] },
  { classCode: 'SELF_HEATING', categories: ['2'] },
  { classCode: 'WATER_REACTIVE', categories: ['1', '2', '3'] },
  { classCode: 'OX_LIQ', categories: ['2', '3'] },
  { classCode: 'OX_SOL', categories: ['2', '3'] },
  { classCode: 'ORG_PEROXIDE', categories: ['Type C', 'Type D', 'Type E', 'Type F'] },
  { classCode: 'ACUTE_TOX_ORAL', categories: ['4'], publicExcluded: true },
  { classCode: 'ACUTE_TOX_DERMAL', categories: ['4'], publicExcluded: true },
  { classCode: 'ACUTE_TOX_INHAL', categories: ['4'], publicExcluded: true },
  { classCode: 'SKIN_CORR_IRRIT', categories: ['2'] },
  { classCode: 'EYE_DAMAGE_IRRIT', categories: ['2'] },
  { classCode: 'STOT_SE', categories: ['2', '3', '3 narcotic'], publicExcluded: true },
  { classCode: 'STOT_RE', categories: ['2'], publicExcluded: true },
  { classCode: 'AQUATIC_ACUTE', categories: ['1'] },
  { classCode: 'AQUATIC_CHRONIC', categories: ['1', '2'] },
];

/** Annex I §1.5.2.1.2 — тара ≤ 125 мл: можно снять ТОЛЬКО P-фразы. */
const DEROGATION_125_P_ONLY: { classCode: string; categories: string[] }[] = [
  { classCode: 'FLAM_GAS', categories: ['2'] },
  { classCode: 'REPRO_TOX', categories: ['Additional category'] }, // эффекты на лактацию
  { classCode: 'AQUATIC_CHRONIC', categories: ['3', '4'] },
];

/** Annex I §1.5.2.1.3 — тара ≤ 125 мл: можно снять пиктограмму, слово, H- и P-фразу. */
const DEROGATION_125_ALL: { classCode: string; categories: string[] }[] = [
  { classCode: 'CORR_METAL', categories: ['1'] },
];

// ── Мелкие помощники ────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => String(s ?? '').trim();
const key = (p: HazardPair) => `${p.classCode}|${p.categoryCode}`;

/**
 * Есть ли в тексте самостоятельное вхождение метки категории.
 *
 * ⚠⚠ ГРАНИЦЫ СЛОВА ЗДЕСЬ НЕ РАБОТАЮТ, И ЭТО ЛОВУШКА, А НЕ ПРИДИРКА. У класса
 * CARCINOGEN категории `1A`, `1B` и `2`. Наивный `\b1\b` не найдёт ничего, а
 * наивный `includes('1')` найдёт «1» внутри «1A» и «1B» — и условие «Highly
 * recommended for category 1A and 1B» будет приписано категории 1, которой у
 * класса нет вовсе. Поэтому проверяем соседей вручную: слева и справа от
 * вхождения не должно быть буквы или цифры.
 *
 * ⚠ `\b` из JS не годится ещё и потому, что метки бывают с точкой и пробелом:
 * «Division 1.4», «Type C», «3 narcotic».
 */
function mentionsToken(text: string, token: string): boolean {
  const t = text.toLowerCase();
  const q = token.toLowerCase().trim();
  if (!q) return false;
  let from = 0;
  for (;;) {
    const i = t.indexOf(q, from);
    if (i < 0) return false;
    const before = i > 0 ? t[i - 1] : '';
    const after = i + q.length < t.length ? t[i + q.length] : '';
    const alnum = (c: string) => !!c && /[a-z0-9]/.test(c);
    if (!alnum(before) && !alnum(after)) return true;
    from = i + 1;
  }
}

/** Говорит ли условие ECHA о категориях вообще (а не о свойстве продукта). */
function conditionScopesCategories(text: string): boolean {
  return /categor(y|ies)/i.test(text) || /\btype\s+[a-g]\b/i.test(text) || /\bdivision\s+1\.\d\b/i.test(text);
}

/**
 * Называет ли условие именно НАШУ категорию.
 * «Type C» и «Division 1.4» приходят как есть, «1A» — голой меткой.
 */
function conditionNamesCategory(text: string, categoryCode: string): boolean {
  const c = norm(categoryCode);
  if (!c) return false;
  if (mentionsToken(text, c)) return true;
  // «Type C» в данных, «C» в условии — и наоборот.
  const bare = c.replace(/^(type|division)\s+/i, '');
  return bare !== c && mentionsToken(text, bare);
}

// ── Проход 1: разбор классификации ──────────────────────────────────────────

/**
 * H-коды вещества → пары «класс + категория».
 *
 * ⚠⚠ СВЯЗКА ОДНОЗНАЧНА НЕ ВСЕГДА, И МОЛЧАТЬ ОБ ЭТОМ НЕЛЬЗЯ. `H242` читается
 * восемью парами (ORG_PEROXIDE и SELF_REACTIVE, типы C–F), `H314` — тремя
 * подкатегориями 1A/1B/1C.
 *
 * ⭐ Но замер по базе показал, что пугать человека надо не всегда: из 18
 * неоднозначных сочетаний «H-код + сигнальное слово» НАБОР P-КОДОВ РАСХОДИТСЯ
 * ТОЛЬКО У ШЕСТИ — `H240`, `H241`, `H242`, `H250`, `H280`. У остальных
 * (`H314`, `H317`, `H334`, `H300`, `H310`, `H330`, `H340`, `H350`, `H360`,
 * `H271`, `H272`) все кандидаты дают ОДИН И ТОТ ЖЕ набор фраз, и на ответ
 * неоднозначность не влияет. Поэтому в `ambiguity` попадают только те, где
 * расхождение настоящее: предупреждение, которое срабатывает всегда, перестают
 * читать.
 *
 * ⚠ `hazard_classifications` в базе ПУСТА (0 строк) — связка идёт через
 * `substances.h_statement_codes` и `clp_matrix_full.h_codes`, а не через неё.
 */
export function resolveHazardPairs(
  hCodes: string[],
  signalWord: string | null | undefined,
  data: PrecedenceData,
): { pairs: HazardPair[]; ambiguity: { hCode: string; candidates: HazardPair[] }[] } {
  const sw = norm(signalWord).toLowerCase();
  const seen = new Map<string, HazardPair>();
  const ambiguity: { hCode: string; candidates: HazardPair[] }[] = [];

  const pSetOf = (p: HazardPair) =>
    data.matrix
      .filter((m) => m.classCode === p.classCode && norm(m.categoryCode) === norm(p.categoryCode))
      .map((m) => m.pCode)
      .sort()
      .join(',');

  for (const raw of hCodes ?? []) {
    const h = norm(raw).toUpperCase();
    if (!h) continue;
    let cands = data.hazardIndex.filter((r) => r.hCodes.some((x) => norm(x).toUpperCase() === h));

    /**
     * ⛔⛔ БЕЗ ЭТОГО ОТКАТА ТЕРЯЕТСЯ КАЖДЫЙ ТРИДЦАТЫЙ H-КОД, И ТИХО.
     *
     * В Annex VI коды печатаются с уточняющей буквой: `H360F` (fertility),
     * `H360D`, `H360FD`, `H361d`, `H350i` (по вдыханию). В матрице Annex IV
     * категория одна на всё семейство, и там лежит голый `H360`. Точное
     * сравнение такой код не находит — и вещество остаётся без своего класса,
     * то есть без половины фраз, ничего при этом не сообщив.
     *
     * ⚠ Мерка по всей базе: 12 724 вхождения H-кодов у 4 178 веществ. Точно
     * совпадают 12 267, **457 требуют отката к четырёхзначной основе**,
     * не разбирается — НОЛЬ. То есть откат закрывает разрыв целиком и ничего
     * не остаётся на выдумку.
     *
     * ⚠ Откат ровно на четыре знака (`H` + три цифры) и только если точного
     * совпадения не нашлось. Резать глубже нельзя: `H301` и `H300` — разные
     * категории острой токсичности, а не форма одного кода.
     */
    if (!cands.length && /^H\d{3}./.test(h)) {
      const stem = h.slice(0, 4);
      cands = data.hazardIndex.filter((r) => r.hCodes.some((x) => norm(x).toUpperCase() === stem));
    }

    if (cands.length > 1 && sw) {
      const bySignal = cands.filter((r) => norm(r.signalWord).toLowerCase() === sw);
      if (bySignal.length) cands = bySignal;
    }
    const pairs = cands.map((r) => ({ classCode: r.classCode, categoryCode: norm(r.categoryCode) }));
    for (const p of pairs) seen.set(key(p), p);

    if (pairs.length > 1) {
      const distinct = new Set(pairs.map(pSetOf));
      // ⭐ Расхождения нет — значит и предупреждения быть не должно.
      if (distinct.size > 1) ambiguity.push({ hCode: h, candidates: pairs });
    }
  }

  return { pairs: [...seen.values()], ambiguity };
}

// ── Проход 2: уровень ECHA для пары ─────────────────────────────────────────

/**
 * Уровень важности фразы для конкретных класса, категории и аудитории.
 *
 * ⛔⛔ ЗДЕСЬ ЖИВЁТ ПОПРАВКА К РАЗБОРУ SESSION 63, И БЕЗ НЕЁ ШКАЛА ВРЁТ.
 * Таблица ECHA на CARCINOGEN накрывает 1A, 1B и 2 разом, а внутри ячейки два
 * пункта: «Highly recommended for category 1A and 1B» и «Recommended for
 * category 2». Разбор разложил блок по всем трём категориям и оставил ОБА
 * пункта у каждой — то есть у категории 2 висит `highly_recommended`, которого
 * методичка ей не давала.
 *
 * ⚠ Мерка: таких сочетаний «класс + код + аудитория» десять. У пяти условие
 * само называет категорию (`CARCINOGEN` P201 и P308+P313, `MUTAGEN` P201,
 * `REPRO_TOX` P201, `FLAM_LIQ` P233) — эти разбираются здесь, автоматически.
 * У других пяти условие говорит о СВОЙСТВЕ ПРОДУКТА («если взрывчатое
 * чувствительно к удару»), и решить за человека нельзя: тогда возвращается
 * `conditional`, а интерфейс обязан спросить.
 *
 * ⚠⚠ Сырые строки при этом НЕ ТРОГАЕМ. Блок ECHA действительно накрывает три
 * категории, и в таблице он записан верно; разделяет их условие. Правка данных
 * стёрла бы связь «вывод → сырой блок», ради которой схема и делалась на шесть
 * таблиц.
 */
export function echaLevelFor(
  pCode: string,
  pair: HazardPair,
  audience: Audience,
  data: PrecedenceData,
): { level: EchaLevel | null; conditional: PUnit['levelConditional']; sdsOnly: boolean; conditions: string[] } {
  const rows = data.echa.filter(
    (r) =>
      r.pCode === pCode &&
      r.classCode === pair.classCode &&
      norm(r.categoryCode) === norm(pair.categoryCode) &&
      (r.audience === 'both' || r.audience === audience),
  );
  if (!rows.length) return { level: null, conditional: null, sdsOnly: false, conditions: [] };

  const label = rows.filter((r) => r.scope === 'label');
  if (!label.length) {
    return {
      level: null,
      conditional: null,
      sdsOnly: true,
      conditions: rows.map((r) => r.conditionText).filter(Boolean),
    };
  }

  // ⭐ Условие, называющее НАШУ категорию, старше общего.
  const namesOurs = label.filter((r) => conditionNamesCategory(r.conditionText, pair.categoryCode));
  // Условие, которое говорит о категориях, но не о нашей, — про соседа. Убрать.
  const notAboutSiblings = label.filter(
    (r) => !conditionScopesCategories(r.conditionText) || conditionNamesCategory(r.conditionText, pair.categoryCode),
  );
  const use = namesOurs.length ? namesOurs : notAboutSiblings.length ? notAboutSiblings : label;

  const levels = [...new Set(use.map((r) => r.level))];
  const best = levels.reduce<EchaLevel>((a, b) => (levelWeight(b) > levelWeight(a) ? b : a), levels[0]);
  const worst = levels.reduce<EchaLevel>((a, b) => (levelWeight(b) < levelWeight(a) ? b : a), levels[0]);

  return {
    level: best,
    conditional:
      levels.length > 1 ? { best, worst, conditions: use.map((r) => r.conditionText).filter(Boolean) } : null,
    sdsOnly: false,
    conditions: use.map((r) => r.conditionText).filter(Boolean),
  };
}

// ── Проход 3: сборка единиц ─────────────────────────────────────────────────

/**
 * Собрать кандидатов в ЕДИНИЦЫ печати.
 *
 * ⭐ «Единица» — это то, что считается одной фразой при счёте до шести. Пара
 * `P305+P351+P338` — одна единица, а не три, и это не наше упрощение:
 *
 *   «Such combined statements should be counted as one P-statement.»
 *   — ECHA Guidance §7.2
 *
 * Отсюда и лечение дефекта: пара атомарна, разорвать её нельзя в принципе, а
 * её компоненты из набора уходят — они уже напечатаны внутри пары.
 */
function buildUnits(pairs: HazardPair[], audience: Audience, data: PrecedenceData): PUnit[] {
  const comboByCode = new Map(data.combos.map((c) => [c.code, c.components.map(norm)]));
  const units = new Map<string, PUnit>();

  for (const pair of pairs) {
    // ⚠ Класс ANY — раздел Annex IV «Consumer products». Профессионалу он не
    // адресован, и печатать «Keep out of reach of children» на бочке для завода
    // значит утверждать то, чего регламент не требует.
    if (pair.classCode === 'ANY' && audience !== 'general_public') continue;

    const rows = data.matrix.filter(
      (m) => m.classCode === pair.classCode && norm(m.categoryCode) === norm(pair.categoryCode),
    );
    for (const row of rows) {
      const code = norm(row.pCode);
      if (!code) continue;
      const existing = units.get(code);
      if (existing) {
        existing.hazards.push(pair);
        // ⭐ Уровень от разных опасностей берём самый высокий — «the most
        // stringent P-statement should be selected» (ECHA §7.2).
        const lv = echaLevelFor(code, pair, audience, data);
        if (levelWeight(lv.level) > levelWeight(existing.level)) {
          existing.level = lv.level;
          existing.levelConditional = lv.conditional;
        }
        for (const c of lv.conditions) if (!existing.echaConditions.includes(c)) existing.echaConditions.push(c);
        if (row.conditionText && !existing.conditions.includes(row.conditionText)) {
          existing.conditions.push(row.conditionText);
        }
        existing.reasons.push({
          rule: 'duplicate',
          text: `Та же фраза положена и по ${pair.classCode} ${pair.categoryCode || ''}`.trim(),
          citation: 'CLP Annex IV, матрица',
        });
        continue;
      }

      const lv = echaLevelFor(code, pair, audience, data);
      const unit: PUnit = {
        code,
        components: comboByCode.get(code) ?? [],
        type: norm(row.statementType) || 'other',
        text: data.text?.[code] ?? null,
        level: lv.level,
        levelConditional: lv.conditional,
        hazards: [pair],
        conditions: row.conditionText ? [row.conditionText] : [],
        echaConditions: [...lv.conditions],
        verdict: 'selected',
        reasons: [
          {
            rule: pair.classCode === 'ANY' ? 'consumer-only' : 'matrix',
            text:
              pair.classCode === 'ANY'
                ? 'Общий раздел Annex IV: применяется, когда товар поставляется населению'
                : `Положена по ${pair.classCode} ${pair.categoryCode || ''}`.trim(),
            citation: 'CLP Annex IV, chapeau: «All specific elements relating to particular hazard classes shall be used»',
          },
        ],
        rank: 0,
      };
      if (lv.sdsOnly) {
        unit.verdict = 'sds-only';
        unit.reasons.push({
          rule: 'sds-only',
          text: `ECHA относит эту фразу к паспорту безопасности, а не к этикетке: ${lv.conditions[0] ?? ''}`.trim(),
          citation: 'ECHA Guidance on Labelling and Packaging v4.2, §7.3',
        });
      }
      if (lv.conditional) {
        unit.reasons.push({
          rule: 'ambiguous-level',
          text: `Уровень зависит от условия — ${lv.conditional.best} или ${lv.conditional.worst}: ${lv.conditional.conditions.join(' | ')}`,
          citation: 'ECHA Guidance v4.2, §7.3 — условие применения',
        });
      }
      units.set(code, unit);
    }
  }

  return [...units.values()];
}

/** Компоненты пар, попавшие в набор, поглощаются самой парой. */
function absorbComponents(units: PUnit[]): void {
  const present = new Set(units.filter((u) => u.verdict !== 'absorbed').map((u) => u.code));
  const owner = new Map<string, string>();
  for (const u of units) for (const c of u.components) if (present.has(c)) owner.set(c, u.code);

  for (const u of units) {
    const by = owner.get(u.code);
    if (!by || by === u.code) continue;
    u.verdict = 'absorbed';
    u.reasons.push({
      rule: 'combo-absorbs',
      text: `Уже напечатана внутри ${by} — пара считается одной фразой и рвать её нельзя`,
      citation: 'ECHA Guidance v4.2, §7.2: «Such combined statements should be counted as one P-statement»',
    });
  }
}

/**
 * ⭐⭐ Компонент пары без своего уровня у ECHA — не кандидат на этикетку.
 *
 * ECHA не завела ни одного блока на 23 кода: `P301`, `P302`, `P303`, `P304`,
 * `P305`, `P306`, `P308`, `P313`, `P332`…`P342`, `P351`…`P362`. Это не пропуск
 * разбора: в таблицах §7.3 перечислена только собранная пара. Значит одиночный
 * `P304` на этикетке — фраза, которую методичка не предполагает.
 *
 * ⚠ Исключения перечислены поимённо в `NO_ECHA_LEVEL_BUT_LEGITIMATE` — см.
 * комментарий там. Без них терялись бы `P101`, `P102`, `P103`, `P212`, `P503`.
 */
function dropUngradedComponents(units: PUnit[], data: PrecedenceData): void {
  const isComponent = new Set<string>();
  for (const c of data.combos) for (const x of c.components) isComponent.add(norm(x));

  for (const u of units) {
    if (u.verdict !== 'selected') continue;
    if (u.level !== null) continue;
    if (NO_ECHA_LEVEL_BUT_LEGITIMATE[u.code]) {
      u.reasons.push({
        rule: 'no-echa-level',
        text: `Уровня у ECHA нет, но фраза законна: ${NO_ECHA_LEVEL_BUT_LEGITIMATE[u.code]}`,
        citation: 'CLP Annex IV, часть 1',
      });
      continue;
    }
    if (isComponent.has(u.code)) {
      u.verdict = 'dropped';
      u.reasons.push({
        rule: 'no-echa-level',
        text: 'Компонент комбинированной фразы: у ECHA нет уровня для него отдельно, на этикетке печатается только собранная пара',
        citation: 'ECHA Guidance v4.2, §7.3 — блоков на этот код в таблицах нет',
      });
    }
  }
}

/**
 * Колонка 5 Annex IV: «убрать X, если на этикетке есть Y».
 *
 * ⭐ Это не наша выдумка и не эвристика — поправка ▼M12 прямо велит применять
 * колонку 5 при отборе:
 *
 *   «Where the text in column 5 indicates that a precautionary statement may be
 *    omitted if another precautionary statement is given on the label, this
 *    information may be used in selecting precautionary statements in
 *    accordance with Articles 22 and 28.»
 *
 * ⚠ Формулировка «may be omitted» — право, а не обязанность. Поэтому фраза
 * помечается `omitted` с причиной, а интерфейс обязан дать вернуть её.
 *
 * ⚠⚠ Правило читается из текста условия, а НЕ из зашитой таблицы. Зашитая
 * копия разошлась бы с базой молча — ровно тот дефект, что ловили в session 39
 * со списком кодов знаков.
 */
function applyOmissionRules(units: PUnit[]): void {
  const alive = () => new Set(units.filter((u) => u.verdict === 'selected').map((u) => u.code));

  for (const u of units) {
    if (u.verdict !== 'selected') continue;
    for (const cond of u.conditions) {
      // «may be omitted if P234 is given on the label», «omit where P202 is used»,
      // «may be omitted when P333 + P313 is given on the label»
      const m = cond.match(/omit(?:ted)?\s+(?:if|when|where)\s+(P\d{3}(?:\s*\+\s*P\d{3})*)/i);
      if (!m) continue;
      const target = m[1].replace(/\s*\+\s*/g, '+').toUpperCase();
      if (!alive().has(target)) continue;
      u.verdict = 'omitted';
      u.reasons.push({
        rule: 'omit-if',
        text: `Колонка 5 Annex IV разрешает снять, потому что на этикетке уже есть ${target}. Право, а не обязанность — можно вернуть.`,
        citation: 'CLP Annex IV, колонка 5 (поправка ▼M12)',
      });
      break;
    }
  }
}

/** Старшинство по срочности внутри одного пути воздействия. */
function applyMedicalLadder(units: PUnit[]): void {
  const rankOf = (code: string) => {
    const parts = code.split('+').map((s) => s.trim());
    const med = parts.find((p) => MEDICAL_LADDER.includes(p));
    return med ? MEDICAL_LADDER.indexOf(med) : -1;
  };
  const routeOf = (code: string) =>
    code
      .split('+')
      .map((s) => s.trim())
      .filter((p) => !MEDICAL_LADDER.includes(p))
      .join('+');

  const byRoute = new Map<string, PUnit[]>();
  for (const u of units) {
    if (u.verdict !== 'selected') continue;
    if (rankOf(u.code) < 0) continue;
    const r = routeOf(u.code);
    if (!byRoute.has(r)) byRoute.set(r, []);
    byRoute.get(r)!.push(u);
  }

  for (const [, group] of byRoute) {
    if (group.length < 2) continue;
    const best = group.reduce((a, b) => (rankOf(b.code) < rankOf(a.code) ? b : a));
    for (const u of group) {
      if (u === best) continue;
      u.verdict = 'dropped';
      u.reasons.push({
        rule: 'ladder',
        text: `Более срочная фраза того же пути уже выбрана — ${best.code}`,
        citation: 'ECHA Guidance v4.2, §7.2: «the most stringent P-statement should be selected»',
      });
    }
  }
}

/**
 * ⭐⭐ «Highly recommended, IN COMBINATION WITH P303+P361+P353, P305+P351+P338
 * or P301+P330+P331» — у ECHA это встречается прямым текстом, и без проверки
 * движок печатает фразу, которая сама по себе смысла не несёт.
 *
 * Пример живой: `P310` «Immediately call a POISON CENTER» у SKIN_CORR_IRRIT.
 * Одна на этикетке она говорит «звоните», не говоря во что промывать и чем.
 * ECHA поэтому и пишет «в сочетании с».
 *
 * ⚠ Снимать фразу за это НЕЛЬЗЯ: сочетание может быть выполнено фразой, которую
 * человек добавил руками, а формальной парой такие связки в CLP не оформлены.
 * Поэтому — замечание в протокол, а решение за человеком.
 */
function checkCompanions(selected: PUnit[]): void {
  const onLabel = new Set(selected.map((u) => u.code));
  for (const u of selected) {
    for (const cond of u.echaConditions) {
      const m = cond.match(/in\s+combination\s+with\s+(.+)$/i);
      if (!m) continue;
      const wanted = (m[1].match(/P\s*\d{3}(?:\s*\+\s*P\s*\d{3})*/gi) ?? []).map((s) =>
        s.replace(/\s+/g, '').toUpperCase(),
      );
      if (!wanted.length) continue;
      if (wanted.some((w) => onLabel.has(w))) continue;
      u.reasons.push({
        rule: 'needs-companion',
        text: `ECHA даёт эту фразу «в сочетании с» ${wanted.join(' / ')}, а ни одной из них на этикетке нет. Проверьте: сама по себе она может быть непонятна.`,
        citation: 'ECHA Guidance v4.2, §7.3 — условие «in combination with»',
      });
    }
  }
}

// ── Проход 4: ранжирование ──────────────────────────────────────────────────

/**
 * Порядок ОТБОРА (какие фразы выживают), а не порядок печати.
 *
 * ⚠⚠ РАЗНИЦА ПРИНЦИПИАЛЬНАЯ. Порядок ПЕЧАТИ регламент отдаёт поставщику
 * дословно: «The supplier may decide the order of the precautionary statements
 * on the label» (ст. 32(2)). Значит зашивать его константой нельзя — это
 * переключатель. А вот порядок ОТБОРА регламентом не задан вовсе, и здесь
 * движок обязан объяснить каждый свой шаг.
 *
 * Ключи, от старшего к младшему:
 *   ① закреп ст. 28(2) — населению одна фраза про утилизацию обязательна;
 *   ② уровень ECHA для этого класса и этой аудитории;
 *   ③ сколько разных опасностей закрывает единица (ст. 28(1) от обратного:
 *      фраза, закрывающая три класса, «unnecessary» не назовёшь);
 *   ④ тип раздела и код — только чтобы результат был воспроизводим.
 *
 * ⚠ Тип фразы из ключей УШЁЛ. В первой редакции замысла он был ключом №4, но
 * ст. 32(2) отдала порядок поставщику, а важность теперь берётся у ECHA.
 */
const TYPE_ORDER = ['general', 'prevention', 'response', 'storage', 'disposal'];

function rankUnits(units: PUnit[], audience: Audience): void {
  const live = units.filter((u) => u.verdict === 'selected');

  /**
   * ① Закрепы. Их ДВА, и они разной природы — смешивать нельзя.
   *
   * ⭐ Первый — закон: ст. 28(2), «where the substance or mixture is supplied to
   * the general public, one precautionary statement addressing the disposal …
   * shall appear on the label». Обязанность, и потому он старший.
   *
   * ⚠⚠ Второй — НАШЕ РЕШЕНИЕ, И НАЗЫВАТЬ ЕГО НАДО ТАК. `P102` «Keep out of
   * reach of children» в Annex IV стоит с условием применения «Consumer
   * products», а не с обязанностью, и шкалы важности у общего раздела нет
   * вовсе — методичка ECHA §7.3 разбирает классы опасности. Значит по правилам
   * движка вес у неё нулевой, и на потребительской таре она уезжала в конец
   * списка, за фразами про хранение.
   *
   * Решение Сергея (session 64): закрепить для населения. Основание —
   * рыночная практика, а не регламент, и в протоколе это сказано прямо. Так
   * профессионал видит, где кончается закон и начинается наш выбор.
   */
  const pins: { unit: PUnit; order: number }[] = [];
  if (audience === 'general_public') {
    const disposal = live
      .filter((u) => u.type === 'disposal')
      .sort((a, b) => levelWeight(b.level) - levelWeight(a.level) || a.code.localeCompare(b.code))[0];
    if (disposal) {
      disposal.reasons.push({
        rule: 'anchor-disposal',
        text: 'Закреплена законом: при поставке населению одна фраза про утилизацию обязана быть на этикетке',
        citation: 'CLP ст. 28(2)',
      });
      pins.push({ unit: disposal, order: 0 });
    }

    const p102 = live.find((u) => u.code === 'P102');
    if (p102) {
      p102.reasons.push({
        rule: 'anchor-disposal',
        text: '⚠ Закреплена НАШИМ решением, а не регламентом: в Annex IV «Keep out of reach of children» стоит с условием применения «Consumer products», а не с обязанностью. Шкалы важности у общего раздела нет, поэтому без закрепа фраза уезжала в конец списка. Снять можно.',
        citation: 'CLP Annex IV, часть 1, раздел общих фраз (условие применения «Consumer products»)',
      });
      pins.push({ unit: p102, order: 1 });
    }
  }
  const pinOrder = new Map(pins.map((p) => [p.unit, p.order]));

  const score = (u: PUnit) => [
    pinOrder.has(u) ? 0 : 1,
    pinOrder.get(u) ?? 0,
    -levelWeight(u.level),
    -u.hazards.length,
    TYPE_ORDER.indexOf(u.type) < 0 ? TYPE_ORDER.length : TYPE_ORDER.indexOf(u.type),
    u.code,
  ];

  live.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] === sb[i]) continue;
      return sa[i] < sb[i] ? -1 : 1;
    }
    return 0;
  });

  live.forEach((u, i) => {
    u.rank = i;
    u.reasons.push({
      rule: 'level',
      text: u.level
        ? `Уровень ECHA: ${u.level}; закрывает опасностей: ${u.hazards.length}`
        : `Уровня у ECHA нет; закрывает опасностей: ${u.hazards.length}`,
      citation: 'ECHA Guidance v4.2, §7.3 + CLP ст. 28(1)',
    });
  });
}

// ── Проход 0.5: послабления по объёму тары ──────────────────────────────────

/**
 * ⭐ ПЕРВЫЙ ОТВЕТ ПРОФЕССИОНАЛА НА «НЕ ЛЕЗЕТ» — НЕ ПРИОРИТЕЗАЦИЯ, А ЗАКОН.
 *
 * До всякого отбора стоит проверить, не разрешает ли Annex I §1.5.2 не печатать
 * фразы вовсе. Все три послабления — «may be omitted», то есть право: движок
 * предлагает, решает человек, выбор пишется в протокол.
 */
export function derogationsFor(pairs: HazardPair[], containerMl: number | undefined, audience: Audience): DerogationVerdict[] {
  if (!containerMl || containerMl > 125) return [];
  const out: DerogationVerdict[] = [];

  const hit = (
    list: { classCode: string; categories: string[]; publicExcluded?: boolean }[],
  ): HazardPair[] =>
    pairs.filter((p) =>
      list.some(
        (r) =>
          r.classCode === p.classCode &&
          r.categories.some((c) => c === norm(p.categoryCode)) &&
          !(r.publicExcluded && audience === 'general_public'),
      ),
    );

  const hp = hit(DEROGATION_125_HP);
  if (hp.length) {
    out.push({
      applies: true,
      threshold: 125,
      allows: 'h-and-p',
      classes: hp,
      text: 'Тара ≤ 125 мл: для этих классов H- и P-фразы можно не печатать. ⚠ Право, а не обязанность.',
      citation: 'CLP Annex I §1.5.2.1.1 (через ст. 29(2))',
    });
  }
  const po = hit(DEROGATION_125_P_ONLY);
  if (po.length) {
    out.push({
      applies: true,
      threshold: 125,
      allows: 'p-only',
      classes: po,
      text: 'Тара ≤ 125 мл: для этих классов можно не печатать P-фразы (H-фразы остаются).',
      citation: 'CLP Annex I §1.5.2.1.2',
    });
  }
  const all = hit(DEROGATION_125_ALL);
  if (all.length) {
    out.push({
      applies: true,
      threshold: 125,
      allows: 'pictogram-signal-h-p',
      classes: all,
      text: 'Тара ≤ 125 мл, коррозия к металлам: можно снять пиктограмму, сигнальное слово, H- и P-фразу.',
      citation: 'CLP Annex I §1.5.2.1.3',
    });
  }
  if (containerMl <= 10) {
    out.push({
      applies: true,
      threshold: 10,
      allows: 'article-17-elements',
      classes: pairs,
      text: 'Внутренняя тара ≤ 10 мл при поставке дистрибьютору: элементы ст. 17 можно снять при условиях §1.5.2.4.',
      citation: 'CLP Annex I §1.5.2.4',
    });
  }
  return out;
}

// ── Замер влезаемости ───────────────────────────────────────────────────────

/**
 * ⚠⚠ ЛИМИТ ЗАДАЁТ САМЫЙ ТЕСНЫЙ ЯЗЫК, И СЧИТАТЬ ЭТО НАДО ДО ОТБОРА.
 *
 * CLP ст. 17(2) требует одних и тех же сведений во всех языках этикетки. Шесть
 * фраз по-английски и четыре по-гречески — незаконная этикетка, а не «немного
 * не влезло». Замер (session 63) на 99,06 × 60 мм: EN — 9 фраз, EL и BG — 6.
 * Разрыв в три фразы из десяти.
 *
 * ⛔ Язык решает не везде, а в узкой полосе размеров: на маленькой этикетке не
 * влезает ни на одном, на большой влезает на всех. Поэтому замер настоящий, а
 * не поправочный коэффициент.
 *
 * @param langs  языки этикетки
 * @param probe  «влезает ли N фраз на языке L» — считает вызывающий настоящим
 *               `layoutLabel`, потому что только у него есть полный `LabelInput`.
 */
export function worstLanguageCapacity(
  langs: string[],
  probe: (lang: string, n: number) => boolean,
  max = 12,
): { capacity: number; worstLang: string | null; byLang: Record<string, number> } {
  const byLang: Record<string, number> = {};
  let capacity = max;
  let worstLang: string | null = null;

  for (const lang of langs.length ? langs : ['EN']) {
    let fit = 0;
    for (let n = 1; n <= max; n++) {
      if (!probe(lang, n)) break;
      fit = n;
    }
    byLang[lang] = fit;
    if (fit < capacity) {
      capacity = fit;
      worstLang = lang;
    }
  }
  return { capacity, worstLang, byLang };
}

// ── Общий вход ──────────────────────────────────────────────────────────────

export function selectPStatements(input: PrecedenceInput, data: PrecedenceData): PrecedenceResult {
  const notes: string[] = [];

  const resolved = input.pairs?.length
    ? { pairs: input.pairs.map((p) => ({ classCode: p.classCode, categoryCode: norm(p.categoryCode) })), ambiguity: [] }
    : resolveHazardPairs(input.hCodes ?? [], input.signalWord, data);

  /**
   * ⛔⛔ ОБЩИЙ РАЗДЕЛ ANNEX IV НЕ ПРИХОДИТ НИ ИЗ ОДНОГО H-КОДА, И ЭТО ЛОВУШКА.
   *
   * `P101`, `P102` «Keep out of reach of children», `P103` лежат в матрице под
   * классом `ANY` с условием «Consumer products». H-кода у них нет по существу:
   * они положены не за опасность, а за то, что товар идёт населению. Разбор
   * классификации их поэтому не находит НИКОГДА, и первый прогон движка выдал
   * потребительскую этикетку без «беречь от детей», не сказав ни слова.
   *
   * ⚠ Поймано только прогоном на живом веществе — ни один вывод из данных на
   * это не указывал: в матрице строки есть, в наборе их нет, и обе стороны
   * выглядят правильно по отдельности.
   */
  if (input.audience === 'general_public' && data.matrix.some((m) => m.classCode === 'ANY')) {
    if (!resolved.pairs.some((p) => p.classCode === 'ANY')) {
      resolved.pairs.push({ classCode: 'ANY', categoryCode: '' });
    }
  }

  // ⚠ Классы, введённые после версии 4.2 методички ECHA (март 2021), шкалы не
  // имеют, и молчать об этом нельзя: пустой уровень выглядит как «неважно».
  const ungraded = resolved.pairs.filter(
    (p) => p.classCode !== 'ANY' && !data.echa.some((r) => r.classCode === p.classCode && norm(r.categoryCode) === norm(p.categoryCode)),
  );
  if (ungraded.length) {
    notes.push(
      `У ${ungraded.map((p) => `${p.classCode} ${p.categoryCode}`.trim()).join(', ')} шкалы важности ECHA нет: методичка версии 4.2 (март 2021) старше этих классов. Отбор для них опирается только на Annex IV и статью 28.`,
    );
  }
  for (const a of resolved.ambiguity) {
    notes.push(
      `${a.hCode} читается по-разному (${a.candidates.map((c) => `${c.classCode} ${c.categoryCode}`.trim()).join(' / ')}), и наборы фраз у прочтений расходятся. Взято объединение — проверьте, какая категория ваша.`,
    );
  }

  const units = buildUnits(resolved.pairs, input.audience, data);
  absorbComponents(units);
  dropUngradedComponents(units, data);
  applyOmissionRules(units);
  applyMedicalLadder(units);
  rankUnits(units, input.audience);

  const statutory = input.statutoryLimit ?? 6;
  const fit = input.fitCapacity ?? Infinity;
  const limit = Math.max(1, Math.min(statutory, fit));
  const limitReason =
    fit < statutory
      ? `Ограничивает размер этикетки: по замеру помещается ${fit}, а не ${statutory}. ⚠ Считалось по самому тесному языку — ст. 17(2) требует одинаковых сведений во всех языках.`
      : `Потолок статьи 28(3): не более ${statutory} фраз, «unless necessary to reflect the nature and the severity of the hazards».`;

  const live = units.filter((u) => u.verdict === 'selected').sort((a, b) => a.rank - b.rank);
  const selected = live.slice(0, limit);
  for (const u of live.slice(limit)) {
    u.verdict = 'dropped';
    u.reasons.push({
      rule: 'limit',
      text: `Не поместилась в лимит ${limit}. ⭐ Уходит в паспорт безопасности — так предписывает ECHA, а не мы.`,
      citation: 'ECHA Guidance v4.2, §7.2: «The de-selected statements can be introduced under the relevant headings of the SDS»',
    });
  }

  checkCompanions(selected);

  /**
   * ⚠⚠ ЧЕСТНАЯ ОГОВОРКА, А НЕ КОСМЕТИКА. Ранжирование стоит на шкале ECHA, а у
   * `P101`, `P102`, `P103`, `P212`, `P503` шкалы нет — методичка §7.3 их просто
   * не разбирает. Значит они весят ноль и уходят вниз списка автоматически.
   *
   * Для `P102` «Keep out of reach of children» на потребительской таре это
   * выглядит неправильно, и молчать тут нельзя. ⛔ Но и «закрепить» её движок не
   * вправе: в Annex IV она стоит с условием применения «Consumer products», а не
   * с обязанностью, и ст. 28(2) закрепляет только утилизацию. Поэтому — строка в
   * оговорках, решение за человеком.
   */
  const ungradedPushedOut = units.filter(
    (u) => NO_ECHA_LEVEL_BUT_LEGITIMATE[u.code] && !selected.includes(u) && u.verdict !== 'omitted',
  );
  if (ungradedPushedOut.length) {
    notes.push(
      `Не попали на этикетку из-за отсутствия шкалы, а не из-за неважности: ${ungradedPushedOut.map((u) => u.code).join(', ')}. Методичка ECHA §7.3 разбирает классы опасности и общий раздел Annex IV не оценивает, поэтому ранг у этих фраз нулевой. ⚠ Для товара населению это стоит проверить руками — особенно P102 «Keep out of reach of children».`,
    );
  }

  const toSds = units.filter((u) => u.verdict !== 'selected' || !selected.includes(u));

  let diff: PrecedenceResult['diff'] = null;
  if (input.suppliedCodes?.length) {
    const ours = new Set(selected.map((u) => u.code));
    const theirs = new Set(input.suppliedCodes.map((c) => norm(c).toUpperCase().replace(/\s*\+\s*/g, '+')));
    diff = {
      onlyOurs: [...ours].filter((c) => !theirs.has(c)).sort(),
      onlyTheirs: [...theirs].filter((c) => !ours.has(c)).sort(),
      both: [...ours].filter((c) => theirs.has(c)).sort(),
    };
  }

  return {
    pairs: resolved.pairs,
    ambiguity: resolved.ambiguity,
    units: units.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code)),
    selected,
    toSds,
    limit,
    limitReason,
    derogations: derogationsFor(resolved.pairs, input.containerMl, input.audience),
    diff,
    notes,
  };
}
