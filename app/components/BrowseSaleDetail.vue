<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'

const props = defineProps<{
    sale: GarageSale
}>()

const emit = defineEmits<{
    (e: 'clear'): void
}>()

const user = useSupabaseUser()
const { isSaved, save, unsave } = useSavedSales()

const status = computed(() => saleStatus(props.sale))
const dateRange = computed(() => formatDateRange(props.sale.start_date, props.sale.end_date))
const timeRange = computed(() => formatTimeRange(props.sale.start_time, props.sale.end_time))

const lightboxIndex = ref<number | null>(null)

const saving = ref(false)
async function onLetsGo() {
    if (!user.value) {
        navigateTo('/login')
        return
    }
    saving.value = true
    if (isSaved(props.sale.id)) {
        await unsave(props.sale.id)
    } else {
        await save(props.sale.id)
    }
    saving.value = false
}
</script>

<template>
    <article class="rounded-xl bg-white p-5 ring-1 ring-orange-100">
        <div class="mb-3 flex items-start justify-between">
            <div class="flex items-center gap-2">
                <span
                    v-if="status === 'active'"
                    class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800"
                >
                    Happening today
                </span>
                <span
                    v-else-if="status === 'upcoming'"
                    class="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800"
                >
                    Upcoming
                </span>
            </div>
            <button
                class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
                @click="emit('clear')"
            >
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    />
                </svg>
            </button>
        </div>

        <h2 class="font-display text-2xl font-bold text-gray-900">{{ sale.title }}</h2>

        <div
            v-if="sale.status !== 'open'"
            class="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1"
            :class="statusBannerClass(sale.status)"
        >
            <span>{{ statusOption(sale.status).icon }}</span>
            <span>
                <strong>{{ statusOption(sale.status).label }}.</strong>
                {{ statusOption(sale.status).description }}
            </span>
        </div>

        <p class="mt-2 text-gray-700">📍 {{ sale.address }}</p>
        <p class="mt-1 text-gray-700">
            📅 {{ dateRange }}<span v-if="timeRange"> · {{ timeRange }}</span>
        </p>

        <div
            v-if="sale.photos && sale.photos.length"
            class="mt-4 grid grid-cols-3 gap-1.5"
        >
            <button
                v-for="(url, i) in sale.photos"
                :key="url"
                type="button"
                class="aspect-square overflow-hidden rounded-lg bg-gray-100 ring-1 ring-orange-100 transition hover:ring-2 hover:ring-brand-500"
                @click="lightboxIndex = i"
            >
                <img
                    :src="url"
                    :alt="`Photo ${i + 1}`"
                    loading="lazy"
                    class="h-full w-full object-cover"
                />
            </button>
        </div>
        <PhotoLightbox v-model:open="lightboxIndex" :photos="sale.photos ?? []" />

        <p
            v-if="sale.description"
            class="mt-4 whitespace-pre-line rounded-lg bg-cream p-3 text-sm text-gray-800"
        >
            {{ sale.description }}
        </p>

        <div class="mt-5 flex flex-wrap gap-2">
            <button
                v-if="!isSaved(sale.id)"
                class="btn-primary"
                :disabled="saving"
                @click="onLetsGo"
            >
                {{ saving ? 'Saving…' : "Let's go!" }}
            </button>
            <button
                v-else
                class="rounded-lg bg-green-50 px-5 py-2.5 font-medium text-green-700 ring-1 ring-green-200 hover:bg-green-100"
                :disabled="saving"
                @click="onLetsGo"
            >
                ✓ On your list — remove?
            </button>
            <NuxtLink :to="`/sale/${sale.id}`" class="btn-secondary">Open full page</NuxtLink>
        </div>
    </article>
</template>
