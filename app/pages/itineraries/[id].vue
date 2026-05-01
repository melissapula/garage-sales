<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'
import type { RouteStop } from '~/composables/useRoutes'
import type { OptimizedRoute } from '~/composables/useRouteOptimizer'
import draggable from 'vuedraggable'

const route = useRoute()
const supabase = useSupabaseClient()
const router = useRouter()

const id = route.params.id as string

// ============================================================================
// Data
// ============================================================================
const { data, refresh } = await useAsyncData(`route-${id}`, () => fetchRouteWithStops(id))

const { data: savedSales, refresh: refreshSaved } = await useAsyncData(
    'route-saved-sales',
    () => fetchSavedSalesWithDetails(),
)

// Saved sales available on this route's date that haven't been added yet.
const availableSaved = computed(() => {
    if (!data.value) return []
    const inRoute = new Set(data.value.stops.map((s) => s.garage_sale_id))
    const day = data.value.route.route_date
    return (savedSales.value ?? [])
        .filter((row) => !inRoute.has(row.garage_sale_id))
        .filter((row) => row.sale.start_date <= day && day <= row.sale.end_date)
})

// ============================================================================
// Manual ordering
// ============================================================================
async function addToRoute(saleId: string) {
    if (!data.value) return
    const stops = data.value.stops
    const nextPos = (stops.length === 0 ? 0 : stops[stops.length - 1]!.position) + 1
    const { error } = await supabase
        .from('route_stops')
        .insert({ route_id: id, garage_sale_id: saleId, position: nextPos })
    if (error) {
        alert(error.message)
        return
    }
    invalidateOptimization()
    await refresh()
}

async function removeStop(saleId: string) {
    const { error } = await supabase
        .from('route_stops')
        .delete()
        .eq('route_id', id)
        .eq('garage_sale_id', saleId)
    if (error) {
        alert(error.message)
        return
    }
    invalidateOptimization()
    await refresh()
}

// Local mirror of the displayed stop list, used as v-model for vuedraggable.
// We keep it in sync with the server-side order until the user drags, then
// persist whatever new order they ended up with.
const draggableStops = ref<RouteStop[]>([])
const persisting = ref(false)

async function persistDraggedOrder() {
    if (!data.value || persisting.value) return
    const updates = draggableStops.value.map((s, i) => ({
        route_id: id,
        garage_sale_id: s.garage_sale_id,
        position: i + 1,
    }))
    persisting.value = true
    const { error } = await supabase.from('route_stops').upsert(updates)
    persisting.value = false
    if (error) {
        alert(error.message)
        await refresh()
        return
    }
    invalidateOptimization()
    await refresh()
}

// ============================================================================
// Optimize
// ============================================================================
type StartMode = 'location' | 'address'
const startMode = ref<StartMode>('location')
const startAddress = ref('')
const startResolved = ref<{ lng: number; lat: number; label?: string } | null>(null)
const startAddressLabel = ref<string | null>(null)
const capturingLocation = ref(false)
const geocodingStart = ref(false)

const departureTime = ref('08:00')
const roundTrip = ref(true)

const optimizedOrder = ref<number[] | null>(null)
const routeGeometry = ref<GeoJSON.LineString | null>(null)
const totalDistanceMi = ref<number | null>(null)
const totalDriveMin = ref<number | null>(null)
const timeline = ref<TimelineEntry[] | null>(null)
const returnLegMin = ref<number | null>(null)
const arriveHomeAt = ref<Date | null>(null)

const optimizing = ref(false)
const optimizeError = ref<string | null>(null)

function invalidateOptimization() {
    optimizedOrder.value = null
    routeGeometry.value = null
    totalDistanceMi.value = null
    totalDriveMin.value = null
    timeline.value = null
    returnLegMin.value = null
    arriveHomeAt.value = null
}

async function captureLocation() {
    optimizeError.value = null
    startAddressLabel.value = null
    capturingLocation.value = true
    try {
        const pos = await getCurrentPosition()
        startResolved.value = { lng: pos.lng, lat: pos.lat, label: 'You' }
        // Reverse geocode so the user can verify the location is right
        // (browser geolocation on desktop often resolves to the ISP edge).
        try {
            startAddressLabel.value = await reverseGeocode(pos.lng, pos.lat)
        } catch {
            // Non-blocking — the route still works without the human-readable address.
        }
    } catch (e) {
        optimizeError.value = e instanceof Error ? e.message : 'Could not get location'
    } finally {
        capturingLocation.value = false
    }
}

