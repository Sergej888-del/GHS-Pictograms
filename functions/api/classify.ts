// functions/api/classify.ts — POST /api/classify
// Серверный слой классификатора смесей (design-doc §3, шаг 5 §9).
//
// ⭐⭐⭐ ЗАЧЕМ СЕРВЕР, А НЕ ОСТРОВ. Три причины, каждой хватило бы одной:
//   1. таблицы правил ЗАКРЫТЫ для anon (№99, session 78) — читать их может
//      только service-ключ, а он не имеет права попасть в бандл;
//   2. `statement_timeout` роли anon — 3 с; тяжёлый состав в браузере в него
//      не уложится, а service_role лимита не имеет;
//   3. правовой контур не должен зависеть от того, что прислал браузер:
//      классификации компонентов Annex VI подтягиваются ЗДЕСЬ по index_number.
//
// ⛔ Тексты ошибок — по-английски: их читает посетитель.

import type { EventContext } from '@cloudflare/workers-types';
import { classifyMixture } from '../../src/lib/classifier/engine.ts';
import {
  applyProfiles, corsHeaders, fail, invalidSupplierPairs, json, loadProfiles,
  loadReference, parseBody, rateLimit, tooMany, verifyTurnstile, clientIp,
  type Env,
} from './classify/_shared.ts';

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('classifier: PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in Pages Variables');
    return fail(503, 'NOT_CONFIGURED', 'The classifier is not available right now. Try again later.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'BAD_JSON', 'The request body is not valid JSON.');
  }

  const { error, parsed } = parseBody(body);
  if (error || !parsed) return fail(400, 'BAD_INPUT', error ?? 'The request could not be read.');

  // Turnstile до лимита: неудачная капча не должна съедать чужую квоту по IP.
  const token = (body as Record<string, unknown>).turnstileToken;
  const ok = await verifyTurnstile(env, token, clientIp(request));
  if (!ok) {
    return fail(403, 'TURNSTILE', 'The anti-bot check did not pass. Reload the page and try again.');
  }

  let rate;
  try {
    rate = await rateLimit(env, request, 'classify');
  } catch {
    return fail(503, 'RATE_LIMIT_UNAVAILABLE', 'The classifier is busy. Try again in a minute.');
  }
  if (!rate.allowed) return tooMany(rate);

  try {
    const cacheStore = (caches as unknown as { default?: Cache }).default ?? null;
    const data = await loadReference(env, cacheStore);
    if (!data.generic.length || !data.registry.length) {
      console.error('classifier: reference snapshot came back empty');
      return fail(503, 'NO_REFERENCE', 'The rule tables could not be read. Try again later.');
    }

    const profiles = parsed.annex6Indexes.length ? await loadProfiles(env, parsed.annex6Indexes) : {};
    applyProfiles(parsed.input, profiles);

    const bad = invalidSupplierPairs(parsed.input, data);
    if (bad.length) {
      return fail(400, 'UNKNOWN_CLASSIFICATION',
        'One of the supplier classifications is not a hazard class and category we recognise. Pick them from the list.',
        { pairs: bad.slice(0, 10) });
    }

    const result = classifyMixture(parsed.input, data, { computedAt: new Date().toISOString() });

    return json({
      ok: true,
      tier: 'anon',
      rateLimit: { remaining: rate.remaining, limit: rate.limit, resetAt: rate.resetAt },
      result,
    });
  } catch (err) {
    console.error('classifier: unhandled failure', JSON.stringify({ message: (err as Error)?.message }));
    return fail(500, 'ENGINE_FAILED', 'The classification could not be completed. Nothing was saved — try again.');
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet(): Promise<Response> {
  return fail(405, 'METHOD', 'Send the composition as a POST request.');
}
