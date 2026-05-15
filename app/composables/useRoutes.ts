import type { GarageSale } from '~/composables/useGarageSales'
import { GARAGE_SALE_SELECT } from '~/composables/useGarageSales'
import type { EndMode } from '~/composables/useRouteOptimizer'

export interface Route {
    id: string
    user_id: string
    name: string
    route_date: string
    is_public: boolean
    created_at: string
    /** Where the route should end. Default 'round_trip'. */
    end_mode: EndMode
    /** Human-readable end address; only meaningful when end_mode === 'address'. */
    end_address: string | null
    end_lat: number | null
    end_lng: number | null
}

export interface RouteStop {
    route_id: string
    garage_sale_id: string
    position: number
    sale: GarageSale
}

export async function fetchRoutes() {
    const supabase = useSupabaseClient()
    const { data, error } = await supabase
        .from('routes')
        .select('*')
        .order('route_date', { ascending: true })
    if (error) throw error
    return (data ?? []) as Route[]
}

export async function fetchRouteWithStops(id: string) {
    const supabase = useSupabaseClient()
    const { data: route, error: err1 } = await supabase
        .from('routes')
        .select('*')
        .eq('id', id)
        .maybeSingle()
    if (err1) throw err1
    if (!route) return null

    const { data: stops, error: err2 } = await supabase
        .from('route_stops')
        .select(`route_id, garage_sale_id, position, sale:garage_sales(${GARAGE_SALE_SELECT})`)
        .eq('route_id', id)
        .order('position')
    if (err2) throw err2

    return {
        route: route as Route,
        stops: (stops ?? []) as unknown as RouteStop[],
    }
}

export async function fetchSavedSalesWithDetails() {
    const supabase = useSupabaseClient()
    const { data, error } = await supabase
        .from('saved_sales')
        .select(`garage_sale_id, created_at, sale:garage_sales!inner(${GARAGE_SALE_SELECT})`)
        // We DO ship expired sales (end_date < today) and tombstones
        // (deleted_at not null) so the itineraries page can render them
        // with their respective "ended" / "removed" notices instead of
        // silently dropping them. Cron eventually purges tombstones >30
        // days old; expired sales hang around as long as the row exists.
        .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as unknown as Array<{
        garage_sale_id: string
        created_at: string
        sale: GarageSale
    }>
}
