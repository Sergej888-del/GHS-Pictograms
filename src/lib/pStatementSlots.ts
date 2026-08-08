// src/lib/pStatementSlots.ts
// Заполняемые пропуски в тексте P-фраз CLP Annex IV.
//
// ⚠⚠ ЧТО ЭТО. Введение к Annex IV говорит про свой текст прямо:
//   • «…»   — details on the information to be provided are indicated in column (5);
//   • «/»   — a choice has to be made between the phrases they separate
//             in accordance with the indications provided in column (5);
//   • «[…]» — text is not appropriate in every case, conditions for use are
//             given in column (5).
// То есть регламент сам объясняет каждый знак — но только в колонке 5, которой у
// нас не было. Из-за её отсутствия в `p_statements.text_plain` кем-то дописаны
// ОТВЕТЫ ЗА ПОСТАВЩИКА: «Keep wetted with water» вместо «Keep wetted with …».
// Регламент про смачивающий агент ничего не утверждает, и для многих веществ
// вода — прямо опасный ответ. Колонка 5 теперь в базе: `p_statement_conditions`.
//
// Разбор с замерами — claude/p-statement-ellipsis.md.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠⚠ ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: ВЫБОРА ПО КОСОЙ ЧЕРТЕ.
//
// Косая черта совпадает между языками только у 8 кодов из 41. Пример P313:
//
//   EN  Get medical advice/attention.
//   DE  Ärztlichen Rat einholen/ärztliche Hilfe hinzuziehen.
//   FI  Hakeudu lääkäriin.          ← выбора НЕТ вовсе
//   FR  Consulter un médecin.       ← выбора НЕТ вовсе
//
// Выбрал поставщик «attention» по-английски — по-фински выбирать не из чего.
// Общего контрола «выбери одно» на два языка не существует, и это устройство
// регламента, а не наша недоработка. ⚠ Границы альтернатив вдобавок не
// разбираются из строки: в «Get medical advice/attention» альтернативы —
// «advice» и «attention», а не «Get medical advice» и «attention».
// Сегодня косая черта печатается как есть; так делают почти все живые этикетки.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⭐⭐ УПРОЩЕНИЕ, НА КОТОРОМ ВСЁ ДЕРЖИТСЯ. На H-фразах уже решено: поставщик
// вводит значение ОТДЕЛЬНО ДЛЯ КАЖДОГО ЯЗЫКА (переводить введённое им мы не
// можем). Значит сопоставлять слоты между языками не нужно вообще: для каждого
// языка берём его собственный текст и считаем пропуски в нём. У P413
// по-английски четыре поля, по-итальянски три — и это ПРАВИЛЬНО, а не
// расхождение: итальянская редакция не печатает вариант в °F.
//
// Источник: EUR-Lex / Publications Office, CELEX 02008R1272, Annex IV.

/**
 * Обязателен ли пропуск.
 *
 * `required` — пропуск стоит дополнением при глаголе или предлоге, и без него
 * фраза ломается: «Keep wetted with.», «Use to extinguish.». Пустым оставить
 * нельзя — фраза не печатается вовсе.
 *
 * `optional` — пропуск идёт последним в перечислении через косую черту и значит
 * «или укажите иное»: «POISON CENTER/doctor/…». Предыдущие варианты остаются в
 * силе, и пропуск законно опускается вместе со своей косой чертой.
 *
 * ⚠⚠ Отличие СТРУКТУРНОЕ, а не стилистическое. У H-фраз пропуск был
 * обстоятельством, и опущение всегда оставляло предложение целым. Здесь — нет.
 */
export type PSlotKind = 'required' | 'optional';

