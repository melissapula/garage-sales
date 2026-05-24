export interface GeocodeResult {
    address: string;
    lat: number;
    lng: number;
}

// Session-lifetime LRU caches for both directions. Mapbox bills per
// request, and a typical user session repeats the same query several
// times — typing an address, clearing it, retyping it; or panning the
// map back to a previously-reverse-geocoded spot. Map preserves
// insertion order; on hit we delete + re-set to bump the entry to the
// end, on overflow we evict the oldest.
const CACHE_LIMIT = 200;
const reverseCache = new Map<string, string | null>();
const forwardCache = new Map<string, GeocodeResult | null>();

function cacheGet<T>(cache: Map<string, T>, key: string): T | undefined {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key) as T;
    cache.delete(key);
    cache.set(key, v);
    return v;
}

function cacheSet<T>(cache: Map<string, T>, key: string, value: T): void {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
}

/** Resolve coordinates → human-readable address via Mapbox reverse geocoding. */
export async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
    const config = useRuntimeConfig();
    const token = config.public.mapboxToken as string;
    if (!token) return null;

    // Round to ~10cm precision so floating-point jitter on the same
    // location still hits the cache.
    const key = `${lng.toFixed(6)},${lat.toFixed(6)}`;
    const cached = cacheGet(reverseCache, key);
    if (cached !== undefined) return cached;

    const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();
    const f = json.features?.[0];
    const result = !f ? null : (f.properties?.full_address ?? f.properties?.name ?? null);
    cacheSet(reverseCache, key, result);
    return result;
}

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
    const config = useRuntimeConfig();
    const token = config.public.mapboxToken as string;
    if (!token) throw new Error('Mapbox token not configured');

    const key = query.trim().toLowerCase();
    if (key) {
        const cached = cacheGet(forwardCache, key);
        if (cached !== undefined) return cached;
    }

    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', query);
    // Bias results to the user's general area via Mapbox's IP-based proximity,
    // so "123 Main St" picks the local match for whoever is typing instead of
    // always preferring one hardcoded city.
    url.searchParams.set('proximity', 'ip');
    url.searchParams.set('country', 'us');
    url.searchParams.set('limit', '1');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const json = await res.json();
    const feature = json.features?.[0];
    if (!feature) {
        if (key) cacheSet(forwardCache, key, null);
        return null;
    }

    const [lng, lat] = feature.geometry.coordinates as [number, number];
    const result: GeocodeResult = {
        address: feature.properties?.full_address ?? feature.properties?.name ?? query,
        lat,
        lng,
    };
    if (key) cacheSet(forwardCache, key, result);
    return result;
}
