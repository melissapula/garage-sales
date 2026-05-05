<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'
import {
    type BrowseFiltersValue,
    type FilterLocation,
    RADIUS_OPTIONS,
    emptyFilters,
} from '~/utils/filters'

const props = defineProps<{
    sales: GarageSale[]
    modelValue: BrowseFiltersValue
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', v: BrowseFiltersValue): void
}>()

// =============================================================================
// Date-range filter
// =============================================================================
function setDateStart(iso: string | null) {
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { ...props.modelValue.dateRange, start: iso },
    })
}

function setDateEnd(iso: string | null) {
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { ...props.modelValue.dateRange, end: iso },
    })
}

function clearDateRange() {
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { start: null, end: null },
    })
}

// Quick presets — the picker handles arbitrary ranges, but the most
// common queries ("today", "this weekend") are worth one tap.
function applyPresetToday() {
    const today = todayLocalISO()
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { start: today, end: today },
    })
}

function applyPresetThisWeekend() {
    // "This weekend" = the upcoming Saturday + Sunday, OR today + tomorrow
    // when today is Saturday or Sunday.
    const now = new Date()
    const dow = now.getDay() // 0 Sun, 6 Sat
    const start = new Date(now)
    if (dow === 0) {
        // It's Sunday — show Sun only.
        // (start = today, end = today)
    } else if (dow === 6) {
        // Saturday — show Sat–Sun.
    } else {
        // Mon–Fri — jump to upcoming Saturday.
        start.setDate(now.getDate() + (6 - dow))
    }
    const end = new Date(start)
    if (start.getDay() === 6) end.setDate(start.getDate() + 1) // Sat → end Sun
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { start: toLocalISO(start), end: toLocalISO(end) },
    })
}

// =============================================================================
// Time-of-day filter
// =============================================================================
const TIME_BUCKETS = [
    { id: 'morning' as const, label: 'Morning', sub: 'before noon' },
    { id: 'afternoon' as const, label: 'Afternoon', sub: 'noon – 5pm' },
    { id: 'evening' as const, label: 'Evening', sub: '5pm onward' },
]

function toggleBucket(b: 'morning' | 'afternoon' | 'evening') {
    const next = props.modelValue.timeBuckets.includes(b)
        ? props.modelValue.timeBuckets.filter((x) => x !== b)
        : [...props.modelValue.timeBuckets, b]
    emit('update:modelValue', { ...props.modelValue, timeBuckets: next })
}

// =============================================================================
// Location filter
// =============================================================================
const locationInput = ref('')
const findingLocation = ref(false)
const locationError = ref<string | null>(null)

async function useMyLocation() {
    locationError.value = null
    findingLocation.value = true
    try {
        const pos = await getCurrentPosition()
        const label = (await reverseGeocode(pos.lng, pos.lat)) ?? 'Your location'
        setLocation({ lat: pos.lat, lng: pos.lng, label })
    } catch (e) {
        locationError.value = e instanceof Error ? e.message : 'Could not get location'
    } finally {
        findingLocation.value = false
    }
}

async function searchLocation() {
    locationError.value = null
    if (!locationInput.value.trim()) return
    findingLocation.value = true
    try {
        const result = await geocodeAddress(locationInput.value.trim())
        if (!result) {
            locationError.value = "Couldn't find that location."
            return
        }
        setLocation({ lat: result.lat, lng: result.lng, label: result.address })
        locationInput.value = ''
    } catch (e) {
        locationError.value = e instanceof Error ? e.message : 'Search failed'
    } finally {
        findingLocation.value = false
    }
}

function setLocation(location: FilterLocation) {
    emit('update:modelValue', { ...props.modelValue, location })
}

function clearLocation() {
    emit('update:modelValue', { ...props.modelValue, location: null })
}

function setRadius(miles: number) {
    emit('update:modelValue', { ...props.modelValue, radiusMiles: miles })
}

// =============================================================================
// Clear-all
// =============================================================================
const hasFilters = computed(
    () =>
        props.modelValue.dateRange.start !== null ||
        props.modelValue.dateRange.end !== null ||
        props.modelValue.timeBuckets.length > 0 ||
        props.modelValue.location !== null,
)

function clearAll() {
    emit('update:modelValue', emptyFilters())
}
</script>

