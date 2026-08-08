// src/lib/labelMarkets.ts
// Рынки, у которых официальных языков больше одного.
//
// ⚠⚠ ЭТОТ ФАЙЛ РЕШАЕТ РОВНО ОДИН ВОПРОС: печатать второй язык РАВНОПРАВНО или
// подчинённо. Больше он ничего не решает — какие именно фразы печатать, берётся
// из `statement_translations`, а не отсюда.
//
// Почему это вообще вопрос. Движок по умолчанию печатает второй язык курсивом и
// приглушённым серым: читатель видит пару «фраза и её перевод». Там, где второй
// язык добавлен по желанию поставщика, это верно. А в Канаде английский и
// французский обязательны ОБА, и серый курсив там — не оформление, а
// утверждение «этот текст второстепенный». Юридически он не второстепенный.
//
// ⚠⚠ РАЗНИЦА МЕЖДУ ДВУМЯ УРОВНЯМИ УВЕРЕННОСТИ — ГЛАВНОЕ В ЭТОМ ФАЙЛЕ.
//
//   'required'  — норма прямо требует оба языка на одной этикетке. Такой ровно
//                 один: Канада, HPR s. 6.2. Одноязычная этикетка поставщика там
//                 незаконна, и это написано в самом акте.
//
//   'official'  — у государства несколько официальных языков, а CLP Art. 17(2)
//                 требует этикетку «на официальном языке (языках) государства,
//                 где вещество или смесь поставляется на рынок, если это
//                 государство не установит иное». Установило ли оно иное —
//                 вопрос НАЦИОНАЛЬНОГО права, и наш инструмент на него не
//                 отвечает. Мы перечисляем языки и говорим об этом прямо.
//
// ⚠⚠ Сочинять «в Бельгии достаточно двух» или «в Финляндии хватит финского» —
// значит выдать догадку за норму на документе, который человек наклеит на тару.
// Если уверенности нет, её отсутствие печатается словами, а не сглаживается.

import type { JurisdictionKey } from './jurisdictions';

export type MarketCertainty = 'required' | 'official';

export type LabelMarket = {
  /** Код рынка. ⚠ Не код языка: у одного рынка их несколько. */
  code: string;
  name: string;
  jurisdiction: JurisdictionKey;
  /**
   * Официальные языки рынка, которые ЕСТЬ в приложениях CLP.
   * ⚠⚠ Люксембургского здесь нет и быть не может: люксембургский не входит в
   * официальные языки ЕС, значит в Annex III и IV его текстов не существует.
   * Напечатать этикетку на нём мы физически не можем — и молча делать вид, что
   * рынок закрыт двумя языками, нельзя.
   */
  languages: string[];
  certainty: MarketCertainty;
  /** Норма, на которую мы ссылаемся. Печатается человеку. */
  citation: string;
  /** Что именно сказать человеку. ⚠ Без обещаний, которых мы не можем дать. */
  note: string;
};

/**
 * ⚠ Список НЕ полный по замыслу: здесь только рынки, где языков больше одного.
 * Одноязычные рынки в таблице не нужны — у них второй язык всегда добровольный,
 * и подача по умолчанию (подчинённая) верна.
 */
