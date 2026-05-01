// Seed garage sales into Supabase.
//
// Reads scripts/seed-data.json (an array of sale objects), geocodes each
// address via Mapbox, and inserts the rows using the service role key
// (bypasses RLS).
//
// Usage:
//   1. Copy scripts/seed-data.example.json → scripts/seed-data.json
//   2. Fill in the sales you want to add
//   3. node scripts/seed-sales.mjs

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN

if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
}
if (!MAPBOX_TOKEN) {
    console.error('Missing MAPBOX_TOKEN in .env')
    process.exit(1)
}

const dataPath = resolve(__dirname, 'seed-data.json')
let sales
try {
    sales = JSON.parse(await readFile(dataPath, 'utf8'))
} catch (e) {
    console.error(`Could not read ${dataPath}. Copy seed-data.example.json → seed-data.json and fill it in.`)
    console.error(e.message)
    process.exit(1)
}

if (!Array.isArray(sales) || sales.length === 0) {
    console.error('seed-data.json must be a non-empty array of sales.')
    process.exit(1)
}

async function geocode(address) {
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward')
    url.searchParams.set('q', address)
    url.searchParams.set('proximity', '-94.8826,47.4716') // Bemidji
    url.searchParams.set('country', 'us')
    url.searchParams.set('limit', '1')
    url.searchParams.set('access_token', MAPBOX_TOKEN)

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`)
    const json = await res.json()
    const f = json.features?.[0]
    if (!f) return null
    const [lng, lat] = f.geometry.coordinates
    return {
        address: f.properties?.full_address ?? f.properties?.name ?? address,
        lat,
        lng,
    }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
})

const inserted = []
const failed = []

for (const sale of sales) {
    const required = ['user_id', 'title', 'address', 'start_date', 'end_date']
    const missing = required.filter((k) => !sale[k])
    if (missing.length) {
        failed.push({ sale, reason: `Missing fields: ${missing.join(', ')}` })
        continue
    }

    let resolved
    try {
        resolved = await geocode(sale.address)
    } catch (e) {
        failed.push({ sale, reason: `Geocoding error: ${e.message}` })
        continue
    }
    if (!resolved) {
        failed.push({ sale, reason: 'Address not found' })
        continue
    }

    const row = {
        user_id: sale.user_id,
        title: sale.title,
        description: sale.description ?? null,
        address: resolved.address,
        lat: resolved.lat,
        lng: resolved.lng,
        start_date: sale.start_date,
        end_date: sale.end_date,
        start_time: sale.start_time ?? null,
        end_time: sale.end_time ?? null,
    }

    const { data, error } = await supabase
        .from('garage_sales')
        .insert(row)
        .select('id, title')
        .single()

    if (error) {
        failed.push({ sale, reason: `Insert error: ${error.message}` })
        continue
    }
    inserted.push({ id: data.id, title: data.title, address: resolved.address })
    console.log(`  ✓ ${data.title} — ${resolved.address}`)
}

console.log(`\nInserted ${inserted.length} sale(s).`)
if (failed.length) {
    console.log(`\nFailed ${failed.length}:`)
    for (const f of failed) {
        console.log(`  ✗ ${f.sale.title || '(no title)'} — ${f.reason}`)
    }
    process.exit(1)
}
