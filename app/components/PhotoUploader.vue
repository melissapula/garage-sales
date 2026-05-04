<script setup lang="ts">
const MAX_PHOTOS = 10

const props = defineProps<{
    modelValue: string[]
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', urls: string[]): void
}>()

const { uploadPhoto, deletePhotos } = useSalePhotos()

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)

const dragActive = ref(false)
let dragDepth = 0

const remainingSlots = computed(() => Math.max(0, MAX_PHOTOS - props.modelValue.length))
const limitReached = computed(() => remainingSlots.value === 0)

async function processFiles(files: File[]) {
    if (files.length === 0) return
    error.value = null

    let toUpload = files
    if (toUpload.length > remainingSlots.value) {
        const dropped = toUpload.length - remainingSlots.value
        toUpload = toUpload.slice(0, remainingSlots.value)
        error.value = `Only ${remainingSlots.value} more photo${remainingSlots.value === 1 ? '' : 's'} fits — ${dropped} skipped.`
    }
    if (toUpload.length === 0) {
        if (limitReached.value) error.value = `You've hit the ${MAX_PHOTOS}-photo limit.`
        if (fileInput.value) fileInput.value.value = ''
        return
    }

    uploading.value = true
    try {
        // Separate non-image files first so they don't poison the upload
        // pool; track them for a single combined error message.
        const validFiles: File[] = []
        const messages: string[] = []
        for (const f of toUpload) {
            if (f.type.startsWith('image/')) validFiles.push(f)
            else messages.push(`${f.name} isn't an image — skipped.`)
        }

        // Upload in parallel with a small concurrency cap — Supabase Storage
        // handles concurrent puts fine, but we don't want to slam slow
        // connections with 10-at-once. Use allSettled so one failure
        // doesn't kill the rest of the batch.
        const concurrency = 3
        const newUrls: string[] = []
        for (let i = 0; i < validFiles.length; i += concurrency) {
            const chunk = validFiles.slice(i, i + concurrency)
            const results = await Promise.allSettled(chunk.map((f) => uploadPhoto(f)))
            results.forEach((r, j) => {
                if (r.status === 'fulfilled') {
                    newUrls.push(r.value)
                } else {
                    const why = r.reason instanceof Error ? r.reason.message : 'upload failed'
                    messages.push(`${chunk[j]!.name}: ${why}`)
                }
            })
        }

        if (newUrls.length) emit('update:modelValue', [...props.modelValue, ...newUrls])
        if (messages.length) {
            error.value = (error.value ? error.value + ' ' : '') + messages.join(' ')
        }
    } finally {
        uploading.value = false
        if (fileInput.value) fileInput.value.value = ''
    }
}

async function onPicked(ev: Event) {
    const input = ev.target as HTMLInputElement
    if (!input.files || input.files.length === 0) return
    await processFiles(Array.from(input.files))
}

function onDragEnter(ev: DragEvent) {
    if (!ev.dataTransfer) return
    const hasFiles = Array.from(ev.dataTransfer.items ?? []).some((i) => i.kind === 'file')
    if (!hasFiles) return
    dragDepth++
    dragActive.value = true
}

function onDragOver(ev: DragEvent) {
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

function onDragLeave() {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) dragActive.value = false
}

async function onDrop(ev: DragEvent) {
    dragDepth = 0
    dragActive.value = false
    const files = ev.dataTransfer?.files
    if (!files || files.length === 0) return
    await processFiles(Array.from(files))
}

async function removeAt(idx: number) {
    const url = props.modelValue[idx]
    if (!url) return
    const next = props.modelValue.slice()
    next.splice(idx, 1)
    emit('update:modelValue', next)
    deletePhotos([url]).catch(() => {})
}

function pick() {
    fileInput.value?.click()
}
</script>

<template>
    <div
        class="rounded-xl border-2 border-dashed bg-white p-3 transition sm:p-4"
        :class="dragActive ? 'border-brand-500 bg-orange-50' : 'border-gray-300'"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
    >
        <div v-if="modelValue.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <div
                v-for="(url, i) in modelValue"
                :key="url"
                class="group relative aspect-square overflow-hidden rounded-lg bg-gray-100 ring-1 ring-orange-100"
            >
                <img :src="url" class="h-full w-full object-cover" :alt="`Photo ${i + 1}`" />
                <button
                    type="button"
                    class="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="Remove photo"
                    @click="removeAt(i)"
                >
                    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        />
                    </svg>
                </button>
            </div>
        </div>

        <div
            v-else
            class="pointer-events-none flex flex-col items-center justify-center py-6 text-center text-sm text-gray-500"
        >
            <svg
                class="mb-2 h-8 w-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                viewBox="0 0 24 24"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
            </svg>
            <p class="font-medium text-gray-700">Drag photos here</p>
            <p class="mt-0.5 text-xs">or click below to browse — up to {{ MAX_PHOTOS }} images</p>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-3">
            <input
                ref="fileInput"
                type="file"
                accept="image/*"
                multiple
                class="sr-only"
                @change="onPicked"
            />
            <button
                type="button"
                class="btn-secondary !min-h-[40px] !px-4 !py-2 text-sm disabled:cursor-not-allowed"
                :disabled="uploading || limitReached"
                @click="pick"
            >
                {{
                    uploading
                        ? 'Uploading…'
                        : limitReached
                          ? `${MAX_PHOTOS}-photo limit reached`
                          : modelValue.length
                            ? '+ Add more photos'
                            : 'Browse files'
                }}
            </button>
            <span class="text-xs text-gray-500">
                {{ modelValue.length }} of {{ MAX_PHOTOS }} photo{{ MAX_PHOTOS === 1 ? '' : 's' }}
            </span>
        </div>

        <p v-if="error" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {{ error }}
        </p>
    </div>
</template>
