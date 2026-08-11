/**
 * Снимок данных движка отбора P-фраз — статический файл `/data/p-precedence.json`.
 *
 * Собирается НА СБОРКЕ из пяти таблиц и отдаётся как обычная статика. Читает
 * его `src/lib/pPrecedenceData.ts`, а разбирает `src/lib/pPrecedence.ts`.
 *
 * ⭐⭐ ЭТО ОТВЕТ НА РАЗВИЛКУ ИЗ ОЧЕРЕДИ №6 — «клиент или сборка». Сборка, и вот
 * почему:
 *
 * ① **Движку нужны ВСЕ строки до первого ответа.** Он не уточняет ответ по мере
 *    загрузки: неполная матрица даёт не медленный ответ, а НЕВЕРНЫЙ — фраза,
 *    которой нет в выборке, молча не попадёт на этикетку. Частичная загрузка
 *    здесь хуже отсутствия загрузки.
 * ② **Молчаливые отказы Supabase уже кусали этот проект** (session 31,
 *    claude/silent-supabase-failures.md: успешная сборка выкатила 15 страниц
 *    веществ без §10). Четыре запроса на каждое открытие инструмента — четыре
 *    повода отдать этикетку с недобранным набором фраз и не сказать ни слова.
 * ③ **Это регламент, а не пользовательские данные.** Матрица Annex IV меняется
 *    с выходом ATP, примерно раз в полтора года. Тянуть её на каждого
 *    посетителя — платить за свежесть, которой не бывает.
 * ④ **Cloudflare кэширует статику и не кэширует Supabase.** При кэше 10,9 %
 *    (очередь №3) добавлять четыре некэшируемых запроса на посетителя значит
 *    идти против единственной дешёвой победы, какая у нас есть.
 *
 * ⚠⚠ И ПОЧЕМУ ЭНДПОИНТ, А НЕ СКРИПТ ВЫГРУЗКИ С ФАЙЛОМ В GIT. Первая редакция
 * была скриптом (`npm run dump:p-precedence` → закоммитить 215 КБ). Отброшена:
 * снимок в git ОТСТАЁТ ОТ БАЗЫ МОЛЧА. Забыл прогнать после правки матрицы — и
 * инструмент отбирает по вчерашним данным, ничем себя не выдавая. Здесь файл
 * пересобирается на каждом деплое, лишнего шага нет и забыть нечего.
 *
 * ⚠ Зависимость сборки от базы этим НЕ добавляется: сборка и так тянет из
 * Supabase 4 500 страниц. Добавляется пять запросов к пяти маленьким таблицам.
 */
import type { APIRoute } from 'astro'
import { supabase } from '../../lib/supabase'
import { must } from '../../lib/mustQuery'

export const prerender = true

/**
 * ⚠⚠ ЧИТАЕМ СТРАНИЦАМИ ВСЕГДА. PostgREST отдаёт не больше 1 000 строк за раз, а
 * соединение ECHA уже даёт 749 — сегодня влезает, завтра нет. Молча обрезанная
 * выборка здесь означает потерянную фразу на этикетке, а не «неполный список».
 */
async function all<T>(table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const rows = must(
      `${table} (from=${from})`,
      await supabase.from(table).select(columns).order(order).range(from, from + page - 1),
    ) as unknown as T[]
    out.push(...(rows ?? []))
    if (!rows || rows.length < page) break
  }
  return out
}

type MatrixRaw = {
  class_code: string; category_code: string; p_code: string; statement_type: string
  conditions_for_use: string | null; h_codes: string[] | null; signal_word: string | null
}
type ScopeRaw = { table_id: number; class_code: string; category_code: string }
type BlockRaw = { block_id: number; table_id: number; column_type: string; p_code: string }
type RecRaw = { block_id: number; level: string; scope: string; audience: string; condition_text: string | null }
type ComboRaw = { code: string; components: string[] | null; text_en: string | null }
type PTextRaw = { code: string; text_en: string | null }