<template>
    <div class="space-y-5 rounded-xl bg-white p-4 ring-1 ring-orange-100">
        <div class="flex items-center justify-between">
            <h2 class="font-display text-lg font-bold text-gray-900">Filters</h2>
            <button
                v-if="hasFilters"
                class="text-xs text-sky-700 hover:underline"
                @click="clearAll"
            >
                Clear all
            </button>
        </div>

        <!-- Location -->
        <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Location
            </h3>

            <div
                v-if="modelValue.location"
                class="flex items-start justify-between gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-gray-800"
            >
                <span class="min-w-0 flex-1 truncate">📍 {{ modelValue.location.label }}</span>
                <button
                    class="shrink-0 text-xs text-red-600 hover:underline"
                    @click="clearLocation"
                >
                    Clear
                </button>
            </div>

            <template v-else>
                <button
                    type="button"
                    class="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-sky-500 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                    :disabled="findingLocation"
                    @click="useMyLocation"
                >
                    {{ findingLocation ? 'Finding…' : '📍 Use my location' }}
                </button>
                <form class="mt-2 flex gap-2" @submit.prevent="searchLocation">
                    <input
                        v-model="locationInput"
                        placeholder="City or zip"
                        class="input flex-1 !min-h-[40px] !text-sm"
                        :disabled="findingLocation"
                    />
                    <button
                        type="submit"
                        class="rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        :disabled="findingLocation || !locationInput.trim()"
                    >
                        Find
                    </button>
                </form>
            </template>

            <p
                v-if="locationError"
                class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
            >
                {{ locationError }}
            </p>

            <div class="mt-3">
                <p class="mb-1.5 text-xs text-gray-600">Within</p>
                <div class="flex flex-wrap gap-1">
                    <button
                        v-for="r in RADIUS_OPTIONS"
                        :key="r"
                        type="button"
                        class="rounded-full border px-3 py-1 text-xs font-semibold transition"
                        :class="
                            modelValue.radiusMiles === r
                                ? 'border-brand-500 bg-brand-500 text-white'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300'
                        "
                        :disabled="!modelValue.location"
                        @click="setRadius(r)"
                    >
                        {{ r }} mi
                    </button>
                </div>
                <p
                    v-if="!modelValue.location"
                    class="mt-1 text-xs text-gray-400"
                >
                    Set a location first.
                </p>
            </div>
        </div>

        <!-- Dates -->
        <div>
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Dates
                </h3>
                <button
                    v-if="modelValue.dateRange.start || modelValue.dateRange.end"
                    type="button"
                    class="text-xs text-sky-700 hover:underline"
                    @click="clearDateRange"
                >
                    Clear
                </button>
            </div>

            <div class="flex flex-wrap gap-1.5">
                <button
                    type="button"
                    class="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-brand-300"
                    @click="applyPresetToday"
                >
                    Today
                </button>
                <button
                    type="button"
                    class="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-brand-300"
                    @click="applyPresetThisWeekend"
                >
                    This weekend
                </button>
            </div>

            <div class="mt-3 space-y-2">
                <label class="flex items-center gap-2 text-sm">
                    <span class="w-10 shrink-0 text-gray-600">From</span>
                    <input
                        type="date"
                        class="input flex-1 !min-h-[40px] !text-sm"
                        :value="modelValue.dateRange.start ?? ''"
                        @input="
                            setDateStart(
                                ($event.target as HTMLInputElement).value || null,
                            )
                        "
                    />
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <span class="w-10 shrink-0 text-gray-600">To</span>
                    <input
                        type="date"
                        class="input flex-1 !min-h-[40px] !text-sm"
                        :min="modelValue.dateRange.start ?? undefined"
                        :value="modelValue.dateRange.end ?? ''"
                        @input="
                            setDateEnd(
                                ($event.target as HTMLInputElement).value || null,
                            )
                        "
                    />
                </label>
            </div>

            <p class="mt-2 text-xs text-gray-500">
                Leave a side blank for an open-ended range.
            </p>
        </div>

        <!-- Time -->
        <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Time</h3>
            <ul class="space-y-1.5">
                <li v-for="b in TIME_BUCKETS" :key="b.id">
                    <label class="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                            :checked="modelValue.timeBuckets.includes(b.id)"
                            @change="toggleBucket(b.id)"
                        />
                        <span class="text-gray-800">{{ b.label }}</span>
                        <span class="text-xs text-gray-500">{{ b.sub }}</span>
                    </label>
                </li>
            </ul>
        </div>
    </div>
</template>
