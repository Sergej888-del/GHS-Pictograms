import type { EventContext } from '@cloudflare/workers-types'

interface Env {
  BREVO_API_KEY: string
}

// --- Brevo double opt-in (DOI) configuration — created 2026-06-27 ---
// templateId 3 = "DOI Confirmation" built in Brevo's HTML editor, so href="{{ double_opt_in }}"
// reaches Brevo verbatim (drag-and-drop #1 and simple-editor #2 wrapped the token, so Brevo
// did not recognise them as DOI templates).
// Still in debug mode: returns the raw Brevo response as JSON.
const NEWSLETTER_LIST_ID = 6 // Brevo list "GHS Compliance Updates"
const DOI_TEMPLATE_ID = 3 // Brevo template "DOI Confirmation" (HTML editor, Active)
const REDIRECT_URL = 'https://ghspictograms.com/subscribed/'

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

    const brevoBody = await brevoRes.text().catch(() => '')

    // DEBUG: always 200 + JSON so the browser shows the real Brevo response.
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