async function geocodeStart() {
    optimizeError.value = null
    startAddressLabel.value = null
    if (!startAddress.value.trim()) {
        optimizeError.value = 'Enter a starting address.'
        return
    }
    geocodingStart.value = true
    try {
        const result = await geocodeAddress(startAddress.value.trim())
        if (!result) {
            optimizeError.value = "Couldn't find that address."
            startResolved.value = null
            return
        }
        startResolved.value = { lng: result.lng, lat: result.lat, label: 'Start' }
        startAddress.value = result.address
    } catch (e) {
        optimizeError.value = e instanceof Error ? e.message : 'Geocoding failed'
    } finally {
        geocodingStart.value = false
    }
}

function applyRouteResult(result: OptimizedRoute, opts: { reorder: boolean }) {
    optimizedOrder.value = opts.reorder ? result.stopOrder : null
    routeGeometry.value = result.geometry
    totalDistanceMi.value = result.distanceMeters / 1609.344
    totalDriveMin.value = result.durationSeconds / 60
    returnLegMin.value = result.returnLeg ? result.returnLeg.durationSeconds / 60 : null

    const [hh, mm] = departureTime.value.split(':').map(Number)
    const departure = new Date(data.value!.route.route_date + 'T00:00:00')
    departure.setHours(hh ?? 8, mm ?? 0, 0, 0)
    // Use stopLegs (excludes the return-home leg) so the timeline only shows
    // arrivals at actual stops.
    timeline.value = buildTimeline(result.stopLegs, departure, 30)

    // Arrival back home = last stop's departure + return leg drive time.
    if (result.returnLeg && timeline.value.length > 0) {
        const lastStop = timeline.value[timeline.value.length - 1]!
        arriveHomeAt.value = new Date(
            lastStop.departAt.getTime() + result.returnLeg.durationSeconds * 1000,
        )
    } else {
        arriveHomeAt.value = null
    }
}

async function optimize() {
    if (!data.value || data.value.stops.length === 0) return
    if (!startResolved.value) {
        optimizeError.value = 'Set a starting point first.'
        return
    }
    if (data.value.stops.length + 1 > 12) {
        optimizeError.value = 'Optimization supports up to 11 stops at a time.'
        return
    }
    optimizing.value = true
    optimizeError.value = null
    try {
        // For non-round-trip optimization, the user's LAST dragged stop
        // becomes the fixed endpoint. We feed Mapbox the stops in dragged
        // order so the destination=last pin lines up with the user's intent.
        const stopsInput = roundTrip.value
            ? data.value.stops.map((s) => ({ lng: s.sale.lng, lat: s.sale.lat }))
            : draggableStops.value.map((s) => ({ lng: s.sale.lng, lat: s.sale.lat }))
        const result = await optimizeRoute(startResolved.value, stopsInput, {
            roundTrip: roundTrip.value,
        })
        applyRouteResult(result, { reorder: true })
    } catch (e) {
        optimizeError.value = e instanceof Error ? e.message : 'Optimization failed'
    } finally {
        optimizing.value = false
    }
}

async function useMyOrder() {
    if (!data.value || draggableStops.value.length === 0) return
    if (!startResolved.value) {
        optimizeError.value = 'Set a starting point first.'
        return
    }
    optimizing.value = true
    optimizeError.value = null
    try {
        const result = await buildRouteFromOrder(
            startResolved.value,
            // Honor the order the user dragged into.
            draggableStops.value.map((s) => ({ lng: s.sale.lng, lat: s.sale.lat })),
            { roundTrip: roundTrip.value },
        )
        applyRouteResult(result, { reorder: false })
    } catch (e) {
        optimizeError.value = e instanceof Error ? e.message : 'Routing failed'
    } finally {
        optimizing.value = false
    }
}

const stopsInVisitOrder = computed(() => {
    if (!data.value) return []
    const stops = data.value.stops
    if (!optimizedOrder.value) return stops
    return optimizedOrder.value.map((i) => stops[i]).filter(Boolean) as typeof stops
})

