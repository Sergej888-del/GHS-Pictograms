/**
 * Граница индексации страниц веществ — ОДНО правило на страницу, sitemap и сторож.
 *
 * ⚠⚠ ЗАЧЕМ (session 85, 2026-09-02). 09–18.08 Google проиндексировал ~1,9 тыс.
 * наших страниц, из них большинство — вещества. 21.08 показы в Google упали
 * с ~1,5 тыс./день до ~100, средняя позиция 24 → 56, и просели ВСЕ разделы,
 * а не только вещества: /ghs/ghs05/ 247 → 45, /compliance/reach/… 214 → 49,
 * /un/ 191 → 65. Апдейта Google на эту дату нет, техники (noindex, X-Robots,
 * robots.txt, блокировка Googlebot) нет — Googlebot получает 200. Это сайтовая
 * переоценка: 2 088 страниц веществ без данных LCSS — один шаблон, 1,1–1,7 тыс.
 * слов переводов и повторяющихся блоков и ни одного собственного факта.
 *
 * ⚠ При этом в Bing папка /substances/ за полгода дала 315 показов и 4 клика
 * при 3,5 тыс. страниц в индексе, а в цитированиях Copilot (28 тыс. за 30 дней)
 * веществ нет вовсе. Закрытие ничего не стоит ни одному поисковику.
 *
 * ПРАВИЛО. Страница вещества индексируется, если у CAS есть запись
 * в src/data/lcss-values.json (числовые свойства с источниками) ИЛИ
 * в src/data/lcss-text.json (описание, сводка опасностей, OEL и т.д.).
 * Остальные получают `<meta name="robots" content="noindex, follow">`,
 * НЕ попадают в sitemap, но остаются на сайте, в инструментах и в перелинковке.
 * Замер на сборке 2026-09-02: 1 563 индексируемых, 2 088 закрытых.
 *
 * ⚠⚠ `noindex` ставится ОДИН РАЗ. Снять и вернуть — Google переиндексирует
 * медленно и с недоверием. Поэтому граница здесь одна и она должна только
 * УЖЕСТОЧАТЬСЯ: следующий шаг — «и прошёл check:facts» (аудит s86: 164
 * страницы печатают в прозе число, расходящееся с другими источниками).
 *
 * ⚠ Все три потребителя — src/pages/substances/[slug].astro (мета-тег),
 * src/pages/sitemap.xml.ts (отбор адресов) и scripts/check-dist.ts
 * (subs-index-gate, subs-sitemap) — обязаны звать ЭТУ функцию, а не повторять
 * условие. Разойдись они — sitemap позовёт краулера на закрытую страницу.
 */
import lcssValues from '../data/lcss-values.json'
import lcssText from '../data/lcss-text.json'

/** Версия правила — печатается в отчёте check:dist, чтобы смена была видна. */
export const SUBSTANCE_INDEX_GATE = 'lcss-presence-1'

const withValues = new Set(Object.keys(lcssValues as Record<string, unknown>))
const withText = new Set(Object.keys(lcssText as Record<string, unknown>))

/** Индексировать ли страницу вещества с этим CAS. */
export function substanceIndexable(cas: string): boolean {
  return withValues.has(cas) || withText.has(cas)
}

/** Сколько CAS проходят границу — для заголовка сторожа. */
export function substanceIndexableCount(): number {
  return new Set([...withValues, ...withText]).size
}
