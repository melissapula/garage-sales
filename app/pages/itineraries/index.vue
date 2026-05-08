<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()

const { unsave, refresh: refreshSavedIds } = useSavedSales()

const today = todayLocalISO()

const { data: savedSales, refresh: refreshSaved } = await useAsyncData('saved-sales-detail', () =>
    fetchSavedSalesWithDetails(),
)

const { data: routes, refresh: refreshRoutes } = await useAsyncData('my-routes', () =>
    fetchRoutes(),
)

onMounted(() => {
    refreshSavedIds()
})

const newRouteName = ref('')
const newRouteDate = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

async function createRoute() {
    if (!user.value) return
    if (!newRouteName.value.trim() || !newRouteDate.value) return
    if (newRouteDate.value < today) {
        createError.value = "Route date can't be in the past."
        return
    }
    creating.value = true
    createError.value = null
    const { data, error } = await supabase
        .from('routes')
        .insert({
            user_id: user.value.id,
            name: newRouteName.value.trim(),
            route_date: newRouteDate.value,
        })
        .select('id')
        .single()
    creating.value = false
    if (error) {
        createError.value = error.message
        return
    }
    router.push(`/itineraries/${data.id}`)
}

async function removeSaved(saleId: string) {
    const ok = await confirm({
        title: 'Remove from saved sales?',
        description: "You can re-add it from the map any time.",
        confirmText: 'Remove',
        tone: 'danger',
    })
    if (!ok) return
    await unsave(saleId)
    refreshSaved()
    toast.success('Removed from saved sales.')
}

async function deleteRoute(id: string) {
    const ok = await confirm({
        title: 'Delete this route?',
        description: 'This cannot be undone.',
        confirmText: 'Delete',
        tone: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('routes').delete().eq('id', id)
    if (error) {
        toast.error(error.message)
        return
    }
    toast.success('Route deleted.')
    refreshRoutes()
}

// Show every saved sale, including expired and removed ones — each
// gets its own visual treatment (yellow / red) so the user knows why
// they can no longer visit it. The tombstone for a removed sale stays
// for ~30 days then cron-purges (cascade-drops the saved row);
// expired entries persist until the user removes them or the cron
// finally deletes the past-end-dated sale.
const displayedSavedSales = computed(() =>
    (savedSales.value ?? []).filter((s) => s.sale),
)
</script>

<template>
    <section class="mx-auto max-w-4xl px-4 py-8">
        <h1 class="font-display text-3xl font-bold text-gray-900">Your itineraries</h1>
        <p class="mt-2 text-gray-600">Save sales you'd like to visit, then plan a route for the day.</p>

        <!-- ============================================================ -->
        <!-- Saved sales                                                  -->
        <!-- ============================================================ -->
        <section class="mt-8">
            <h2 class="font-display text-xl font-bold text-gray-900">Your saved sales</h2>
            <p class="mt-1 text-sm text-gray-600">
                Sales you've tapped <em>Let's go!</em> on. Ended sales show in yellow,
                and ones the owner removed show in red — clear them with <em>Remove</em>
                when you're done.
            </p>

            <ul v-if="displayedSavedSales.length" class="mt-4 space-y-2">
                <li
                    v-for="row in displayedSavedSales"
                    :key="row.garage_sale_id"
                    class="flex items-start gap-3 rounded-xl p-3 ring-1"
                    :class="saleRowToneClasses(row.sale)"
                >
                    <div class="flex-1">
                        <p
                            v-if="isRemovedSale(row.sale)"
                            class="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700"
                        >
                            ⚠ Removed by the owner
                        </p>
                        <p
                            v-else-if="isExpiredSale(row.sale)"
                            class="mb-1 text-xs font-semibold uppercase tracking-wide text-yellow-800"
                        >
                            ⏳ This sale has ended
                        </p>
                        <NuxtLink
                            v-if="!isRemovedSale(row.sale)"
                            :to="`/sale/${row.garage_sale_id}`"
                            class="font-medium hover:text-brand-600"
                            :class="
                                isExpiredSale(row.sale)
                                    ? 'text-gray-700 line-through'
                                    : 'text-gray-900'
                            "
                        >
                            {{ row.sale.title }}
                        </NuxtLink>
                        <span
                            v-else
                            class="font-medium text-gray-700 line-through"
                        >
                            {{ row.sale.title }}
                        </span>
                        <div class="mt-0.5 text-xs text-gray-600">{{ row.sale.address }}</div>
                        <div class="mt-0.5 text-xs text-gray-500">
                            {{ summarizeSchedule(row.sale).compact }}
                        </div>
                    </div>
                    <button
                        class="text-xs text-red-600 hover:underline"
                        @click="removeSaved(row.garage_sale_id)"
                    >
                        Remove
                    </button>
                </li>
            </ul>

            <p v-else class="mt-4 rounded-xl bg-white p-4 text-sm text-gray-600 ring-1 ring-orange-100">
                No saved sales yet. Browse the
                <NuxtLink to="/browse" class="text-sky-700 hover:underline">map</NuxtLink>
                and click <em>Let's go!</em> on the ones you'd like to visit.
            </p>
        </section>

        <!-- ============================================================ -->
        <!-- Plan a route                                                 -->
        <!-- ============================================================ -->
        <section class="mt-10">
            <h2 class="font-display text-xl font-bold text-gray-900">Plan a route</h2>
            <p class="mt-1 text-sm text-gray-600">
                Pick a day. We'll filter your saved sales to ones happening then.
            </p>

            <form
                class="mt-4 grid gap-3 rounded-xl bg-white p-4 ring-1 ring-orange-100 sm:grid-cols-[1fr_180px_auto]"
                @submit.prevent="createRoute"
            >
                <input
                    v-model="newRouteName"
                    placeholder="Name your route"
                    maxlength="120"
                    required
                    class="input"
                />
                <input
                    v-model="newRouteDate"
                    type="date"
                    required
                    :min="today"
                    class="input"
                />
                <button
                    type="submit"
                    class="btn-primary"
                    :disabled="creating || !newRouteName.trim() || !newRouteDate"
                >
                    {{ creating ? 'Creating…' : 'Plan it' }}
                </button>
            </form>
            <p v-if="createError" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ createError }}
            </p>
        </section>

        <!-- ============================================================ -->
        <!-- Existing routes                                              -->
        <!-- ============================================================ -->
        <section v-if="routes && routes.length" class="mt-10">
            <h2 class="font-display text-xl font-bold text-gray-900">Your routes</h2>
            <ul class="mt-4 space-y-2">
                <li
                    v-for="r in routes"
                    :key="r.id"
                    class="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-orange-100"
                >
                    <NuxtLink :to="`/itineraries/${r.id}`" class="flex-1 hover:text-brand-600">
                        <div class="font-medium text-gray-900">{{ r.name }}</div>
                        <div class="mt-0.5 text-xs text-gray-500">
                            {{
                                new Date(r.route_date + 'T00:00:00').toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'short',
                                    day: 'numeric',
                                })
                            }}
                        </div>
                    </NuxtLink>
                    <button
                        class="ml-3 text-sm text-red-600 hover:underline"
                        @click="deleteRoute(r.id)"
                    >
                        Delete
                    </button>
                </li>
            </ul>
        </section>
    </section>
</template>
