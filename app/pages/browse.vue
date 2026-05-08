<script setup lang="ts">
import {
    type BrowseFiltersValue,
    applyFilters,
    emptyFilters,
} from '~/utils/filters'
import { getCurrentPosition } from '~/composables/useRouteOptimizer'

const { savedSet, save, refresh: refreshSaved } = useSavedSales()
const user = useSupabaseUser()
const route = useRoute()
const router = useRouter()

const showWelcome = ref(route.query.welcome === '1')
function dismissWelcome() {
    showWelcome.value = false
    const next = { ...route.query }
    delete next.welcome
    router.replace({ query: next })
}

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
    // On mobile, browsers fire a synthesized mouseenter on tap, leaving
    // hoveredId set after a pin tap. Without clearing it here, the popover
    // would re-render as a transient hover popup (no X) when selection
    // clears, leaving the user with a popover they can't dismiss.
    hoveredId.value = null
}

async function onLetsGo(saleId: string) {
    if (!user.value) {
        navigateTo('/login')
        return
    }
    await save(saleId)
}

// Center the map on the user's location on first visit, with the choice
// cached so we don't re-prompt every page load. The on-map "📍"
// GeolocateControl button is always available for an explicit re-center.
//
// The cache has a TTL so users who change their mind (or move cities)
// aren't stuck forever:
//   - granted: keep coords for 7 days, then re-ask
//   - denied: keep the "no" for 24h, then re-ask
//
// Key is namespaced by user id (or 'anon') so a shared device doesn't
// leak user A's coords to user B's first browse after sign-out.
function locationKey(): string {
    return `gst:user-location:${user.value?.id ?? 'anon'}`
}
const GRANTED_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DENIED_TTL_MS = 24 * 60 * 60 * 1000
type CachedLocation =
    | { asked: true; granted: true; lng: number; lat: number; ts: number }
    | { asked: true; granted: false; ts: number }
const userCenter = ref<[number, number] | null>(null)

function readLocationCache(): CachedLocation | null {
    if (typeof localStorage === 'undefined') return null
    try {
        const raw = localStorage.getItem(locationKey())
        if (!raw) return null
        const cached = JSON.parse(raw) as CachedLocation
        const age = Date.now() - (cached.ts ?? 0)
        const ttl = cached.granted ? GRANTED_TTL_MS : DENIED_TTL_MS
        if (age > ttl) {
            // Stale — drop it so we re-prompt and refresh the coords.
            localStorage.removeItem(locationKey())
            return null
        }
        return cached
    } catch {
        return null
    }
}

/**
 * Seed the radius filter from the user's coordinates. Sets the
 * filter immediately with a placeholder label so the radius circle
 * kicks in without waiting on the reverse-geocode round-trip; the
 * pretty label backfills when the geocode resolves. Reset each page
 * load — the filter is intentionally session-only, so a user who
 * clears it during a session keeps it cleared for that session, but
 * still sees the default re-applied on the next visit.
 */
async function applyUserLocationToFilter(lng: number, lat: number) {
    filters.value = {
        ...filters.value,
        location: { lng, lat, label: 'Your location' },
    }
    try {
        const label = await reverseGeocode(lng, lat)
        if (label && filters.value.location) {
            filters.value = {
                ...filters.value,
                location: { lng, lat, label },
            }
        }
    } catch {
        // keep the placeholder
    }
}

if (import.meta.client) {
    const cached = readLocationCache()
    if (cached?.granted) {
        userCenter.value = [cached.lng, cached.lat]
        applyUserLocationToFilter(cached.lng, cached.lat)
    }
}

onMounted(async () => {
    if (!import.meta.client) return
    if (readLocationCache()) return // already asked recently — skip prompt

    try {
        const pos = await getCurrentPosition()
        userCenter.value = [pos.lng, pos.lat]
        applyUserLocationToFilter(pos.lng, pos.lat)
        const entry: CachedLocation = { asked: true, granted: true, lng: pos.lng, lat: pos.lat, ts: Date.now() }
        localStorage.setItem(locationKey(), JSON.stringify(entry))
    } catch {
        const entry: CachedLocation = { asked: true, granted: false, ts: Date.now() }
        try { localStorage.setItem(locationKey(), JSON.stringify(entry)) } catch { /* ignore */ }
    }
})

// Mobile tab state
type MobileTab = 'list' | 'map' | 'filters'
const mobileTab = ref<MobileTab>('list')

function selectMobileTab(tab: MobileTab) {
    mobileTab.value = tab
    // Tapping a tab is a "go back to browsing" gesture: clear any selected
    // sale so the list tab shows the full filtered list and the map tab
    // shows all the filtered pins without the stacked detail card.
    clearSelection()
}

