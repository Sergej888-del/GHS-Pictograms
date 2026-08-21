/**
 * Мост между двумя именованиями категорий в базе.
 *
 * `clp_precautionary_matrix` (и вид `clp_matrix_full`) называет категории так,
 * как их печатает Annex IV: «Division 1.1», «Type C», «Additional category»,
 * «Pyrophoric gas», у раздражения глаз — просто «2». Реестр категорий
 * `hazard_category_mapping` называет их как Annex I / таблицы классификации:
 * «1.1», «Type C and D», «Lactation», «Pyrophoric», «2A» и «2B».
 *
 * ⚠⚠ ПОКА МОСТА НЕ БЫЛО, /hazard-classes/ МОЛЧА ПЕЧАТАЛА «none» В КОЛОНКЕ
 * P-КОДОВ у взрывчатых веществ дивизионов 1.1–1.5, у органических пероксидов
 * и самореактивных веществ типов C–F, у раздражения глаз 2A/2B, у лактации,
 * у химически нестабильных и пирофорных газов — всего у 21 строки. Страница
 * собирала P-коды по ключу «класс|категория реестра», а в матрице такого ключа
 * не было. Никто не замечал, потому что «none» выглядит как законный ответ:
 * у Explosives 1.6 и Type G фраз и вправду нет. Нашлось в session 76, когда
 * появилась проверка `hazard-classes-pcodes` с обратной сверкой «ключ базы →
 * строка страницы».
 *
 * ⚠ Движок P-фраз (`pPrecedence.ts`) этим мостом НЕ пользуется: он работает
 * прямо с категориями матрицы через `clp_matrix_full.h_codes`. Мост нужен
 * там, где матрицу кладут рядом с реестром: страница классов и её проверка.
 *
 * Возвращает СПИСОК: одна строка матрицы может питать две строки реестра
 * («2» → «2A» и «2B»; «1» у кожи → «1A», «1B», «1C»), а общие фразы класса
 * `ANY` (P101–P103, Annex IV Table 6.1) не принадлежат ни одной категории.
 */
export function matrixToMappingCategories(classCode: string, matrixCategory: string): string[] {
  const cls = classCode.trim()
  const cat = matrixCategory.trim()
  if (cls === 'ANY' || !cat) return []

  // «Division 1.4» → «1.4»
  const division = cat.match(/^Division\s+(\d\.\d)$/i)
  if (division) return [division[1]]

  switch (cls) {
    case 'EYE_DAMAGE_IRRIT':
      return cat === '2' ? ['2A', '2B'] : [cat]
    case 'SKIN_CORR_IRRIT':
      return cat === '1' ? ['1A', '1B', '1C'] : [cat]
    case 'FLAM_GAS':
      if (cat === 'A') return ['Chemically unstable A']
      if (cat === 'B') return ['Chemically unstable B']
      if (/^Pyrophoric gas$/i.test(cat)) return ['Pyrophoric']
      return [cat]
    case 'ORG_PEROXIDE':
    case 'SELF_REACTIVE': {
      const type = cat.match(/^Type\s+([A-G])$/i)
      if (!type) return [cat]
      const letter = type[1].toUpperCase()
      if (letter === 'C' || letter === 'D') return ['Type C and D']
      if (letter === 'E' || letter === 'F') return ['Type E and F']
      return [`Type ${letter}`]
    }
    case 'REPRO_TOX':
      return /^Additional category$/i.test(cat) ? ['Lactation'] : [cat]
    default:
      return [cat]
  }
}
