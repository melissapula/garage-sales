<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'

export interface BrowseFiltersValue {
    /** ISO date strings (YYYY-MM-DD) the user has checked. Empty = no day filter. */
    days: string[]
    /** Time-of-day buckets the user has checked. Empty = no time filter. */
    timeBuckets: ('morning' | 'afternoon' | 'evening')[]
}

const props = defineProps<{
    sales: GarageSale[]
    modelValue: BrowseFiltersValue
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', v: BrowseFiltersValue): void
}>()

// Build the list of unique days that appear in the data.
const availableDays = computed(() => {
    const set = new Set<string>()
    for (const s of props.sales) {
        const start = new Date(s.start_date + 'T00:00:00')
        const end = new Date(s.end_date + 'T00:00:00')
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            set.add(d.toISOString().slice(0, 10))
        }
    }
    return [...set].sort()
})

function dayLabel(iso: string): string {
    const today = new Date().toISOString().slice(0, 10)
    const d = new Date(iso + 'T00:00:00')
    if (iso === today) return 'Today'
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (iso === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow'
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function toggleDay(iso: string) {
    const days = props.modelValue.days.includes(iso)
        ? props.modelValue.days.filter((d) => d !== iso)
        : [...props.modelValue.days, iso]
    emit('update:modelValue', { ...props.modelValue, days })
}

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

const hasFilters = computed(
    () => props.modelValue.days.length > 0 || props.modelValue.timeBuckets.length > 0,
)

function clearAll() {
    emit('update:modelValue', { days: [], timeBuckets: [] })
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

        <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Day</h3>
            <ul class="space-y-1.5">
                <li v-for="iso in availableDays" :key="iso">
                    <label class="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                            :checked="modelValue.days.includes(iso)"
                            @change="toggleDay(iso)"
                        />
                        <span class="text-gray-800">{{ dayLabel(iso) }}</span>
                    </label>
                </li>
                <li v-if="availableDays.length === 0" class="text-sm text-gray-500">
                    No sales currently posted.
                </li>
            </ul>
        </div>

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
