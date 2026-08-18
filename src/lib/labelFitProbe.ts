/**
 * ЗАМЕР ВЛЕЗАЕМОСТИ: сколько P-фраз реально помещается на ЭТУ этикетку.
 *
 * ⚠⚠ ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, ЕСЛИ `layoutLabel` УЖЕ ОТВЕЧАЕТ «ВЛЕЗЛО / НЕТ».
 *
 * `layoutLabel` отвечает про ГОТОВЫЙ набор: разложил — влезло или нет. А отбор
 * фраз (`selectPStatements`) обязан знать число ДО того, как набор собран:
 * лимит входит в отбор параметром `fitCapacity`, а не проверяется после него.
 * Отсюда двухпроходная схема, и этот модуль — её средний шаг:
 *
 *   отбор без лимита → ЗАМЕР по каждому языку → лимит = min(28(3), худший язык)
 *   → отбор с лимитом
 *
 * ⛔⛔ ЛИМИТ ЗАДАЁТ САМЫЙ ТЕСНЫЙ ЯЗЫК, А НЕ ОСНОВНОЙ. CLP ст. 17(2) требует
 * одних и тех же сведений во всех языках этикетки. Девять фраз по-английски и
 * шесть по-болгарски — не «немного не влезло», а незаконная этикетка. Замер
 * session 63 на 99,06 × 60 мм: EN — 9, EL и BG — 6, разрыв в три фразы из
 * десяти. Разбор: `claude/label-fit-size-vs-language.md`.
 *
 * ⛔ ПОПРАВОЧНЫМ КОЭФФИЦИЕНТОМ ЭТО НЕ РЕШАЕТСЯ, И ЭТО ПРОВЕРЕНО. Язык решает не
 * везде, а в узкой полосе размеров: на маленькой этикетке не влезает ни на
 * одном языке, на большой влезает на всех. Средняя ширина знака описывает ЯЗЫК,
 * а переполняется КОНКРЕТНАЯ фраза, и внутри одного языка разброс больше, чем
 * между языками (`claude/label-text-width-by-language.md` §2). Поэтому замер
 * настоящий: тот же `layoutLabel`, что рисует этикетку.
 *
 * ⚠⚠ ПОЛЗУНОК КЕГЛЯ ВХОДИТ В ЗАМЕР. `bodyScale` едет в `LabelOptions` как есть:
 * человек увеличил шрифт — фраз влезает меньше, и число обязано это показать.
 * Замер по автоподбору при поднятом ползунке обещал бы место, которого нет.
 *
 * ⚠ Модуль намеренно БЕЗ React и без сети: его гоняет и конструктор, и
 * `scripts/check-label-fit.ts` под `node --experimental-strip-types`.
 */
import {
  layoutLabel,
  type LabelInput,
  type LabelOptions,
  type SecondLanguageBlock,
  type SignalLevel,
  type Statement,
} from './labelEngine.ts';
import { worstLanguageCapacity } from './pPrecedence.ts';

/**
 * Языковой слой этикетки: всё, что на этом языке печатается.
 *
 * ⚠⚠ ТЕКСТЫ ПРИХОДЯТ ГОТОВЫМИ К ПЕЧАТИ, А НЕ СЫРЫМИ ИЗ БАЗЫ. Отрисовку
 * пропусков (`renderPStatement`, `renderStatement`) делает тот же код, который
 * печатает этикетку. Иначе замер и печать разошлись бы, а расхождение здесь
 * означает «обещали шесть, влезло пять» — и обнаружилось бы уже на бумаге.
 *
 * ⚠ Фраза, у которой обязательный пропуск не заполнен, на этикетку не идёт.
 * Для замера её всё равно надо передать ОФИЦИАЛЬНЫМ текстом: пропуск заполнят,
 * и строка станет длиннее, а не короче. Замер обязан быть консервативным.
 */
