<script setup lang="ts">
const props = defineProps<{
    open: boolean
    saleId: string
}>()

const emit = defineEmits<{
    (e: 'update:open', v: boolean): void
    (e: 'submitted'): void
}>()

const REASONS = [
    { value: 'false_info', label: 'False or misleading info' },
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'duplicate', label: 'Duplicate of another sale' },
    { value: 'other', label: 'Other' },
] as const

type Reason = typeof REASONS[number]['value']

const reason = ref<Reason | ''>('')
const notes = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

const dialogEl = ref<HTMLElement | null>(null)
const isOpen = computed(() => props.open)

useFocusTrap(dialogEl, isOpen)

function close() {
    emit('update:open', false)
}

// Reset form fields whenever the modal opens — otherwise a previous
// submission's reason/notes would still be sitting there.
watch(isOpen, (open) => {
    if (open) {
        reason.value = ''
        notes.value = ''
        error.value = null
        submitting.value = false
    }
})

function onKeydown(ev: KeyboardEvent) {
    if (!props.open) return
    if (ev.key === 'Escape') close()
}

watch(isOpen, (open) => {
    if (typeof document === 'undefined') return
    if (open) {
        document.body.style.overflow = 'hidden'
        document.addEventListener('keydown', onKeydown)
    } else {
        document.body.style.overflow = ''
        document.removeEventListener('keydown', onKeydown)
    }
})

onBeforeUnmount(() => {
    if (typeof document !== 'undefined') {
        document.body.style.overflow = ''
        document.removeEventListener('keydown', onKeydown)
    }
})

async function submit() {
    if (!reason.value || submitting.value) return
    submitting.value = true
    error.value = null
    try {
        await $fetch('/api/sale-reports', {
            method: 'POST',
            body: {
                saleId: props.saleId,
                reason: reason.value,
                notes: notes.value.trim() || undefined,
            },
        })
        emit('submitted')
        close()
    } catch (e: unknown) {
        const msg =
            e && typeof e === 'object' && 'data' in e && (e as { data: { statusMessage?: string } }).data?.statusMessage
                ? (e as { data: { statusMessage: string } }).data.statusMessage
                : e instanceof Error
                  ? e.message
                  : 'Could not submit report'
        error.value = msg
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <Teleport v-if="open" to="body">
        <div
            ref="dialogEl"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-sale-title"
            @click.self="close"
        >
            <form
                class="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
                @submit.prevent="submit"
            >
                <h3 id="report-sale-title" class="font-display text-lg font-bold text-gray-900">
                    Report this sale
                </h3>
                <p class="mt-1 text-sm text-gray-600">
                    Flag this listing for our review. We read every report and act on
                    confirmed violations.
                </p>

                <div class="mt-4">
                    <label for="report-reason" class="block text-sm font-medium text-gray-700">
                        Reason <span class="text-red-600">*</span>
                    </label>
                    <select
                        id="report-reason"
                        v-model="reason"
                        required
                        class="input mt-1 !min-h-[40px]"
                    >
                        <option value="" disabled>Pick one…</option>
                        <option v-for="r in REASONS" :key="r.value" :value="r.value">
                            {{ r.label }}
                        </option>
                    </select>
                </div>

                <div class="mt-4">
                    <label for="report-notes" class="block text-sm font-medium text-gray-700">
                        Notes (optional)
                    </label>
                    <textarea
                        id="report-notes"
                        v-model="notes"
                        rows="3"
                        maxlength="2000"
                        placeholder="Anything that helps us evaluate this report — e.g. what's wrong, what the address actually is, etc."
                        class="input mt-1"
                    />
                </div>

                <p
                    v-if="error"
                    class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                    {{ error }}
                </p>

                <div class="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        class="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        @click="close"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        class="inline-flex min-h-[40px] items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                        :disabled="submitting || !reason"
                    >
                        {{ submitting ? 'Sending…' : 'Submit report' }}
                    </button>
                </div>
            </form>
        </div>
    </Teleport>
</template>
