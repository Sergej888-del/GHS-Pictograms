/**
 * Генерирует public/_redirects: для всех веществ с пиктограммами КРОМЕ TOP 200 — 301 на GHSSymbols.
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })
dotenv.config()

const url = process.env.PUBLIC_SUPABASE_URL
const key = process.env.PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Нужны PUBLIC_SUPABASE_URL и PUBLIC_SUPABASE_ANON_KEY (.env или .env.local)')
  process.exit(1)
}

const supabase = createClient(url, key)

/** Как prioritizePictogramSubstances в src/lib/pictogramCasPaths.ts */
function prioritizePictogramSubstances(s) {
  return [...s].sort((a, b) => {
    const aHas = a.common_name ? 1 : 0
    const bHas = b.common_name ? 1 : 0
    if (aHas !== bHas) return bHas - aHas
    const aLen = (a.common_name || a.iupac_name || '').length
    const bLen = (b.common_name || b.iupac_name || '').length
    return aLen - bLen
  })
}

async function main() {
  const allSubstances = []
  let from = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('substances')
      .select('cas_number, common_name, iupac_name, ghs_pictogram_codes')
      .not('ghs_pictogram_codes', 'is', null)
      .range(from, from + batchSize - 1)

    if (error) throw error
    if (!data?.length) break

    for (const row of data) {
      const codes = row.ghs_pictogram_codes
      if ((codes?.length ?? 0) > 0 && row.cas_number?.trim()) {
        allSubstances.push({
          cas_number: row.cas_number.trim(),
          common_name: row.common_name,
          iupac_name: row.iupac_name ?? '',
          ghs_pictogram_codes: codes,
        })
      }
    }
    if (data.length < batchSize) break
    from += batchSize
  }

  const top200Rows = prioritizePictogramSubstances(allSubstances).slice(0, 200)
  const topCAS = new Set(top200Rows.map((s) => s.cas_number))

  const redirects = []
  for (const s of allSubstances) {
    if (topCAS.has(s.cas_number)) continue
    const slug = encodeURIComponent(s.cas_number)
    redirects.push(`/pictograms/${slug}/  https://ghssymbols.com/hazards/${slug}/  301`)
  }

  const redirectsPath = path.join(process.cwd(), 'public', '_redirects')
  let existingContent = ''
  if (fs.existsSync(redirectsPath)) {
    existingContent = fs.readFileSync(redirectsPath, 'utf-8')
    existingContent = existingContent
      .split('\n')
      .filter((line) => !line.includes('/pictograms/'))
      .join('\n')
  }

  const newContent =
    (existingContent.trim() +
      '\n\n' +
      '# Auto-generated /pictograms/[cas]/ redirects (non–TOP-200)\n' +
      redirects.join('\n'))
      .trim() + '\n'

  fs.writeFileSync(redirectsPath, newContent)
  console.log(`Generated ${redirects.length} redirects in ${redirectsPath}`)
  console.log(`TOP ${topCAS.size} substances skipped (prerendered)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
