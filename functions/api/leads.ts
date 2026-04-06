import type { EventContext } from '@cloudflare/workers-types'

interface Env {
  PUBLIC_SUPABASE_URL: string
  PUBLIC_SUPABASE_ANON_KEY: string
  BREVO_API_KEY: string
}

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>
): Promise<Response> {
  const { request, env } = context

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  try {
    const body = await request.json() as {
      email: string
      company: string
      role: string
      cas_number: string
      substance_name: string
      label_template: string
      volume_range: string
    }

    if (!body.email || !body.email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // Сохраняем в Supabase
    const supabaseRes = await fetch(`${env.PUBLIC_SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.PUBLIC_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.PUBLIC_SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        email: body.email,
        company: body.company,
        tool_used: 'ghs-label-constructor',
        notes: `Role: ${body.role} | CAS: ${body.cas_number} | Substance: ${body.substance_name} | Template: ${body.label_template} | Volume: ${body.volume_range}`,
        created_at: new Date().toISOString(),
      }),
    })

    // Отправляем в Brevo
    await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        email: body.email,
        attributes: {
          COMPANY: body.company,
          ROLE: body.role,
          TOOL: 'GHS Label Constructor',
          CAS: body.cas_number,
          SUBSTANCE: body.substance_name,
        },
        listIds: [3],
        updateEnabled: true,
      }),
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