const activeCount = computed(
    () => filteredSales.value.filter((s) => saleStatus(s) === 'active').length,
)
const upcomingCount = computed(
    () => filteredSales.value.filter((s) => saleStatus(s) === 'upcoming').length,
)
</script>

<template>
    <section class="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        <!-- Welcome banner -->
        <div
            v-if="showWelcome"
            class="mb-4 flex items-start gap-3 rounded-xl bg-gradient-to-r from-orange-100 to-amber-100 p-4 ring-1 ring-orange-200"
        >
            <span class="text-2xl">👋</span>
            <div class="flex-1 text-sm text-gray-800">
                <p class="font-display text-base font-bold text-gray-900">
                    Welcome to Garage Sale Tracker!
                </p>
                <p class="mt-1">
                    Tap <strong>"Let's go!"</strong> on any sale to save it for later, or
                    <NuxtLink
                        to="/post"
                        class="font-semibold text-brand-600 hover:underline"
                    >
                        post your own
                    </NuxtLink>
                    .
                </p>
                <p class="mt-1.5">
                    This app is still evolving — if you'd like a feature added or run into a
                    bug, <span class="whitespace-nowrap"><a
                        href="mailto:missap1214@gmail.com?subject=Garage%20Sale%20Tracker"
                        class="font-semibold text-sky-700 hover:underline"
                    >reach out</a>.</span> I'd love to hear from you.
                </p>
            </div>
            <button
                class="-mr-1 -mt-1 shrink-0 rounded p-1 text-gray-500 hover:bg-black/5 hover:text-gray-800"
                aria-label="Dismiss welcome message"
                @click="dismissWelcome"
            >
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    />
                </svg>
            </button>
        </div>

        <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h1 class="font-display text-2xl font-bold text-gray-900 sm:text-3xl">
                Browse garage sales
            </h1>
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
                @click="selectMobileTab(tab)"
            >
                {{ tab }}
            </button>
        </nav>

        <!-- 3-column desktop / single-pane mobile -->
        <div
            class="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,380px)_minmax(0,1fr)]"
        >
            <!-- LEFT: Filters -->
            <aside :class="{ 'hidden lg:block': mobileTab !== 'filters' }">
                <BrowseFilters
                    v-model="filters"
                    :sales="sales ?? []"
                    :filtered-count="filteredSales.length"
                />
            </aside>

            <!-- MIDDLE: list or detail -->
            <!-- On mobile, when a sale is selected we stack detail above the
                 map by default. Tapping any tab clears the selection, so the
                 tab's view is shown without the stacked detail card. -->
            <div :class="{ 'hidden lg:block': mobileTab !== 'list' && !selectedSale }">
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
                        <template v-if="sales && sales.length > 0">
                            <p>No sales match these filters.</p>
                            <button
                                type="button"
                                class="mt-2 text-sky-700 hover:underline"
                                @click="filters = emptyFilters()"
                            >
                                Clear all filters
                            </button>
                        </template>
                        <template v-else>
                            <p>No garage sales posted in your area yet.</p>
                            <NuxtLink to="/post" class="mt-1 inline-block text-sky-700 hover:underline">
                                Be the first — post a sale
                            </NuxtLink>
                        </template>
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
            <!-- Mobile: fill the viewport so there's no cream gap between
                 the map and the footer. Desktop: 60vh, sized to live
                 alongside the list column in the 3-col row. -->
            <div
                :class="{ 'hidden lg:block': mobileTab !== 'map' && !selectedSale }"
                class="relative min-h-screen lg:min-h-[60vh]"
            >
                <ClientOnly>
                    <LazyBrowseMap
                        :sales="filteredSales"
                        :selected-id="selectedId"
                        :hovered-id="hoveredId"
                        :initial-center="userCenter"
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

                <!-- Map legend overlay -->
                <div
                    class="pointer-events-none absolute left-3 top-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-xs shadow-md ring-1 ring-orange-100"
                >
                    <div class="flex items-center gap-1.5 text-gray-700">
                        <span class="h-2 w-2 rounded-full" style="background: #22c55e" />
                        <span class="font-medium">{{ activeCount }}</span>
                        <span>today</span>
                    </div>
                    <div class="mt-1 flex items-center gap-1.5 text-gray-700">
                        <span class="h-2 w-2 rounded-full" style="background: #eab308" />
                        <span class="font-medium">{{ upcomingCount }}</span>
                        <span>upcoming</span>
                    </div>
                </div>
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