export const MULTILINGUAL_MARKETS: LabelMarket[] = [
  {
    code: 'CA',
    name: 'Canada',
    jurisdiction: 'whmis',
    languages: ['EN', 'FR'],
    certainty: 'required',
    citation: 'HPR s. 6.2',
    note:
      'English and French are both mandatory on a Canadian supplier label. A unilingual label is not lawful, ' +
      'and neither language is subordinate — both are printed at the same size.',
  },
  {
    code: 'BE',
    name: 'Belgium',
    jurisdiction: 'clp',
    languages: ['NL', 'FR', 'DE'],
    certainty: 'official',
    citation: 'CLP Art. 17(2)',
    note:
      'Belgium has three official languages — Dutch, French and German. Art. 17(2) requires the label to be in ' +
      'the official language(s) of the market. ⚠ This tool prints two languages at a time, so a label for the ' +
      'whole Belgian market may need a third block that it cannot produce; check which regions you supply.',
  },
  {
    code: 'LU',
    name: 'Luxembourg',
    jurisdiction: 'clp',
    languages: ['FR', 'DE'],
    certainty: 'official',
    citation: 'CLP Art. 17(2)',
    note:
      'French and German are official languages of Luxembourg and both exist in the CLP annexes. ' +
      '⚠ Luxembourgish is also official there but is not an EU official language, so the regulation publishes ' +
      'no Luxembourgish wording at all — we cannot print it, and we will not invent it.',
  },
  {
    code: 'FI',
    name: 'Finland',
    jurisdiction: 'clp',
    languages: ['FI', 'SV'],
    certainty: 'official',
    citation: 'CLP Art. 17(2)',
    note:
      'Finnish and Swedish are both official languages of Finland. Whether one alone is accepted is a question of ' +
      'Finnish national law, which this tool does not answer — confirm it before printing a unilingual label.',
  },
  {
    code: 'IE',
    name: 'Ireland',
    jurisdiction: 'clp',
    languages: ['EN', 'GA'],
    certainty: 'official',
    citation: 'CLP Art. 17(2)',
    note:
      'English and Irish are both official languages of Ireland and both exist in the CLP annexes. ' +
      'English-only labels are what the Irish market normally sees; confirm this for your product.',
  },
  {
    code: 'MT',
    name: 'Malta',
    jurisdiction: 'clp',
    languages: ['MT', 'EN'],
    certainty: 'official',
    citation: 'CLP Art. 17(2)',
    note:
      'Maltese and English are both official languages of Malta and both exist in the CLP annexes. ' +
      'Confirm which your customer requires before printing only one.',
  },
];

export const MARKET_BY_CODE = new Map(MULTILINGUAL_MARKETS.map((m) => [m.code, m]));

/** Рынки, которые стоит предложить для выбранной юрисдикции. */
export function marketsFor(jurisdiction: JurisdictionKey): LabelMarket[] {
  return MULTILINGUAL_MARKETS.filter((m) => m.jurisdiction === jurisdiction);
}

/**
 * Печатать ли второй язык равноправно.
 *
 * ⚠⚠ Правило одно, и оно не про вкус: РАВНОПРАВНО, если рынок требует более
 * одного языка. Отсюда следует и поведение Канады без всякого особого случая в
 * коде: у WHMIS `requiredLanguages` уже равно `['en','fr']`, и рынок CA стоит в
 * таблице. Особый случай, написанный вторым местом, однажды разойдётся с первым.
 *
 * @param jurisdiction выбранная юрисдикция
 * @param marketCode   выбранный рынок или null — «рынок не указан»
 * @param requiredLanguages `requiredLanguages` юрисдикции из jurisdictions.ts
 */
export function secondLanguageIsEqual(
  jurisdiction: JurisdictionKey,
  marketCode: string | null,
  requiredLanguages: string[],
): boolean {
  // Юрисдикция сама требует два языка — Канада. Рынок уточнять не нужно.
  if (requiredLanguages.length > 1) return true;
  if (!marketCode) return false;
  const m = MARKET_BY_CODE.get(marketCode);
  return !!m && m.jurisdiction === jurisdiction && m.languages.length > 1;
}

/**
 * Пара языков, которую стоит подставить для рынка.
 *
 * ⚠ Возвращаются ПЕРВЫЕ ДВА из перечисленных, и порядок в таблице значим: для
 * Бельгии это NL + FR, а не FR + DE. Порядок взят по числу говорящих, и это
 * догадка об удобстве, а не норма — человек вправе переставить.
 */
export function suggestedPairFor(marketCode: string | null): [string, string] | null {
  if (!marketCode) return null;
  const m = MARKET_BY_CODE.get(marketCode);
  if (!m || m.languages.length < 2) return null;
  return [m.languages[0], m.languages[1]];
}
