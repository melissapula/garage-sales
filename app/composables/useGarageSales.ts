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
