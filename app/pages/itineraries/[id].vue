<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'
import type { RouteStop } from '~/composables/useRoutes'
import type { EndMode, OptimizedRoute, RouteEnd } from '~/composables/useRouteOptimizer'
import draggable from 'vuedraggable'

const route = useRoute()
const supabase = useSupabaseClient()
const router = useRouter()

const id = route.params.id as string

const config = useRuntimeConfig()
const toast = useToast()
const { confirm } = useConfirm()

// Two-way sync between the saved-sale cards and their map pins.
const selectedAvailableId = ref<string | null>(null)
const hoveredAvailableId = ref<string | null>(null)

function selectAvailable(saleId: string) {
    selectedAvailableId.value = saleId
}
function onHoverAvailable(saleId: string | null) {
    hoveredAvailableId.value = saleId
}
function clearAvailableSelection() {
    selectedAvailableId.value = null
    hoveredAvailableId.value = null
}

// ============================================================================
// Data
// ============================================================================
const { data, refresh } = await useAsyncData(`route-${id}`, async () => {
    const result = await fetchRouteWithStops(id)
    if (!result) {
        throw createError({ statusCode: 404, statusMessage: 'Route not found' })
    }
    return result
})

const { data: savedSales, refresh: refreshSaved } = await useAsyncData(
    'route-saved-sales',
    () => fetchSavedSalesWithDetails(),
)

// Saved sales available on this route's date that haven't been added yet.
// Removed (soft-deleted) sales are excluded — you can't add a tombstone to a
// route. Existing route stops that became tombstones still render with a
// "removed" notice (see template) and are skipped in route calculations.
//
// "Available on this date" uses per-day matching against `sale_dates`,
// not the envelope — a sale with non-contiguous days (Weekend 1 + 2)
// shouldn't appear as available on the gap days inside its envelope.
const availableSaved = computed(() => {
    if (!data.value) return []
    const inRoute = new Set(data.value.stops.map((s) => s.garage_sale_id))
    const day = data.value.route.route_date
    return (savedSales.value ?? [])
        .filter((row) => !inRoute.has(row.garage_sale_id))
        .filter((row) => !isRemovedSale(row.sale))
        .filter((row) => findSaleDateOn(row.sale, day) !== null)
})

// Just the GarageSale objects for the map's available-pin prop, memoized so
// the prop reference is stable between renders (otherwise the deep watcher
// in RouteMap tears down + recreates markers on every reactive update,
// which kills the user's hover state).
const availableSales = computed(() => availableSaved.value.map((row) => row.sale))

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
        toast.error(error.message)
        return
    }
    invalidateOptimization()
    await refresh()
}

