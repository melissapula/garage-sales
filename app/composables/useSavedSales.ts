/**
 * Reactive shared state for the user's "Let's go!" wishlist.
 * Backed by the saved_sales table.
 *
 * Errors surface via the toast bus + console — earlier the helpers
 * silently swallowed errors with `if (error) return`, so a failed save
 * (RLS misfire, network blip) showed the heart click as a no-op and
 * the user thought they'd saved a sale they hadn't.
 */
export function useSavedSales() {
    const supabase = useSupabaseClient()
    const user = useSupabaseUser()
    const toast = useToast()
    const savedIds = useState<string[]>('saved-sale-ids', () => [])
    const savedSet = computed(() => new Set(savedIds.value))

    async function refresh() {
        if (!user.value) {
            savedIds.value = []
            return
        }
        const { data, error } = await supabase.from('saved_sales').select('garage_sale_id')
        if (error) {
            // Refresh is invoked passively (mount, user change) — don't toast
            // on every transient failure, just log so Sentry / dev tools see
            // it. The user can still click "Let's go!" successfully; the
            // initial set just won't reflect existing saves until next load.
            console.error('[useSavedSales] refresh failed:', error)
            return
        }
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
        if (error) {
            console.error('[useSavedSales] save failed:', error)
            toast.error("Couldn't save that sale. Please try again.")
            return
        }
        savedIds.value = [...savedIds.value, saleId]
    }

    async function unsave(saleId: string) {
        if (!user.value) return
        const { error } = await supabase
            .from('saved_sales')
            .delete()
            .eq('garage_sale_id', saleId)
        if (error) {
            console.error('[useSavedSales] unsave failed:', error)
            toast.error("Couldn't remove that sale. Please try again.")
            return
        }
        savedIds.value = savedIds.value.filter((id) => id !== saleId)
    }

    return { savedIds, savedSet, isSaved, save, unsave, refresh }
}