// Keep the draggable mirror in sync with the canonical visit order.
watch(
    stopsInVisitOrder,
    (next) => {
        draggableStops.value = next.slice()
    },
    { immediate: true },
)

const stopsForMap = computed(() => stopsInVisitOrder.value.map((s) => ({ sale: s.sale })))

const visitOrderForMap = computed<number[] | null>(() =>
    // After we reorder via optimizedOrder, stopsForMap is already in visit order,
    // so the map should show 1..N as-is — pass null for natural order.
    null,
)

// ============================================================================
// Export to Maps apps
// ============================================================================
// Google Maps allows up to 9 waypoints (between origin and destination).
const GOOGLE_MAX_WAYPOINTS = 9

const mapsLinks = computed(() => {
    const stops = stopsInVisitOrder.value
    if (stops.length === 0) return null

    const stopCoords = stops.map((s) => `${s.sale.lat},${s.sale.lng}`)

    let origin: string
    let destination: string
    let waypoints: string[]

    if (startResolved.value) {
        const startStr = `${startResolved.value.lat},${startResolved.value.lng}`
        origin = startStr
        if (roundTrip.value) {
            // Round trip: end back at start, all stops as waypoints in between.
            destination = startStr
            waypoints = stopCoords
        } else {
            // One-way: end at the last stop.
            destination = stopCoords[stopCoords.length - 1]!
            waypoints = stopCoords.slice(0, -1)
        }
    } else {
        // No explicit start. Use first stop as origin.
        if (stopCoords.length < 2 && !roundTrip.value) return null
        origin = stopCoords[0]!
        if (roundTrip.value) {
            destination = stopCoords[0]!
            waypoints = stopCoords.slice(1)
        } else {
            destination = stopCoords[stopCoords.length - 1]!
            waypoints = stopCoords.slice(1, -1)
        }
    }

    const truncated = waypoints.length > GOOGLE_MAX_WAYPOINTS
    const googleWaypoints = truncated ? waypoints.slice(0, GOOGLE_MAX_WAYPOINTS) : waypoints

    const google = new URL('https://www.google.com/maps/dir/')
    google.searchParams.set('api', '1')
    google.searchParams.set('origin', origin)
    google.searchParams.set('destination', destination)
    if (googleWaypoints.length) google.searchParams.set('waypoints', googleWaypoints.join('|'))
    google.searchParams.set('travelmode', 'driving')

    const appleDaddr = [...waypoints, destination].join(' to:')
    const apple = new URL('https://maps.apple.com/')
    apple.searchParams.set('saddr', origin)
    apple.searchParams.set('daddr', appleDaddr)
    apple.searchParams.set('dirflg', 'd')

    return {
        google: google.toString(),
        apple: apple.toString(),
        truncated,
        droppedCount: waypoints.length - googleWaypoints.length,
    }
})

async function deleteRoute() {
    if (!confirm('Delete this route?')) return
    const { error } = await supabase.from('routes').delete().eq('id', id)
    if (error) {
        alert(error.message)
        return
    }
    router.push('/itineraries')
}

