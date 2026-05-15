/**
 * Google Maps' "directions" deep-link (`/maps/dir/?api=1&waypoints=…`)
 * accepts at most 9 waypoints between the origin and the destination.
 * Apple Maps has no comparable cap. Both `/itineraries/[id]` and
 * `/share/[id]` build these links — keep the cap in one place so a
 * Google policy change is a one-line edit.
 */
export const GOOGLE_MAX_WAYPOINTS = 9

export type EndMode = 'round_trip' | 'last_stop' | 'address'

export interface RouteEnd {
    mode: EndMode
    /** Required when mode === 'address'. */
    coord?: { lng: number; lat: number }
}

export interface OptimizedLeg {
    distanceMeters: number
    durationSeconds: number
}

export interface OptimizedRoute {
    /** Order to visit the input stops, expressed as input indices (excludes the start point). */
    stopOrder: number[]
    /** GeoJSON LineString of the driving route. */
    geometry: GeoJSON.LineString
    /** Total distance in meters. */
    distanceMeters: number
    /** Total duration in seconds. */
    durationSeconds: number
    /**
     * Per-leg drive segments in optimized order.
     * legs[0] = start → first stop, legs[1] = first stop → second stop, …
     * For a round-trip optimize or a custom-end optimize, the final entry
     * is the trailing leg (separated from `stopLegs` for convenience).
     */
    legs: OptimizedLeg[]
    /** Just the legs that lead INTO each stop (excludes the return/end leg). */
    stopLegs: OptimizedLeg[]
    /** Drive time + distance back to the start. Non-null iff end.mode === 'round_trip'. */
    returnLeg: OptimizedLeg | null
    /** Drive time + distance to a custom end address. Non-null iff end.mode === 'address'. */
    endLeg: OptimizedLeg | null
}

/**
 * Solve a TSP-style optimal route from `start` through all `stops`.
 * Uses Mapbox Optimization API v1 (driving profile).
 *
 * `end.mode`:
 *   - 'round_trip' (default): drive returns to the start point. All stops are reorderable.
 *   - 'last_stop':            open trip — the LAST input stop is fixed as the destination,
 *                             middle stops are reordered. (Mapbox v1 doesn't allow
 *                             `destination=any` with `roundtrip=false`, so we pin to
 *                             the user's last dragged stop.)
 *   - 'address':              open trip — the user-supplied end coord becomes the fixed
 *                             destination. All stops are reorderable; the end coord is
 *                             appended as an extra waypoint and pinned via destination=last.
 *
 * Mapbox cap: 12 coordinates total. That's start + 11 stops (round_trip/last_stop)
 * or start + 10 stops + end (address mode).
 */
