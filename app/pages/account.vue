<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()

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
    </section>
</template>
