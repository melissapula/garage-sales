<script setup lang="ts">
const { toasts, dismiss } = useToast()

function toneClass(tone: string) {
    if (tone === 'error') return 'bg-red-50 text-red-900 ring-red-200'
    if (tone === 'success') return 'bg-green-50 text-green-900 ring-green-200'
    return 'bg-sky-50 text-sky-900 ring-sky-200'
}
</script>

<template>
    <Teleport to="body">
        <div
            class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6"
        >
            <TransitionGroup
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="opacity-0 translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
            >
                <div
                    v-for="t in toasts"
                    :key="t.id"
                    class="pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ring-1"
                    :class="toneClass(t.tone)"
                    :role="t.tone === 'error' ? 'alert' : 'status'"
                >
                    <span class="min-w-0 flex-1 whitespace-pre-line">{{ t.message }}</span>
                    <button
                        class="-mr-1 shrink-0 rounded p-0.5 text-gray-400 hover:bg-black/5 hover:text-gray-700"
                        aria-label="Dismiss"
                        @click="dismiss(t.id)"
                    >
                        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            />
                        </svg>
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>
