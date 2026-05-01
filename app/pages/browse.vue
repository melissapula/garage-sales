<script setup lang="ts">
const { savedSet, save, refresh: refreshSaved } = useSavedSales()
const user = useSupabaseUser()

const { data: sales, pending, error, refresh } = await useAsyncData('active-sales', () =>
    fetchActiveSales(),
)

onMounted(refreshSaved)
watch(user, refreshSaved)

// Filters
const filters = ref<BrowseFiltersValue>(emptyFilters())
const filteredSales = computed(() => applyFilters(sales.value ?? [], filters.value))

// Selection / hover state
const selectedId = ref<string | null>(null)
const hoveredId = ref<string | null>(null)

const selectedSale = computed(() =>
    selectedId.value ? (sales.value ?? []).find((s) => s.id === selectedId.value) ?? null : null,
)

function onSelect(saleId: string) {
    selectedId.value = saleId
}

function onHover(saleId: string | null) {
    hoveredId.value = saleId
}

function clearSelection() {
    selectedId.value = null
}

async function onLetsGo(saleId: string) {
    if (!user.value) {
        navigateTo('/login')
        return
    }
    await save(saleId)
}

// Mobile tab state
type MobileTab = 'list' | 'map' | 'filters'
const mobileTab = ref<MobileTab>('list')

const activeCount = computed(
    () => filteredSales.value.filter((s) => saleStatus(s) === 'active').length,
)
const upcomingCount = computed(
    () => filteredSales.value.filter((s) => saleStatus(s) === 'upcoming').length,
)
</script>

<template>
    <section class="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
                <h1 class="font-display text-2xl font-bold text-gray-900 sm:text-3xl">
                    Browse garage sales
                </h1>
                <p class="mt-1 text-sm text-gray-600">
                    <span class="inline-flex items-center gap-1">
                        <span class="h-2 w-2 rounded-full" style="background: #22c55e" />
                        {{ activeCount }} happening today
                    </span>
                    <span class="mx-2 text-gray-300">·</span>
                    <span class="inline-flex items-center gap-1">
                        <span class="h-2 w-2 rounded-full" style="background: #eab308" />
                        {{ upcomingCount }} upcoming
                    </span>
                </p>
            </div>
            <button
                class="text-sm text-sky-700 hover:underline"
                :disabled="pending"
                @click="refresh()"
            >
                {{ pending ? 'Refreshing…' : 'Refresh' }}
            </button>
        </div>

        <div v-if="error" class="rounded-lg bg-red-50 p-4 text-red-700">
            Couldn't load sales: {{ error.message }}
        </div>

        <!-- Mobile tab nav -->
        <nav class="mb-3 flex rounded-lg bg-white p-1 ring-1 ring-orange-100 lg:hidden">
            <button
                v-for="tab in (['list', 'map', 'filters'] as MobileTab[])"
                :key="tab"
                class="flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition"
                :class="
                    mobileTab === tab
                        ? 'bg-brand-500 text-white'
                        : 'text-gray-600 hover:bg-orange-50'
                "
                @click="mobileTab = tab"
            >
                {{ tab }}
            </button>
        </nav>

        <!-- 3-column desktop / single-pane mobile -->
        <div class="grid gap-4 lg:grid-cols-[260px_minmax(0,380px)_minmax(0,1fr)]">
            <!-- LEFT: Filters -->
            <aside :class="{ 'hidden lg:block': mobileTab !== 'filters' }">
                <BrowseFilters v-model="filters" :sales="sales ?? []" />
            </aside>

            <!-- MIDDLE: list or detail -->
            <div :class="{ 'hidden lg:block': mobileTab !== 'list' }">
                <BrowseSaleDetail
                    v-if="selectedSale"
                    :sale="selectedSale"
                    @clear="clearSelection"
                />
                <div
                    v-else
                    class="space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:p-1"
                >
                    <div
                        v-if="filteredSales.length === 0"
                        class="rounded-xl bg-white p-6 text-center text-sm text-gray-600 ring-1 ring-orange-100"
                    >
                        No sales match these filters.
                    </div>
                    <BrowseSaleCard
                        v-for="sale in filteredSales"
                        :key="sale.id"
                        :sale="sale"
                        :selected="hoveredId === sale.id"
                        @select="onSelect"
                        @hover="onHover"
                    />
                </div>
            </div>

            <!-- RIGHT: Map -->
            <div :class="{ 'hidden lg:block': mobileTab !== 'map' }" class="min-h-[60vh]">
                <ClientOnly>
                    <BrowseMap
                        :sales="filteredSales"
                        :selected-id="selectedId"
                        :hovered-id="hoveredId"
                        @select="onSelect"
                        @hover="onHover"
                        @clear="clearSelection"
                        @lets-go="onLetsGo"
                    />
                    <template #fallback>
                        <div
                            class="flex h-full min-h-[420px] w-full items-center justify-center rounded-xl bg-gray-100 text-gray-500"
                        >
                            Loading map…
                        </div>
                    </template>
                </ClientOnly>
            </div>
        </div>

        <p
            v-if="sales && sales.length === 0"
            class="mt-4 text-center text-gray-600"
        >
            No garage sales posted yet. Be the first —
            <NuxtLink to="/post" class="text-sky-700 hover:underline">post a sale</NuxtLink>.
        </p>
    </section>
</template>
