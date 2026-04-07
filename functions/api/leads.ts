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
    const body = await request.json() as Record<string, unknown>

    const email = typeof body.email === 'string' ? body.email : ''
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    const source = typeof body.source === 'string' ? body.source : ''

    // Старый формат (Label Constructor)
    const company = typeof body.company === 'string' ? body.company : ''
    const role = typeof body.role === 'string' ? body.role : ''
    const cas_number = typeof body.cas_number === 'string' ? body.cas_number : ''
    const substance_name = typeof body.substance_name === 'string' ? body.substance_name : ''
    const label_template = typeof body.label_template === 'string' ? body.label_template : ''
    const volume_range = typeof body.volume_range === 'string' ? body.volume_range : ''

    // Новый формат (SVG download)
    const ghsCode = typeof body.ghsCode === 'string' ? body.ghsCode : ''
    const ghsName = typeof body.ghsName === 'string' ? body.ghsName : ''
    const tool = typeof body.tool === 'string' ? body.tool : ''

    const toolUsed =
      source === 'svg-download'
        ? (tool || 'svg-download')
        : 'ghs-label-constructor'

    const notes =
      source === 'svg-download'
        ? `Source: svg-download | GHS: ${ghsCode} (${ghsName}) | Tool: ${toolUsed}`
        : `Role: ${role} | CAS: ${cas_number} | Substance: ${substance_name} | Template: ${label_template} | Volume: ${volume_range}`

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
        email,
        company_name: company || '',
        source_tool: toolUsed,
        source_domain: 'ghspictograms.com',
        source_page: source === 'svg-download' ? `/ghs/${ghsCode.toLowerCase()}/` : '/label-constructor/',
        substance_name: substance_name || ghsName || '',
        qualification_notes: notes,
      }),
    })

    if (!supabaseRes.ok) {
      const errText = await supabaseRes.text().catch(() => '')
      console.error('Leads API error:', JSON.stringify({
        step: 'supabase_insert',
        status: supabaseRes.status,
        statusText: supabaseRes.statusText,
        body: errText,
      }))
      return new Response(JSON.stringify({ error: 'Supabase insert failed', details: errText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    // Отправляем в Brevo
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        email,
        attributes: {
          COMPANY: company,
          ROLE: role,
          TOOL: toolUsed,
          CAS: cas_number,
          SUBSTANCE: substance_name,
          GHS_CODE: ghsCode,
          GHS_NAME: ghsName,
        },
        listIds: [3],
        updateEnabled: true,
      }),
    })

    if (!brevoRes.ok) {
      const brevoText = await brevoRes.text().catch(() => '')
      console.error('Leads API error:', JSON.stringify({
        step: 'brevo_contact_create',
        status: brevoRes.status,
        statusText: brevoRes.statusText,
        body: brevoText,
      }))
      return new Response(JSON.stringify({ error: 'Brevo request failed', details: brevoText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })

  } catch (err) {
    // Требуется для Cloudflare Functions Logs
    console.error('Leads API error:', JSON.stringify(err))
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: 'Server error', message }), {
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
