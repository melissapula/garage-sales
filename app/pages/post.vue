<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const today = new Date().toISOString().slice(0, 10)

const title = ref('')
const description = ref('')
const addressInput = ref('')
const resolved = ref<{ address: string; lat: number; lng: number } | null>(null)
const startDate = ref('')
const endDate = ref('')
const startTime = ref('')
const endTime = ref('')
const photos = ref<string[]>([])
const contactEnabled = ref(true)

const error = ref<string | null>(null)
const geocoding = ref(false)
const saving = ref(false)

// Re-geocode forces the user to confirm whenever they edit the address text.
watch(addressInput, () => {
    if (resolved.value && resolved.value.address !== addressInput.value) {
        resolved.value = null
    }
})

const validationError = computed<string | null>(() => {
    if (!title.value.trim()) return 'Add a title.'
    if (!resolved.value) return 'Find the address on the map first.'
    if (!startDate.value) return 'Pick a start date.'
    if (startDate.value < today) return "Start date can't be in the past."
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
            error.value = "Couldn't find that address. Try adding city/state."
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
    if (!user.value) {
        error.value = 'You need to be signed in.'
        return
    }
    saving.value = true

    // Reject if another active sale at the same address overlaps these dates.
    try {
        const conflict = await findOverlappingSale(
            resolved.value!.lat,
            resolved.value!.lng,
            startDate.value,
            endDate.value,
        )
        if (conflict) {
            saving.value = false
            error.value =
                `There's already a sale at this address overlapping these dates: ` +
                `"${conflict.title}" (${conflict.start_date} – ${conflict.end_date}). ` +
                `If you think that listing is wrong, use the Contact link in the footer to let us know.`
            return
        }
    } catch {
        // If the dup-check call itself fails, don't block — fall through.
    }

    const { data, error: err } = await supabase
        .from('garage_sales')
        .insert({
            user_id: user.value.id,
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
        .select('id')
        .single()
    saving.value = false
    if (err) {
        error.value = err.message
        return
    }
    router.push(`/sale/${data.id}`)
}
</script>

<template>
    <section class="mx-auto max-w-2xl px-4 py-8">
        <h1 class="font-display text-3xl font-bold text-gray-900">Post a garage sale</h1>
        <p class="mt-2 text-gray-600">It'll show up on the map for everyone to find.</p>

        <form class="mt-8 space-y-5" @submit.prevent="submit">
            <div>
                <label class="block text-sm font-medium text-gray-700" for="title">Title</label>
                <input
                    id="title"
                    v-model="title"
                    required
                    maxlength="120"
                    placeholder="Big multi-family sale"
                    class="input mt-1"
                />
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
                    placeholder="Furniture, kids' clothes, tools, books, kitchen stuff…"
                    class="input mt-1"
                />
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700" for="address">
                    Address <span class="text-red-600">*</span>
                </label>
                <div class="mt-1 flex flex-col gap-2 sm:flex-row">
                    <input
                        id="address"
                        v-model="addressInput"
                        required
                        placeholder="123 Main St, City, State"
                        class="input flex-1"
                    />
                    <button
                        type="button"
                        class="btn-secondary !min-h-[44px] sm:w-40"
                        :disabled="geocoding"
                        @click="findAddress"
                    >
                        {{ geocoding ? 'Finding…' : 'Find address' }}
                    </button>
                </div>
                <p
                    v-if="resolved"
                    class="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"
                >
                    📍 {{ resolved.address }}
                </p>
                <p v-else class="mt-1 text-xs text-gray-500">
                    Type an address and click <em>Find address</em> to confirm it on the map.
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
                        :min="today"
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
                <PhotoUploader v-model="photos" class="mt-1" />
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
                        Messages land in your inbox. Uncheck if you'd rather not be contacted.
                    </span>
                </span>
            </label>

            <p
                v-if="error"
                class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
                {{ error }}
            </p>
            <p
                v-else-if="!isValid"
                class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
                {{ validationError }}
            </p>

            <div class="flex gap-3">
                <button
                    type="submit"
                    class="btn-primary"
                    :disabled="saving || !isValid"
                >
                    {{ saving ? 'Posting…' : 'Post sale' }}
                </button>
                <NuxtLink to="/browse" class="btn-secondary">Cancel</NuxtLink>
            </div>
        </form>
    </section>
</template>
