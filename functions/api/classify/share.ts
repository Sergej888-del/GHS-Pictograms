// functions/api/classify/share.ts — короткая ссылка на расчёт
//   POST /api/classify/share      → { shareToken, url }
//   GET  /api/classify/share?s=…  → { payload, releaseKey, resultHash, createdAt }
//
// ⭐⭐ Решение Сергея (s80): короткая ссылка всегда. Длинный адрес с составом
// в параметрах ломается в письмах и мессенджерах, а рецептура из десяти
// компонентов туда просто не влезает.
//
// ⭐⭐⭐ ХРАНИТСЯ ВХОД, А НЕ РЕЗУЛЬТАТ. Отчёт по ссылке пересчитывается по
// ТЕКУЩЕМУ релизу базы, а `resultHash` того, что видел автор, лежит рядом:
// значит открывший ссылку узнаёт не «релиз другой», а «результат тот же» либо
// «результат изменился с тех пор — вот чем». Для аудита это и есть ответ на
// вопрос «а что видел человек в тот день».
//
// ⛔ Тексты — по-английски: их читает посетитель.

import type { EventContext } from '@cloudflare/workers-types';
import { corsHeaders, fail, json, rateLimit, rpc, tooMany, type Env } from './_shared.ts';

const SITE = 'https://ghspictograms.com';
const TOOL_PATH = '/tools/clp-mixture-classifier/';
const TOKEN_RE = /^[A-Za-z0-9_-]{6,16}$/;

function shareUrl(token: string): string {
  return `${SITE}${TOOL_PATH}?s=${token}`;
}

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(503, 'NOT_CONFIGURED', 'Sharing is not available right now.');
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, 'BAD_JSON', 'The request body is not valid JSON.');
  }

  const payload = body.payload;
  if (!payload || typeof payload !== 'object') {
    return fail(400, 'BAD_INPUT', 'Nothing to share — send the composition as payload.');
  }
  const size = JSON.stringify(payload).length;
  if (size > 60_000) {
    return fail(413, 'TOO_LARGE', 'This composition is too large to share as a link.');
  }

  let rate;
  try {
    rate = await rateLimit(env, request, 'share');
  } catch {
    return fail(503, 'RATE_LIMIT_UNAVAILABLE', 'Sharing is busy. Try again in a minute.');
  }
  if (!rate.allowed) return tooMany(rate);

  try {
    const out = await rpc<{ shareToken: string; releaseKey: string }>(env, 'classifier_share_put', {
      p_payload: payload,
      p_release_key: typeof body.releaseKey === 'string' ? body.releaseKey : 'unknown',
      p_result_hash: typeof body.resultHash === 'string' ? body.resultHash : null,
    });
    return json({ ok: true, shareToken: out.shareToken, url: shareUrl(out.shareToken), releaseKey: out.releaseKey });
  } catch (err) {
    console.error('classifier share put failed', JSON.stringify({ message: (err as Error)?.message }));
    return fail(500, 'SHARE_FAILED', 'The link could not be created. Try again.');
  }
}

export async function onRequestGet(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(503, 'NOT_CONFIGURED', 'Sharing is not available right now.');
  }
  const token = new URL(request.url).searchParams.get('s') ?? '';
  if (!TOKEN_RE.test(token)) {
    return fail(400, 'BAD_TOKEN', 'That link does not look like one of ours.');
  }
  try {
    const row = await rpc<null | {
      shareToken: string; payload: unknown; releaseKey: string;
      resultHash: string | null; createdAt: string; hits: number;
    }>(env, 'classifier_share_get', { p_token: token });
    if (!row) {
      return fail(404, 'NOT_FOUND', 'This link has expired or never existed. Ask whoever sent it for a new one.');
    }
    // ⚠ Кэш запрещён: по ссылке считают заново, и релиз базы мог сдвинуться.
    return json({ ok: true, ...row, url: shareUrl(token) });
  } catch (err) {
    console.error('classifier share get failed', JSON.stringify({ message: (err as Error)?.message }));
    return fail(500, 'SHARE_FAILED', 'The link could not be opened. Try again.');
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders() });
}
