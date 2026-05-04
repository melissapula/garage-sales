<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = useSupabaseClient()
const user = useSupabaseUser()

const { data: threads, refresh } = await useAsyncData(
    'inbox-threads',
    () => fetchInbox(),
    { watch: [user] },
)

const unread = useUnreadCount()

let channel: RealtimeChannel | null = null

onMounted(() => {
    unread.refresh()
    channel = supabase
        .channel('inbox-list')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            () => {
                // Refetch the threads list so a brand-new conversation
                // shows up. The navbar unread badge is updated via deltas
                // in the layout channel, so we don't refetch the count.
                refresh()
            },
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'message_threads' },
            () => {
                refresh()
            },
        )
        .subscribe()
})

onBeforeUnmount(() => {
    if (channel) supabase.removeChannel(channel)
    channel = null
})

async function refreshAll() {
    await Promise.all([refresh(), unread.refresh()])
}

function fmtRelative(iso: string): string {
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    const min = Math.floor(diffMs / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day}d ago`
    return d.toLocaleDateString()
}
</script>

<template>
    <section class="mx-auto max-w-3xl px-4 py-8">
        <h1 class="font-display text-3xl font-bold text-gray-900">Inbox</h1>
        <p class="mt-2 text-sm text-gray-600">
            Conversations with other users about garage sales.
        </p>

        <ul v-if="threads && threads.length" class="mt-6 space-y-2">
            <li v-for="t in threads" :key="t.id">
                <NuxtLink
                    :to="`/inbox/${t.id}`"
                    class="block rounded-xl bg-white p-4 ring-1 ring-orange-100 transition hover:shadow-md"
                    :class="t.unreadCount > 0 ? 'ring-2 ring-brand-500' : ''"
                >
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <span class="font-display text-base font-bold text-gray-900">
                                    {{ t.other?.display_name || 'Someone' }}
                                </span>
                                <span
                                    v-if="t.unreadCount > 0"
                                    class="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white"
                                >
                                    {{ t.unreadCount }}
                                </span>
                            </div>
                            <p v-if="t.sale" class="mt-0.5 truncate text-xs text-sky-700">
                                About: {{ t.sale.title }}
                            </p>
                            <p
                                class="mt-1 truncate text-sm"
                                :class="t.unreadCount > 0 ? 'font-medium text-gray-900' : 'text-gray-600'"
                            >
                                {{ t.last_message_preview || 'No messages yet' }}
                            </p>
                        </div>
                        <span class="shrink-0 text-xs text-gray-500">
                            {{ fmtRelative(t.last_message_at) }}
                        </span>
                    </div>
                </NuxtLink>
            </li>
        </ul>

        <p
            v-else-if="threads"
            class="mt-6 rounded-xl bg-white p-6 text-center text-sm text-gray-600 ring-1 ring-orange-100"
        >
            No messages yet. Start a conversation by clicking
            <strong>Message owner</strong> on a sale's detail page.
        </p>

        <button class="mt-4 text-sm text-sky-700 hover:underline" @click="refreshAll">
            Refresh
        </button>
    </section>
</template>
