import type { EventContext } from '@cloudflare/workers-types'

interface Env {
  BREVO_API_KEY: string
}

// --- Brevo double opt-in (DOI) configuration — created 2026-06-27 ---
// These are NOT secrets. The only secret is BREVO_API_KEY, injected via Cloudflare env
// (same key already used by functions/api/leads.ts).
const NEWSLETTER_LIST_ID = 6 // Brevo list "GHS Compliance Updates" — CONFIRMED subscribers land here
const DOI_TEMPLATE_ID = 1 // Brevo template "DOI Confirmation" (Active) — the confirmation email
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

    // Trigger Brevo's double opt-in flow. Brevo emails the user a confirmation link;
    // the contact is added to NEWSLETTER_LIST_ID ONLY AFTER they click confirm, then
    // Brevo redirects them to REDIRECT_URL. No contact is mailed before that click.
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        email,
        includeListIds: [NEWSLETTER_LIST_ID],
        templateId: DOI_TEMPLATE_ID,
        redirectionUrl: REDIRECT_URL,
      }),
    })

    // Brevo returns 201 on success. Anything else: log full detail (Cloudflare Functions Logs)
    // and surface a non-fatal error. Duplicate/edge-case handling refined after the live test.
    if (!brevoRes.ok) {
      const errText = await brevoRes.text().catch(() => '')
      console.error('Subscribe API error:', JSON.stringify({
        step: 'brevo_doi',
        status: brevoRes.status,
        statusText: brevoRes.statusText,
        body: errText,
      }))
      return new Response(JSON.stringify({ error: 'Subscription could not be processed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  } catch (err) {
    console.error('Subscribe API error:', JSON.stringify(err))
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders })
}
