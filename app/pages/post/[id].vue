<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'

const route = useRoute()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const toast = useToast()

const id = route.params.id as string
const today = todayLocalISO()

const { data: existing, error: loadError } = await useAsyncData(`edit-${id}`, async () => {
    const { data, error } = await supabase
        .from('garage_sales')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    if (error) throw error
    if (!data) {
        throw createError({ statusCode: 404, statusMessage: 'Sale not found' })
    }
    return data as GarageSale
})

if (existing.value && user.value && existing.value.user_id !== user.value.id) {
    throw createError({ statusCode: 403, statusMessage: 'Not your sale' })
}

const title = ref(existing.value?.title ?? '')
const description = ref(existing.value?.description ?? '')
const addressInput = ref(existing.value?.address ?? '')
const resolved = ref<{ address: string; lat: number; lng: number } | null>(
    existing.value
        ? {
              address: existing.value.address,
              lat: existing.value.lat,
              lng: existing.value.lng,
          }
        : null,
)
const startDate = ref(existing.value?.start_date ?? '')
const endDate = ref(existing.value?.end_date ?? '')
const startTime = ref(existing.value?.start_time ?? '')
const endTime = ref(existing.value?.end_time ?? '')
const photos = ref<string[]>(existing.value?.photos ?? [])
const contactEnabled = ref<boolean>(existing.value?.contact_enabled ?? true)

const error = ref<string | null>(null)
const geocoding = ref(false)
const saving = ref(false)

// PhotoUploader stages storage deletes for already-saved photos and
// only commits them after we successfully persist the form. That way a
// user who removes a photo and then closes the page without saving
// still has the photo when they come back.
const photoUploaderRef = ref<{ commitPendingDeletes: () => Promise<void> } | null>(null)

watch(addressInput, () => {
    if (resolved.value && resolved.value.address !== addressInput.value) {
        resolved.value = null
    }
})

const validationError = computed<string | null>(() => {
    if (!title.value.trim()) return 'Add a title.'
    if (!resolved.value) return 'Find the address on the map first.'
    if (!startDate.value) return 'Pick a start date.'
    if (!endDate.value) return 'Pick an end date.'
    if (endDate.value < today) return "End date can't be in the past."
    if (endDate.value < startDate.value) return 'End date must be on or after the start date.'
    if (!startTime.value) return 'Pick a start time.'
    if (!endTime.value) return 'Pick an end time.'
    if (startDate.value === endDate.value && endTime.value <= startTime.value) {
        return 'End time must be after the start time.'
    }
    return null
})

const isValid = computed(() => validationError.value === null)

async function findAddress() {
    error.value = null
    if (!addressInput.value.trim()) {
        error.value = 'Enter an address first.'
        return
    }
    geocoding.value = true
    try {
        const result = await geocodeAddress(addressInput.value.trim())
        if (!result) {
            error.value = "Couldn't find that address."
            resolved.value = null
            return
        }
        resolved.value = result
        addressInput.value = result.address
    } catch (e: unknown) {
        error.value = e instanceof Error ? e.message : 'Geocoding failed'
    } finally {
        geocoding.value = false
    }
}

async function submit() {
    error.value = null
    if (!isValid.value) {
        error.value = validationError.value
        return
    }
    saving.value = true

    // Reject if another active sale at the same address overlaps these dates,
    // excluding this sale itself. The retry helper tries twice; if both
    // attempts fail we still save, but flag the user afterwards.
    let dupCheckFailed = false
    try {
        const conflict = await findOverlappingSaleWithRetry(
            user.value!.id,
            resolved.value!.lat,
            resolved.value!.lng,
            startDate.value,
            endDate.value,
            id,
        )
        if (conflict) {
            saving.value = false
            error.value =
                `You've already got another sale at this address overlapping these dates: ` +
                `"${conflict.title}" (${conflict.start_date} – ${conflict.end_date}). ` +
                `Adjust your dates, or edit that listing instead.`
            return
        }
    } catch {
        dupCheckFailed = true
    }

    const { error: err } = await supabase
        .from('garage_sales')
        .update({
            title: title.value.trim(),
            description: description.value.trim() || null,
            address: resolved.value!.address,
            lat: resolved.value!.lat,
            lng: resolved.value!.lng,
            start_date: startDate.value,
            end_date: endDate.value,
            start_time: startTime.value,
            end_time: endTime.value,
            photos: photos.value,
            contact_enabled: contactEnabled.value,
        })
        .eq('id', id)
    saving.value = false
    if (err) {
        error.value = err.message
        return
    }
    // Now that the new photos[] is persisted, commit any storage deletes
    // the user staged via the photo uploader's "X" button.
    await photoUploaderRef.value?.commitPendingDeletes()
    if (dupCheckFailed) {
        toast.info(
            "We couldn't verify you don't already have another sale at this address. Your edits are saved — please double-check 'My sales' for a duplicate.",
        )
    }
    router.push(`/sale/${id}`)
}
</script>

