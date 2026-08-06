/**
 * Значения идентификационных номеров опасности (номер Кемлера), ADR 5.3.2.3.2.
 *
 * ⚠⚠ ФАЙЛ РАЗОБРАН ИЗ ПЕРВОИСТОЧНИКА, НЕ ПИСАН ПО ПАМЯТИ.
 * Источник: ADR 2025, ECE/TRANS/352 Vol. II, раздел 5.3.2.3.2 — PDF лежит в
 * _active-docs/2412010_E_ECE_TRANS_352_Vol.II_WEB.pdf. Тексты verbatim, 97 кодов.
 *
 * ⚠ Покрытие проверено по базе: из 96 значений `dg_substances.hazard_id_number`
 * здесь нет ровно двух, и оба — не пробел разбора, а устройство самого ADR:
 *   · `1.5D` (UN 0331, UN 0332) — у Класса 1 номером опасности служит код
 *     классификации (правило 5.3.2.3.1, последний абзац);
 *   · `688`  (UN 3423) — комбинация напечатана в Таблице A, но в перечень
 *     5.3.2.3.2 не входит. Придумывать ей текст нельзя: показываем разбор по
 *     цифрам из 5.3.2.3.1 и честно говорим, что готового значения в ADR нет.
 *
 * Правило проекта: пустая секция честнее чужого текста.
 */

