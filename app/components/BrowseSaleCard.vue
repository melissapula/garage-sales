<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'

const props = defineProps<{
    sale: GarageSale
    /** Whether this card is currently the selected/highlighted one. */
    selected?: boolean
}>()

const emit = defineEmits<{
    (e: 'select', saleId: string): void
    (e: 'hover', saleId: string | null): void
}>()

const user = useSupabaseUser()
const { isSaved, save, unsave } = useSavedSales()
const toast = useToast()

const status = computed(() => saleStatus(props.sale))
const schedule = computed(() => summarizeSchedule(props.sale))

function onClick() {
    emit('select', props.sale.id)
}

const saving = ref(false)
async function onLetsGo(ev: Event) {
    ev.stopPropagation()
    if (!user.value) {
        navigateTo('/login')
        return
    }
    saving.value = true
    await save(props.sale.id)
    saving.value = false
}

const removing = ref(false)
async function onRemove(ev: Event) {
    ev.stopPropagation()
    removing.value = true
    await unsave(props.sale.id)
    removing.value = false
    toast.success('Removed from saved sales.')
}
</script>

<template>
    <article
        class="cursor-pointer rounded-xl bg-white p-3 ring-1 transition hover:shadow-md sm:p-4"
        :class="selected ? 'ring-2 ring-brand-500' : 'ring-orange-100'"
        @click="onClick"
        @mouseenter="emit('hover', sale.id)"
        @mouseleave="emit('hover', null)"
    >
        <div class="flex items-start gap-3">
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
                        v-if="status === 'active'"
                        class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800"
                    >
                        Today
                    </span>
                    <span
                        v-else-if="status === 'upcoming'"
                        class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800"
                    >
                        Upcoming
                    </span>
                    <span
                        v-if="sale.status !== 'open'"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        :class="statusBadgeClass(sale.status)"
                    >
                        <span>{{ statusOption(sale.status).icon }}</span>
                        {{ statusOption(sale.status).short }}
                    </span>
                </div>
                <h3 class="truncate font-display text-base font-bold text-gray-900">
                    {{ sale.title }}
                </h3>
                <p class="mt-0.5 truncate text-sm text-gray-600">{{ sale.address }}</p>
                <p class="mt-0.5 truncate text-xs text-gray-500">
                    {{ schedule.compact }}
                </p>
            </div>
        </div>

        <div class="mt-3 flex items-center gap-2" @click.stop>
            <slot name="action">
                <button
                    v-if="!isSaved(sale.id)"
                    class="flex-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                    :disabled="saving"
                    @click="onLetsGo"
                >
                    {{ saving ? 'Saving…' : "Let's go!" }}
                </button>
                <template v-else>
                    <span
                        class="flex-1 rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-semibold text-green-700"
                    >
                        ✓ On your list
                    </span>
                    <button
                        type="button"
                        class="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                        :disabled="removing"
                        :aria-label="`Remove ${sale.title} from saved sales`"
                        @click="onRemove"
                    >
                        {{ removing ? 'Removing…' : 'Remove' }}
                    </button>
                </template>
            </slot>
        </div>
    </article>
</template>
