export type SaleOwnerStatus = 'open' | 'running_late' | 'winding_down' | 'closed'

export interface GarageSale {
    id: string
    user_id: string
    title: string
    description: string | null
    address: string
    lat: number
    lng: number
    start_date: string
    end_date: string
    start_time: string | null
    end_time: string | null
    photos: string[]
    contact_enabled: boolean
    status: SaleOwnerStatus
    created_at: string
}

export async function fetchActiveSales() {
    const supabase = useSupabaseClient()
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
        .from('garage_sales')
        .select('*')
        .gte('end_date', today)
        .neq('status', 'closed')
        .order('start_date', { ascending: true })
    if (error) throw error
    return (data ?? []) as GarageSale[]
}

export interface OverlapConflict {
    id: string
    title: string
    start_date: string
    end_date: string
    address: string
}

/**
 * Find an existing active sale at the same coordinates whose date range
 * overlaps the proposed [startDate, endDate]. Returns null if there's no
 * conflict.
 *
 * Lat/lng are matched within ±0.0001° (~11m) so identical Mapbox geocodes
 * for the same address still match each other even with tiny float drift.
 *
 * `excludeId` lets the edit form skip its own existing row.
 */
export async function findOverlappingSale(
    lat: number,
    lng: number,
    startDate: string,
    endDate: string,
    excludeId?: string,
): Promise<OverlapConflict | null> {
    const supabase = useSupabaseClient()
    const eps = 0.0001
    let q = supabase
        .from('garage_sales')
        .select('id, title, start_date, end_date, address')
        .gte('lat', lat - eps)
        .lte('lat', lat + eps)
        .gte('lng', lng - eps)
        .lte('lng', lng + eps)
        .lte('start_date', endDate)
        .gte('end_date', startDate)
        .neq('status', 'closed')
        .limit(1)
    if (excludeId) q = q.neq('id', excludeId)
    const { data, error } = await q
    if (error) throw error
    return (data?.[0] as OverlapConflict | undefined) ?? null
}

/**
 * Same as `findOverlappingSale`, but retries once after a short delay if
 * the underlying request fails (e.g. transient network blip). The post
 * forms use this so they can distinguish "no conflict" from "we couldn't
 * tell", and warn the user in the latter case rather than silently
 * posting a possible duplicate.
 */
export async function findOverlappingSaleWithRetry(
    lat: number,
    lng: number,
    startDate: string,
    endDate: string,
    excludeId?: string,
): Promise<OverlapConflict | null> {
    try {
        return await findOverlappingSale(lat, lng, startDate, endDate, excludeId)
    } catch (firstError) {
        await new Promise((r) => setTimeout(r, 300))
        try {
            return await findOverlappingSale(lat, lng, startDate, endDate, excludeId)
        } catch (secondError) {
            // Re-throw the second error so the caller can show a soft
            // notice. We log both attempts to ease debugging.
            console.warn('Overlap check failed (1st attempt):', firstError)
            console.warn('Overlap check failed (retry):', secondError)
            throw secondError
        }
    }
}