/**
 * Схема слотов по АНГЛИЙСКОМУ эталону — по одному массиву на код.
 *
 * ⚠⚠ Почему по английскому, а не по каждому языку отдельно. Проверка «перед
 * знаком стоит косая черта» на самом тексте работает по-английски, но врёт в
 * эстонском, шведском, итальянском и румынском: там косая черта стоит раньше в
 * предложении, а знак — в конце («võtta ühendust MÜRGISTUSTEABEKESKUSE/arstiga…»).
 * Смысл при этом тот же самый. Английская редакция ставит знак сразу за косой
 * чертой во всех таких кодах, и разночтений в ней нет — она и служит эталоном.
 *
 * ⚠ Замерено по 576 строкам (24 кода × 24 языка), не составлено на глаз.
 */
export const P_SLOTS: Record<string, PSlotKind[]> = {
  'P230': ['required'],
  'P231': ['optional'],
  'P231+P232': ['optional'],
  'P241': ['optional'],
  'P250': ['optional'],
  'P264': ['required'],
  'P301+P310': ['optional'],
  'P301+P312': ['optional'],
  'P302+P352': ['optional'],
  'P308+P311': ['optional'],
  'P310': ['optional'],
  'P311': ['optional'],
  'P312': ['optional'],
  'P320': ['required'],
  'P321': ['required'],
  'P342+P311': ['optional'],
  'P352': ['optional'],
  'P370+P378': ['required'],
  'P378': ['required'],
  'P401': ['required'],
  'P406': ['optional'],
  'P411': ['required', 'optional'],
  'P413': ['required', 'optional', 'required', 'optional'],
  'P501': ['required'],
};

/**
 * Языковые редакции, где знак пропуска напечатан не знаком.
 *
 * ⚠⚠ Литовский P230 вместо многоточия печатает СЛОВО: «Laikyti sudrėkintą
 * (kuo)» — «(чем)». Это то же указание поставщику, и на этикетке ему не место.
 * Проверено по `.tmp-eurlex/clp-consolidated-lt.html`.
 * ⚠ Список измерен: это единственный такой случай среди 576 строк.
 */
const MARK_EXCEPTIONS: Record<string, Record<string, RegExp>> = {
  'P230': { LT: /\(kuo\)/g },
};

/**
 * Приведение знака к одному виду.
 *
 * ⚠⚠ Знак пропуска в регламенте бывает ЧЕТЫРЁХ видов: «…», «...», «..» и слово
 * в скобках. Латышский P352 печатает ДВЕ точки: «ar lielu ūdens/.. daudzumu».
 * Детектор, ищущий только «…» и «...», пропускал латышский молча — и на
 * этикетке оставались две точки посреди фразы.
 */
export function normaliseMarks(text: string, code = '', lang = ''): string {
  let out = String(text ?? '').replace(/\.{2,3}/g, '…');
  const ex = MARK_EXCEPTIONS[code]?.[String(lang ?? '').toUpperCase()];
  if (ex) out = out.replace(ex, '…');
  return out;
}

/**
 * Коды, у которых часть текста стоит в квадратных скобках.
 *
 * По введению к Annex IV: «text in square brackets is not appropriate in every
 * case and should be used only in certain circumstances». То есть это НЕ пропуск,
 * а необязательный кусок, и решает поставщик — галочкой, а не вводом.
 *
 * ⭐ Единственная разметка P-фраз, которая совпадает во всех 24 языках: 6 кодов
 * из 6. Многоточие совпадает у 20 из 24, косая черта — у 8 из 41.
 * ⚠ По умолчанию кусок ВЫКЛЮЧЕН: «may be used» — это разрешение, а не указание,
 * и включать его за поставщика мы не вправе.
 */
export const P_BRACKET_CODES = [
  'P241', 'P284', 'P334', 'P353', 'P302+P335+P334', 'P303+P361+P353',
] as const;

export function hasPBracket(code: string): boolean {
  return (P_BRACKET_CODES as readonly string[]).includes(code);
}

/**
 * Убрать или раскрыть куски в квадратных скобках.
 *
 * ⚠ Делается ДО разбора пропусков: у P241 пропуск лежит ВНУТРИ скобок
 * («[electrical/ventilating/lighting/…]»), и при выключенном куске поля для него
 * быть не должно вовсе. Иначе поставщик заполнит поле, которого не увидит на
 * этикетке.
 */
