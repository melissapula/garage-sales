<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'
import { GARAGE_SALE_SELECT } from '~/composables/useGarageSales'
import { emptyDay, scheduleDates, scheduleEnvelope, validateSchedule, type ScheduleDay } from '~/utils/schedule'

const route = useRoute()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const toast = useToast()

const id = route.params.id as string

const { data: existing, error: loadError } = await useAsyncData(`edit-${id}`, async () => {
    const { data, error } = await supabase
        .from('garage_sales')
        .select(GARAGE_SALE_SELECT)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    if (error) throw error
    if (!data) {
        throw createError({ statusCode: 404, statusMessage: 'Sale not found' })
    }
    // Ownership check inside the loader so we don't leak the existence
    // of a foreign sale via a 403 vs 404 distinction (RLS would block
    // mutations anyway, but the read here returns the row's full shape
    // including photos, so the cleanest fix is to mask ownership
    // mismatches as not-found upstream of the form mount).
    if (user.value && data.user_id !== user.value.id) {
        throw createError({ statusCode: 404, statusMessage: 'Sale not found' })
    }
    return data as unknown as GarageSale
})

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
const days = ref<ScheduleDay[]>(
    existing.value && existing.value.sale_dates && existing.value.sale_dates.length
        ? existing.value.sale_dates.map((d) => ({
              date: d.sale_date,
              start_time: d.start_time ?? '',
              end_time: d.end_time ?? '',
          }))
        : [emptyDay()],
)
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
    // Edit allows already-past days (e.g. for a sale that's started),
    // but requires at least one day still in the future — same intent
    // as the legacy "end_date can't be in the past" rule.
    return validateSchedule(days.value, { allowPastDates: true, requireFutureEnd: true })
})

const isValid = computed(() => validationError.value === null)

function addDay() {
    const dates = days.value.map((d) => d.date).filter(Boolean).sort()
    let next = ''
    if (dates.length) {
        const last = new Date(dates[dates.length - 1] + 'T00:00:00')
        last.setDate(last.getDate() + 1)
        next = toLocalISO(last)
    }
    const prev = days.value[days.value.length - 1]
    days.value.push({
        date: next,
        start_time: prev?.start_time ?? '',
        end_time: prev?.end_time ?? '',
    })
}

function removeDay(i: number) {
    if (days.value.length === 1) {
        days.value[0] = emptyDay()
        return
    }
    days.value.splice(i, 1)
}

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

    const dates = scheduleDates(days.value)
    const envelope = scheduleEnvelope(days.value)

    // Reject if another active sale at the same address shares any day
    // with this one (excluding this sale itself). The retry helper tries
    // twice; if both attempts fail we still save, but flag the user.
    let dupCheckFailed = false
    try {
        const conflict = await findOverlappingSaleWithRetry(
            user.value!.id,
            resolved.value!.lat,
            resolved.value!.lng,
            dates,
            id,
        )
        if (conflict) {
            saving.value = false
            const dayList = conflict.conflictDates.join(', ')
            error.value =
                `You've already got another sale at this address on ${dayList}: ` +
                `"${conflict.title}". Adjust your days, or edit that listing instead.`
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
            // Envelope columns — the sale_dates trigger will overwrite
            // these with min/max once we sync the rows below. Passing
            // them here keeps the row consistent in the brief moment
            // between the parent UPDATE and the sale_dates writes.
            start_date: envelope.start_date,
            end_date: envelope.end_date,
            start_time: envelope.start_time,
            end_time: envelope.end_time,
            photos: photos.value,
            contact_enabled: contactEnabled.value,
        })
        .eq('id', id)
    if (err) {
        saving.value = false
        error.value = err.message
        return
    }

    // Sync the per-day rows: delete any days the user removed, then
    // upsert the current set (handles both unchanged days, time edits,
    // and brand-new days).
    const oldDates = new Set(
        (existing.value?.sale_dates ?? []).map((d) => d.sale_date),
    )
    const newDates = new Set(dates)
    const toRemove = [...oldDates].filter((d) => !newDates.has(d))
    if (toRemove.length) {
        const { error: delErr } = await supabase
            .from('sale_dates')
            .delete()
            .eq('sale_id', id)
            .in('sale_date', toRemove)
        if (delErr) {
            saving.value = false
            error.value = `Couldn't remove old days: ${delErr.message}`
            return
        }
    }
    const { error: upErr } = await supabase
        .from('sale_dates')
        .upsert(
            days.value.map((d) => ({
                sale_id: id,
                sale_date: d.date,
                start_time: d.start_time,
                end_time: d.end_time,
            })),
            { onConflict: 'sale_id,sale_date' },
        )
    saving.value = false
    if (upErr) {
        error.value = `Couldn't save the schedule: ${upErr.message}`
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

            <!-- Per-day schedule -->
            <div>
                <div class="mb-2 flex items-center justify-between">
                    <label class="block text-sm font-medium text-gray-700">
                        Sale schedule <span class="text-red-600">*</span>
                    </label>
                    <span class="text-xs text-gray-500">
                        {{ days.length }} day{{ days.length === 1 ? '' : 's' }}
                    </span>
                </div>
                <p class="mb-3 text-xs text-gray-500">
                    Add one row per day. Different hours each day? No problem — set them per row.
                </p>

                <ul class="space-y-3">
                    <li
                        v-for="(day, i) in days"
                        :key="i"
                        class="rounded-lg bg-white p-3 ring-1 ring-orange-100"
                    >
                        <div class="mb-2 flex items-center justify-between">
                            <span class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Day {{ i + 1 }}
                            </span>
                            <button
                                type="button"
                                class="text-xs text-red-600 hover:underline"
                                :aria-label="`Remove day ${i + 1}`"
                                @click="removeDay(i)"
                            >
                                {{ days.length === 1 ? 'Clear' : 'Remove' }}
                            </button>
                        </div>
                        <div class="grid gap-2 sm:grid-cols-3">
                            <label class="block">
                                <span class="block text-xs text-gray-600">Date</span>
                                <input
                                    v-model="day.date"
                                    type="date"
                                    required
                                    class="input mt-1 !min-h-[40px] !text-sm"
                                />
                            </label>
                            <label class="block">
                                <span class="block text-xs text-gray-600">Start time</span>
                                <input
                                    v-model="day.start_time"
                                    type="time"
                                    required
                                    class="input mt-1 !min-h-[40px] !text-sm"
                                />
                            </label>
                            <label class="block">
                                <span class="block text-xs text-gray-600">End time</span>
                                <input
                                    v-model="day.end_time"
                                    type="time"
                                    required
                                    class="input mt-1 !min-h-[40px] !text-sm"
                                />
                            </label>
                        </div>
                    </li>
                </ul>

                <button
                    type="button"
                    class="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-dashed border-brand-400 bg-orange-50 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-orange-100"
                    @click="addDay"
                >
                    + Add day
                </button>
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700">
                    Photos (optional, up to 10)
                </label>
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
