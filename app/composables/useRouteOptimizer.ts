/**
 * Google Maps' "directions" deep-link (`/maps/dir/?api=1&waypoints=…`)
 * accepts at most 9 waypoints between the origin and the destination.
 * Apple Maps has no comparable cap. Both `/itineraries/[id]` and
 * `/share/[id]` build these links — keep the cap in one place so a
 * Google policy change is a one-line edit.
 */
export const GOOGLE_MAX_WAYPOINTS = 9

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
     * For a round-trip optimize, the final entry is the return-to-start leg
     * (separated from `stopLegs` for convenience).
     */
    legs: OptimizedLeg[]
    /** Just the legs that lead INTO each stop (excludes the return-home leg, if any). */
    stopLegs: OptimizedLeg[]
    /** Drive time and distance for the return leg if this is a round-trip; null otherwise. */
    returnLeg: OptimizedLeg | null
}

/**
 * Solve a TSP-style optimal route from `start` through all `stops`.
 * Uses Mapbox Optimization API v1 (driving profile).
 *
 * `roundTrip = true` (default): drive returns to the start point. All stops are reorderable.
 * `roundTrip = false`: open trip — the LAST input stop is fixed as the destination,
 *                       middle stops are reordered. (Mapbox v1 doesn't allow `destination=any`
 *                       with `roundtrip=false`, so we pin the endpoint to the user's choice.)
 *
 * Mapbox limit: 12 coordinates total (start + stops). We bail out otherwise.
 */
export async function optimizeRoute(
    start: { lng: number; lat: number },
    stops: { lng: number; lat: number }[],
    options: { roundTrip?: boolean } = {},
): Promise<OptimizedRoute> {
    const roundTrip = options.roundTrip !== false

    if (stops.length === 0) throw new Error('Need at least one stop to optimize')
    if (stops.length + 1 > 12) {
        throw new Error('Mapbox Optimization API supports up to 12 coordinates (start + 11 stops).')
    }

    const config = useRuntimeConfig()
    const token = config.public.mapboxToken as string

    const all = [start, ...stops]
    const coordStr = all.map((c) => `${c.lng},${c.lat}`).join(';')

    const url = new URL(`https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordStr}`)
    url.searchParams.set('source', 'first')
    if (roundTrip) {
        url.searchParams.set('roundtrip', 'true')
    } else {
        // Open trip: pin the endpoint to the user's last stop, optimize the middle.
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
    const stopOrder = orderToInputIdx.slice(1).map((inputIdx) => inputIdx - 1)

    const legs: OptimizedLeg[] = (trip.legs ?? []).map(
        (l: { distance: number; duration: number }) => ({
            distanceMeters: l.distance,
            durationSeconds: l.duration,
        }),
    )

    // For a round trip with N stops we get N+1 legs: N "into-a-stop" legs and
    // one "back-to-start" leg. Split them so the timeline can ignore the return.
    const stopLegs = roundTrip ? legs.slice(0, stops.length) : legs
    const returnLeg = roundTrip ? (legs[stops.length] ?? null) : null

    return {
        stopOrder,
        geometry: trip.geometry,
        distanceMeters: trip.distance,
        durationSeconds: trip.duration,
        legs,
        stopLegs,
        returnLeg,
    }
}

/**
 * Build a driving route through `stops` IN THE GIVEN ORDER (no reordering).
 * Uses the Mapbox Directions API. Returns the same shape as `optimizeRoute`
 * so the UI can use either result interchangeably.
 *
 * `roundTrip = true` appends the start coord as a final waypoint so the route
 * returns home; otherwise the route ends at the last stop.
 *
 * Directions API supports up to 25 coordinates per request.
 */
export async function buildRouteFromOrder(
    start: { lng: number; lat: number },
    stops: { lng: number; lat: number }[],
    options: { roundTrip?: boolean } = {},
): Promise<OptimizedRoute> {
    const roundTrip = options.roundTrip === true

    if (stops.length === 0) throw new Error('Need at least one stop to route')
    const totalCoords = 1 + stops.length + (roundTrip ? 1 : 0)
    if (totalCoords > 25) {
        throw new Error('Directions API supports up to 24 stops per route.')
    }

    const config = useRuntimeConfig()
    const token = config.public.mapboxToken as string

    const coordList = [start, ...stops]
    if (roundTrip) coordList.push(start)
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

    // When round-tripping, the final leg is start→…→last→start; split it off
    // so the timeline only counts the legs that lead INTO each stop.
    const stopLegs = roundTrip ? legs.slice(0, stops.length) : legs
    const returnLeg = roundTrip ? (legs[stops.length] ?? null) : null

    return {
        // Identity order — we used what the caller gave us.
        stopOrder: stops.map((_, i) => i),
        geometry: route.geometry,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        legs,
        stopLegs,
        returnLeg,
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