/** Код → значение из перечня 5.3.2.3.2, слово в слово. */
export const HIN_MEANING: Record<string, string> = {
  '20': "asphyxiant gas or gas with no subsidiary hazard",
  '22': "refrigerated liquefied gas, asphyxiant",
  '223': "refrigerated liquefied gas, flammable",
  '225': "refrigerated liquefied gas, oxidizing (fire-intensifying)",
  '23': "flammable gas",
  '238': "gas, flammable corrosive",
  '239': "flammable gas, which can spontaneously lead to violent reaction",
  '25': "oxidizing (fire-intensifying) gas",
  '26': "toxic gas",
  '263': "toxic gas, flammable",
  '265': "toxic gas, oxidizing (fire-intensifying)",
  '268': "toxic gas, corrosive",
  '28': "gas, corrosive",
  '30': "flammable liquid (flash-point between 23 °C and 60 °C, inclusive) or flammable liquid or solid in the molten state with a flash-point above 60 °C, heated to a temperature equal to or above its flash-point, or self-heating liquid",
  '323': "flammable liquid which reacts with water, emitting flammable gases",
  'X323': "flammable liquid which reacts dangerously with water, emitting flammable gases",
  '33': "highly flammable liquid (flash-point below 23 °C)",
  '333': "pyrophoric liquid",
  'X333': "pyrophoric liquid which reacts dangerously with water",
  '336': "highly flammable liquid, toxic",
  '338': "highly flammable liquid, corrosive",
  'X338': "highly flammable liquid, corrosive, which reacts dangerously with water",
  '339': "highly flammable liquid which can spontaneously lead to violent reaction",
  '36': "flammable liquid (flash-point between 23 °C and 60 °C, inclusive), slightly toxic, or self- heating liquid, toxic",
  '362': "flammable liquid, toxic, which reacts with water, emitting flammable gases",
  'X362': "flammable liquid toxic, which reacts dangerously with water, emitting flammable gases",
  '368': "flammable liquid, toxic, corrosive",
  '38': "flammable liquid (flash-point between 23 °C and 60 °C, inclusive), slightly corrosive or self-heating liquid, corrosive",
  '382': "flammable liquid, corrosive, which reacts with water, emitting flammable gases",
  'X382': "flammable liquid, corrosive, which reacts dangerously with water, emitting flammable gases",
  '39': "flammable liquid, which can spontaneously lead to violent reaction",
  '40': "flammable solid, or self-reactive substance, or self-heating substance, or polymerizing substance",
  '423': "solid which reacts with water, emitting flammable gases, or flammable solid which reacts with water, emitting flammable gases or self-heating solid which reacts with water, emitting flammable gases",
  'X423': "solid which reacts dangerously with water, emitting flammable gases, or flammable solid which reacts dangerously with water, emitting flammable gases, or self-heating solid which reacts dangerously with water, emitting flammable gases",
  '43': "spontaneously flammable (pyrophoric) solid",
  'X432': "spontaneously flammable (pyrophoric) solid which reacts dangerously with water, emitting flammable gases",
  '44': "flammable solid, in the molten state at an elevated temperature",
  '446': "flammable solid, toxic, in the molten state, at an elevated temperature",
  '46': "flammable or self-heating solid, toxic",
  '462': "toxic solid which reacts with water, emitting flammable gases",
  'X462': "solid which reacts dangerously with water, emitting toxic gases",
  '48': "flammable or self-heating solid, corrosive",
  '482': "corrosive solid which reacts with water, emitting flammable gases",
  'X482': "solid which reacts dangerously with water, emitting corrosive gases",
  '50': "oxidizing (fire-intensifying) substance",
  '539': "flammable organic peroxide",
  '55': "strongly oxidizing (fire-intensifying) substance",
  '556': "strongly oxidizing (fire-intensifying) substance, toxic",
  '558': "strongly oxidizing (fire-intensifying) substance, corrosive",
  '559': "strongly oxidizing (fire-intensifying) substance, which can spontaneously lead to violent reaction",
  '56': "oxidizing substance (fire-intensifying), toxic",
  '568': "oxidizing substance (fire-intensifying), toxic, corrosive",
  '58': "oxidizing substance (fire-intensifying), corrosive",
  '59': "oxidizing substance (fire-intensifying) which can spontaneously lead to violent reaction",
  '60': "toxic or slightly toxic substance",
  '606': "infectious substance",
  '623': "toxic liquid, which reacts with water, emitting flammable gases",
  '63': "toxic substance, flammable (flash-point between 23 °C and 60 °C, inclusive)",
  '638': "toxic substance, flammable (flash-point between 23 °C and 60 °C, inclusive), corrosive",
  '639': "toxic substance, flammable (flash-point not above 60 °C) which can spontaneously lead to violent reaction",
  '64': "toxic solid, flammable or self-heating",
  '642': "toxic solid, which reacts with water, emitting flammable gases",
  '65': "toxic substance, oxidizing (fire-intensifying)",
  '66': "highly toxic substance",
  '663': "highly toxic substance, flammable (flash-point not above 60 °C)",
  '664': "highly toxic solid, flammable or self-heating",
  '665': "highly toxic substance, oxidizing (fire-intensifying)",
  '668': "highly toxic substance, corrosive",
  'X668': "highly toxic substance, corrosive, which reacts dangerously with water",
  '669': "highly toxic substance which can spontaneously lead to violent reaction",
  '68': "toxic substance, corrosive",
  '69': "toxic or slightly toxic substance, which can spontaneously lead to violent reaction",
  '70': "radioactive material",
  '768': "radioactive material, toxic, corrosive",
  '80': "corrosive or slightly corrosive substance",
  'X80': "corrosive or slightly corrosive substance, which reacts dangerously with water",
  '823': "corrosive liquid which reacts with water, emitting flammable gases",
  '83': "corrosive or slightly corrosive substance, flammable (flash-point between 23 °C and 60 °C, inclusive)",
  'X83': "corrosive or slightly corrosive substance, flammable, (flash-point between 23 °C and 60 °C, inclusive), which reacts dangerously with water",
  '836': "Corrosive or slightly corrosive substance, flammable (flash-point between 23 °C and 60 °C, inclusive) and toxic",
  '839': "corrosive or slightly corrosive substance, flammable (flash-point between 23 °C and 60 °C inclusive) which can spontaneously lead to violent reaction",
  'X839': "corrosive or slightly corrosive substance, flammable (flash-point between 23 °C and 60 °C inclusive), which can spontaneously lead to violent reaction and which reacts dangerously with water",
  '84': "corrosive solid, flammable or self-heating",
  '842': "corrosive solid which reacts with water, emitting flammable gases",
  '85': "corrosive or slightly corrosive substance, oxidizing (fire-intensifying)",
  '856': "corrosive or slightly corrosive substance, oxidizing (fire-intensifying) and toxic",
  '86': "corrosive or slightly corrosive substance, toxic",
  '88': "highly corrosive substance",
  'X88': "highly corrosive substance, which reacts dangerously with water",
  '883': "highly corrosive substance, flammable (flash-point between 23 °C and 60 °C inclusive)",
  '884': "highly corrosive solid, flammable or self-heating",
  '885': "highly corrosive substance, oxidizing (fire-intensifying)",
  '886': "highly corrosive substance, toxic",
  'X886': "highly corrosive substance, toxic, which reacts dangerously with water",
  '89': "corrosive or slightly corrosive substance, which can spontaneously lead to violent reaction",
  '90': "environmentally hazardous substance; miscellaneous dangerous substances",
  '99': "miscellaneous dangerous substance carried at an elevated temperature",
}

/**
 * Общее значение цифр, ADR 5.3.2.3.1. Нужно там, где готовой строки в 5.3.2.3.2
 * нет (см. `688`), и для разбора номера по цифрам на странице.
 */
export const HIN_DIGIT: Record<string, string> = {
  '2': 'Emission of gas due to pressure or to chemical reaction',
  '3': 'Flammability of liquids (vapours) and gases or self-heating liquid',
  '4': 'Flammability of solids or self-heating solid',
  '5': 'Oxidizing (fire-intensifying) effect',
  '6': 'Toxicity or risk of infection',
  '7': 'Radioactivity',
  '8': 'Corrosivity',
  '9': 'Risk of spontaneous violent reaction',
  '0': 'No further hazard — the first figure alone describes the hazard adequately',
}