async function removeStop(saleId: string) {
    const ok = await confirm({
        title: 'Remove this stop?',
        description: "It'll come out of the route order. You can re-add it from your saved sales.",
        confirmText: 'Remove',
        tone: 'danger',
    })
    if (!ok) return
    const { error } = await supabase
        .from('route_stops')
        .delete()
        .eq('route_id', id)
        .eq('garage_sale_id', saleId)
    if (error) {
        toast.error(error.message)
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
        toast.error(error.message)
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

// End-location state. Backed by the route row's end_mode / end_address /
// end_lat / end_lng columns so the choice persists across reloads and the
// share page reflects it. Default 'round_trip' for legacy rows.
const endMode = ref<EndMode>(data.value?.route.end_mode ?? 'round_trip')
const endAddress = ref(data.value?.route.end_address ?? '')
const endResolved = ref<{ lng: number; lat: number } | null>(
    data.value?.route.end_lat != null && data.value?.route.end_lng != null
        ? { lng: data.value.route.end_lng, lat: data.value.route.end_lat }
        : null,
)
const geocodingEnd = ref(false)

const optimizedOrder = ref<number[] | null>(null)
const routeGeometry = ref<GeoJSON.LineString | null>(null)
const totalDistanceMi = ref<number | null>(null)
const totalDriveMin = ref<number | null>(null)
const timeline = ref<TimelineEntry[] | null>(null)
// Trailing-leg duration: drive home (round trip) OR drive to custom end.
const returnLegMin = ref<number | null>(null)
const endLegMin = ref<number | null>(null)
const trailingArriveAt = ref<Date | null>(null)

const optimizing = ref(false)
const optimizeError = ref<string | null>(null)

function invalidateOptimization() {
    optimizedOrder.value = null
    routeGeometry.value = null
    totalDistanceMi.value = null
    totalDriveMin.value = null
    timeline.value = null
    returnLegMin.value = null
    endLegMin.value = null
    trailingArriveAt.value = null
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

async function geocodeEnd() {
    optimizeError.value = null
    if (!endAddress.value.trim()) {
        optimizeError.value = 'Enter an end address.'
        return
    }
    geocodingEnd.value = true
    try {
        const result = await geocodeAddress(endAddress.value.trim())
        if (!result) {
            optimizeError.value = "Couldn't find that end address."
            endResolved.value = null
            return
        }
        endResolved.value = { lng: result.lng, lat: result.lat }
        endAddress.value = result.address
        invalidateOptimization()
        await persistEndChoice()
    } catch (e) {
        optimizeError.value = e instanceof Error ? e.message : 'Geocoding failed'
    } finally {
        geocodingEnd.value = false
    }
}

async function setEndMode(mode: EndMode) {
    if (endMode.value === mode) return
    endMode.value = mode
    invalidateOptimization()
    await persistEndChoice()
}

/**
 * Push the current end choice to the DB. Eager so a refresh / share-link
 * visitor sees the latest decision; we don't bother optimistically reverting
 * on failure (the user can re-pick — local state remains usable).
 */
async function persistEndChoice() {
    if (!data.value) return
    // The routes_end_address_coords_check constraint rejects rows where
    // end_mode = 'address' without end_lat/end_lng. Selecting the pill
    // before entering an address is a valid intermediate UI state, so
    // skip the save until geocodeEnd() has resolved coords.
    if (endMode.value === 'address' && !endResolved.value) return
    const payload = {
        end_mode: endMode.value,
        end_address: endMode.value === 'address' ? endAddress.value || null : null,
        end_lat: endMode.value === 'address' && endResolved.value ? endResolved.value.lat : null,
        end_lng: endMode.value === 'address' && endResolved.value ? endResolved.value.lng : null,
    }
    const { error } = await supabase.from('routes').update(payload).eq('id', id)
    if (error) {
        toast.error(`Couldn't save end choice: ${error.message}`)
    }
}

/** Translate the local UI state into the optimizer's RouteEnd contract. */
function currentRouteEnd(): RouteEnd {
    if (endMode.value === 'address') {
        if (!endResolved.value) throw new Error('Set the end address first.')
        return { mode: 'address', coord: endResolved.value }
    }
    return { mode: endMode.value }
}

function applyRouteResult(result: OptimizedRoute, opts: { reorder: boolean }) {
    optimizedOrder.value = opts.reorder ? result.stopOrder : null
    routeGeometry.value = result.geometry
    totalDistanceMi.value = result.distanceMeters / 1609.344
    totalDriveMin.value = result.durationSeconds / 60
    returnLegMin.value = result.returnLeg ? result.returnLeg.durationSeconds / 60 : null
    endLegMin.value = result.endLeg ? result.endLeg.durationSeconds / 60 : null

    const [hh, mm] = departureTime.value.split(':').map(Number)
    const departure = new Date(data.value!.route.route_date + 'T00:00:00')
    departure.setHours(hh ?? 8, mm ?? 0, 0, 0)
    // Use stopLegs (excludes the trailing leg) so the timeline only shows
    // arrivals at actual stops.
    timeline.value = buildTimeline(result.stopLegs, departure, 30)

    // Trailing-leg arrival: arrival back home (round trip) OR arrival at the
    // custom end address. Only one of returnLeg / endLeg is ever non-null.
    const trailing = result.returnLeg ?? result.endLeg
    if (trailing && timeline.value.length > 0) {
        const lastStop = timeline.value[timeline.value.length - 1]!
        trailingArriveAt.value = new Date(
            lastStop.departAt.getTime() + trailing.durationSeconds * 1000,
        )
    } else {
        trailingArriveAt.value = null
    }
}

// Stops minus any tombstones (sales the owner soft-deleted). We keep
// tombstones in the visible list so the user sees what was removed,
// but exclude them from every routing / mapping calculation —
// optimizer, directions, Google/Apple Maps export, drive timeline.
const activeStopsInOrder = computed(() =>
    (data.value?.stops ?? []).filter((s) => !isRemovedSale(s.sale)),
)
const activeDraggable = computed(() =>
    draggableStops.value.filter((s) => !isRemovedSale(s.sale)),
)

// Mapbox Optimization v1 caps coords at 12. When the end is a custom
// address we burn one coord for it, so the stop cap drops from 11 to 10.
const optimizeStopCap = computed(() => (endMode.value === 'address' ? 10 : 11))

async function optimize() {
    if (!data.value || activeStopsInOrder.value.length === 0) return
    if (!startResolved.value) {
        optimizeError.value = 'Set a starting point first.'
        return
    }
    if (endMode.value === 'address' && !endResolved.value) {
        optimizeError.value = 'Set the end address first.'
        return
    }
    if (activeStopsInOrder.value.length > optimizeStopCap.value) {
        optimizeError.value = `Optimization supports up to ${optimizeStopCap.value} stops with this end choice.`
        return
    }
    optimizing.value = true
    optimizeError.value = null
    try {
        // For 'last_stop' optimization, the user's LAST dragged stop becomes
        // the fixed endpoint — feed Mapbox the stops in dragged order so
        // destination=last lines up with intent. Round-trip and address
        // modes don't care about input order.
        const inputStops =
            endMode.value === 'last_stop' ? activeDraggable.value : activeStopsInOrder.value
        // Track which full-stops index each active input index corresponds
        // to so we can map Mapbox's active-relative result.stopOrder back
        // to indices in `data.value.stops` (which still contains tombstones).
        const fullIdxFor = inputStops.map((s) =>
            data.value!.stops.findIndex((fs) => fs.garage_sale_id === s.garage_sale_id),
        )
        const stopsInput = inputStops.map((s) => ({ lng: s.sale.lng, lat: s.sale.lat }))
        const result = await optimizeRoute(startResolved.value, stopsInput, currentRouteEnd())
        const activeOrderFullIdx = result.stopOrder.map((i) => fullIdxFor[i]!)
        const tombstoneFullIdx = data.value!.stops
            .map((s, i) => (isRemovedSale(s.sale) ? i : -1))
            .filter((i) => i >= 0)
        applyRouteResult(
            { ...result, stopOrder: [...activeOrderFullIdx, ...tombstoneFullIdx] },
            { reorder: true },
        )
    } catch (e) {
        optimizeError.value = e instanceof Error ? e.message : 'Optimization failed'
    } finally {
        optimizing.value = false
    }
}

async function useMyOrder() {
    if (!data.value || activeDraggable.value.length === 0) return
    if (!startResolved.value) {
        optimizeError.value = 'Set a starting point first.'
        return
    }
    if (endMode.value === 'address' && !endResolved.value) {
        optimizeError.value = 'Set the end address first.'
        return
    }
    optimizing.value = true
    optimizeError.value = null
    try {
        const result = await buildRouteFromOrder(
            startResolved.value,
            // Honor the order the user dragged into.
            activeDraggable.value.map((s) => ({ lng: s.sale.lng, lat: s.sale.lat })),
            currentRouteEnd(),
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

// Same as stopsInVisitOrder but with tombstones filtered out — what the
// timeline corresponds to. Mapbox's `result.stopLegs` only has entries
// for the active stops we sent in, so timeline[i] aligns with the i-th
// active stop in visit order, not the i-th overall stop.
const routedStopsInOrder = computed(() =>
    stopsInVisitOrder.value.filter((s) => !isRemovedSale(s.sale)),
)

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
// `GOOGLE_MAX_WAYPOINTS` is exported from useRouteOptimizer so this and
// /share/[id] share one source of truth for Google's deep-link cap.

const mapsLinks = computed(() => {
    // Map exports only navigate to active stops — tombstones have no
    // valid destination since the listing was removed.
    const stops = stopsInVisitOrder.value.filter((s) => !isRemovedSale(s.sale))
    if (stops.length === 0) return null

    const stopCoords = stops.map((s) => `${s.sale.lat},${s.sale.lng}`)
    const endCoord = endResolved.value
        ? `${endResolved.value.lat},${endResolved.value.lng}`
        : null

    let origin: string
    let destination: string
    let waypoints: string[]

    if (startResolved.value) {
        const startStr = `${startResolved.value.lat},${startResolved.value.lng}`
        origin = startStr
        if (endMode.value === 'round_trip') {
            // Round trip: end back at start, all stops as waypoints in between.
            destination = startStr
            waypoints = stopCoords
        } else if (endMode.value === 'address' && endCoord) {
            // End at user-supplied address: all stops are waypoints leading there.
            destination = endCoord
            waypoints = stopCoords
        } else {
            // End at the last stop.
            destination = stopCoords[stopCoords.length - 1]!
            waypoints = stopCoords.slice(0, -1)
        }
    } else {
        // No explicit start. Fall back to using the first stop as origin.
        origin = stopCoords[0]!
        if (endMode.value === 'address' && endCoord) {
            destination = endCoord
            waypoints = stopCoords.slice(1)
        } else if (endMode.value === 'round_trip') {
            if (stopCoords.length < 2) return null
            destination = stopCoords[0]!
            waypoints = stopCoords.slice(1)
        } else {
            if (stopCoords.length < 2) return null
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

    // Apple Maps' URL scheme only supports a single daddr (the +to: chain
    // is a Google convention Apple has never implemented), so route to just
    // the first stop after the origin. The template warns when this means
    // dropping later stops from the Apple link.
    const appleFirstStop = waypoints[0] ?? destination
    const apple = new URL('https://maps.apple.com/')
    apple.searchParams.set('saddr', origin)
    apple.searchParams.set('daddr', appleFirstStop)
    apple.searchParams.set('dirflg', 'd')

    return {
        google: google.toString(),
        apple: apple.toString(),
        truncated,
        droppedCount: waypoints.length - googleWaypoints.length,
        appleFirstStopOnly: waypoints.length > 0,
    }
})

/**
 * Open a Maps deep-link with a per-click cache-buster appended. Without
 * this, mobile OSes (and to a lesser extent desktop Google Maps tabs) tend
 * to recognize an identical URI and refresh the *previous* navigation
 * activity instead of routing the new params — so a user who tweaks the
 * route and re-taps "Open in Google Maps" sees the old route. Appending
 * `_t=<timestamp>` makes every click a distinct URI from the OS's POV.
 * Unknown params are ignored by Google/Apple Maps.
 */
function openInMaps(url: string) {
    const sep = url.includes('?') ? '&' : '?'
    window.open(`${url}${sep}_t=${Date.now()}`, '_blank', 'noopener,noreferrer')
}

async function deleteRoute() {
    const ok = await confirm({
        title: 'Delete this route?',
        description: 'This cannot be undone.',
        confirmText: 'Delete',
        tone: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('routes').delete().eq('id', id)
    if (error) {
        toast.error(error.message)
        return
    }
    toast.success('Route deleted.')
    router.push('/itineraries')
}

// =============================================================================
// Public sharing
// =============================================================================
const shareUrl = computed(() => `${config.public.siteUrl}/share/${id}`)
const shareCopied = ref(false)
const togglingPublic = ref(false)

async function togglePublic() {
    if (!data.value || togglingPublic.value) return
    togglingPublic.value = true
    const next = !data.value.route.is_public
    const { error } = await supabase
        .from('routes')
        .update({ is_public: next })
        .eq('id', id)
    if (error) {
        togglingPublic.value = false
        toast.error(error.message)
        return
    }
    // Refetch to pick up the canonical state instead of mutating
    // data.value.route.is_public directly — that mutation would race
    // with any concurrent refresh() and could be silently clobbered.
    await refresh()
    togglingPublic.value = false
    if (next) toast.success('Route is now public — share the link!')
}

async function copyShareLink() {
    try {
        await navigator.clipboard.writeText(shareUrl.value)
        shareCopied.value = true
        setTimeout(() => (shareCopied.value = false), 2000)
    } catch {
        window.prompt('Copy this link:', shareUrl.value)
    }
}

function fmtTime(d: Date): string {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDriveMin(seconds: number): string {
    const m = Math.round(seconds / 60)
    return m < 1 ? '<1 min' : `${m} min`
}

/**
 * The sale's hours specifically on this route's date — falls back to
 * the envelope when the sale predates 0018 or has no row for this day
 * (shouldn't happen given `availableSaved` filters by per-day match,
 * but guards the existing-stops path where a sale's schedule may have
 * shifted after the stop was added).
 */
function stopHoursOn(sale: GarageSale): string {
    if (!data.value) return ''
    const row = findSaleDateOn(sale, data.value.route.route_date)
    if (row) return formatTimeRange(row.start_time, row.end_time)
    return formatTimeRange(sale.start_time, sale.end_time)
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

            <!-- Share -->
            <section class="mt-4 rounded-xl bg-white p-4 ring-1 ring-orange-100">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="flex-1">
                        <h2 class="font-display text-base font-bold text-gray-900">
                            Share this route
                        </h2>
                        <p class="mt-1 text-sm text-gray-600">
                            <template v-if="data.route.is_public">
                                Public — anyone with the link can view this route (read-only).
                            </template>
                            <template v-else>
                                Make it public to share the link with friends or family.
                            </template>
                        </p>
                    </div>
                    <button
                        type="button"
                        class="rounded-lg border px-3 py-1.5 text-sm font-semibold transition"
                        :class="
                            data.route.is_public
                                ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                : 'border-brand-500 bg-brand-500 text-white hover:bg-brand-600'
                        "
                        :disabled="togglingPublic"
                        @click="togglePublic"
                    >
                        {{
                            togglingPublic
                                ? 'Saving…'
                                : data.route.is_public
                                  ? 'Make private'
                                  : 'Make public'
                        }}
                    </button>
                </div>
                <div
                    v-if="data.route.is_public"
                    class="mt-3 flex flex-col gap-2 sm:flex-row"
                >
                    <input
                        :value="shareUrl"
                        readonly
                        class="input flex-1 !min-h-[40px] !text-sm"
                        @focus="($event.target as HTMLInputElement).select()"
                    />
                    <button
                        type="button"
                        class="btn-secondary !min-h-[40px] !px-4 !py-2 text-sm sm:w-32"
                        @click="copyShareLink"
                    >
                        {{ shareCopied ? '✓ Copied' : 'Copy link' }}
                    </button>
                </div>
            </section>

            <!-- Split: stops + map -->
            <div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
                <!-- LEFT: stops list -->
                <div>
                    <h2 class="font-display text-lg font-bold text-gray-900">
                        Stops ({{ data.stops.length }})
                    </h2>

                    <p v-if="stopsInVisitOrder.length > 1" class="mt-2 text-xs text-gray-500">
                        Drag stops by the <span class="font-mono">⋮⋮</span> handle to reorder.
                    </p>

                    <!-- Preemptive caps so users don't discover the limits at
                         the moment they tap Optimize / Export. Mapbox v1
                         maxes out at 11 stops; Google's dir/?waypoints=
                         deep-link tops out at 9. -->
                    <p
                        v-if="activeStopsInOrder.length > optimizeStopCap"
                        class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
                    >
                        ⚠ {{ activeStopsInOrder.length }} stops — Optimize Order
                        only supports {{ optimizeStopCap }} with the current end choice.
                        Remove {{ activeStopsInOrder.length - optimizeStopCap }} to use it.
                    </p>
                    <p
                        v-else-if="activeStopsInOrder.length > 9"
                        class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    >
                        Heads up: Google Maps export caps at 9 waypoints, so
                        the last {{ activeStopsInOrder.length - 9 }} stop{{
                            activeStopsInOrder.length - 9 === 1 ? '' : 's'
                        }} will be dropped from the deep-link.
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
                                class="flex items-start gap-3 rounded-xl p-3 ring-1"
                                :class="saleRowToneClasses(stop.sale)"
                            >
                                <button
                                    type="button"
                                    class="drag-handle -ml-1 flex h-11 w-9 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
                                    aria-label="Drag to reorder"
                                    @click.prevent
                                >
                                    <svg
                                        class="h-6 w-6"
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
                                    class="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                                    :class="
                                        isRemovedSale(stop.sale)
                                            ? 'bg-red-400'
                                            : isExpiredSale(stop.sale)
                                                ? 'bg-yellow-500'
                                                : 'bg-brand-500'
                                    "
                                >
                                    {{ i + 1 }}
                                </span>
                                <div class="flex-1 min-w-0">
                                    <p
                                        v-if="isRemovedSale(stop.sale)"
                                        class="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700"
                                    >
                                        ⚠ Removed by the owner — skipped on this route
                                    </p>
                                    <p
                                        v-else-if="isExpiredSale(stop.sale)"
                                        class="mb-1 text-xs font-semibold uppercase tracking-wide text-yellow-800"
                                    >
                                        ⏳ This sale has ended
                                    </p>
                                    <NuxtLink
                                        v-if="!isRemovedSale(stop.sale)"
                                        :to="`/sale/${stop.garage_sale_id}`"
                                        class="font-medium hover:text-brand-600"
                                        :class="
                                            isExpiredSale(stop.sale)
                                                ? 'text-gray-700 line-through'
                                                : 'text-gray-900'
                                        "
                                    >
                                        {{ stop.sale.title }}
                                    </NuxtLink>
                                    <span
                                        v-else
                                        class="font-medium text-gray-700 line-through"
                                    >
                                        {{ stop.sale.title }}
                                    </span>
                                    <div class="mt-0.5 truncate text-xs text-gray-600">
                                        {{ stop.sale.address }}
                                    </div>
                                    <div class="mt-0.5 text-xs text-gray-500">
                                        <template v-if="stopHoursOn(stop.sale)">
                                            Open {{ stopHoursOn(stop.sale) }}
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
                        <p
                            v-if="availableSaved.length"
                            class="mt-1 text-xs text-gray-500"
                        >
                            Tap a card to highlight it on the map.
                        </p>
                        <div v-if="availableSaved.length" class="mt-3 space-y-2">
                            <BrowseSaleCard
                                v-for="row in availableSaved"
                                :key="row.garage_sale_id"
                                :sale="row.sale"
                                :selected="
                                    selectedAvailableId === row.garage_sale_id ||
                                    hoveredAvailableId === row.garage_sale_id
                                "
                                @select="selectAvailable"
                                @hover="onHoverAvailable"
                            >
                                <template #action>
                                    <button
                                        type="button"
                                        class="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
                                        @click="addToRoute(row.garage_sale_id)"
                                    >
                                        + Add to route
                                    </button>
                                </template>
                            </BrowseSaleCard>
                        </div>
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
                        <LazyRouteMap
                            :stops="stopsForMap"
                            :order="visitOrderForMap"
                            :route-geometry="routeGeometry"
                            :start="startResolved"
                            :end="endMode === 'address' && endResolved ? { lng: endResolved.lng, lat: endResolved.lat, label: 'End' } : null"
                            :available="availableSales"
                            :selected-available-id="selectedAvailableId"
                            :hovered-available-id="hoveredAvailableId"
                            @select-available="selectAvailable"
                            @hover-available="onHoverAvailable"
                            @clear-available="clearAvailableSelection"
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

                <!--
                  Stop-count caps by feature. These limits come from the upstream APIs
                  (Mapbox Optimization v1, Mapbox Directions v5, Google Maps deep-link
                  param), not from our own code — so they're worth surfacing up front
                  rather than waiting for the user to discover them at click time. The
                  "Use my order" / "Optimize order" caps shift by 1 when ending at a
                  custom address (the end coord burns one slot in the Mapbox call).
                -->
                <details class="mt-3 rounded-lg bg-cream/60 px-4 py-3 text-sm ring-1 ring-orange-100">
                    <summary class="cursor-pointer font-medium text-gray-800">
                        Stop limits by feature
                    </summary>
                    <ul class="mt-2 space-y-1.5 text-xs text-gray-700">
                        <li>
                            💾 <strong>Save to your list</strong> — no limit. Add as
                            many sales as you want to a route.
                        </li>
                        <li>
                            📋 <strong>Use my order</strong> — up to
                            {{ endMode === 'address' ? 23 : 24 }} stops
                            ({{ endMode === 'address' ? '23 with' : '24 without' }} a
                            custom end address).
                        </li>
                        <li>
                            🧭 <strong>Optimize order</strong> — up to
                            {{ optimizeStopCap }} stops
                            ({{ endMode === 'address' ? '10 with' : '11 without' }} a
                            custom end address).
                        </li>
                        <li>
                            🗺️ <strong>Open in Google Maps</strong> — up to 9 stops
                            between your start and end. Extra stops get dropped from
                            the link (we show a warning when this happens).
                        </li>
                        <li>
                            🍎 <strong>Open in Apple Maps</strong> — first stop only.
                            Apple's URL scheme doesn't support multi-stop deep links, so the button
                            routes from your start to the first stop. Use Google Maps for the full
                            multi-stop route.
                        </li>
                    </ul>
                </details>

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
                                    📍 Refind my location
                                </span>
                                <span v-else>📍 Use my location</span>
                            </button>
                        </div>
                        <div v-else class="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                                v-model="startAddress"
                                placeholder="123 Main St, City, State"
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

                <div class="mt-4">
                    <label class="block text-sm font-medium text-gray-700">End at</label>
                    <div class="mt-1 flex flex-wrap gap-2">
                        <button
                            type="button"
                            class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
                            :class="
                                endMode === 'round_trip'
                                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            "
                            @click="setEndMode('round_trip')"
                        >
                            🏠 Round trip
                        </button>
                        <button
                            type="button"
                            class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
                            :class="
                                endMode === 'last_stop'
                                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            "
                            @click="setEndMode('last_stop')"
                        >
                            🏁 Last sale
                        </button>
                        <button
                            type="button"
                            class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
                            :class="
                                endMode === 'address'
                                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            "
                            @click="setEndMode('address')"
                        >
                            📍 An address
                        </button>
                    </div>
                    <p class="mt-1 text-xs text-gray-500">
                        <template v-if="endMode === 'round_trip'">
                            Drive home after the last stop — back to your starting point.
                        </template>
                        <template v-else-if="endMode === 'last_stop'">
                            End at whichever sale is last in your dragged order. Optimize Order
                            keeps it pinned as the final stop.
                        </template>
                        <template v-else>
                            Drive to a specific address after the last sale — e.g. someone's
                            house, the office, a different city.
                        </template>
                    </p>
                    <div v-if="endMode === 'address'" class="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                            v-model="endAddress"
                            placeholder="123 Main St, City, State"
                            class="input flex-1"
                            :disabled="geocodingEnd"
                            @keydown.enter.prevent="geocodeEnd"
                        />
                        <button
                            type="button"
                            class="btn-secondary !min-h-[44px] sm:w-32"
                            :disabled="geocodingEnd"
                            @click="geocodeEnd"
                        >
                            <span
                                v-if="geocodingEnd"
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
                            <span v-else>Set end</span>
                        </button>
                    </div>
                    <p
                        v-if="endMode === 'address' && endResolved"
                        class="mt-2 text-xs text-gray-700"
                    >
                        ✓ Ending at <strong>{{ endAddress }}</strong>
                    </p>
                </div>

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
                        :disabled="optimizing || !startResolved || activeStopsInOrder.length === 0"
                        @click="useMyOrder"
                    >
                        {{ optimizing ? 'Building…' : '📋 Use my order' }}
                    </button>
                    <button
                        type="button"
                        class="btn-primary"
                        :disabled="optimizing || !startResolved || activeStopsInOrder.length === 0"
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
                        <!--
                          We keep <a href> for right-click "Open in new tab"
                          accessibility (the static href still works), but
                          intercept left-click to append a per-click cache
                          buster — without it, mobile Maps apps tend to
                          re-show the previously-opened route instead of
                          re-parsing the new params after a route edit.
                        -->
                        <a
                            :href="mapsLinks.google"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-sky-600"
                            @click.prevent="openInMaps(mapsLinks.google)"
                        >
                            🗺️ Open in Google Maps
                        </a>
                        <a
                            :href="mapsLinks.apple"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50"
                            @click.prevent="openInMaps(mapsLinks.apple)"
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
                    </p>
                    <p
                        v-if="mapsLinks.appleFirstStopOnly"
                        class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    >
                        Apple Maps deep links only support one destination, so the 🍎 button routes
                        to your first stop only. Use Google Maps to navigate the full route.
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
                                        {{ routedStopsInOrder[i]?.sale.title }}
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
                            v-if="returnLegMin !== null || endLegMin !== null"
                            class="flex items-start gap-3 rounded-lg bg-sky-50 p-3 ring-1 ring-sky-100"
                        >
                            <span
                                class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-sm font-bold text-white"
                            >
                                {{ returnLegMin !== null ? '🏠' : '🏁' }}
                            </span>
                            <div class="flex-1 min-w-0">
                                <div class="flex flex-wrap items-baseline justify-between gap-2">
                                    <span class="font-medium text-gray-900">
                                        {{ returnLegMin !== null ? 'Drive home' : 'Drive to end' }}
                                    </span>
                                    <span class="text-xs text-gray-500">
                                        {{
                                            Math.round((returnLegMin ?? endLegMin) as number)
                                        }} min
                                    </span>
                                </div>
                                <div
                                    v-if="trailingArriveAt"
                                    class="mt-0.5 text-sm text-gray-700"
                                >
                                    Arrive {{ fmtTime(trailingArriveAt) }}
                                </div>
                                <div class="mt-0.5 text-xs text-gray-600">
                                    <template v-if="returnLegMin !== null">
                                        Round trip back to your start point
                                    </template>
                                    <template v-else>
                                        {{ endAddress || 'Your custom end address' }}
                                    </template>
                                </div>
                            </div>
                        </li>
                    </ol>
                </div>
            </section>
        </template>
    </section>
</template>
