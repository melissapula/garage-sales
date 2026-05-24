<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js';

const supabase = useSupabaseClient();
const user = useSupabaseUser();

const {
    data: threads,
    refresh,
    pending,
} = await useAsyncData('inbox-threads', () => fetchInbox(), { watch: [user] });

const unread = useUnreadCount();

let channel: RealtimeChannel | null = null;

onMounted(() => {
    unread.refresh();
    channel = supabase
        .channel('inbox-list')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
                // Most messages land in a thread we already have on
                // screen — update that row in place instead of a full
                // fetchInbox round-trip (which re-runs an N-row profile
                // join + the unread-counts RPC). Only fall back to
                // refresh() for a brand-new thread that wasn't in our
                // list before.
                const m = payload.new as {
                    id?: string;
                    thread_id?: string;
                    sender_id?: string;
                    body?: string;
                    created_at?: string;
                };
                if (
                    typeof m?.id !== 'string' ||
                    typeof m.thread_id !== 'string' ||
                    typeof m.sender_id !== 'string' ||
                    typeof m.body !== 'string' ||
                    typeof m.created_at !== 'string'
                ) {
                    refresh();
                    return;
                }
                const list = threads.value;
                if (!list) {
                    refresh();
                    return;
                }
                const existing = list.find((t) => t.id === m.thread_id);
                if (!existing) {
                    // New thread for this user — fetch to pull in the
                    // other-participant profile + sale relation.
                    refresh();
                    return;
                }
                existing.last_message_preview = m.body.slice(0, 100);
                existing.last_message_at = m.created_at;
                if (m.sender_id !== user.value?.id) {
                    existing.unreadCount = (existing.unreadCount ?? 0) + 1;
                }
                // Re-sort so the freshly-active thread floats to the top.
                threads.value = [existing, ...list.filter((t) => t.id !== m.thread_id)];
            },
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'message_threads' },
            () => {
                // Catches edge cases the messages-INSERT path doesn't
                // (hide/unhide flips, etc.). Rare; full refresh is fine.
                refresh();
            },
        )
        .subscribe();
});

onBeforeUnmount(() => {
    if (channel) supabase.removeChannel(channel);
    channel = null;
});

async function refreshAll() {
    await Promise.all([refresh(), unread.refresh()]);
}

function fmtRelative(iso: string): string {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return d.toLocaleDateString();
}
</script>

<template>
    <section class="mx-auto max-w-3xl px-4 py-8">
        <h1 class="font-display text-3xl font-bold text-gray-900">Inbox</h1>
        <p class="mt-2 text-sm text-gray-600">Conversations with other users about garage sales.</p>

        <!-- Skeleton during a refetch (e.g. user state change). The first
             paint is server-rendered with data already loaded, so this
             only shows when there's no cached threads list yet. -->
        <div v-if="pending && !threads?.length" class="mt-6 space-y-2">
            <div v-for="i in 3" :key="i" class="rounded-xl bg-white p-4 ring-1 ring-orange-100">
                <div class="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
                <div class="mt-2 h-3 w-1/2 animate-pulse rounded bg-gray-200" />
                <div class="mt-2 h-3 w-2/3 animate-pulse rounded bg-gray-200" />
            </div>
        </div>

        <ul v-else-if="threads && threads.length" class="mt-6 space-y-2">
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
                                :class="
                                    t.unreadCount > 0
                                        ? 'font-medium text-gray-900'
                                        : 'text-gray-600'
                                "
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
