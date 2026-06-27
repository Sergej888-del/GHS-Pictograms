import type { EventContext } from '@cloudflare/workers-types'

interface Env {
  BREVO_API_KEY: string
}

// --- Brevo double opt-in (DOI) configuration — created 2026-06-27 ---
// Verified working end-to-end. The DOI template MUST be tagged "optin" in Brevo and contain a
// button whose link is the token {{ doubleoptin }} (one word) — otherwise Brevo's DOI endpoint
// returns "An active DOI template does not exist". templateId is also required.
// The only secret is BREVO_API_KEY, injected via Cloudflare env (same key used by leads.ts).
const NEWSLETTER_LIST_ID = 6 // Brevo list "GHS Compliance Updates" — CONFIRMED subscribers land here
const DOI_TEMPLATE_ID = 3 // Brevo template "DOI Confirmation" (HTML, tagged "optin", Active)
const REDIRECT_URL = 'https://ghspictograms.com/subscribed/' // where Brevo redirects after confirm

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

    // Trigger Brevo's double opt-in flow. Brevo emails the confirmation link; the contact is
    // added to NEWSLETTER_LIST_ID only AFTER they click confirm, then redirected to REDIRECT_URL.
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

    // 201 = DOI email sent. Treat a "contact already exists / already in list" response as a soft
    // success so a returning subscriber gets a friendly result instead of an error.
    if (brevoRes.ok) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    const errText = await brevoRes.text().catch(() => '')
    const alreadyExists =
      brevoRes.status === 400 &&
      /duplicate|already\s+(exists|in)|contact\s+already/i.test(errText)

    if (alreadyExists) {
      return new Response(JSON.stringify({ success: true, alreadySubscribed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // Genuine failure: log full detail (Cloudflare Functions Logs), return a clean error.
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
