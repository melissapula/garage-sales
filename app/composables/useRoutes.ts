import type { GarageSale } from '~/composables/useGarageSales'

export interface Route {
    id: string
    user_id: string
    name: string
    route_date: string
    created_at: string
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
        .select('route_id, garage_sale_id, position, sale:garage_sales(*)')
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
        .select('garage_sale_id, created_at, sale:garage_sales(*)')
        .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as unknown as Array<{
        garage_sale_id: string
        created_at: string
        sale: GarageSale
    }>
}