<template>
    <section class="mx-auto max-w-2xl px-4 py-8">
        <h1 class="font-display text-3xl font-bold text-gray-900">Edit sale</h1>

        <div v-if="loadError" class="mt-6 rounded-lg bg-red-50 p-4 text-red-700">
            {{ loadError.message }}
        </div>
        <div
            v-else-if="!existing"
            class="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600"
        >
            That sale doesn't exist.
        </div>

        <form v-else class="mt-8 space-y-5" @submit.prevent="submit">
            <div>
                <label class="block text-sm font-medium text-gray-700" for="title">Title</label>
                <input id="title" v-model="title" required maxlength="120" class="input mt-1" />
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700" for="description">
                    Description
                </label>
                <textarea
                    id="description"
                    v-model="description"
                    rows="3"
                    maxlength="2000"
                    class="input mt-1"
                />
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700" for="address">
                    Address <span class="text-red-600">*</span>
                </label>
                <div class="mt-1 flex flex-col gap-2 sm:flex-row">
                    <input id="address" v-model="addressInput" required class="input flex-1" />
                    <button
                        type="button"
                        class="btn-secondary !min-h-[44px] sm:w-40"
                        :disabled="geocoding"
                        @click="findAddress"
                    >
                        {{ geocoding ? 'Finding…' : 'Re-geocode' }}
                    </button>
                </div>
                <p
                    v-if="resolved"
                    class="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"
                >
                    📍 {{ resolved.address }}
                </p>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
                <div>
                    <label class="block text-sm font-medium text-gray-700" for="start-date">
                        Start date <span class="text-red-600">*</span>
                    </label>
                    <input
                        id="start-date"
                        v-model="startDate"
                        type="date"
                        required
                        class="input mt-1"
                    />
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700" for="end-date">
                        End date <span class="text-red-600">*</span>
                    </label>
                    <input
                        id="end-date"
                        v-model="endDate"
                        type="date"
                        required
                        :min="startDate || today"
                        class="input mt-1"
                    />
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700" for="start-time">
                        Start time <span class="text-red-600">*</span>
                    </label>
                    <input
                        id="start-time"
                        v-model="startTime"
                        type="time"
                        required
                        class="input mt-1"
                    />
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700" for="end-time">
                        End time <span class="text-red-600">*</span>
                    </label>
                    <input
                        id="end-time"
                        v-model="endTime"
                        type="time"
                        required
                        class="input mt-1"
                    />
                </div>
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700">Photos (optional)</label>
                <PhotoUploader ref="photoUploaderRef" v-model="photos" class="mt-1" />
            </div>

            <label class="flex cursor-pointer items-start gap-2 rounded-lg bg-white p-3 ring-1 ring-orange-100">
                <input
                    v-model="contactEnabled"
                    type="checkbox"
                    class="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                <span class="text-sm">
                    <span class="font-medium text-gray-900">
                        Allow people to message me about this sale
                    </span>
                    <span class="block text-xs text-gray-600">
                        Uncheck to disable the message button on this listing.
                    </span>
                </span>
            </label>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>
            <p
                v-else-if="!isValid && existing"
                class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
                {{ validationError }}
            </p>

            <div class="flex gap-3">
                <button type="submit" class="btn-primary" :disabled="saving || !isValid">
                    {{ saving ? 'Saving…' : 'Save changes' }}
                </button>
                <NuxtLink :to="`/sale/${id}`" class="btn-secondary">Cancel</NuxtLink>
            </div>
        </form>
    </section>
</template>
