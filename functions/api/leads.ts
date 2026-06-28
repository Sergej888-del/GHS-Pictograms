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
        : source === 'pictogram-selector'
          ? 'pictogram-selector'
          : 'ghs-label-constructor'

    const incomingNotes = typeof body.notes === 'string' ? body.notes : ''
    const notes =
      source === 'svg-download'
        ? `Source: svg-download | GHS: ${ghsCode} (${ghsName}) | Tool: ${toolUsed}`
        : source === 'pictogram-selector'
          ? `Source: pictogram-selector | ${incomingNotes}`
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
        source_page:
          source === 'svg-download'
            ? `/ghs/${ghsCode.toLowerCase()}/`
            : source === 'pictogram-selector'
              ? '/pictogram-selector/'
              : '/label-constructor/',
        substance_name: substance_name || ghsName || '',
        qualification_notes: notes,
      }),
    })

    // 409 = duplicate (email, source_tool): лид уже захвачен — это не ошибка, пропускаем дальше
    if (!supabaseRes.ok && supabaseRes.status !== 409) {
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

    // Brevo auto-add REMOVED 2026-06-28 (Phase 3): it added every lead to list 3
    // with updateEnabled:true and NO consent — the exact GDPR Art 7 defect behind the
    // 170 unmailable legacy leads. Marketing consent now lives ONLY in the DOI flow
    // (functions/api/subscribe.ts -> Brevo double opt-in -> list 6). This endpoint no
    // longer touches Brevo; the Supabase insert above is an internal log only and must
    // NOT be used for marketing. No client calls this endpoint anymore (all three tools
    // were un-gated 2026-06-28); it is kept as a harmless 200 for any stale/cached caller.
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })

  } catch (err) {
    // Требуется для Cloudflare Functions Logs
    console.error('Leads API error:', JSON.stringify(err))
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
