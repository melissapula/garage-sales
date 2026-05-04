import { serverSupabaseServiceRole } from '#supabase/server'

/**
 * Dynamic sitemap. Returns the static crawlable pages plus every
 * indexable user-generated page — active non-tombstoned sales
 * (`/sale/[id]`) and public shared routes (`/share/[id]`).
 *
 * Uses the service role to bypass RLS for predictable enumeration,
 * but only emits public-readable URLs anyway.
 */

interface SaleRow {
    id: string
    end_date: string
    created_at: string
}
interface RouteRow {
    id: string
    created_at: string
}

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    const siteUrl = (config.public.siteUrl as string).replace(/\/$/, '')
    const admin = await serverSupabaseServiceRole(event)

    // Today in user's "local-ish" timezone — the server runs in UTC,
    // but matching `fetchActiveSales`'s end_date semantics is good
    // enough here. Worst case a sale that ends today drops off the
    // sitemap a few hours late.
    const today = new Date().toISOString().slice(0, 10)

    const { data: sales } = await admin
        .from('garage_sales')
        .select('id, end_date, created_at')
        .is('deleted_at', null)
        .gte('end_date', today)
        .order('created_at', { ascending: false })
        .limit(50000)
    const { data: routes } = await admin
        .from('routes')
        .select('id, created_at')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(50000)

    const staticUrls = [
        { loc: `${siteUrl}/`, changefreq: 'hourly', priority: '1.0' },
        { loc: `${siteUrl}/browse`, changefreq: 'hourly', priority: '0.9' },
        { loc: `${siteUrl}/privacy`, changefreq: 'monthly', priority: '0.3' },
        { loc: `${siteUrl}/terms`, changefreq: 'monthly', priority: '0.3' },
    ]

    const saleUrls = (sales as SaleRow[] | null ?? []).map((s) => ({
        loc: `${siteUrl}/sale/${s.id}`,
        lastmod: s.created_at.slice(0, 10),
        changefreq: 'daily',
        priority: '0.8',
    }))
    const shareUrls = (routes as RouteRow[] | null ?? []).map((r) => ({
        loc: `${siteUrl}/share/${r.id}`,
        lastmod: r.created_at.slice(0, 10),
        changefreq: 'weekly',
        priority: '0.5',
    }))

    const all = [...staticUrls, ...saleUrls, ...shareUrls]

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
    .map(
        (u) => `    <url>
        <loc>${escapeXml(u.loc)}</loc>${
            'lastmod' in u && u.lastmod
                ? `\n        <lastmod>${u.lastmod}</lastmod>`
                : ''
        }
        <changefreq>${u.changefreq}</changefreq>
        <priority>${u.priority}</priority>
    </url>`,
    )
    .join('\n')}
</urlset>
`

    setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
    // Cache for an hour at the edge — sitemap doesn't need to be
    // realtime, and Google doesn't crawl this URL often anyway.
    setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=3600')
    return xml
})