export function applyPBrackets(text: string, on: boolean): string {
  const s = String(text ?? '');
  return on ? s.replace(/\[([^\[\]]*)\]/g, '$1') : s.replace(/\s*\[[^\[\]]*\]\s*/g, ' ');
}

/** Сколько полей ввода нужно ЭТОМУ языку для ЭТОГО кода при таком состоянии скобок. */
export function pSlotCount(text: string, code: string, lang: string, bracketOn = false): number {
  const s = applyPBrackets(normaliseMarks(text, code, lang), bracketOn);
  return (s.match(/…/g) ?? []).length;
}

/**
 * Вид каждого слота в конкретной языковой редакции.
 *
 * Когда число слотов совпало с английским — вид берётся поштучно. Когда не
 * совпало (итальянский и нидерландский P413 печатают три слота вместо четырёх,
 * потому что не дают варианта в °F), все слоты считаются `required`.
 * ⚠ Это сознательный перегиб в сторону строгости: лишний раз попросить назвать
 * величину дешевле, чем напечатать «не выше .».
 */
export function pSlotKinds(text: string, code: string, lang: string, bracketOn = false): PSlotKind[] {
  const n = pSlotCount(text, code, lang, bracketOn);
  const ref = P_SLOTS[code];
  if (!ref) return Array(n).fill('required');
  if (ref.length === n) return ref.slice();
  return Array(n).fill('required');
}

/** Есть ли у кода заполняемые пропуски вообще. */
export function hasPSlots(code: string): boolean {
  return Boolean(P_SLOTS[code]);
}

export type RenderedPStatement = {
  /** Текст фразы. ⚠ Гарантированно без «…», «..» и «(kuo)». */
  text: string;
  /** Индексы слотов, которые поставщик заполнил. */
  filled: number[];
  /** Индексы слотов, оставленных пустыми. */
  omitted: number[];
  /** Индексы пустых ОБЯЗАТЕЛЬНЫХ слотов — из-за них фраза не печатается. */
  missing: number[];
  /**
   * ⚠⚠ Фразу печатать нельзя: не заполнено то, без чего она ломается.
   * Вызывающий обязан выбросить строку с этикетки, а не печатать «text».
   */
  suppressed: boolean;
};

/**
 * Слот вместе с косой чертой, если она перед ним стоит.
 *
 * ⚠ ПУСТОЙ слот убирается ВМЕСТЕ С ЧЕРТОЙ: иначе «POISON CENTER/doctor/…»
 * превратится в «POISON CENTER/doctor/», и висящая черта на этикетке читается
 * как обрыв текста.
 * ⚠⚠ ЗАПОЛНЕННЫЙ слот черту СОХРАНЯЕТ. Первая редакция этого файла съедала её
 * заодно со знаком, и «не выше … °C/… °F» превращалось в «не выше 50 oC122oF».
 * В проверках это не всплыло ни разу — увидела только отрисовка.
 */
const SLOT_WITH_SLASH = /(\s*\/\s*)?…/g;

/** Буква или цифра — то, к чему нельзя подставлять значение впритык. */
function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch) && /[\p{L}\p{N}]/u.test(ch as string);
}

