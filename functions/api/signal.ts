// functions/api/signal.ts — единый вход для трёх сигналов от инструментов (№120, session 88):
//   save     → record_feature_interest   («Save this result», №142)
//   feedback → record_tool_feedback      (форма пожеланий, C)
//   miss     → record_search_miss        («искал и не нашёл», E)
//
// ЗАЧЕМ ФУНКЦИЯ, А НЕ ПРЯМОЙ RPC ИЗ БРАУЗЕРА. Postgres не умеет проверить токен
// Turnstile; проверка живёт здесь (verifyTurnstile, siteverify), и только после
// неё RPC вызывается service-ключом. У anon/authenticated EXECUTE на этих трёх
// RPC ОТОЗВАН (scripts/sql/90-*.sql) — иначе бот обошёл бы функцию.
//
// Слои защиты по порядку: Turnstile → лимит по IP (30/ч, бакет `signal`, та же
// таблица, что у классификатора) → лимиты на visitor_id внутри RPC (5/3/30 в сутки).
//
// ⚠ Без TURNSTILE_SECRET проверка выключена ОСОЗНАННО (первый деплой до ключа) —
// verifyTurnstile пишет warning в лог. Лимит по IP работает всегда.
// ⛔ Тексты для человека — по-английски. Ошибки PostgREST — только в лог.

import type { EventContext } from '@cloudflare/workers-types';
import {
  type Env, clientIp, fail, json, rateLimit, rpc, tooMany, verifyTurnstile,
} from './classify/_shared';

type Kind = 'save' | 'feedback' | 'miss';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL_RE = /^[a-z0-9-]{1,40}$/;
const WANT_RE = /^[a-z0-9_]{1,40}$/;

interface Body {
  kind: Kind;
  turnstileToken?: unknown;
  visitor: string;
  tool: string;
  page: string | null;
  wants: string[];
  comment: string | null;
  email: string | null;
  query: string | null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function parse(raw: unknown): { error?: string; body?: Body } {
  if (!raw || typeof raw !== 'object') return { error: 'The request body is not an object.' };
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'save' && kind !== 'feedback' && kind !== 'miss') return { error: 'Unknown signal kind.' };
  const visitor = str(r.visitor, 36);
  if (!visitor || !UUID_RE.test(visitor)) return { error: 'The visitor id is not a UUID.' };
  const tool = str(r.tool, 40);
  if (!tool || !TOOL_RE.test(tool)) return { error: 'The tool key is not valid.' };
  const wantsRaw = Array.isArray(r.wants) ? r.wants : [];
  if (wantsRaw.length > 10) return { error: 'Too many items.' };
  const wants: string[] = [];
  for (const w of wantsRaw) {
    if (typeof w !== 'string' || !WANT_RE.test(w)) return { error: 'An item key is not valid.' };
    wants.push(w);
  }
  return {
    body: {
      kind,
      turnstileToken: r.turnstileToken,
      visitor,
      tool,
      page: str(r.page, 200),
      wants,
      comment: str(r.comment, 500),
      email: str(r.email, 254),
      query: str(r.query, 120),
    },
  };
}

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, 'BAD_JSON', 'The request body is not valid JSON.');
  }
  const { error, body } = parse(raw);
  if (error || !body) return fail(400, 'BAD_INPUT', error ?? 'The request could not be read.');

  // Turnstile до лимита: неудачная проверка не должна съедать чужую квоту по IP.
  const human = await verifyTurnstile(env, body.turnstileToken, clientIp(request));
  if (!human) return fail(403, 'TURNSTILE', 'The anti-bot check did not pass. Reload the page and try again.');

  let rate;
  try {
    rate = await rateLimit(env, request, 'signal');
  } catch {
    return fail(503, 'RATE_LIMIT_UNAVAILABLE', 'Please try again in a minute.');
  }
  if (!rate.allowed) return tooMany(rate);

  try {
    let result: unknown;
    if (body.kind === 'save') {
      result = await rpc(env, 'record_feature_interest', {
        p_feature: 'save_result', p_tool: body.tool, p_page: body.page, p_visitor: body.visitor, p_email: null,
      });
    } else if (body.kind === 'feedback') {
      result = await rpc(env, 'record_tool_feedback', {
        p_tool: body.tool, p_page: body.page, p_visitor: body.visitor,
        p_wants: body.wants, p_comment: body.comment, p_email: body.email,
      });
    } else {
      if (!body.query || body.query.length < 2) return fail(400, 'BAD_INPUT', 'The search text is too short.');
      result = await rpc(env, 'record_search_miss', {
        p_tool: body.tool, p_query: body.query, p_visitor: body.visitor, p_page: body.page,
      });
    }
    return json({ ok: true, result });
  } catch {
    return fail(502, 'DB', 'The signal could not be stored. Nothing else is affected.');
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://ghspictograms.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
