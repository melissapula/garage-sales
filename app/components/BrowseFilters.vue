<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales';
import { type BrowseFiltersValue, type FilterLocation, emptyFilters } from '~/utils/filters';

const props = defineProps<{
    sales: GarageSale[];
    modelValue: BrowseFiltersValue;
    /** Sales matching the current filters — passed in so the header can
     *  show a live count. Single source of truth lives in the parent. */
    filteredCount: number;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', v: BrowseFiltersValue): void;
}>();

// =============================================================================
// Date-range filter
// =============================================================================
function setDateStart(iso: string | null) {
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { ...props.modelValue.dateRange, start: iso },
    });
}

function setDateEnd(iso: string | null) {
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { ...props.modelValue.dateRange, end: iso },
    });
}

function clearDateRange() {
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { start: null, end: null },
    });
}

// Quick presets — the picker handles arbitrary ranges, but the most
// common queries ("today", "this weekend") are worth one tap.
function applyPresetToday() {
    const today = todayLocalISO();
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { start: today, end: today },
    });
}

function applyPresetThisWeekend() {
    // "This weekend" = the upcoming Saturday + Sunday, OR today + tomorrow
    // when today is Saturday or Sunday. Past code had empty Sun/Sat
    // branches that worked by accident — this version is explicit.
    const now = new Date();
    const dow = now.getDay(); // 0 Sun, 6 Sat
    const start = new Date(now);
    // Mon–Fri (1..5): jump forward to the upcoming Saturday.
    // Sat (6) + Sun (0): start on today.
    if (dow >= 1 && dow <= 5) {
        start.setDate(now.getDate() + (6 - dow));
    }
    const end = new Date(start);
    // If start is Saturday, extend to Sunday. If start is Sunday, single day.
    if (start.getDay() === 6) end.setDate(start.getDate() + 1);
    emit('update:modelValue', {
        ...props.modelValue,
        dateRange: { start: toLocalISO(start), end: toLocalISO(end) },
    });
}

// =============================================================================
// Time-of-day filter
// =============================================================================
const TIME_BUCKETS = [
    { id: 'morning' as const, label: 'Morning', sub: 'before noon' },
    { id: 'afternoon' as const, label: 'Afternoon', sub: 'noon – 5pm' },
    { id: 'evening' as const, label: 'Evening', sub: '5pm onward' },
];

function toggleBucket(b: 'morning' | 'afternoon' | 'evening') {
    const next = props.modelValue.timeBuckets.includes(b)
        ? props.modelValue.timeBuckets.filter((x) => x !== b)
        : [...props.modelValue.timeBuckets, b];
    emit('update:modelValue', { ...props.modelValue, timeBuckets: next });
}

// =============================================================================
// Location filter
// =============================================================================
const locationInput = ref('');
const findingLocation = ref(false);
const locationError = ref<string | null>(null);

async function useMyLocation() {
    locationError.value = null;
    findingLocation.value = true;
    try {
        const pos = await getCurrentPosition();
        const label = (await reverseGeocode(pos.lng, pos.lat)) ?? 'Your location';
        setLocation({ lat: pos.lat, lng: pos.lng, label });
    } catch (e) {
        locationError.value = e instanceof Error ? e.message : 'Could not get location';
    } finally {
        findingLocation.value = false;
    }
}

async function searchLocation() {
    locationError.value = null;
    if (!locationInput.value.trim()) return;
    findingLocation.value = true;
    try {
        const result = await geocodeAddress(locationInput.value.trim());
        if (!result) {
            locationError.value = "Couldn't find that location.";
            return;
        }
        setLocation({ lat: result.lat, lng: result.lng, label: result.address });
        locationInput.value = '';
    } catch (e) {
        locationError.value = e instanceof Error ? e.message : 'Search failed';
    } finally {
        findingLocation.value = false;
    }
}

function setLocation(location: FilterLocation) {
    emit('update:modelValue', { ...props.modelValue, location });
}

function clearLocation() {
    emit('update:modelValue', { ...props.modelValue, location: null });
}

// Radius slider uses a local ref for the visual value so the thumb
// follows the cursor instantly during drag, and a debounced emit so
// the parent's filteredSales / map re-render doesn't fire on every
// pixel of drag. Each native `input` event would otherwise rerun
// applyFilters across all sales, the BrowseMap signature watcher,
// and the cards list — visible as a Poor INP score in production.
const localRadius = ref(props.modelValue.radiusMiles);
watch(
    () => props.modelValue.radiusMiles,
    (next) => {
        if (next !== localRadius.value) localRadius.value = next;
    },
);
const debouncedEmitRadius = useDebounceFn((miles: number) => {
    // Guard against a stale queued value: if the user clicked "Clear
    // all" (which resets the parent and re-syncs localRadius via the
    // watcher above) between the drag and the debounce firing, the
    // queued `miles` would race-undo the reset. Only emit if it still
    // matches the current intent.
    if (miles !== localRadius.value) return;
    emit('update:modelValue', { ...props.modelValue, radiusMiles: miles });
}, 120);
function setRadius(miles: number) {
    localRadius.value = miles;
    debouncedEmitRadius(miles);
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
);

function clearAll() {
    emit('update:modelValue', emptyFilters());
}
</script>

<template>
    <div class="space-y-5 rounded-xl bg-white p-4 ring-1 ring-orange-100">
        <div class="flex items-center justify-between">
            <div class="flex items-baseline gap-2">
                <h2 class="font-display text-lg font-bold text-gray-900">Filters</h2>
                <span class="text-xs text-gray-500">
                    · {{ filteredCount }} {{ filteredCount === 1 ? 'match' : 'matches' }}
                </span>
            </div>
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
                <div class="mb-1.5 flex items-baseline justify-between text-xs text-gray-600">
                    <span>Within</span>
                    <span class="font-semibold text-gray-900"> {{ localRadius }} mi </span>
                </div>
                <input
                    type="range"
                    min="5"
                    max="100"
                    step="5"
                    class="w-full accent-brand-500"
                    :value="localRadius"
                    :disabled="!modelValue.location"
                    @input="
                        (() => {
                            const v = Number(($event.target as HTMLInputElement).value);
                            if (Number.isFinite(v)) setRadius(v);
                        })()
                    "
                />
                <div class="mt-1 flex justify-between text-[10px] text-gray-400">
                    <span>5 mi</span>
                    <span>100 mi</span>
                </div>
                <p v-if="!modelValue.location" class="mt-1 text-xs text-gray-400">
                    Set a location first.
                </p>
            </div>
        </div>

        <!-- Dates -->
        <div>
            <div class="mb-2 flex items-center justify-between">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Dates</h3>
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
                        @input="setDateStart(($event.target as HTMLInputElement).value || null)"
                    />
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <span class="w-10 shrink-0 text-gray-600">To</span>
                    <input
                        type="date"
                        class="input flex-1 !min-h-[40px] !text-sm"
                        :min="modelValue.dateRange.start ?? undefined"
                        :value="modelValue.dateRange.end ?? ''"
                        @input="setDateEnd(($event.target as HTMLInputElement).value || null)"
                    />
                </label>
            </div>

            <p class="mt-2 text-xs text-gray-500">Leave a side blank for an open-ended range.</p>
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
