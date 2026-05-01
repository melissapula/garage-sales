<script setup lang="ts">
const supabase = useSupabaseClient()
const router = useRouter()

const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

async function submit() {
    error.value = null
    loading.value = true
    const { error: err } = await supabase.auth.updateUser({ password: password.value })
    loading.value = false
    if (err) {
        error.value = err.message
        return
    }
    router.push('/browse')
}
</script>

<template>
    <section class="mx-auto max-w-md px-4 py-10 sm:py-16">
        <h1 class="font-display text-3xl font-bold text-gray-900">Choose a new password</h1>

        <form class="mt-8 space-y-4" @submit.prevent="submit">
            <div>
                <label class="block text-sm font-medium text-gray-700" for="password">
                    New password
                </label>
                <input
                    id="password"
                    v-model="password"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    required
                    class="input mt-1"
                />
            </div>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>

            <button type="submit" class="btn-primary w-full" :disabled="loading">
                {{ loading ? 'Updating…' : 'Update password' }}
            </button>
        </form>
    </section>
</template>
