<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

const user = useSupabaseUser()
const supabase = useSupabaseClient()
const unread = useUnreadCount()
const unreadCount = unread.count

const route = useRoute()
const menuOpen = ref(false)

// Close mobile menu on every navigation.
watch(() => route.fullPath, () => {
    menuOpen.value = false
})

let channel: RealtimeChannel | null = null

function teardownChannel() {
    if (channel) supabase.removeChannel(channel)
    channel = null
}

function subscribeUnread() {
    teardownChannel()
    if (!user.value) return
    channel = supabase
        .channel('layout-unread')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            () => {
                unread.refresh()
            },
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'messages' },
            () => {
                // Mark-read updates change the unread count.
                unread.refresh()
            },
        )
        .subscribe()
}

watch(
    user,
    () => {
        unread.refresh()
        subscribeUnread()
    },
    { immediate: true },
)

onBeforeUnmount(teardownChannel)

async function signOut() {
    menuOpen.value = false
    await supabase.auth.signOut()
    await navigateTo('/')
}
</script>

<template>
    <div class="flex min-h-screen flex-col">
        <header class="sticky top-0 z-30 border-b border-orange-100 bg-white/90 backdrop-blur">
            <nav class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
                <NuxtLink
                    to="/"
                    class="font-display text-lg font-bold text-brand-600 sm:text-xl"
                >
                    Garage Sale Tracker
                </NuxtLink>

                <!-- Desktop nav -->
                <div class="hidden items-center gap-2 md:flex">
                    <NuxtLink
                        to="/browse"
                        class="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                    >
                        Browse
                    </NuxtLink>
                    <template v-if="user">
                        <NuxtLink
                            to="/post"
                            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                        >
                            Post a sale
                        </NuxtLink>
                        <NuxtLink
                            to="/my-sales"
                            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                        >
                            My sales
                        </NuxtLink>
                        <NuxtLink
                            to="/itineraries"
                            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                        >
                            Itineraries
                        </NuxtLink>
                        <NuxtLink
                            to="/inbox"
                            class="relative rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                        >
                            Inbox
                            <span
                                v-if="unreadCount > 0"
                                class="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white"
                            >
                                {{ unreadCount > 99 ? '99+' : unreadCount }}
                            </span>
                        </NuxtLink>
                        <NuxtLink
                            to="/account"
                            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                        >
                            Account
                        </NuxtLink>
                        <button
                            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-900"
                            @click="signOut"
                        >
                            Sign out
                        </button>
                    </template>
                    <template v-else>
                        <NuxtLink
                            to="/login"
                            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-brand-600"
                        >
                            Sign in
                        </NuxtLink>
                        <NuxtLink to="/signup" class="btn-primary !min-h-[40px] !px-4 !py-2 text-sm">
                            Sign up
                        </NuxtLink>
                    </template>
                </div>

                <!-- Mobile hamburger trigger -->
                <button
                    type="button"
                    class="relative flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 hover:bg-orange-50 md:hidden"
                    aria-label="Menu"
                    :aria-expanded="menuOpen"
                    @click="menuOpen = !menuOpen"
                >
                    <svg
                        v-if="!menuOpen"
                        class="h-6 w-6"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    <svg
                        v-else
                        class="h-6 w-6"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M6 18L18 6" />
                    </svg>
                    <span
                        v-if="user && unreadCount > 0 && !menuOpen"
                        class="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white"
                    >
                        {{ unreadCount > 9 ? '9+' : unreadCount }}
                    </span>
                </button>
            </nav>

            <!-- Mobile menu drawer -->
            <Transition
                enter-active-class="transition duration-150 ease-out"
                enter-from-class="opacity-0 -translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition duration-100 ease-in"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-2"
            >
                <div
                    v-if="menuOpen"
                    class="border-t border-orange-100 bg-white md:hidden"
                >
                    <div class="mx-auto flex max-w-6xl flex-col gap-1 px-3 py-3">
                        <NuxtLink
                            to="/browse"
                            class="rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                        >
                            Browse
                        </NuxtLink>
                        <template v-if="user">
                            <NuxtLink
                                to="/post"
                                class="rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                            >
                                Post a sale
                            </NuxtLink>
                            <NuxtLink
                                to="/my-sales"
                                class="rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                            >
                                My sales
                            </NuxtLink>
                            <NuxtLink
                                to="/itineraries"
                                class="rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                            >
                                Itineraries
                            </NuxtLink>
                            <NuxtLink
                                to="/inbox"
                                class="flex items-center justify-between rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                            >
                                <span>Inbox</span>
                                <span
                                    v-if="unreadCount > 0"
                                    class="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white"
                                >
                                    {{ unreadCount > 99 ? '99+' : unreadCount }}
                                </span>
                            </NuxtLink>
                            <NuxtLink
                                to="/account"
                                class="rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                            >
                                Account
                            </NuxtLink>
                            <button
                                class="rounded-lg px-3 py-3 text-left text-base font-medium text-gray-500 hover:bg-orange-50 hover:text-gray-900"
                                @click="signOut"
                            >
                                Sign out
                            </button>
                        </template>
                        <template v-else>
                            <NuxtLink
                                to="/login"
                                class="rounded-lg px-3 py-3 text-base font-medium text-gray-800 hover:bg-orange-50 hover:text-brand-600"
                            >
                                Sign in
                            </NuxtLink>
                            <NuxtLink
                                to="/signup"
                                class="rounded-lg bg-brand-500 px-3 py-3 text-center text-base font-semibold text-white hover:bg-brand-600"
                            >
                                Sign up
                            </NuxtLink>
                        </template>
                    </div>
                </div>
            </Transition>
        </header>

        <main class="flex-1">
            <slot />
        </main>

        <footer class="border-t border-orange-100 bg-white">
            <div class="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-500">
                <p>Garage Sale Tracker — find and route the weekend's best stops.</p>
            </div>
        </footer>
    </div>
</template>
