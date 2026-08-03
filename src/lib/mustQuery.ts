// Обёртки над ответом Supabase — «падать громко на ОШИБКЕ, деградировать тихо
// на ПУСТОТЕ» (session 31).
//
// ⚠⚠ Почему это отдельный модуль, а не функции во фронтматтере страницы.
// Astro исполняет `getStaticPaths()` в ИЗОЛИРОВАННОЙ области видимости: консты
// и функции, объявленные в `---`, внутри неё НЕ видны, а импорты верхнего уровня
// видны. Первая версия этой правки положила `must()` во фронтматтер страницы
// вещества, и сборка легла с `must is not defined`. Правило записано в
// `compliance-hub-infrastructure.md` §9.1 — стоило прочитать до, а не после.
//
// ⚠ Зачем всё это. До правки каждый запрос на сборке был написан как
// `const { data } = await supabase…`, и `error` выбрасывался при
// деструктуризации. Отказ сети превращался в отсутствующий блок БЕЗ единой
// строчки в логе: 2026-08-03 успешная сборка молча выкатила 15 страниц веществ
// без §10 — среди них серная, соляная и азотная кислоты. Поймала это только
// проверка `sdssec-anchors` в check-dist, за минуту до деплоя.
// Разбор: claude/silent-supabase-failures.md.
//
// Пустой ответ — факт о данных, его можно пережить. Ошибка запроса — факт о
// сети, и она обязана остановить сборку: страница без раздела опаснее, чем
// сборка, которая не состоялась.

export interface PostgrestLike<T> {
  data: T
  error: { message: string; code?: string } | null
}

/** Ошибка запроса роняет сборку; `what` попадает в текст, чтобы было видно ЧТО и ГДЕ. */
export function must<T>(what: string, res: PostgrestLike<T>): T {
  if (res.error) throw new Error(`build: ${what} — ${res.error.message}`)
  return res.data
}

/**
 * То же для `.single()`.
 * ⚠ `PGRST116` («строк нет») — это факт о данных, а не отказ: раньше такой ответ
 * давал `null`, и ронять на нём сборку значило бы поменять поведение, а не
 * починить дефект.
 */
export function mustSingle<T>(what: string, res: PostgrestLike<T | null>): T | null {
  if (res.error && res.error.code !== 'PGRST116') {
    throw new Error(`build: ${what} — ${res.error.message}`)
  }
  return res.data ?? null
}

/**
 * Прогон с ограничением параллелизма.
 *
 * ⚠⚠ Зачем. `getStaticPaths` страницы вещества делал
 * `Promise.all(pages.map(async …))` — то есть запускал ВСЕ 109 веществ разом, по
 * ~7 запросов на каждое: около 700 одновременных обращений к Supabase. Пулер это
 * не держит, и Postgres начинает отвечать `canceling statement due to statement
 * timeout`. Сама по себе тяжёлая RPC быстрая: `get_class_substances('BASE', 9)`
 * в одиночку укладывается в 177 мс — проблема ровно в том, сколько их сразу.
 *
 * Пока ошибки глотались (`const { data } = …`), это выглядело не как отказ, а как
 * пропавший на части страниц блок. См. claude/silent-supabase-failures.md.
 *
 * ⚠ Число воркеров подбиралось на 109 страницах: 6 проходит стабильно. Поднимать
 * без замера не стоит — выигрыш секунды, цена те же тихие таймауты.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
