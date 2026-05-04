<script setup lang="ts">
const props = defineProps<{
    photos: string[]
    /** null = closed; number = currently-shown photo index. */
    open: number | null
}>()

const emit = defineEmits<{
    (e: 'update:open', index: number | null): void
}>()

const index = computed({
    get: () => props.open,
    set: (v) => emit('update:open', v),
})

const isOpen = computed(() => index.value !== null)

function close() {
    emit('update:open', null)
}

function next() {
    if (index.value === null) return
    index.value = (index.value + 1) % props.photos.length
}

function prev() {
    if (index.value === null) return
    index.value = (index.value - 1 + props.photos.length) % props.photos.length
}

function onKeydown(ev: KeyboardEvent) {
    if (!isOpen.value) return
    if (ev.key === 'Escape') close()
    else if (ev.key === 'ArrowRight') next()
    else if (ev.key === 'ArrowLeft') prev()
}

// Touch swipe support (simple horizontal swipe).
let touchStartX = 0
let touchStartY = 0

function onTouchStart(ev: TouchEvent) {
    const t = ev.touches[0]
    if (!t) return
    touchStartX = t.clientX
    touchStartY = t.clientY
}

function onTouchEnd(ev: TouchEvent) {
    const t = ev.changedTouches[0]
    if (!t) return
    const dx = t.clientX - touchStartX
    const dy = t.clientY - touchStartY
    // Need a meaningful horizontal swipe (and mostly horizontal).
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next()
        else prev()
    }
}

watch(isOpen, (v) => {
    if (typeof document === 'undefined') return
    if (v) {
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

const dialogEl = ref<HTMLElement | null>(null)
useFocusTrap(dialogEl, isOpen)
</script>

<template>
    <Teleport v-if="isOpen" to="body">
        <div
            ref="dialogEl"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            role="dialog"
            aria-modal="true"
            @click.self="close"
            @touchstart="onTouchStart"
            @touchend="onTouchEnd"
        >
            <button
                type="button"
                class="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                aria-label="Close"
                @click="close"
            >
                <svg class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    />
                </svg>
            </button>

            <button
                v-if="photos.length > 1"
                type="button"
                class="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                aria-label="Previous photo"
                @click.stop="prev"
            >
                <svg class="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                    <path
                        fill-rule="evenodd"
                        d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                        clip-rule="evenodd"
                    />
                </svg>
            </button>

            <button
                v-if="photos.length > 1"
                type="button"
                class="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
                aria-label="Next photo"
                @click.stop="next"
            >
                <svg class="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                    <path
                        fill-rule="evenodd"
                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                        clip-rule="evenodd"
                    />
                </svg>
            </button>

            <img
                v-if="index !== null"
                :src="photos[index]"
                :alt="`Photo ${index + 1} of ${photos.length}`"
                class="max-h-[90vh] max-w-[92vw] select-none object-contain"
                @click.stop
            />

            <div
                v-if="photos.length > 1 && index !== null"
                class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white backdrop-blur"
            >
                {{ index + 1 }} / {{ photos.length }}
            </div>
        </div>
    </Teleport>
</template>
