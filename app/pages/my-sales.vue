<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { deletePhotos } = useSalePhotos()

const { data: sales, refresh } = await useAsyncData<GarageSale[]>(
    'my-sales',
    async () => {
        if (!user.value) return []
        const { data, error } = await supabase
            .from('garage_sales')
            .select('*')
            .eq('user_id', user.value.id)
            .order('start_date', { ascending: false })
        if (error) throw error
        return (data ?? []) as GarageSale[]
    },
    { watch: [user] },
)

async function deleteSale(sale: GarageSale) {
    if (!confirm(`Delete "${sale.title}"? This cannot be undone.`)) return
    const { error } = await supabase.from('garage_sales').delete().eq('id', sale.id)
    if (error) {
        alert(error.message)
        return
    }
    if (sale.photos?.length) deletePhotos(sale.photos).catch(() => {})
    refresh()
}

function statusLabel(s: GarageSale): string {
    const status = saleStatus(s)
    if (status === 'active') return 'Happening today'
    if (status === 'upcoming') return 'Upcoming'
    return 'Past'
}

function statusClass(s: GarageSale): string {
    const status = saleStatus(s)
    if (status === 'active') return 'bg-green-100 text-green-800'
    if (status === 'upcoming') return 'bg-yellow-100 text-yellow-800'
    return 'bg-gray-100 text-gray-600'
}
</script>

<template>
    <section class="mx-auto max-w-3xl px-4 py-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h1 class="font-display text-3xl font-bold text-gray-900">Your garage sales</h1>
                <p class="mt-2 text-sm text-gray-600">
                    Sales you've posted. Past sales are kept for 7 days, then auto-deleted.
                </p>
            </div>
            <NuxtLink to="/post" class="btn-primary !min-h-[40px] !px-4 !py-2 text-sm">
                + New sale
            </NuxtLink>
        </div>

        <ul v-if="sales && sales.length" class="mt-6 space-y-3">
            <li
                v-for="sale in sales"
                :key="sale.id"
                class="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-orange-100 sm:p-4"
            >
                <img
                    v-if="sale.photos && sale.photos.length"
                    :src="sale.photos[0]"
                    :alt="sale.title"
                    loading="lazy"
                    class="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-orange-100 sm:h-20 sm:w-20"
                />
                <div class="min-w-0 flex-1">
                    <div class="mb-1 flex flex-wrap items-center gap-2">
                        <span
                            class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                            :class="statusClass(sale)"
                        >
                            {{ statusLabel(sale) }}
                        </span>
                        <span
                            v-if="sale.photos && sale.photos.length"
                            class="text-[10px] uppercase tracking-wide text-gray-500"
                        >
                            {{ sale.photos.length }}
                            photo{{ sale.photos.length === 1 ? '' : 's' }}
                        </span>
                    </div>
                    <NuxtLink
                        :to="`/sale/${sale.id}`"
                        class="block truncate font-display text-base font-bold text-gray-900 hover:text-brand-600"
                    >
                        {{ sale.title }}
                    </NuxtLink>
                    <p class="mt-0.5 truncate text-sm text-gray-600">{{ sale.address }}</p>
                    <p class="mt-0.5 text-xs text-gray-500">
                        {{ formatDateRange(sale.start_date, sale.end_date) }}
                        <template v-if="sale.start_time && sale.end_time">
                            · {{ formatTimeRange(sale.start_time, sale.end_time) }}
                        </template>
                    </p>
                </div>
                <div class="flex flex-col gap-2">
                    <NuxtLink
                        :to="`/post/${sale.id}`"
                        class="rounded-lg border border-sky-500 px-3 py-1.5 text-center text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
                    >
                        Edit
                    </NuxtLink>
                    <button
                        class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                        @click="deleteSale(sale)"
                    >
                        Delete
                    </button>
                </div>
            </li>
        </ul>

        <p
            v-else-if="sales"
            class="mt-6 rounded-xl bg-white p-6 text-center text-sm text-gray-600 ring-1 ring-orange-100"
        >
            You haven't posted a sale yet.
            <NuxtLink to="/post" class="text-sky-700 hover:underline">Post one →</NuxtLink>
        </p>
    </section>
</template>