export type FitLangBlock = {
  /** Официальное сигнальное слово на этом языке; `null` — источника нет. */
  signalWord: string | null;
  /** Имя вещества на этом языке; `undefined` — перевода нет, печатать нечего. */
  productName?: string;
  /** H-фразы в том виде, в каком встанут на этикетку. */
  hStatements: Statement[];
  /** Текст P-фразы по коду. Коды, которых здесь нет, берут откат по `fallbackP`. */
  pText: Record<string, string>;
};

/**
 * Этикетка без P-фраз: всё, что от их числа не зависит.
 *
 * ⚠ `options` несёт размер, юрисдикцию, назначение, объём тары и `bodyScale`.
 * Ровно те же, что у превью, — иначе меряется не та этикетка, которую печатают.
 */
export type FitProbeContext = {
  /** Языки этикетки. ⚠ Основной — первым: он задаёт порядок блоков. */
  langs: string[];
  byLang: Record<string, FitLangBlock>;
  /** Откат текста P-фразы, когда официального на языке нет. Ключ — код. */
  fallbackP: Record<string, string>;
  productName: string;
  casNumber?: string;
  ecNumber?: string | null;
  nominalQty?: string;
  batchNumber?: string;
  ufiCode?: string;
  signalLevel: SignalLevel | null;
  pictograms: { code: string; svg: string }[];
  pFormat: 'codes' | 'combined';
  supplier: { name?: string; address?: string; phone?: string };
  logo?: { dataUrl: string; aspect: number };
  notes?: string[];
  /** Второй язык подан равноправно (Канада, Бельгия) — тот же кегль, не курсив. */
  secondEqual?: boolean;
  options: LabelOptions;
};

/** Текст P-фразы на языке с откатом. */
function pTextFor(ctx: FitProbeContext, lang: string, code: string): string {
  return ctx.byLang[lang]?.pText[code] ?? ctx.fallbackP[code] ?? code;
}

function statementsFor(ctx: FitProbeContext, lang: string, codes: string[]): Statement[] {
  return codes.map((code) => ({ code, text: pTextFor(ctx, lang, code) }));
}

/**
 * Собрать ввод раскладки так, будто на этикетке стоят ровно эти фразы, а
 * основной язык — `lang`.
 *
 * ⚠⚠ ВТОРОЙ БЛОК ОСТАЁТСЯ НА МЕСТЕ, И ЭТО ГЛАВНОЕ В ЗАМЕРЕ. Меряй мы каждый
 * язык поодиночке, двуязычная этикетка получила бы вместимость одноязычной —
 * то есть вдвое завышенную. На двуязычной каждая фраза печатается ДВАЖДЫ, и
 * место занимает пара, а не строка.
 *
 * Отсюда и смысл перебора языков в `measureFitCapacity`: языки меняются
 * местами (кто основной, кто второй), а сама пара блоков остаётся. Минимум по
 * перестановкам и есть честная вместимость.
 */
export function buildProbeInput(ctx: FitProbeContext, lang: string, codes: string[]): LabelInput {
  const primary = ctx.byLang[lang];
  const otherLang = ctx.langs.find((l) => l !== lang) ?? null;
  const other = otherLang ? ctx.byLang[otherLang] : null;

  const second: SecondLanguageBlock | undefined = otherLang && other
    ? {
        langTag: otherLang,
        signalWord: other.signalWord,
        productName: other.productName,
        equal: ctx.secondEqual,
        hStatements: other.hStatements,
        pStatements: statementsFor(ctx, otherLang, codes),
        combinedPText: ctx.pFormat === 'combined'
          ? codes.map((c) => pTextFor(ctx, otherLang, c)).join(' ')
          : undefined,
      }
    : undefined;

  return {
    productName: primary?.productName ?? ctx.productName,
    casNumber: ctx.casNumber,
    ecNumber: ctx.ecNumber,
    nominalQty: ctx.nominalQty,
    batchNumber: ctx.batchNumber,
    ufiCode: ctx.ufiCode,
    signalWord: primary?.signalWord ?? null,
    signalLevel: ctx.signalLevel,
    pictograms: ctx.pictograms,
    hStatements: primary?.hStatements ?? [],
    pStatements: statementsFor(ctx, lang, codes),
    pFormat: ctx.pFormat,
    combinedPText: ctx.pFormat === 'combined'
      ? codes.map((c) => pTextFor(ctx, lang, c)).join(' ')
      : undefined,
    supplier: ctx.supplier,
    logo: ctx.logo,
    second,
    notes: ctx.notes,
  };
}

