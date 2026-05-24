<script setup lang="ts">
const user = useSupabaseUser();
const config = useRuntimeConfig();

useSeoMeta({
    title: 'Garage Sale Tracker — find every yard sale near you, plan your route',
    description:
        "Free garage-sale map. Browse every yard, garage, and estate sale in your area, save the ones you want to hit, and we'll route you through them in the best order. Sellers can post for free.",
    ogTitle: 'Garage Sale Tracker',
    ogDescription:
        "Find every yard, garage, and estate sale near you. Pick the ones you want to hit and we'll plan the best route.",
    ogImage: () => `${config.public.siteUrl}/og-image.png`,
    ogUrl: () => config.public.siteUrl as string,
    ogType: 'website',
    twitterCard: 'summary_large_image',
});
</script>

<template>
    <section class="mx-auto max-w-6xl px-4 py-12 sm:py-20">
        <div class="grid gap-10 sm:grid-cols-2 sm:items-center">
            <div>
                <h1 class="font-display text-4xl font-bold leading-tight text-gray-900 sm:text-5xl">
                    The
                    <span class="text-brand-500">garage sale</span>
                    map.
                </h1>
                <p class="mt-4 text-lg text-gray-700">
                    Find every yard, garage, and estate sale near you. Pick the ones you want to hit
                    and we'll plan the best route.
                </p>
                <div class="mt-8 flex flex-wrap gap-3">
                    <NuxtLink to="/browse" class="btn-primary"> Browse the map </NuxtLink>
                    <NuxtLink v-if="user" to="/post" class="btn-secondary"> Post a sale </NuxtLink>
                    <NuxtLink v-else to="/signup" class="btn-secondary"> Sign up to post </NuxtLink>
                </div>
            </div>

            <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-orange-100">
                <h2 class="font-display text-2xl font-bold text-gray-900">How it works</h2>
                <ol class="mt-4 space-y-4 text-gray-700">
                    <li class="flex gap-3">
                        <span
                            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700"
                        >
                            1
                        </span>
                        <p>
                            <strong>Browse the map.</strong> Green pins are happening today, yellow
                            pins are coming up.
                        </p>
                    </li>
                    <li class="flex gap-3">
                        <span
                            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700"
                        >
                            2
                        </span>
                        <p>
                            <strong>Add sales to your itinerary.</strong> Save the ones that look
                            worth a stop.
                        </p>
                    </li>
                    <li class="flex gap-3">
                        <span
                            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700"
                        >
                            3
                        </span>
                        <p>
                            <strong>Optimize your route.</strong> We'll start from where you are and
                            order the stops to save you driving.
                        </p>
                    </li>
                </ol>
            </div>
        </div>
    </section>
</template>
