/**
 * Reactive shared state for the user's "Let's go!" wishlist.
 * Backed by the saved_sales table.
 */
export function useSavedSales() {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    const savedIds = useState<string[]>('saved-sale-ids', () => [])
    const savedSet = computed(() => new Set(savedIds.value))

    async function refresh() {
        if (!user.value) {
            savedIds.value = []
            return
        }
        const { data, error } = await supabase.from('saved_sales').select('garage_sale_id')
        if (error) return
        savedIds.value = (data ?? []).map((r) => r.garage_sale_id as string)
    }

    function isSaved(saleId: string) {
        return savedSet.value.has(saleId)
    }

    async function save(saleId: string) {
        if (!user.value || savedSet.value.has(saleId)) return
        const { error } = await supabase
            .from('saved_sales')
            .insert({ user_id: user.value.id, garage_sale_id: saleId })
        if (!error) savedIds.value = [...savedIds.value, saleId]
    }

    async function unsave(saleId: string) {
        if (!user.value) return
        const { error } = await supabase
            .from('saved_sales')
            .delete()
            .eq('garage_sale_id', saleId)
        if (!error) savedIds.value = savedIds.value.filter((id) => id !== saleId)
    }

    return { savedIds, savedSet, isSaved, save, unsave, refresh }
}
