<script setup lang="ts">
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { count: unreadCount, refresh: refreshUnread } = useUnreadCount()

watch(
    user,
    () => {
        refreshUnread()
    },
    { immediate: true },
)

async function signOut() {
    await supabase.auth.signOut()
    await navigateTo('/')
}
</script>

<template>
    <div class="flex min-h-screen flex-col">
        <header class="sticky top-0 z-30 border-b border-orange-100 bg-white/90 backdrop-blur">
            <nav class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
                <NuxtLink to="/" class="font-display text-xl font-bold text-brand-600">
                    Bemidji Garage Sales
                </NuxtLink>

                <div class="flex items-center gap-1 sm:gap-3">
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
            </nav>
        </header>

        <main class="flex-1">
            <slot />
        </main>

        <footer class="border-t border-orange-100 bg-white">
            <div class="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-500">
                <p>Bemidji Garage Sales — find and route the weekend's best stops.</p>
            </div>
        </footer>
    </div>
</template>