/** Прибрать пробелы и знаки после того, как слот убран или заменён. */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*\/\s*([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Собрать печатаемую P-фразу.
 *
 * `values[i]` — то, что поставщик ввёл в i-й слот ЭТОГО языка. ⚠⚠ Значения не
 * переносятся между языками и не переводятся: «hands» внутри немецкой строки —
 * такой же дефект, как непечатаемое многоточие, только незаметнее.
 */
export function renderPStatement(
  text: string,
  code: string,
  lang: string,
  values: (string | undefined)[] = [],
  bracketOn = false,
): RenderedPStatement {
  const src = applyPBrackets(normaliseMarks(text, code, lang), bracketOn);
  const kinds = pSlotKinds(text, code, lang, bracketOn);
  const filled: number[] = [];
  const omitted: number[] = [];
  const missing: number[] = [];

  let i = 0;
  const body = src.replace(SLOT_WITH_SLASH, (match, slash: string | undefined, offset: number) => {
    const idx = i++;
    const v = String(values[idx] ?? '').trim();
    if (!v) {
      omitted.push(idx);
      if (kinds[idx] === 'required') missing.push(idx);
      return '';
    }
    filled.push(idx);
    // ⚠⚠ Пробел ставится ПО СОСЕДНЕМУ ЗНАКУ, а не всегда. «Keep wetted with…»
    // без пробела даёт «witha phlegmatiser», а «…kg» с пробелом — верное
    // «500 kg». Но после косой черты пробела быть не должно: «/doctor/наш
    // круглосуточный телефон», а не «/doctor/ наш».
    const keep = slash ?? '';
    const prev = keep ? keep.trim().slice(-1) : src[offset - 1];
    const next = src[offset + match.length];
    const lead = isWordChar(prev) ? ' ' : '';
    const tail = isWordChar(next) ? ' ' : '';
    return `${keep}${lead}${v}${tail}`;
  });

  return { text: tidy(body), filled, omitted, missing, suppressed: missing.length > 0 };
}

/**
 * Страховка последнего рубежа.
 *
 * ⚠⚠ Ни одна строка на этикетке не имеет права нести указание поставщику.
 * Проверка стоит ОТДЕЛЬНО от `renderPStatement`, потому что ловит и то, чего мы
 * не предусмотрели: новый вид знака в будущем импорте, код вне карты, языковую
 * редакцию, где знак напечатан словом.
 */
export function containsPMarks(s: string): boolean {
  return /…|\.\.|\(kuo\)|[\[\]]/.test(String(s ?? ''));
}

/**
 * Вытащить сочинённый ответ из нашего `text_plain` в ПРЕДЗАПОЛНЕНИЕ поля.
 *
 * ⭐⭐ Смысл приёма: сочинённое никуда не девается, но перестаёт быть невидимым
 * утверждением и становится предложением, которое поставщик видит и принимает.
 * «Wash hands thoroughly after handling» на этикетке — это мы утверждаем, что
 * мыть надо руки. «hands» в поле «parts of the body to be washed» рядом с
 * требованием регламента — это предложение, за которое отвечает поставщик.
 *
 * ⚠⚠ И приём САМООГРАНИЧЕН в честную сторону. Значение достаётся, только если
 * наш текст и правда был подстановкой: начало и конец обязаны совпасть с
 * официальными. Где мы не подставили, а ПЕРЕСКАЗАЛИ — «not exceeding the
 * specified temperature» вместо «… °C/… °F», «contents and container» вместо
 * «contents/container» — совпадения нет, и поле остаётся пустым. Пересказ в
 * предзаполнение не попадёт никогда.
 *
 * ⚠ Работает только для однослотовых кодов и только для того языка, у которого
 * есть наш `text_plain` (английский).
 */
export function inferSlotDefault(
  official: string,
  ours: string | null | undefined,
  code: string,
  lang: string,
): string | null {
  if (!ours) return null;
  const o = applyPBrackets(normaliseMarks(official, code, lang), true);
  if ((o.match(/…/g) ?? []).length !== 1) return null;

  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const bare = (s: string) => flat(s).replace(/[.\s]+$/, '');

  const [rawPre, rawPost] = o.split(/\s*\/?\s*…/);
  const pre = flat(rawPre ?? '');
  const post = bare(rawPost ?? '');
  const plain = flat(ours);

  if (pre && !plain.startsWith(pre)) return null;
  const tail = bare(plain);
  if (post && !tail.endsWith(post)) return null;

  const mid = tail.slice(pre.length, post ? tail.length - post.length : undefined);
  const value = mid.replace(/^[\s,;:]+|[\s,;:.]+$/g, '');
  return value || null;
}
