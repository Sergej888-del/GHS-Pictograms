// functions/api/classify/lookup.ts — GET /api/classify/lookup?q=…
// Поиск компонента по CAS / EC / index number / имени, ≤ 10 кандидатов
// с уже собранной карточкой (пары A0, SCL, M-факторы, ATE, ноты).
//
// ⭐⭐ ОДИН ЗАПРОС — ОДНА КАРТОЧКА. Найти и тут же показать, что подтянется:
// иначе интерфейс сначала рисует имя, а состав правды приезжает вторым
// запросом, и человек успевает нажать «добавить» вслепую.
//
// ⚠ Коллизия CAS (кадмий, №82): один CAS может принадлежать нескольким
// записям Annex VI. Возвращаем ВСЕ формы и число `formsSharingCas` —
// выбирает человек. `.single()` по CAS запрещён (урок session 74).
//
// ⛔ Тексты — по-английски.

import type { EventContext } from '@cloudflare/workers-types';
import { corsHeaders, fail, json, loadProfiles, rateLimit, rpc, tooMany, type Env } from './_shared.ts';

interface Candidate {
  indexNumber: string;
  name: string;
  casPrimary: string | null;
  ecPrimary: string | null;
  hCodes: string[] | null;
  formsSharingCas: number;
  pairs: number;
}

export async function onRequestGet(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('classifier lookup: Pages Variables missing');
    return fail(503, 'NOT_CONFIGURED', 'Search is not available right now. Try again later.');
  }

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return json({ ok: true, query: q, candidates: [], profiles: {} });
  }
  if (q.length > 120) {
    return fail(400, 'BAD_INPUT', 'That search term is too long.');
  }

  // Поиск дешевле расчёта, но это тоже обращение к закрытым таблицам —
  // лимит свой, отдельным ведром, чтобы набор в поле не съедал квоту расчётов.
  let rate;
  try {
    rate = await rateLimit(env, request, 'lookup');
  } catch {
    return fail(503, 'RATE_LIMIT_UNAVAILABLE', 'Search is busy. Try again in a minute.');
  }
  if (!rate.allowed) return tooMany(rate);

  try {
    const candidates = await rpc<Candidate[]>(env, 'classifier_lookup', { p_q: q, p_limit: 10 });
    const profiles = candidates.length
      ? await loadProfiles(env, candidates.map((c) => c.indexNumber))
      : {};
    return json({
      ok: true,
      query: q,
      candidates,
      profiles,
      rateLimit: { remaining: rate.remaining, limit: rate.limit, resetAt: rate.resetAt },
    });
  } catch (err) {
    console.error('classifier lookup failed', JSON.stringify({ message: (err as Error)?.message }));
    return fail(500, 'LOOKUP_FAILED', 'The search could not be completed. Try again.');
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders() });
}
