<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const { unsave, refresh: refreshSavedIds } = useSavedSales()

const today = new Date().toISOString().slice(0, 10)

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
    await unsave(saleId)
    refreshSaved()
}

async function deleteRoute(id: string) {
    if (!confirm('Delete this route?')) return
    const { error } = await supabase.from('routes').delete().eq('id', id)
    if (error) {
        alert(error.message)
        return
    }
    refreshRoutes()
}

const upcomingSavedSales = computed(() =>
    (savedSales.value ?? []).filter((s) => s.sale && saleStatus(s.sale) !== 'past'),
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
                Sales you've tapped <em>Let's go!</em> on. Past ones drop off automatically.
            </p>

            <ul v-if="upcomingSavedSales.length" class="mt-4 space-y-2">
                <li
                    v-for="row in upcomingSavedSales"
                    :key="row.garage_sale_id"
                    class="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-orange-100"
                >
                    <div class="flex-1">
                        <NuxtLink
                            :to="`/sale/${row.garage_sale_id}`"
                            class="font-medium text-gray-900 hover:text-brand-600"
                        >
                            {{ row.sale.title }}
                        </NuxtLink>
                        <div class="mt-0.5 text-xs text-gray-600">{{ row.sale.address }}</div>
                        <div class="mt-0.5 text-xs text-gray-500">
                            {{ formatDateRange(row.sale.start_date, row.sale.end_date) }}
                            <template v-if="row.sale.start_time || row.sale.end_time">
                                · {{ formatTimeRange(row.sale.start_time, row.sale.end_time) }}
                            </template>
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
