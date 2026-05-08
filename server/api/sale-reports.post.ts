import { serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import { Resend } from 'resend'

/**
 * User-submitted report on a garage sale (false info, spam, inappropriate,
 * etc.). Sends an email to the configured admin inbox; doesn't auto-hide
 * the sale. Phase 1 has no `sale_reports` table — we just email and let
 * the admin decide. If volume picks up, we add persistence + a queue.
 *
 * Auth required so reports are tied to an accountable user.
 */

const ALLOWED_REASONS = new Set([
    'false_info',
    'spam',
    'inappropriate',
    'duplicate',
    'other',
])

const REASON_LABELS: Record<string, string> = {
    false_info: 'False or misleading info',
    spam: 'Spam',
    inappropriate: 'Inappropriate content',
    duplicate: 'Duplicate of another sale',
    other: 'Other',
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export default defineEventHandler(async (event) => {
    const user = await serverSupabaseUser(event)
    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody<{
        saleId?: string
        reason?: string
        notes?: string
    }>(event)

    const saleId = body.saleId?.trim()
    const reason = body.reason?.trim()
    const notes = (body.notes ?? '').trim().slice(0, 2000)

    if (!saleId) {
        throw createError({ statusCode: 400, statusMessage: 'saleId required' })
    }
    if (!reason || !ALLOWED_REASONS.has(reason)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid reason' })
    }

    const config = useRuntimeConfig(event)
    if (!config.resendApiKey) {
        // Email not configured (local dev) — accept the request silently
        // so the UI can show a success toast, but log so we know.
        console.warn('[sale-reports] Resend not configured; report dropped:', { saleId, reason })
        return { skipped: 'no resend api key' }
    }

    const adminEmail = (config.adminEmail as string) || ''
    if (!adminEmail) {
        console.warn('[sale-reports] adminEmail not configured; report dropped')
        return { skipped: 'no admin email' }
    }

    const admin = await serverSupabaseServiceRole(event)

    // Pull the sale (must exist + not be a tombstone) and its owner so
    // the admin email has full context without a click-through.
    const { data: sale, error: saleErr } = await admin
        .from('garage_sales')
        .select('id, title, address, user_id, deleted_at')
        .eq('id', saleId)
        .maybeSingle()
    if (saleErr) throw createError({ statusCode: 500, statusMessage: saleErr.message })
    if (!sale) throw createError({ statusCode: 404, statusMessage: 'Sale not found' })
    if (sale.deleted_at) {
        // Already removed by the owner — nothing to act on.
        return { skipped: 'sale already deleted' }
    }

    // Reporter + owner profiles for the email.
    const { data: profiles } = await admin
        .from('profiles')
        .select('id, display_name')
        .in('id', [user.id, sale.user_id])
    const reporterProfile = profiles?.find((p) => p.id === user.id)
    const ownerProfile = profiles?.find((p) => p.id === sale.user_id)

    const { data: ownerAuth } = await admin.auth.admin.getUserById(sale.user_id)
    const ownerEmail = ownerAuth?.user?.email ?? '(unknown)'

    const reporterName = reporterProfile?.display_name || '(no display name)'
    const ownerName = ownerProfile?.display_name || '(no display name)'
    const reasonLabel = REASON_LABELS[reason] ?? reason

    const siteUrl = config.public.siteUrl as string
    const saleLink = `${siteUrl}/sale/${sale.id}`

    const subject = `Sale report (${reasonLabel}): ${sale.title}`

    const html = `
<div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;">
    <h1 style="font-size:18px;color:#B91C1C;margin:0 0 8px 0;">⚠️ Sale reported</h1>
    <p style="color:#6B7280;font-size:13px;margin:0 0 16px 0;">A signed-in user flagged a listing for review.</p>

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;margin:24px 0 8px 0;">Reason</h2>
    <p style="margin:0;font-weight:600;">${escapeHtml(reasonLabel)}</p>

    ${notes ? `
    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;margin:24px 0 8px 0;">Notes from reporter</h2>
    <blockquote style="border-left:3px solid #F97316;padding-left:14px;margin:0;color:#374151;white-space:pre-line;">
        ${escapeHtml(notes)}
    </blockquote>
    ` : ''}

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;margin:24px 0 8px 0;">Reported sale</h2>
    <p style="margin:0;"><strong>${escapeHtml(sale.title)}</strong></p>
    <p style="margin:4px 0 0 0;color:#374151;">${escapeHtml(sale.address)}</p>
    <p style="margin:8px 0 0 0;font-size:13px;color:#6B7280;">
        Posted by ${escapeHtml(ownerName)} (${escapeHtml(ownerEmail)})
    </p>
    <p style="margin:16px 0 0 0;">
        <a href="${saleLink}" style="display:inline-block;background:#F97316;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
            Open sale page
        </a>
    </p>

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;margin:24px 0 8px 0;">Reporter</h2>
    <p style="margin:0;">${escapeHtml(reporterName)} (${escapeHtml(user.email ?? '(no email)')})</p>

    <p style="color:#6B7280;font-size:12px;margin-top:32px;">
        Sent automatically by Garage Sale Tracker. If this is spam-volume,
        consider adding a <code>sale_reports</code> table to throttle.
    </p>
</div>`.trim()

    const text = `Sale reported

Reason: ${reasonLabel}
${notes ? `\nNotes from reporter:\n${notes}\n` : ''}
Sale: ${sale.title}
Address: ${sale.address}
Posted by: ${ownerName} (${ownerEmail})
Open: ${saleLink}

Reporter: ${reporterName} (${user.email ?? '(no email)'})`

    const resend = new Resend(config.resendApiKey as string)
    try {
        await resend.emails.send({
            from: config.emailFrom as string,
            to: adminEmail,
            replyTo: user.email ?? undefined,
            subject,
            html,
            text,
        })
        return { sent: true }
    } catch (e) {
        console.error('[sale-reports] Resend error:', e)
        throw createError({
            statusCode: 502,
            statusMessage: e instanceof Error ? e.message : 'Email send failed',
        })
    }
})
