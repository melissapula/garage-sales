<script setup lang="ts">
/**
 * Nuxt's global error page. Renders for both 4xx and 5xx — including
 * the createError({ statusCode: 404 }) throws inside `useAsyncData`
 * loaders for missing sales, routes, and shared routes. Without this
 * file, the user gets the unstyled framework default.
 */
const props = defineProps<{
    error: {
        statusCode?: number;
        statusMessage?: string;
        message?: string;
    };
}>();

const isNotFound = computed(() => props.error?.statusCode === 404);

const heading = computed(() =>
    isNotFound.value ? "We couldn't find that page." : 'Something went wrong.',
);
const detail = computed(() =>
    isNotFound.value
        ? 'The link may be wrong, or the sale or route might have been removed.'
        : (props.error?.statusMessage ?? props.error?.message ?? 'An unexpected error occurred.'),
);

function goHome() {
    clearError({ redirect: '/' });
}

function goBrowse() {
    clearError({ redirect: '/browse' });
}
</script>

<template>
    <div class="flex min-h-screen flex-col bg-cream">
        <header class="sticky top-0 z-10 border-b border-orange-100 bg-white/90 backdrop-blur">
            <nav class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
                <NuxtLink to="/" class="font-display text-lg font-bold text-brand-600 sm:text-xl">
                    Garage Sale Tracker
                </NuxtLink>
            </nav>
        </header>

        <main class="flex flex-1 items-center justify-center px-4 py-16">
            <section class="w-full max-w-md text-center">
                <p class="font-display text-6xl font-bold text-brand-500">
                    {{ error?.statusCode ?? '!' }}
                </p>
                <h1 class="mt-4 font-display text-2xl font-bold text-gray-900 sm:text-3xl">
                    {{ heading }}
                </h1>
                <p class="mt-3 text-sm text-gray-700 sm:text-base">
                    {{ detail }}
                </p>
                <div class="mt-8 flex flex-wrap justify-center gap-3">
                    <button class="btn-primary" @click="goBrowse">Browse sales</button>
                    <button
                        class="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        @click="goHome"
                    >
                        Back home
                    </button>
                </div>
            </section>
        </main>
    </div>
</template>
