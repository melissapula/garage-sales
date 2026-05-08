<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const { data: profile, refresh } = await useAsyncData(
    'my-profile',
    async () => {
        if (!user.value) return null
        const { data, error } = await supabase
            .from('profiles')
            .select('id, display_name, created_at')
            .eq('id', user.value.id)
            .maybeSingle()
        if (error) throw error
        return data as { id: string; display_name: string; created_at: string } | null
    },
    { watch: [user] },
)

const displayName = ref(profile.value?.display_name ?? '')
watch(profile, (p) => {
    displayName.value = p?.display_name ?? ''
})

const saving = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

const isValid = computed(() => {
    const trimmed = displayName.value.trim()
    return trimmed.length >= 1 && trimmed.length <= 60
})

const isDirty = computed(
    () => displayName.value.trim() !== (profile.value?.display_name ?? ''),
)

async function save() {
    if (!user.value || !isValid.value) return
    saving.value = true
    message.value = null
    error.value = null
    const { error: err } = await supabase
        .from('profiles')
        .update({ display_name: displayName.value.trim() })
        .eq('id', user.value.id)
    saving.value = false
    if (err) {
        error.value = err.message
        return
    }
    message.value = 'Saved.'
    setTimeout(() => (message.value = null), 2000)
    await refresh()
}

const memberSince = computed(() =>
    profile.value
        ? new Date(profile.value.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
          })
        : '',
)

// =============================================================================
// Danger zone — delete my account
// =============================================================================
const deleteOpen = ref(false)
const deleteInput = ref('')
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const canDelete = computed(() => deleteInput.value.trim().toUpperCase() === 'DELETE')

async function purgeUserPhotos(userId: string) {
    // List + remove the entire <userId>/ folder in sale-photos. The
    // single-page list cap is 1000, so loop until a partial / empty page
    // confirms we've drained the folder. Otherwise a power user with
    // >1000 photos would leave orphans.
    //
    // Capped at 20 iterations (= 20,000 photos) so a pathological case
    // — e.g. a partial-failure delete that keeps the page full and
    // never shrinks — can't spin forever blocking account deletion.
    const PAGE = 1000
    const MAX_ITERATIONS = 20
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const { data: files } = await supabase.storage
            .from('sale-photos')
            .list(userId, { limit: PAGE })
        if (!files || files.length === 0) return
        const paths = files.map((f) => `${userId}/${f.name}`)
        await supabase.storage.from('sale-photos').remove(paths)
        if (files.length < PAGE) return
    }
    console.warn(
        '[purgeUserPhotos] hit iteration cap; some photos may remain in storage',
    )
}

function cancelDelete() {
    deleteOpen.value = false
    deleteInput.value = ''
    deleteError.value = null
}

async function deleteAccount() {
    if (!user.value || !canDelete.value || deleting.value) return
    deleting.value = true
    deleteError.value = null
    const userId = user.value.id
    try {
        // Best-effort photo cleanup while the session is still valid.
        try {
            await purgeUserPhotos(userId)
        } catch {
            // Non-blocking — DB cascade still runs even if storage fails.
        }

        // Cascade-deletes everything tied to this user via the RPC.
        const { error } = await supabase.rpc('delete_my_account')
        if (error) throw error

        // Session is now invalid; signOut clears the local session state.
        await supabase.auth.signOut()
        await router.push('/?account_deleted=1')
    } catch (e) {
        deleteError.value = e instanceof Error ? e.message : 'Could not delete account'
        deleting.value = false
    }
}
</script>

<template>
    <section class="mx-auto max-w-xl px-4 py-8">
        <h1 class="font-display text-3xl font-bold text-gray-900">Account</h1>
        <p class="mt-2 text-sm text-gray-600">
            Your display name shows in conversations and on shared sales.
        </p>

        <form
            class="mt-6 space-y-5 rounded-xl bg-white p-5 ring-1 ring-orange-100"
            @submit.prevent="save"
        >
            <div>
                <label class="block text-sm font-medium text-gray-700" for="display-name">
                    Display name
                </label>
                <input
                    id="display-name"
                    v-model="displayName"
                    required
                    minlength="1"
                    maxlength="60"
                    class="input mt-1"
                />
                <p class="mt-1 text-xs text-gray-500">
                    Up to 60 characters. People you message will see this name.
                </p>
            </div>

            <div class="text-sm text-gray-600">
                <p>
                    <strong>Email:</strong>
                    {{ user?.email }}
                    <span class="text-gray-400">(can't be changed here)</span>
                </p>
                <p v-if="memberSince" class="mt-1">
                    <strong>Member since:</strong> {{ memberSince }}
                </p>
            </div>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>
            <p v-else-if="message" class="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                {{ message }}
            </p>

            <div class="flex gap-3">
                <button
                    type="submit"
                    class="btn-primary"
                    :disabled="saving || !isValid || !isDirty"
                >
                    {{ saving ? 'Saving…' : 'Save changes' }}
                </button>
            </div>
        </form>

        <!-- Danger zone -->
        <section class="mt-10 rounded-xl border border-red-200 bg-red-50 p-5">
            <h2 class="font-display text-lg font-bold text-red-900">Delete account</h2>
            <p class="mt-1 text-sm text-red-800">
                Permanently delete your account along with every sale you've posted, every saved
                sale, every route you've planned, and every conversation you've had. This can't
                be undone.
            </p>

            <button
                v-if="!deleteOpen"
                type="button"
                class="mt-4 inline-flex min-h-[40px] items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                @click="deleteOpen = true"
            >
                Delete my account
            </button>

            <div v-else class="mt-4 space-y-3">
                <p class="text-sm text-red-900">
                    To confirm, type <strong class="font-mono">DELETE</strong> below.
                </p>
                <input
                    v-model="deleteInput"
                    placeholder="Type DELETE to confirm"
                    class="input border-red-300 focus:border-red-500 focus:ring-red-500"
                />
                <p
                    v-if="deleteError"
                    class="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
                >
                    {{ deleteError }}
                </p>
                <div class="flex flex-wrap gap-2">
                    <button
                        type="button"
                        class="inline-flex min-h-[44px] items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!canDelete || deleting"
                        @click="deleteAccount"
                    >
                        {{ deleting ? 'Deleting…' : 'Permanently delete account' }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        :disabled="deleting"
                        @click="cancelDelete"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </section>
    </section>
</template>