/**
 * Влезает ли этикетка с этими фразами, если основной язык — `lang`.
 *
 * ⚠ Ответ берётся у `layoutLabel().fit.fits`, а не считается заново. Второго
 * мнения о влезаемости в проекте быть не должно: session 65 лечила ровно это у
 * Table 1.3, где сравнений размера оказалось четыре и все разные.
 */
export function probeFits(ctx: FitProbeContext, lang: string, codes: string[]): boolean {
  return layoutLabel(buildProbeInput(ctx, lang, codes), ctx.options).fit.fits;
}

export type FitMeasurement = {
  /** Сколько фраз влезает на самом тесном языке. */
  capacity: number;
  /** Кто оказался самым тесным; `null` — все языки одинаковы. */
  worstLang: string | null;
  /** Сколько влезает на каждом языке. Показывать человеку, а не прятать. */
  byLang: Record<string, number>;
  /** Сколько фраз вообще предлагал отбор — с чем сравнивать вместимость. */
  candidates: number;
  /** Ни одна фраза не влезает при этом размере и кегле. */
  none: boolean;
  /**
   * ⛔⛔ ВЛЕЗАЕТ ЛИ ЭТИКЕТКА ВООБЩЕ БЕЗ ЕДИНОЙ P-ФРАЗЫ.
   *
   * Без этого поля «влезает 0 фраз» читается как «нужно меньше фраз», а причина
   * бывает совсем другой: у анилина ДЕВЯТЬ H-фраз, и на двуязычной этикетке
   * 105 × 74 они не помещаются сами по себе, ещё до всякого отбора. Резать
   * P-фразы там бессмысленно — резать нечего, надо менять размер или кегль.
   *
   * ⚠ Разница видна, только если задать вопрос отдельно: раскладка на ПУСТОМ
   * наборе P-фраз. Одна лишняя раскладка на замер, и интерфейс перестаёт
   * винить фразы в том, к чему они не причастны.
   */
  baseFits: boolean;
};

/**
 * Замер по всем языкам этикетки. `codes` — кандидаты В ПОРЯДКЕ ОТБОРА: первым
 * пробуется самый важный, потому что резать всегда будут хвост.
 *
 * ⚠ Перебор линейный и обрывается на первом «не влезло». Так задумано:
 * `worstLanguageCapacity` не ищет максимум, а находит границу снизу. Если
 * n фраз не влезли, а n+1 почему-то влезли, взято меньшее — замер обязан
 * ошибаться в сторону осторожности.
 */
export function measureFitCapacity(ctx: FitProbeContext, codes: string[]): FitMeasurement {
  const langs = ctx.langs.length ? ctx.langs : ['EN'];
  const m = worstLanguageCapacity(
    langs,
    (lang, n) => probeFits(ctx, lang, codes.slice(0, n)),
    codes.length,
  );
  return {
    capacity: m.capacity,
    worstLang: m.worstLang,
    byLang: m.byLang,
    candidates: codes.length,
    none: m.capacity === 0,
    // ⚠ Спрашивается только когда не влезло ничего: в остальных случаях ответ
    // известен заранее — раз влезла одна фраза, влезет и ни одной.
    baseFits: m.capacity > 0 || langs.every((lang) => probeFits(ctx, lang, [])),
  };
}
