<script setup lang="ts">
const route = useRoute()
const supabase = useSupabaseClient()
const config = useRuntimeConfig()

const id = route.params.id as string

const { data } = await useAsyncData(`share-${id}`, async () => {
    const { data: r, error: rErr } = await supabase
        .from('routes')
        .select('id, name, route_date, is_public, user_id')
        .eq('id', id)
        .maybeSingle()
    if (rErr) throw rErr
    if (!r || !r.is_public) {
        throw createError({ statusCode: 404, statusMessage: 'Route not found' })
    }

    const { data: stops, error: sErr } = await supabase
        .from('route_stops')
        .select('route_id, garage_sale_id, position, sale:garage_sales(*)')
        .eq('route_id', id)
        .order('position')
    if (sErr) throw sErr

    const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', r.user_id)
        .maybeSingle()

    // Filter out stops whose sale was soft-deleted by the owner — public
    // visitors don't need to see tombstones, they'd just be confused by
    // stops they can't visit. The owner sees them in /itineraries/[id].
    type ShareStop = {
        route_id: string
        garage_sale_id: string
        position: number
        sale: import('~/composables/useGarageSales').GarageSale
    }
    const allStops = (stops ?? []) as unknown as ShareStop[]
    const visibleStops = allStops.filter((s) => !s.sale?.deleted_at)

    return {
        route: r as { id: string; name: string; route_date: string; is_public: boolean; user_id: string },
        stops: visibleStops,
        ownerName: profile?.display_name ?? 'A user',
    }
})

const stopsForMap = computed(
    () => data.value?.stops.map((s) => ({ sale: s.sale })) ?? [],
)

const dateLabel = computed(() =>
    data.value
        ? new Date(data.value.route.route_date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
          })
        : '',
)

useSeoMeta({
    title: () =>
        data.value
            ? `${data.value.route.name} — Garage Sale Tracker`
            : 'Shared route — Garage Sale Tracker',
    ogTitle: () => (data.value ? data.value.route.name : 'Shared route'),
    ogDescription: () =>
        data.value
            ? `${data.value.stops.length} stops on ${dateLabel.value}, shared by ${data.value.ownerName}.`
            : '',
    ogImage: () => `${config.public.siteUrl}/og-image.png`,
    ogUrl: () => `${config.public.siteUrl}/share/${id}`,
    ogType: 'website',
    twitterCard: 'summary_large_image',
})

// Build maps export URLs from stop coords, no start point, end at last stop.
const GOOGLE_MAX_WAYPOINTS = 9
const mapsLinks = computed(() => {
    const stops = data.value?.stops ?? []
    if (stops.length < 2) return null
    const coords = stops.map((s) => `${s.sale.lat},${s.sale.lng}`)
    const origin = coords[0]!
    const destination = coords[coords.length - 1]!
    const waypoints = coords.slice(1, -1)
    const truncated = waypoints.length > GOOGLE_MAX_WAYPOINTS
    const googleWaypoints = truncated ? waypoints.slice(0, GOOGLE_MAX_WAYPOINTS) : waypoints
    const google = new URL('https://www.google.com/maps/dir/')
    google.searchParams.set('api', '1')
    google.searchParams.set('origin', origin)
    google.searchParams.set('destination', destination)
    if (googleWaypoints.length) google.searchParams.set('waypoints', googleWaypoints.join('|'))
    google.searchParams.set('travelmode', 'driving')
    const apple = new URL('https://maps.apple.com/')
    apple.searchParams.set('saddr', origin)
    apple.searchParams.set('daddr', [...waypoints, destination].join(' to:'))
    apple.searchParams.set('dirflg', 'd')
    return { google: google.toString(), apple: apple.toString(), truncated }
})
</script>

<template>
    <section class="mx-auto max-w-5xl px-4 py-8">
        <div
            v-if="!data"
            class="rounded-xl bg-gray-100 p-8 text-center text-gray-600"
        >
            This route isn't public, or doesn't exist.
            <NuxtLink to="/browse" class="text-sky-700 hover:underline">Browse sales</NuxtLink>
            instead?
        </div>

        <template v-else>
            <p class="text-sm text-gray-500">Shared by {{ data.ownerName }}</p>
            <h1 class="mt-1 font-display text-3xl font-bold text-gray-900">
                {{ data.route.name }}
            </h1>
            <p class="mt-1 text-gray-600">{{ dateLabel }}</p>

            <div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
                <div>
                    <h2 class="font-display text-lg font-bold text-gray-900">
                        Stops ({{ data.stops.length }})
                    </h2>
                    <ol class="mt-3 space-y-2">
                        <li
                            v-for="(stop, i) in data.stops"
                            :key="stop.garage_sale_id"
                            class="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-orange-100"
                        >
                            <span
                                class="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
                            >
                                {{ i + 1 }}
                            </span>
                            <div class="min-w-0 flex-1">
                                <NuxtLink
                                    :to="`/sale/${stop.garage_sale_id}`"
                                    class="font-medium text-gray-900 hover:text-brand-600"
                                >
                                    {{ stop.sale.title }}
                                </NuxtLink>
                                <div class="mt-0.5 truncate text-xs text-gray-600">
                                    {{ stop.sale.address }}
                                </div>
                                <div
                                    v-if="stop.sale.start_time || stop.sale.end_time"
                                    class="mt-0.5 text-xs text-gray-500"
                                >
                                    Open
                                    {{ formatTimeRange(stop.sale.start_time, stop.sale.end_time) }}
                                </div>
                            </div>
                        </li>
                    </ol>

                    <div v-if="mapsLinks" class="mt-6 space-y-2">
                        <h3 class="font-display text-base font-bold text-gray-900">
                            Drive this route
                        </h3>
                        <a
                            :href="mapsLinks.google"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-sky-600"
                        >
                            🗺️ Open in Google Maps
                        </a>
                        <a
                            :href="mapsLinks.apple"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50"
                        >
                            🍎 Open in Apple Maps
                        </a>
                    </div>
                </div>

                <div>
                    <ClientOnly>
                        <RouteMap
                            :stops="stopsForMap"
                            :order="null"
                            :route-geometry="null"
                            :start="null"
                        />
                        <template #fallback>
                            <div
                                class="flex h-[60vh] min-h-[400px] w-full items-center justify-center rounded-xl bg-gray-100 text-gray-500"
                            >
                                Loading map…
                            </div>
                        </template>
                    </ClientOnly>
                </div>
            </div>

            <section class="mt-10 rounded-xl bg-cream p-5 text-center">
                <p class="font-display text-lg font-bold text-gray-900">
                    Want to plan your own route?
                </p>
                <p class="mt-1 text-sm text-gray-700">
                    Garage Sale Tracker lets you save sales, optimize a driving order, and open
                    the whole thing in Google or Apple Maps in one tap.
                </p>
                <NuxtLink to="/" class="btn-primary mt-4 inline-flex">Get started</NuxtLink>
            </section>
        </template>
    </section>
</template>