function fmtTime(d: Date): string {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDriveMin(seconds: number): string {
    const m = Math.round(seconds / 60)
    return m < 1 ? '<1 min' : `${m} min`
}

const routeDateLabel = computed(() => {
    if (!data.value) return ''
    return new Date(data.value.route.route_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
})
</script>

<template>
    <section class="mx-auto max-w-6xl px-4 py-6">
        <NuxtLink to="/itineraries" class="text-sm text-sky-700 hover:underline">
            ← All itineraries
        </NuxtLink>

        <div v-if="!data" class="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600">
            Route not found.
        </div>

        <template v-else>
            <div class="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 class="font-display text-3xl font-bold text-gray-900">
                        {{ data.route.name }}
                    </h1>
                    <p class="mt-1 text-gray-600">{{ routeDateLabel }}</p>
                </div>
                <button class="text-sm text-red-600 hover:underline" @click="deleteRoute">
                    Delete route
                </button>
            </div>

            <!-- Split: stops + map -->
            <div class="mt-6 grid gap-6 lg:grid-cols-[2fr_3fr]">
                <!-- LEFT: stops list -->
                <div>
                    <h2 class="font-display text-lg font-bold text-gray-900">
                        Stops ({{ data.stops.length }})
                    </h2>

                    <p v-if="stopsInVisitOrder.length > 1" class="mt-2 text-xs text-gray-500">
                        Drag stops by the <span class="font-mono">⋮⋮</span> handle to reorder.
                    </p>

                    <draggable
                        v-if="stopsInVisitOrder.length"
                        v-model="draggableStops"
                        item-key="garage_sale_id"
                        handle=".drag-handle"
                        animation="180"
                        ghost-class="drag-ghost"
                        chosen-class="drag-chosen"
                        tag="ol"
                        class="mt-3 space-y-2"
                        @end="persistDraggedOrder"
                    >
                        <template #item="{ element: stop, index: i }">
                            <li
                                class="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-orange-100"
                            >
                                <button
                                    type="button"
                                    class="drag-handle mt-1 -ml-1 cursor-grab touch-none text-gray-400 hover:text-gray-700 active:cursor-grabbing"
                                    aria-label="Drag to reorder"
                                    @click.prevent
                                >
                                    <svg
                                        class="h-5 w-5"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                    >
                                        <circle cx="7" cy="5" r="1.5" />
                                        <circle cx="13" cy="5" r="1.5" />
                                        <circle cx="7" cy="10" r="1.5" />
                                        <circle cx="13" cy="10" r="1.5" />
                                        <circle cx="7" cy="15" r="1.5" />
                                        <circle cx="13" cy="15" r="1.5" />
                                    </svg>
                                </button>
                                <span
                                    class="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
                                >
                                    {{ i + 1 }}
                                </span>
                                <div class="flex-1 min-w-0">
                                    <NuxtLink
                                        :to="`/sale/${stop.garage_sale_id}`"
                                        class="font-medium text-gray-900 hover:text-brand-600"
                                    >
                                        {{ stop.sale.title }}
                                    </NuxtLink>
                                    <div class="mt-0.5 truncate text-xs text-gray-600">
                                        {{ stop.sale.address }}
                                    </div>
                                    <div class="mt-0.5 text-xs text-gray-500">
                                        <template v-if="stop.sale.start_time || stop.sale.end_time">
                                            Open
                                            {{ formatTimeRange(stop.sale.start_time, stop.sale.end_time) }}
                                        </template>
                                    </div>
                                </div>
                                <button
                                    class="text-xs text-red-600 hover:underline"
                                    @click="removeStop(stop.garage_sale_id)"
                                >
                                    Remove
                                </button>
                            </li>
                        </template>
                    </draggable>

                    <p
                        v-else
                        class="mt-3 rounded-xl bg-white p-4 text-sm text-gray-600 ring-1 ring-orange-100"
                    >
                        No stops yet. Add some from your saved sales below.
                    </p>

                    <!-- Saved sales available on this date -->
                    <div class="mt-6">
                        <h3 class="font-display text-base font-bold text-gray-900">
                            Saved sales available on {{ routeDateLabel }}
                        </h3>
                        <ul v-if="availableSaved.length" class="mt-2 space-y-2">
                            <li
                                v-for="row in availableSaved"
                                :key="row.garage_sale_id"
                                class="flex items-start gap-3 rounded-lg bg-cream p-3"
                            >
                                <div class="flex-1 min-w-0">
                                    <div class="truncate text-sm font-medium text-gray-900">
                                        {{ row.sale.title }}
                                    </div>
                                    <div class="mt-0.5 truncate text-xs text-gray-600">
                                        {{ row.sale.address }}
                                    </div>
                                    <div
                                        v-if="row.sale.start_time || row.sale.end_time"
                                        class="mt-0.5 text-xs text-gray-500"
                                    >
                                        {{ formatTimeRange(row.sale.start_time, row.sale.end_time) }}
                                    </div>
                                </div>
                                <button
                                    class="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
                                    @click="addToRoute(row.garage_sale_id)"
                                >
                                    + Add
                                </button>
                            </li>
                        </ul>
                        <p v-else class="mt-2 text-sm text-gray-500">
                            None of your saved sales are happening that day.
                            <NuxtLink to="/browse" class="text-sky-700 hover:underline">
                                Find more on the map
                            </NuxtLink>.
                        </p>
                    </div>
                </div>

                <!-- RIGHT: map -->
                <div>
                    <ClientOnly>
                        <RouteMap
                            :stops="stopsForMap"
                            :order="visitOrderForMap"
                            :route-geometry="routeGeometry"
                            :start="startResolved"
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

            <!-- Optimize panel -->
            <section
                v-if="data.stops.length"
                class="mt-8 rounded-xl bg-white p-5 ring-1 ring-orange-100"
            >
                <h2 class="font-display text-lg font-bold text-gray-900">Build your route</h2>
                <p class="mt-1 text-sm text-gray-600">
                    <em>Use my order</em> drives the stops in the order you arranged. <em>Optimize order</em>
                    finds the shortest path through all of them. 30 min per stop.
                </p>

                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                    <!-- Start mode picker -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Start from</label>
                        <div class="mt-1 flex gap-2">
                            <button
                                type="button"
                                class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
                                :class="
                                    startMode === 'location'
                                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                "
                                @click="startMode = 'location'"
                            >
                                My location
                            </button>
                            <button
                                type="button"
                                class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
                                :class="
                                    startMode === 'address'
                                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                "
                                @click="startMode = 'address'"
                            >
                                An address
                            </button>
                        </div>
                        <div v-if="startMode === 'location'" class="mt-2">
                            <button
                                type="button"
                                class="btn-secondary !min-h-[40px]"
                                :disabled="capturingLocation"
                                @click="captureLocation"
                            >
                                <span
                                    v-if="capturingLocation"
                                    class="inline-flex items-center gap-2"
                                >
                                    <svg
                                        class="h-4 w-4 animate-spin"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <circle
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            stroke-width="4"
                                            class="opacity-25"
                                        />
                                        <path
                                            d="M4 12a8 8 0 018-8"
                                            stroke="currentColor"
                                            stroke-width="4"
                                            stroke-linecap="round"
                                            class="opacity-75"
                                        />
                                    </svg>
                                    Finding your location…
                                </span>
                                <span v-else-if="startResolved && startResolved.label === 'You'">
                                    📍 Got it
                                </span>
                                <span v-else>📍 Use my location</span>
                            </button>
                        </div>
                        <div v-else class="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                                v-model="startAddress"
                                placeholder="123 Main St, Bemidji"
                                class="input flex-1"
                                :disabled="geocodingStart"
                            />
                            <button
                                type="button"
                                class="btn-secondary !min-h-[44px] sm:w-32"
                                :disabled="geocodingStart"
                                @click="geocodeStart"
                            >
                                <span
                                    v-if="geocodingStart"
                                    class="inline-flex items-center gap-2"
                                >
                                    <svg
                                        class="h-4 w-4 animate-spin"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <circle
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            stroke-width="4"
                                            class="opacity-25"
                                        />
                                        <path
                                            d="M4 12a8 8 0 018-8"
                                            stroke="currentColor"
                                            stroke-width="4"
                                            stroke-linecap="round"
                                            class="opacity-75"
                                        />
                                    </svg>
                                    Finding…
                                </span>
                                <span v-else>Set start</span>
                            </button>
                        </div>
                        <div v-if="startResolved" class="mt-2 space-y-1 text-xs">
                            <p class="text-gray-700">
                                ✓ Starting from
                                <strong>
                                    {{
                                        startResolved.label === 'You'
                                            ? startAddressLabel || 'your current location'
                                            : startAddress
                                    }}
                                </strong>
                            </p>
                            <p
                                v-if="startResolved.label === 'You' && startAddressLabel"
                                class="text-gray-500"
                            >
                                If that doesn't look right, switch to <em>An address</em> and type
                                where you actually are — browser location can pick up an ISP edge
                                instead of you.
                            </p>
                        </div>
                    </div>

                    <!-- Departure time -->
                    <div>
                        <label class="block text-sm font-medium text-gray-700" for="departure">
                            Departure time
                        </label>
                        <input
                            id="departure"
                            v-model="departureTime"
                            type="time"
                            class="input mt-1"
                        />
                        <p class="mt-1 text-xs text-gray-500">
                            Used for the timeline. Default 8:00 AM.
                        </p>
                    </div>
                </div>

                <label class="mt-4 flex cursor-pointer items-start gap-2 text-sm">
                    <input
                        v-model="roundTrip"
                        type="checkbox"
                        class="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                    />
                    <span>
                        <span class="font-medium text-gray-900">Return to start</span>
                        <span class="block text-xs text-gray-500">
                            Round trip — drive home after the last stop. Uncheck to end at the last
                            stop in your dragged order instead.
                        </span>
                    </span>
                </label>

                <p
                    v-if="optimizeError"
                    class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                    {{ optimizeError }}
                </p>

                <div class="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        class="btn-secondary"
                        :disabled="optimizing || !startResolved || data.stops.length === 0"
                        @click="useMyOrder"
                    >
                        {{ optimizing ? 'Building…' : '📋 Use my order' }}
                    </button>
                    <button
                        type="button"
                        class="btn-primary"
                        :disabled="optimizing || !startResolved || data.stops.length === 0"
                        @click="optimize"
                    >
                        {{ optimizing ? 'Optimizing…' : '🧭 Optimize order' }}
                    </button>
                    <p
                        v-if="totalDistanceMi !== null && totalDriveMin !== null"
                        class="text-sm text-gray-700"
                    >
                        {{ totalDistanceMi.toFixed(1) }} mi driving
                        · ~{{ Math.round(totalDriveMin) }} min total drive time
                    </p>
                </div>

                <!-- Export to Maps apps -->
                <div v-if="mapsLinks" class="mt-5 border-t border-orange-100 pt-4">
                    <h3 class="font-display text-base font-bold text-gray-900">Start navigating</h3>
                    <p class="mt-1 text-sm text-gray-600">
                        Open your route in a maps app to drive turn-by-turn.
                    </p>
                    <div class="mt-3 flex flex-wrap gap-2">
                        <a
                            :href="mapsLinks.google"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-sky-600"
                        >
                            🗺️ Open in Google Maps
                        </a>
                        <a
                            :href="mapsLinks.apple"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50"
                        >
                            🍎 Open in Apple Maps
                        </a>
                    </div>
                    <p
                        v-if="mapsLinks.truncated"
                        class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    >
                        Heads up: Google Maps caps direction links at 9 stops between start and end.
                        The last {{ mapsLinks.droppedCount }} stop(s) won't appear in Google's link.
                        Apple Maps handles all of them.
                    </p>
                </div>

                <!-- Timeline -->
                <div v-if="timeline" class="mt-6">
                    <h3 class="font-display text-base font-bold text-gray-900">Timeline</h3>
                    <ol class="mt-3 space-y-2">
                        <li
                            v-for="(entry, i) in timeline"
                            :key="i"
                            class="flex items-start gap-3 rounded-lg bg-cream p-3"
                        >
                            <span
                                class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
                            >
                                {{ i + 1 }}
                            </span>
                            <div class="flex-1 min-w-0">
                                <div class="flex flex-wrap items-baseline justify-between gap-2">
                                    <span class="font-medium text-gray-900">
                                        {{ stopsInVisitOrder[i]?.sale.title }}
                                    </span>
                                    <span class="text-xs text-gray-500">
                                        Drive {{ fmtDriveMin(entry.drivingSecondsFromPrev) }}
                                    </span>
                                </div>
                                <div class="mt-0.5 text-sm text-gray-700">
                                    Arrive {{ fmtTime(entry.arriveAt) }}
                                    · leave {{ fmtTime(entry.departAt) }}
                                </div>
                            </div>
                        </li>
                        <li
                            v-if="returnLegMin !== null"
                            class="flex items-start gap-3 rounded-lg bg-sky-50 p-3 ring-1 ring-sky-100"
                        >
                            <span
                                class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-sm font-bold text-white"
                            >
                                🏠
                            </span>
                            <div class="flex-1 min-w-0">
                                <div class="flex flex-wrap items-baseline justify-between gap-2">
                                    <span class="font-medium text-gray-900">
                                        Drive home
                                    </span>
                                    <span class="text-xs text-gray-500">
                                        {{ Math.round(returnLegMin) }} min
                                    </span>
                                </div>
                                <div v-if="arriveHomeAt" class="mt-0.5 text-sm text-gray-700">
                                    Arrive home {{ fmtTime(arriveHomeAt) }}
                                </div>
                                <div class="mt-0.5 text-xs text-gray-600">
                                    Round trip back to your start point
                                </div>
                            </div>
                        </li>
                    </ol>
                </div>
            </section>
        </template>
    </section>
</template>