export async function optimizeRoute(
    start: { lng: number; lat: number },
    stops: { lng: number; lat: number }[],
    end: RouteEnd = { mode: 'round_trip' },
): Promise<OptimizedRoute> {
    if (stops.length === 0) throw new Error('Need at least one stop to optimize')
    if (end.mode === 'address' && !end.coord) {
        throw new Error("End mode 'address' requires a coord")
    }

    const extraEndCoord = end.mode === 'address' ? 1 : 0
    const totalCoords = 1 + stops.length + extraEndCoord
    if (totalCoords > 12) {
        const cap = end.mode === 'address' ? 10 : 11
        throw new Error(
            `Mapbox Optimization API supports up to ${cap} stops with the chosen end option.`,
        )
    }

    const config = useRuntimeConfig()
    const token = config.public.mapboxToken as string

    const coordList = end.mode === 'address'
        ? [start, ...stops, end.coord!]
        : [start, ...stops]
    const coordStr = coordList.map((c) => `${c.lng},${c.lat}`).join(';')

    const url = new URL(`https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordStr}`)
    url.searchParams.set('source', 'first')
    if (end.mode === 'round_trip') {
        url.searchParams.set('roundtrip', 'true')
    } else {
        // Open trip: pin the endpoint to the last coord (either the user's
        // last stop or the appended end address), optimize the middle.
        url.searchParams.set('destination', 'last')
        url.searchParams.set('roundtrip', 'false')
    }
    url.searchParams.set('geometries', 'geojson')
    url.searchParams.set('overview', 'full')
    url.searchParams.set('steps', 'false')
    url.searchParams.set('access_token', token)

    const requestUrl = url.toString()
    // Strip the access_token before logging — anything that ends up in
    // a console / log forwarder shouldn't carry the live Mapbox token.
    const safeUrl = requestUrl.replace(/([?&])access_token=[^&]*/, '$1access_token=REDACTED')
    const res = await fetch(requestUrl)
    const json = await res.json().catch(() => null)
    if (!res.ok) {
        const msg = json?.message || json?.code || res.statusText || `HTTP ${res.status}`
        console.error('[optimizeRoute] HTTP error', res.status, json, '\nRequest URL:', safeUrl)
        throw new Error(`Mapbox optimization failed: ${msg}`)
    }
    if (!json || (json.code && json.code !== 'Ok')) {
        console.error(
            '[optimizeRoute] Mapbox returned non-Ok\nresponse:',
            json,
            '\nrequest URL:',
            safeUrl,
        )
        const code = json?.code || 'Unknown'
        const message = json?.message || ''
        const friendly =
            code === 'NoRoute'
                ? "Couldn't build a driving route between those points. One of the stops (or your start point) may be too far from a road. Try a different start address."
                : `Mapbox: ${code}${message ? ' — ' + message : ''}`
        throw new Error(friendly)
    }
    const trip = json.trips?.[0]
    if (!trip) throw new Error('No route returned (empty trips)')

    const waypoints = json.waypoints as Array<{ waypoint_index: number }>
    const orderToInputIdx = new Array<number>(waypoints.length)
    waypoints.forEach((w, inputIdx) => {
        orderToInputIdx[w.waypoint_index] = inputIdx
    })
    // For address mode the input list is [start, ...stops, end] so we want
    // the slice that covers the stops only. For other modes the array is
    // already exactly [start, ...stops], so `slice(1, 1 + stops.length)`
    // reduces to `slice(1)` and the semantics are identical.
    const stopOrder = orderToInputIdx
        .slice(1, 1 + stops.length)
        .map((inputIdx) => inputIdx - 1)

    const legs: OptimizedLeg[] = (trip.legs ?? []).map(
        (l: { distance: number; duration: number }) => ({
            distanceMeters: l.distance,
            durationSeconds: l.duration,
        }),
    )

    // Split the trailing leg (return-home or drive-to-end) off from the
    // stop legs so the timeline can render it separately.
    let stopLegs: OptimizedLeg[]
    let returnLeg: OptimizedLeg | null
    let endLeg: OptimizedLeg | null
    if (end.mode === 'round_trip') {
        stopLegs = legs.slice(0, stops.length)
        returnLeg = legs[stops.length] ?? null
        endLeg = null
    } else if (end.mode === 'address') {
        stopLegs = legs.slice(0, stops.length)
        returnLeg = null
        endLeg = legs[stops.length] ?? null
    } else {
        stopLegs = legs
        returnLeg = null
        endLeg = null
    }

    return {
        stopOrder,
        geometry: trip.geometry,
        distanceMeters: trip.distance,
        durationSeconds: trip.duration,
        legs,
        stopLegs,
        returnLeg,
        endLeg,
    }
}

/**
 * Build a driving route through `stops` IN THE GIVEN ORDER (no reordering).
 * Uses the Mapbox Directions API. Returns the same shape as `optimizeRoute`
 * so the UI can use either result interchangeably.
 *
 * `end.mode === 'round_trip'`  appends the start coord as a final waypoint.
 * `end.mode === 'last_stop'`   ends at the last stop.
 * `end.mode === 'address'`     appends the supplied end coord as a final waypoint.
 *
 * Directions API supports up to 25 coordinates per request.
 */