export const GET: APIRoute = async () => {
  const [matrixRaw, scopes, blocks, recs, combosRaw, pSingles] = await Promise.all([
    all<MatrixRaw>('clp_matrix_full',
      'class_code, category_code, p_code, statement_type, conditions_for_use, h_codes, signal_word', 'class_code'),
    all<ScopeRaw>('echa_p_table_scope', 'table_id, class_code, category_code', 'table_id'),
    all<BlockRaw>('echa_p_block', 'block_id, table_id, column_type, p_code', 'block_id'),
    all<RecRaw>('echa_p_recommendation', 'block_id, level, scope, audience, condition_text', 'rec_id'),
    all<ComboRaw>('p_statement_combinations', 'code, components, text_en', 'code'),
    all<PTextRaw>('p_statements', 'code, text_en', 'code'),
  ])

  // ── Словарь условий: один на колонку 5 Annex IV и на условия ECHA ─────────
  // ⚠ Текст условия повторяется десятками строк. Словарь режет снимок вдвое и
  // ничего не меняет по смыслу: индекс разворачивается обратно при чтении.
  const conds: string[] = []
  const condIndex = new Map<string, number>()
  const cond = (text: string | null | undefined): number | null => {
    const t = (text ?? '').trim()
    if (!t) return null
    const hit = condIndex.get(t)
    if (hit !== undefined) return hit
    conds.push(t)
    condIndex.set(t, conds.length - 1)
    return conds.length - 1
  }

  const matrix = matrixRaw.map((r) => [
    r.class_code, r.category_code, r.p_code, r.statement_type, cond(r.conditions_for_use),
  ])

  // ── Пара «класс + категория» → H-коды и сигнальное слово ──────────────────
  // ⚠⚠ ПРИ РАСХОЖДЕНИИ ВНУТРИ ПАРЫ — ПАДАЕМ, А НЕ ВЫБИРАЕМ. Замерено: сегодня
  // расхождений нет ни по `h_codes`, ни по `signal_word` (0 из 105 пар). Но
  // если завтра появится, молча взятая первая строка отдаст веществу ЧУЖОЙ
  // набор фраз — а сборка при этом останется зелёной. Лучше красная сборка.
  const hidxMap = new Map<string, { cls: string; cat: string; h: string[]; sw: string | null }>()
  for (const r of matrixRaw) {
    const key = `${r.class_code}|${r.category_code}`
    const h = (r.h_codes ?? []).slice().sort()
    const prev = hidxMap.get(key)
    if (!prev) { hidxMap.set(key, { cls: r.class_code, cat: r.category_code, h, sw: r.signal_word }); continue }
    if (prev.h.join(',') !== h.join(',') || prev.sw !== r.signal_word) {
      throw new Error(
        `build: p-precedence — пара ${key} описана в clp_matrix_full по-разному: ` +
        `[${prev.h}] «${prev.sw}» против [${h}] «${r.signal_word}»`,
      )
    }
  }
  const hidx = [...hidxMap.values()].map((v) => [v.cls, v.cat, v.h, v.sw])

  // ── Шкала ECHA: рекомендация × блок × охват таблицы ───────────────────────
  const blockById = new Map(blocks.map((b) => [b.block_id, b]))
  const scopesByTable = new Map<number, ScopeRaw[]>()
  for (const s of scopes) {
    const list = scopesByTable.get(s.table_id) ?? []
    list.push(s)
    scopesByTable.set(s.table_id, list)
  }
  const echa: unknown[][] = []
  let orphans = 0
  for (const r of recs) {
    const b = blockById.get(r.block_id)
    if (!b) { orphans++; continue }
    for (const s of scopesByTable.get(b.table_id) ?? []) {
      echa.push([s.class_code, s.category_code, b.p_code, b.column_type,
        r.level, r.scope, r.audience, cond(r.condition_text)])
    }
  }
  if (orphans) throw new Error(`build: p-precedence — ${orphans} рекомендаций ECHA без блока`)

  const combos = combosRaw
    .filter((c) => (c.components ?? []).length > 0)
    .map((c) => [c.code, c.components as string[]])

  const text: [string, string][] = []
  for (const r of [...pSingles, ...combosRaw]) if (r.text_en) text.push([r.code, r.text_en])

  const snapshot = {
    counts: {
      matrix: matrix.length,
      echa: echa.length,
      echaRecommendations: recs.length,
      combos: combos.length,
      pairs: hidx.length,
      conditions: conds.length,
      texts: text.length,
    },
    conds, matrix, echa, combos, hidx, text,
  }

  return new Response(JSON.stringify(snapshot), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // ⚠ Файл меняется только с деплоем — держать его у посетителя сутки
      // безопасно и снимает повторную загрузку при возврате на инструмент.
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
