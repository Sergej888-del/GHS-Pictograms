import type { EventContext } from '@cloudflare/workers-types'

interface Env {
  BREVO_API_KEY: string
}

// --- Brevo double opt-in (DOI) configuration — created 2026-06-27 ---
// NOTE: templateId intentionally OMITTED — Brevo falls back to its built-in DOI template.
// (Our custom "DOI Confirmation" template was not being recognised as an active DOI template;
//  custom design can be reintroduced later once the chain is proven to work.)
// The only secret is BREVO_API_KEY, injected via Cloudflare env (same key used by leads.ts).
const NEWSLETTER_LIST_ID = 6 // Brevo list "GHS Compliance Updates" — CONFIRMED subscribers land here
const REDIRECT_URL = 'https://ghspictograms.com/subscribed/' // where Brevo sends the user after they confirm

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>
): Promise<Response> {
  const { request, env } = context

  try {
    const body = (await request.json()) as Record<string, unknown>

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // Trigger Brevo's double opt-in flow. No templateId → Brevo uses its built-in DOI email.
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        email,
        includeListIds: [NEWSLETTER_LIST_ID],
        redirectionUrl: REDIRECT_URL,
      }),
    })

    const brevoBody = await brevoRes.text().catch(() => '')

    // DEBUG: always return 200 + JSON so the browser shows the real Brevo response,
    // instead of Cloudflare swallowing a non-2xx as an HTML 502 page.
    // (Will be tightened to a clean success/error response once the chain works.)
    return new Response(
      JSON.stringify({
        debug: true,
        brevoOk: brevoRes.ok,
        brevoStatus: brevoRes.status,
        brevoStatusText: brevoRes.statusText,
        brevoBody,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ debug: true, error: 'Server exception', detail: String(err) }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    )
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders })
}
