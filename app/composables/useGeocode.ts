export interface GeocodeResult {
    address: string
    lat: number
    lng: number
}

/** Resolve coordinates → human-readable address via Mapbox reverse geocoding. */
export async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
    const config = useRuntimeConfig()
    const token = config.public.mapboxToken as string
    if (!token) return null

    const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse')
    url.searchParams.set('longitude', String(lng))
    url.searchParams.set('latitude', String(lat))
    url.searchParams.set('access_token', token)

    const res = await fetch(url.toString())
    if (!res.ok) return null
    const json = await res.json()
    const f = json.features?.[0]
    if (!f) return null
    return f.properties?.full_address ?? f.properties?.name ?? null
}

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
    const config = useRuntimeConfig()
    const token = config.public.mapboxToken as string
    if (!token) throw new Error('Mapbox token not configured')

    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward')
    url.searchParams.set('q', query)
    // Bias results to the user's general area via Mapbox's IP-based proximity,
    // so "123 Main St" picks the local match for whoever is typing instead of
    // always preferring one hardcoded city.
    url.searchParams.set('proximity', 'ip')
    url.searchParams.set('country', 'us')
    url.searchParams.set('limit', '1')
    url.searchParams.set('access_token', token)

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
    const json = await res.json()
    const feature = json.features?.[0]
    if (!feature) return null

    const [lng, lat] = feature.geometry.coordinates as [number, number]
    return {
        address: feature.properties?.full_address ?? feature.properties?.name ?? query,
        lat,
        lng,
    }
}
