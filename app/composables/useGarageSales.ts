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
