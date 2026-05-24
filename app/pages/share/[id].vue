<script setup lang="ts">
const route = useRoute();
const supabase = useSupabaseClient();
const config = useRuntimeConfig();

const id = route.params.id as string;

const { data } = await useAsyncData(`share-${id}`, async () => {
    const { data: r, error: rErr } = await supabase
        .from('routes')
        .select('id, name, route_date, is_public, user_id, end_mode, end_address, end_lat, end_lng')
        .eq('id', id)
        .maybeSingle();
    if (rErr) throw rErr;
    if (!r || !r.is_public) {
        throw createError({ statusCode: 404, statusMessage: 'Route not found' });
    }

    const { data: stops, error: sErr } = await supabase
        .from('route_stops')
        .select(`route_id, garage_sale_id, position, sale:garage_sales(${GARAGE_SALE_SELECT})`)
        .eq('route_id', id)
        .order('position');
    if (sErr) throw sErr;

    const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', r.user_id)
        .maybeSingle();

    // Filter out stops whose sale was soft-deleted by the owner — public
    // visitors don't need to see tombstones, they'd just be confused by
    // stops they can't visit. The owner sees them in /itineraries/[id].
    type ShareStop = {
        route_id: string;
        garage_sale_id: string;
        position: number;
        sale: import('~/composables/useGarageSales').GarageSale;
    };
    const allStops = (stops ?? []) as unknown as ShareStop[];
    const visibleStops = allStops.filter((s) => !s.sale?.deleted_at);

    return {
        route: r as {
            id: string;
            name: string;
            route_date: string;
            is_public: boolean;
            user_id: string;
            end_mode: import('~/composables/useRouteOptimizer').EndMode;
            end_address: string | null;
            end_lat: number | null;
            end_lng: number | null;
        },
        stops: visibleStops,
        ownerName: profile?.display_name ?? 'A user',
    };
});

const customEnd = computed(() => {
    const r = data.value?.route;
    if (!r || r.end_mode !== 'address') return null;
    if (r.end_lat == null || r.end_lng == null) return null;
    return { lng: r.end_lng, lat: r.end_lat, label: 'End' as const, address: r.end_address };
});

const stopsForMap = computed(() => data.value?.stops.map((s) => ({ sale: s.sale })) ?? []);

const dateLabel = computed(() =>
    data.value
        ? new Date(data.value.route.route_date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
          })
        : '',
);

function stopHoursOn(sale: import('~/composables/useGarageSales').GarageSale): string {
    if (!data.value) return '';
    const row = findSaleDateOn(sale, data.value.route.route_date);
    if (row) return formatTimeRange(row.start_time, row.end_time);
    return formatTimeRange(sale.start_time, sale.end_time);
}

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
});

// Build maps export URLs from stop coords. The share page has no personal
// start point (we don't know the viewer's location), so origin = first stop.
// Destination depends on the route owner's saved end_mode:
//   - 'last_stop'  → end at the last stop (waypoints = middle stops)
//   - 'address'    → end at the owner's custom address (waypoints = all stops)
//   - 'round_trip' → end back at the first stop (waypoints = remaining stops).
//                    Without a real start, "round trip" is approximated as
//                    return-to-first-stop, which is the closest meaningful
//                    interpretation for a share viewer.
// `GOOGLE_MAX_WAYPOINTS` comes from useRouteOptimizer (auto-imported) so
// it stays in sync with /itineraries/[id].
const mapsLinks = computed(() => {
    const stops = data.value?.stops ?? [];
    if (stops.length === 0) return null;
    const coords = stops.map((s) => `${s.sale.lat},${s.sale.lng}`);
    const mode = data.value?.route.end_mode ?? 'last_stop';

    let origin: string;
    let destination: string;
    let waypoints: string[];

    if (mode === 'address' && customEnd.value) {
        origin = coords[0]!;
        destination = `${customEnd.value.lat},${customEnd.value.lng}`;
        waypoints = coords.slice(1);
    } else if (mode === 'round_trip') {
        if (coords.length < 2) return null;
        origin = coords[0]!;
        destination = coords[0]!;
        waypoints = coords.slice(1);
    } else {
        if (coords.length < 2) return null;
        origin = coords[0]!;
        destination = coords[coords.length - 1]!;
        waypoints = coords.slice(1, -1);
    }

    const truncated = waypoints.length > GOOGLE_MAX_WAYPOINTS;
    const googleWaypoints = truncated ? waypoints.slice(0, GOOGLE_MAX_WAYPOINTS) : waypoints;
    const google = new URL('https://www.google.com/maps/dir/');
    google.searchParams.set('api', '1');
    google.searchParams.set('origin', origin);
    google.searchParams.set('destination', destination);
    if (googleWaypoints.length) google.searchParams.set('waypoints', googleWaypoints.join('|'));
    google.searchParams.set('travelmode', 'driving');
    // Apple Maps' URL scheme only supports a single daddr (no multi-stop),
    // so route to just the first stop after the origin.
    const appleFirstStop = waypoints[0] ?? destination;
    const apple = new URL('https://maps.apple.com/');
    apple.searchParams.set('saddr', origin);
    apple.searchParams.set('daddr', appleFirstStop);
    apple.searchParams.set('dirflg', 'd');
    return {
        google: google.toString(),
        apple: apple.toString(),
        truncated,
        appleFirstStopOnly: waypoints.length > 0,
    };
});

/** Per-click cache-buster — see useRouteOptimizer note on /itineraries/[id]. */
function openInMaps(url: string) {
    const sep = url.includes('?') ? '&' : '?';
    window.open(`${url}${sep}_t=${Date.now()}`, '_blank', 'noopener,noreferrer');
}
</script>

<template>
    <section class="mx-auto max-w-5xl px-4 py-8">
        <div v-if="!data" class="rounded-xl bg-gray-100 p-8 text-center text-gray-600">
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
                                    v-if="stopHoursOn(stop.sale)"
                                    class="mt-0.5 text-xs text-gray-500"
                                >
                                    Open {{ stopHoursOn(stop.sale) }}
                                </div>
                            </div>
                        </li>
                    </ol>

                    <div v-if="mapsLinks" class="mt-6 space-y-2">
                        <h3 class="font-display text-base font-bold text-gray-900">
                            Drive this route
                        </h3>
                        <p v-if="customEnd && customEnd.address" class="text-xs text-gray-600">
                            Ends at <strong>{{ customEnd.address }}</strong>
                        </p>
                        <a
                            :href="mapsLinks.google"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-sky-600"
                            @click.prevent="openInMaps(mapsLinks.google)"
                        >
                            🗺️ Open in Google Maps
                        </a>
                        <a
                            :href="mapsLinks.apple"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50"
                            @click.prevent="openInMaps(mapsLinks.apple)"
                        >
                            🍎 Open in Apple Maps
                        </a>
                        <p
                            v-if="mapsLinks.appleFirstStopOnly"
                            class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                        >
                            Apple Maps deep links only support one destination, so the 🍎 button
                            routes to your first stop only. Use Google Maps to navigate the full
                            route.
                        </p>
                    </div>
                </div>

                <div>
                    <ClientOnly>
                        <LazyRouteMap
                            :stops="stopsForMap"
                            :order="null"
                            :route-geometry="null"
                            :start="null"
                            :end="customEnd"
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
                    Garage Sale Tracker lets you save sales, optimize a driving order, and open the
                    whole thing in Google or Apple Maps in one tap.
                </p>
                <NuxtLink to="/" class="btn-primary mt-4 inline-flex">Get started</NuxtLink>
            </section>
        </template>
    </section>
</template>
