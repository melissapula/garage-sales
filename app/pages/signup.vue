<script setup lang="ts">
const supabase = useSupabaseClient()
const config = useRuntimeConfig()

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const sent = ref(false)

async function submit() {
    error.value = null
    loading.value = true
    const { error: err } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
        options: {
            emailRedirectTo: `${config.public.siteUrl}/confirm`,
        },
    })
    loading.value = false
    if (err) {
        error.value = err.message
        return
    }
    sent.value = true
}
</script>

<template>
    <section class="mx-auto max-w-md px-4 py-10 sm:py-16">
        <h1 class="font-display text-3xl font-bold text-gray-900">Create an account</h1>
        <p class="mt-2 text-gray-600">Post sales and save itineraries.</p>

        <div v-if="sent" class="mt-8 rounded-lg bg-green-50 p-4 text-green-800">
            <p class="font-medium">Check your email.</p>
            <p class="mt-1 text-sm">
                We sent a confirmation link to <strong>{{ email }}</strong>.
            </p>
        </div>

        <form v-else class="mt-8 space-y-4" @submit.prevent="submit">
            <div>
                <label class="block text-sm font-medium text-gray-700" for="email">Email</label>
                <input
                    id="email"
                    v-model="email"
                    type="email"
                    autocomplete="email"
                    required
                    class="input mt-1"
                />
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700" for="password">
                    Password
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
                <p class="mt-1 text-xs text-gray-500">At least 8 characters.</p>
            </div>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>

            <button type="submit" class="btn-primary w-full" :disabled="loading">
                {{ loading ? 'Creating account…' : 'Create account' }}
            </button>
        </form>

        <p class="mt-6 text-center text-sm text-gray-600">
            Already have an account?
            <NuxtLink to="/login" class="text-sky-700 hover:underline">Sign in</NuxtLink>
        </p>
    </section>
</template>
