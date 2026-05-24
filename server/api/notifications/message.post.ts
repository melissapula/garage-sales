import { serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server';
import { Resend } from 'resend';

interface ThreadRow {
    id: string;
    participant_one_id: string;
    participant_two_id: string;
    sale: { id: string; title: string } | null;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sends a "new message" email to the recipient of a freshly-inserted message.
 * Skips the send if the recipient has been active in the thread within the
 * last 15 minutes (probably already sees it in-app).
 */
export default defineEventHandler(async (event) => {
    const user = await serverSupabaseUser(event);
    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    const { messageId } = await readBody<{ messageId?: string }>(event);
    if (!messageId) {
        throw createError({ statusCode: 400, statusMessage: 'messageId required' });
    }

    const config = useRuntimeConfig(event);
    if (!config.resendApiKey) {
        // Email isn't configured in this environment — silently no-op so the
        // client doesn't see errors during local dev.
        return { skipped: 'no resend api key' };
    }

    const admin = await serverSupabaseServiceRole(event);

    // 1. Fetch the message and verify the caller is the sender.
    const { data: msg, error: msgErr } = await admin
        .from('messages')
        .select('id, sender_id, thread_id, body, created_at')
        .eq('id', messageId)
        .maybeSingle();
    if (msgErr) throw createError({ statusCode: 500, statusMessage: msgErr.message });
    if (!msg) throw createError({ statusCode: 404, statusMessage: 'Message not found' });
    if (msg.sender_id !== user.id) {
        throw createError({ statusCode: 403, statusMessage: 'Not your message' });
    }

    // 2. Fetch the thread + sale info.
    const { data: thread } = await admin
        .from('message_threads')
        .select('id, participant_one_id, participant_two_id, sale:garage_sales(id, title)')
        .eq('id', msg.thread_id)
        .maybeSingle();
    if (!thread) throw createError({ statusCode: 404, statusMessage: 'Thread not found' });

    const t = thread as unknown as ThreadRow;
    const recipientId =
        t.participant_one_id === msg.sender_id ? t.participant_two_id : t.participant_one_id;

    // 3. Anti-spam: skip if recipient has been active in this thread recently.
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: recentSentCount } = await admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', msg.thread_id)
        .eq('sender_id', recipientId)
        .gte('created_at', fifteenMinAgo);
    const { count: recentReadCount } = await admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', msg.thread_id)
        .neq('sender_id', recipientId)
        .gte('read_at', fifteenMinAgo);
    if ((recentSentCount ?? 0) > 0 || (recentReadCount ?? 0) > 0) {
        return { skipped: 'recipient recently active' };
    }

    // 4. Atomic idempotency claim. INSERT … ON CONFLICT DO NOTHING is
    // the cheapest "first writer wins" primitive here. If the row was
    // already there (someone replayed the request, the sender's client
    // double-fired, etc.) the insert returns no rows and we skip the
    // email — preventing replay-driven Resend bill amplification.
    const { data: claimed, error: claimErr } = await admin
        .from('message_notifications')
        .insert({ message_id: messageId })
        .select('message_id');
    if (claimErr) {
        // Postgres `unique_violation` (23505) is our signal the row was
        // already claimed by an earlier request — skip silently.
        if (claimErr.code === '23505') {
            return { skipped: 'already notified' };
        }
        throw createError({ statusCode: 500, statusMessage: claimErr.message });
    }
    if (!claimed || claimed.length === 0) {
        return { skipped: 'already notified' };
    }

    // 5. Look up profiles + recipient email.
    const { data: profiles } = await admin
        .from('profiles')
        .select('id, display_name')
        .in('id', [recipientId, msg.sender_id]);
    const senderProfile = profiles?.find((p) => p.id === msg.sender_id);
    const recipientProfile = profiles?.find((p) => p.id === recipientId);

    const { data: recipientAuth } = await admin.auth.admin.getUserById(recipientId);
    const recipientEmail = recipientAuth?.user?.email;
    if (!recipientEmail) return { skipped: 'no recipient email' };

    // 6. Build + send the email.
    const senderName = senderProfile?.display_name || 'Someone';
    const saleTitle = t.sale?.title;
    const subject = saleTitle
        ? `${senderName} sent you a message about "${saleTitle}"`
        : `${senderName} sent you a message on Garage Sale Tracker`;

    const siteUrl = config.public.siteUrl as string;
    const threadLink = `${siteUrl}/inbox/${t.id}`;
    const greetingName = recipientProfile?.display_name ? ' ' + recipientProfile.display_name : '';

    const html = `
<div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
    <p>Hi${escapeHtml(greetingName)},</p>
    <p><strong>${escapeHtml(senderName)}</strong> sent you a message${saleTitle ? ` about <em>${escapeHtml(saleTitle)}</em>` : ''}:</p>
    <blockquote style="border-left:3px solid #F97316;padding-left:14px;margin:16px 0;color:#374151;font-style:italic;white-space:pre-line;">
        ${escapeHtml(msg.body)}
    </blockquote>
    <p style="margin:24px 0;">
        <a href="${threadLink}" style="display:inline-block;background:#F97316;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">
            Reply on Garage Sale Tracker
        </a>
    </p>
    <p style="color:#6B7280;font-size:12px;margin-top:32px;">
        You're getting this because someone messaged you on
        <a href="${siteUrl}" style="color:#0369A1;">Garage Sale Tracker</a>.
    </p>
</div>`.trim();

    const text = `${senderName} sent you a message${saleTitle ? ` about "${saleTitle}"` : ''}:

${msg.body}

Reply: ${threadLink}`;

    const resend = new Resend(config.resendApiKey as string);
    try {
        await resend.emails.send({
            from: config.emailFrom as string,
            to: recipientEmail,
            subject,
            html,
            text,
        });
        return { sent: true };
    } catch (e) {
        console.error('[notifications/message] Resend error:', e);
        throw createError({
            statusCode: 502,
            statusMessage: e instanceof Error ? e.message : 'Email send failed',
        });
    }
});
