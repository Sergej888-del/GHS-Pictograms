/**
 * scripts/emergency-preview.ts - local preview of /directory/emergency-numbers/ with the draft rows.
 *
 * Run:  npm run preview:emergency
 *
 * What it does:
 *   1. reads BOTH tables (emergency_countries, emergency_services) with the service key from .env.local, drafts included;
 *   2. writes them to .emergency-preview.json (git-ignored, stays on this computer);
 *   3. starts the Astro dev server with EMERGENCY_PREVIEW_FILE pointing at that file.
 *
 * Why a script and not the site code: the service key bypasses row-level security. It lives here, outside the site, like in
 * scripts/check-dist.ts. src/lib/emergencyData.ts reads only the JSON file and refuses it on a deploy build.
 *
 * `--export-only` writes the file and stops (for a full local build: set EMERGENCY_PREVIEW_FILE yourself).
 * The page shows a PREVIEW banner and is noindex. Nothing here changes the database.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local') })

if (process.env.CF_PAGES || process.env.CI) {
  console.error('Отказ: это локальный просмотр черновиков, на сборке для публикации он не запускается.')
  process.exit(1)
}

const url = process.env.PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в файле .env.local (в папке ghspictograms).')
  process.exit(1)
}

const FILE = resolve(process.cwd(), '.emergency-preview.json')
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

async function read(table: string, order: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await db.from(table).select('*').order(order).range(0, 999)
  if (error) throw new Error(`${table}: ${error.message}`)
  return data ?? []
}

const countries = await read('emergency_countries', 'country_code')
const services = await read('emergency_services', 'id')
writeFileSync(FILE, JSON.stringify({ exportedAt: new Date().toISOString(), countries, services }, null, 1), 'utf8')

const live = services.filter((s) => s.state === 'live').length
const unconfirmed = services.filter((s) => s.verification === 'unconfirmed').length
console.log(`Выгружено: стран ${countries.length}, служб ${services.length} (live ${live}, не подтверждены ${unconfirmed} — на странице не печатаются).`)
console.log(`Файл: ${FILE}`)

if (process.argv.includes('--export-only')) process.exit(0)

console.log('Запускаю сервер просмотра. Откройте в браузере: http://localhost:4321/directory/emergency-numbers/')
console.log('Остановить: Ctrl+C.')

// The child never gets the service key: it only needs the file path.
const env: NodeJS.ProcessEnv = { ...process.env, EMERGENCY_PREVIEW_FILE: FILE }
delete env.SUPABASE_SERVICE_ROLE_KEY
const child = spawn(process.execPath, ['--use-system-ca', './node_modules/astro/bin/astro.mjs', 'dev'], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
