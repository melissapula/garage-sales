// Seed garage sales into Supabase.
//
// Reads scripts/seed-data.json (an array of sale objects), geocodes each
// address via Mapbox, and inserts into garage_sales + sale_dates using
// the service role key (bypasses RLS).
//
// Two accepted entry shapes:
//
//  Legacy (still works) — single time window across a contiguous range:
//    {
//      "user_id": "...",
//      "title": "...",
//      "address": "...",
//      "start_date": "2026-05-07",
//      "end_date": "2026-05-09",
//      "start_time": "08:00",  // optional
//      "end_time": "17:00"     // optional
//    }
//  Each day in [start_date, end_date] becomes one sale_dates row with
//  the same start/end times.
//
//  Per-day — explicit list of days, each with its own optional times:
//    {
//      "user_id": "...",
//      "title": "...",
//      "address": "...",
//      "dates": [
//        { "date": "2026-05-07", "start_time": "08:00", "end_time": "17:30" },
//        { "date": "2026-05-08", "start_time": "08:00", "end_time": "17:30" },
//        { "date": "2026-05-09", "start_time": "08:00", "end_time": "14:00" }
//      ]
//    }
//
// Usage:
//   1. Copy scripts/seed-data.example.json → scripts/seed-data.json
//   2. Fill in the sales you want to add
//   3. node scripts/seed-sales.mjs

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}
if (!MAPBOX_TOKEN) {
    console.error('Missing MAPBOX_TOKEN in .env');
    process.exit(1);
}

const dataPath = resolve(__dirname, 'seed-data.json');
let sales;
try {
    sales = JSON.parse(await readFile(dataPath, 'utf8'));
} catch (e) {
    console.error(
        `Could not read ${dataPath}. Copy seed-data.example.json → seed-data.json and fill it in.`,
    );
    console.error(e.message);
    process.exit(1);
}

if (!Array.isArray(sales) || sales.length === 0) {
    console.error('seed-data.json must be a non-empty array of sales.');
    process.exit(1);
}

async function geocode(address) {
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', address);
    url.searchParams.set('proximity', '-94.8826,47.4716'); // Bemidji
    url.searchParams.set('country', 'us');
    url.searchParams.set('limit', '1');
    url.searchParams.set('access_token', MAPBOX_TOKEN);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
    const json = await res.json();
    const f = json.features?.[0];
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    return {
        address: f.properties?.full_address ?? f.properties?.name ?? address,
        lat,
        lng,
    };
}

/** Expand a legacy entry's [start_date, end_date] into per-day rows. */
function expandRange(startDate, endDate, startTime, endTime) {
    const out = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        out.push({
            date: `${y}-${m}-${day}`,
            start_time: startTime ?? null,
            end_time: endTime ?? null,
        });
    }
    return out;
}

/**
 * Normalize either entry shape into a `dates` array. Returns null if
 * the entry lacks both shapes (caller treats that as a validation fail).
 */
function normalizeDates(sale) {
    if (Array.isArray(sale.dates) && sale.dates.length) {
        return sale.dates.map((d) => ({
            date: d.date,
            start_time: d.start_time ?? null,
            end_time: d.end_time ?? null,
        }));
    }
    if (sale.start_date && sale.end_date) {
        return expandRange(sale.start_date, sale.end_date, sale.start_time, sale.end_time);
    }
    return null;
}

/** Compute the envelope (min/max date, min start, max end) over a list of days. */
function envelope(dates) {
    const sortedDates = [...dates].map((d) => d.date).sort();
    const starts = dates
        .map((d) => d.start_time)
        .filter(Boolean)
        .sort();
    const ends = dates
        .map((d) => d.end_time)
        .filter(Boolean)
        .sort();
    return {
        start_date: sortedDates[0],
        end_date: sortedDates[sortedDates.length - 1],
        start_time: starts.length ? starts[0] : null,
        end_time: ends.length ? ends[ends.length - 1] : null,
    };
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const inserted = [];
const failed = [];

for (const sale of sales) {
    const required = ['user_id', 'title', 'address'];
    const missing = required.filter((k) => !sale[k]);
    if (missing.length) {
        failed.push({ sale, reason: `Missing fields: ${missing.join(', ')}` });
        continue;
    }

    const dates = normalizeDates(sale);
    if (!dates || dates.length === 0) {
        failed.push({
            sale,
            reason: 'Need either `dates: [...]` or `start_date` + `end_date`.',
        });
        continue;
    }

    let resolved;
    try {
        resolved = await geocode(sale.address);
    } catch (e) {
        failed.push({ sale, reason: `Geocoding error: ${e.message}` });
        continue;
    }
    if (!resolved) {
        failed.push({ sale, reason: 'Address not found' });
        continue;
    }

    const env = envelope(dates);

    const row = {
        user_id: sale.user_id,
        title: sale.title,
        description: sale.description ?? null,
        address: resolved.address,
        lat: resolved.lat,
        lng: resolved.lng,
        start_date: env.start_date,
        end_date: env.end_date,
        start_time: env.start_time,
        end_time: env.end_time,
    };

    const { data, error } = await supabase
        .from('garage_sales')
        .insert(row)
        .select('id, title')
        .single();

    if (error) {
        failed.push({ sale, reason: `Insert error: ${error.message}` });
        continue;
    }

    // Insert per-day rows. The envelope trigger fires per row and
    // recomputes garage_sales.start_date/end_date/start_time/end_time —
    // a no-op since we already passed matching values above.
    const { error: dErr } = await supabase.from('sale_dates').insert(
        dates.map((d) => ({
            sale_id: data.id,
            sale_date: d.date,
            start_time: d.start_time,
            end_time: d.end_time,
        })),
    );
    if (dErr) {
        // Roll back the parent so we don't leave an orphaned envelope-only
        // row that breaks the per-day display logic in the UI.
        await supabase.from('garage_sales').delete().eq('id', data.id);
        failed.push({ sale, reason: `sale_dates insert: ${dErr.message}` });
        continue;
    }

    inserted.push({
        id: data.id,
        title: data.title,
        address: resolved.address,
        days: dates.length,
    });
    console.log(
        `  ✓ ${data.title} — ${resolved.address} (${dates.length} day${dates.length === 1 ? '' : 's'})`,
    );
}

console.log(`\nInserted ${inserted.length} sale(s).`);
if (failed.length) {
    console.log(`\nFailed ${failed.length}:`);
    for (const f of failed) {
        console.log(`  ✗ ${f.sale.title || '(no title)'} — ${f.reason}`);
    }
    process.exit(1);
}
