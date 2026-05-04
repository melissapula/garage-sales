export interface Profile {
    id: string
    display_name: string
}

export interface MessageThread {
    id: string
    participant_one_id: string
    participant_two_id: string
    garage_sale_id: string | null
    last_message_at: string
    last_message_preview: string | null
    created_at: string
}

export interface Message {
    id: string
    thread_id: string
    sender_id: string
    body: string
    read_at: string | null
    created_at: string
}

export interface ThreadWithDetails extends MessageThread {
    other: Profile | null
    sale: { id: string; title: string } | null
    unreadCount: number
}

export async function findOrCreateThread(
    otherUserId: string,
    saleId: string | null,
): Promise<string> {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    if (!user.value) throw new Error('Sign in to send a message.')

    const me = user.value.id
    const orFilter = `and(participant_one_id.eq.${me},participant_two_id.eq.${otherUserId}),and(participant_one_id.eq.${otherUserId},participant_two_id.eq.${me})`

    let query = supabase.from('message_threads').select('id').or(orFilter).limit(1)
    query = saleId ? query.eq('garage_sale_id', saleId) : query.is('garage_sale_id', null)

    const { data: existing } = await query.maybeSingle()
    if (existing) return existing.id

    const { data, error } = await supabase
        .from('message_threads')
        .insert({
            participant_one_id: me,
            participant_two_id: otherUserId,
            garage_sale_id: saleId,
        })
        .select('id')
        .single()
    if (error) throw error
    return data.id
}

export async function sendMessage(threadId: string, body: string): Promise<Message> {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    if (!user.value) throw new Error('Sign in first.')
    const trimmed = body.trim()
    if (!trimmed) throw new Error('Type a message first.')
    const { data, error } = await supabase
        .from('messages')
        .insert({
            thread_id: threadId,
            sender_id: user.value.id,
            body: trimmed,
        })
        .select()
        .single()
    if (error) throw error

    // Fire-and-forget: kick off the email notification without blocking the UX.
    // Failures here are silent — the message is already saved.
    $fetch('/api/notifications/message', {
        method: 'POST',
        body: { messageId: data.id },
    }).catch(() => {})

    return data as Message
}

export async function markThreadRead(threadId: string): Promise<void> {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    if (!user.value) return
    await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .neq('sender_id', user.value.id)
        .is('read_at', null)
}

export async function fetchInbox(): Promise<ThreadWithDetails[]> {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    if (!user.value) return []

    const { data: threads, error } = await supabase
        .from('message_threads')
        .select('*, sale:garage_sales(id, title)')
        .order('last_message_at', { ascending: false })
    if (error) throw error
    if (!threads || threads.length === 0) return []

    // Pull the OTHER participant's profile for each thread in one query.
    const otherIds = new Set<string>()
    for (const t of threads) {
        otherIds.add(t.participant_one_id === user.value.id ? t.participant_two_id : t.participant_one_id)
    }
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', Array.from(otherIds))
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p as Profile]))

    // One grouped round-trip for unread counts across all my threads, in
    // place of an N+1 fan-out (one count query per thread). The
    // `unread_counts_by_thread` RPC is RLS-aware and only returns rows for
    // threads the caller participates in.
    const { data: unreadRows } = await supabase.rpc('unread_counts_by_thread')
    const unreadMap = new Map<string, number>(
        (unreadRows ?? []).map(
            (r: { thread_id: string; unread_count: number | string }) =>
                [r.thread_id, Number(r.unread_count)] as const,
        ),
    )

    const me = user.value.id
    return threads.map((t) => {
        const otherId = t.participant_one_id === me ? t.participant_two_id : t.participant_one_id
        return {
            ...(t as MessageThread),
            sale: (t as unknown as { sale: { id: string; title: string } | null }).sale,
            other: profileMap.get(otherId) ?? null,
            unreadCount: unreadMap.get(t.id) ?? 0,
        } as ThreadWithDetails
    })
}

export async function fetchThreadWithMessages(id: string) {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    if (!user.value) return null

    const { data: thread, error: err1 } = await supabase
        .from('message_threads')
        .select('*, sale:garage_sales(id, title, address)')
        .eq('id', id)
        .maybeSingle()
    if (err1) throw err1
    if (!thread) return null

    const otherId =
        thread.participant_one_id === user.value.id
            ? thread.participant_two_id
            : thread.participant_one_id
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('id', otherId)
        .maybeSingle()

    const { data: messages, error: err2 } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', id)
        .order('created_at')
    if (err2) throw err2

    return {
        thread: thread as MessageThread & { sale: { id: string; title: string; address: string } | null },
        other: (profile ?? null) as Profile | null,
        messages: (messages ?? []) as Message[],
    }
}

/** Reactive global unread count, used to drive the navbar badge. */
export function useUnreadCount() {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    const count = useState<number>('inbox-unread', () => 0)

    async function refresh() {
        if (!user.value) {
            count.value = 0
            return
        }
        const { count: c, error } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .neq('sender_id', user.value.id)
            .is('read_at', null)
        if (!error && c !== null) count.value = c
    }

    return { count, refresh }
}
