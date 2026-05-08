<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Message } from '~/composables/useMessaging'

const route = useRoute()
const supabase = useSupabaseClient()
const user = useSupabaseUser()

const id = route.params.id as string

const toast = useToast()
const { confirm } = useConfirm()

const { data, refresh } = await useAsyncData(
    `thread-${id}`,
    () => fetchThreadWithMessages(id),
    { watch: [user] },
)

const draft = ref('')
const sending = ref(false)
const error = ref<string | null>(null)

// On mobile virtual keyboards, Enter is typically a Send/Done key, not a
// newline key — auto-submitting on Enter there means a half-typed message
// goes out the moment a user reaches for a line break. Enter-to-send is
// kept on devices with a real keyboard (hover + fine pointer), and on
// mobile Enter just inserts a newline as the keyboard expects.
const enterSubmits = ref(false)
onMounted(() => {
    enterSubmits.value = window.matchMedia('(hover: hover) and (pointer: fine)').matches
})

function onTextareaKeydown(ev: KeyboardEvent) {
    if (ev.key !== 'Enter') return
    if (!enterSubmits.value) return
    if (ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return
    ev.preventDefault()
    send()
}

async function send() {
    if (!data.value) return
    error.value = null
    if (!draft.value.trim()) return
    sending.value = true
    try {
        await sendMessage(data.value.thread.id, draft.value)
        draft.value = ''
        // Realtime will append the new message; no need to refresh().
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to send'
    } finally {
        sending.value = false
    }
}

const messagesEl = ref<HTMLDivElement | null>(null)
function scrollToBottom() {
    nextTick(() => {
        if (messagesEl.value) {
            messagesEl.value.scrollTop = messagesEl.value.scrollHeight
        }
    })
}

async function hideConversation() {
    if (!data.value) return
    const ok = await confirm({
        title: 'Remove this conversation from your inbox?',
        description:
            "You won't see it anymore, but the other person still keeps their copy of the messages. If they reply later, the conversation comes back to your inbox.",
        confirmText: 'Remove',
        tone: 'default',
    })
    if (!ok) return
    try {
        await hideThread(data.value.thread.id)
        toast.success('Conversation removed from your inbox.')
        navigateTo('/inbox')
    } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not remove conversation')
    }
}

let channel: RealtimeChannel | null = null

onMounted(async () => {
    // Subscribe BEFORE marking-read so messages that arrive in the
    // window between the initial fetch and now still land in the
    // local list. (The layout channel handles the navbar badge delta
    // for our mark-read UPDATE events — no need to refresh here.)
    channel = supabase
        .channel(`thread-${id}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `thread_id=eq.${id}`,
            },
            async (payload) => {
                // Runtime shape check on the realtime payload before
                // we trust it as a Message — Supabase's payload type is
                // generic, and a future schema/version change shouldn't
                // silently corrupt the messages array.
                const raw = payload.new as Partial<Message> | undefined
                if (
                    !raw ||
                    typeof raw.id !== 'string' ||
                    typeof raw.body !== 'string' ||
                    typeof raw.sender_id !== 'string'
                ) {
                    console.warn('[inbox] unexpected realtime payload shape:', payload.new)
                    return
                }
                const msg = raw as Message
                if (!data.value) return
                if (data.value.messages.some((m) => m.id === msg.id)) return
                // Replace the wrapper instead of `.push` — useAsyncData
                // returns a non-shallow ref, and the immutable update
                // matches the togglePublic refactor pattern (avoids any
                // race with a concurrent refresh() silently overwriting
                // a push). Same shape Vue 3 expects for ref reactivity.
                data.value = {
                    ...data.value,
                    messages: [...data.value.messages, msg],
                }
                scrollToBottom()
                if (msg.sender_id !== user.value?.id) {
                    await markThreadRead(id)
                    // Layout channel handles the badge delta.
                }
            },
        )
        .subscribe()

    if (data.value) {
        await markThreadRead(id)
        scrollToBottom()
    }
})

onBeforeUnmount(() => {
    if (channel) supabase.removeChannel(channel)
    channel = null
})

function fmtTimestamp(iso: string): string {
    const d = new Date(iso)
    const today = new Date()
    const sameDay =
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
    return sameDay
        ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
          })
}
</script>

<template>
    <section class="mx-auto max-w-3xl px-4 py-6">
        <NuxtLink to="/inbox" class="text-sm text-sky-700 hover:underline">
            ← All conversations
        </NuxtLink>

        <div v-if="!data" class="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600">
            Conversation not found.
        </div>

        <template v-else>
            <header class="mt-3 flex items-start justify-between gap-3">
                <div>
                    <h1 class="font-display text-2xl font-bold text-gray-900">
                        {{ data.other?.display_name || 'Someone' }}
                    </h1>
                    <p v-if="data.thread.sale" class="mt-1 text-sm text-sky-700">
                        About:
                        <NuxtLink
                            :to="`/sale/${data.thread.sale.id}`"
                            class="hover:underline"
                        >
                            {{ data.thread.sale.title }}
                        </NuxtLink>
                    </p>
                </div>
                <button
                    class="text-xs text-gray-600 hover:underline"
                    @click="hideConversation"
                >
                    Remove from inbox
                </button>
            </header>

            <div
                ref="messagesEl"
                class="mt-4 max-h-[60vh] overflow-y-auto rounded-xl bg-white p-4 ring-1 ring-orange-100"
            >
                <p
                    v-if="data.messages.length === 0"
                    class="py-8 text-center text-sm text-gray-500"
                >
                    No messages yet. Send the first one below.
                </p>

                <ul v-else class="space-y-3">
                    <li
                        v-for="m in data.messages"
                        :key="m.id"
                        class="flex"
                        :class="m.sender_id === user?.id ? 'justify-end' : 'justify-start'"
                    >
                        <div
                            class="max-w-[78%] rounded-2xl px-3.5 py-2"
                            :class="
                                m.sender_id === user?.id
                                    ? 'bg-brand-500 text-white'
                                    : 'bg-orange-50 text-gray-900'
                            "
                        >
                            <p class="whitespace-pre-line break-words text-sm">
                                <AutoLinkText
                                    :text="m.body"
                                    :link-class="
                                        m.sender_id === user?.id
                                            ? 'break-words text-white underline hover:no-underline'
                                            : 'break-words text-sky-700 hover:underline'
                                    "
                                />
                            </p>
                            <p
                                class="mt-1 text-[10px]"
                                :class="
                                    m.sender_id === user?.id ? 'text-orange-100' : 'text-gray-500'
                                "
                            >
                                {{ fmtTimestamp(m.created_at) }}
                            </p>
                        </div>
                    </li>
                </ul>
            </div>

            <form
                class="mt-3 flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-orange-100 sm:flex-row sm:items-end"
                @submit.prevent="send"
            >
                <textarea
                    v-model="draft"
                    rows="2"
                    maxlength="4000"
                    placeholder="Type a message…"
                    class="input flex-1 !min-h-[60px]"
                    :disabled="sending"
                    @keydown="onTextareaKeydown"
                />
                <button
                    type="submit"
                    class="btn-primary sm:w-28"
                    :disabled="sending || !draft.trim()"
                >
                    {{ sending ? 'Sending…' : 'Send' }}
                </button>
            </form>
            <p v-if="error" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>
        </template>
    </section>
</template>