export async function buildRouteFromOrder(
    start: { lng: number; lat: number },
    stops: { lng: number; lat: number }[],
    end: RouteEnd = { mode: 'last_stop' },
): Promise<OptimizedRoute> {
    if (stops.length === 0) throw new Error('Need at least one stop to route')
    if (end.mode === 'address' && !end.coord) {
        throw new Error("End mode 'address' requires a coord")
    }

    const extraCoord = end.mode === 'round_trip' || end.mode === 'address' ? 1 : 0
    const totalCoords = 1 + stops.length + extraCoord
    if (totalCoords > 25) {
        const cap = end.mode === 'last_stop' ? 24 : 23
        throw new Error(`Directions API supports up to ${cap} stops with the chosen end option.`)
    }

    const config = useRuntimeConfig()
    const token = config.public.mapboxToken as string

    const coordList = [start, ...stops]
    if (end.mode === 'round_trip') coordList.push(start)
    else if (end.mode === 'address') coordList.push(end.coord!)
    const coords = coordList.map((c) => `${c.lng},${c.lat}`).join(';')
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`)
    url.searchParams.set('geometries', 'geojson')
    url.searchParams.set('overview', 'full')
    url.searchParams.set('steps', 'false')
    url.searchParams.set('access_token', token)

    const res = await fetch(url.toString())
    const json = await res.json().catch(() => null)
    if (!res.ok) {
        const msg = json?.message || json?.code || res.statusText || `HTTP ${res.status}`
        console.error('[buildRouteFromOrder] HTTP error', res.status, json)
        throw new Error(`Mapbox directions failed: ${msg}`)
    }
    if (!json || (json.code && json.code !== 'Ok')) {
        console.error('[buildRouteFromOrder] non-Ok', json)
        const code = json?.code || 'Unknown'
        const friendly =
            code === 'NoRoute'
                ? "Couldn't build a driving route between those points. One of the stops or the start may be too far from a road."
                : `${code}${json?.message ? ' — ' + json.message : ''}`
        throw new Error(friendly)
    }

    const route = json.routes?.[0]
    if (!route) throw new Error('No route returned')

    const legs: OptimizedLeg[] = (route.legs ?? []).map((l: { distance: number; duration: number }) => ({
        distanceMeters: l.distance,
        durationSeconds: l.duration,
    }))

    let stopLegs: OptimizedLeg[]
    let returnLeg: OptimizedLeg | null
    let endLeg: OptimizedLeg | null
    if (end.mode === 'round_trip') {
        stopLegs = legs.slice(0, stops.length)
        returnLeg = legs[stops.length] ?? null
        endLeg = null
    } else if (end.mode === 'address') {
        stopLegs = legs.slice(0, stops.length)
        returnLeg = null
        endLeg = legs[stops.length] ?? null
    } else {
        stopLegs = legs
        returnLeg = null
        endLeg = null
    }

    return {
        // Identity order — we used what the caller gave us.
        stopOrder: stops.map((_, i) => i),
        geometry: route.geometry,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        legs,
        stopLegs,
        returnLeg,
        endLeg,
    }
}

export function getCurrentPosition(): Promise<{ lng: number; lat: number }> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported in this browser.'))
            return
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
            (err) => reject(new Error(err.message || 'Location permission denied.')),
            { enableHighAccuracy: true, timeout: 10000 },
        )
    })
}

export interface TimelineEntry {
    /** Stop index in the optimized order (0-based). */
    visitOrder: number
    arriveAt: Date
    departAt: Date
    drivingSecondsFromPrev: number
}

/**
 * Build a half-hour-per-stop visit schedule from optimization legs.
 * `start` is the user's chosen departure time (defaults to now).
 * `dwellMinutes` is how long to spend at each stop (default 30).
 */
export function buildTimeline(
    legs: OptimizedLeg[],
    start: Date = new Date(),
    dwellMinutes = 30,
): TimelineEntry[] {
    const entries: TimelineEntry[] = []
    let cursor = start.getTime()
    for (let i = 0; i < legs.length; i++) {
        const driveMs = legs[i].durationSeconds * 1000
        const arriveAt = new Date(cursor + driveMs)
        const departAt = new Date(arriveAt.getTime() + dwellMinutes * 60 * 1000)
        entries.push({
            visitOrder: i,
            arriveAt,
            departAt,
            drivingSecondsFromPrev: legs[i].durationSeconds,
        })
        cursor = departAt.getTime()
    }
    return entries
}
