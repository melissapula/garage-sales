<script setup lang="ts">
const { pending, answer } = useConfirm()

const dialogEl = ref<HTMLElement | null>(null)
const isOpen = computed(() => !!pending.value)

useFocusTrap(dialogEl, isOpen)

// Escape closes (cancels). Enter is intentionally NOT handled globally
// here — the previous version fired the destructive action on Enter
// regardless of focus, which let stray keystrokes confirm a delete. Now
// Enter only fires when the user has explicitly focused the Confirm
// button (browser-default click activation), and the focus trap focuses
// the Cancel button on open so Enter on first paint cancels.
function onKeydown(ev: KeyboardEvent) {
    if (!pending.value) return
    if (ev.key === 'Escape') answer(false)
}

watch(pending, (p) => {
    if (typeof document === 'undefined') return
    if (p) {
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

const confirmButtonClass = computed(() => {
    const tone = pending.value?.options.tone ?? 'default'
    if (tone === 'danger') {
        return 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500'
    }
    return 'bg-brand-500 text-white hover:bg-brand-600 focus:ring-brand-500'
})
</script>

<template>
    <Teleport v-if="pending" to="body">
        <div
            ref="dialogEl"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            @click.self="answer(false)"
        >
            <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <h3 class="font-display text-lg font-bold text-gray-900">
                    {{ pending.options.title }}
                </h3>
                <p
                    v-if="pending.options.description"
                    class="mt-2 text-sm text-gray-700"
                >
                    {{ pending.options.description }}
                </p>
                <div class="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        class="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                        @click="answer(false)"
                    >
                        {{ pending.options.cancelText ?? 'Cancel' }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex min-h-[40px] items-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2"
                        :class="confirmButtonClass"
                        @click="answer(true)"
                    >
                        {{ pending.options.confirmText ?? 'Confirm' }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>
