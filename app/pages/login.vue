<script setup lang="ts">
const supabase = useSupabaseClient()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

async function submit() {
    error.value = null
    loading.value = true
    const { error: err } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
    })
    loading.value = false
    if (err) {
        error.value = err.message
        return
    }
    const redirect = (route.query.redirect as string) || '/browse'
    router.push(redirect)
}
</script>

<template>
    <section class="mx-auto max-w-md px-4 py-10 sm:py-16">
        <h1 class="font-display text-3xl font-bold text-gray-900">Sign in</h1>
        <p class="mt-2 text-gray-600">Welcome back to Bemidji Garage Sales.</p>

        <form class="mt-8 space-y-4" @submit.prevent="submit">
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
                    autocomplete="current-password"
                    required
                    class="input mt-1"
                />
            </div>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>

            <button type="submit" class="btn-primary w-full" :disabled="loading">
                {{ loading ? 'Signing in…' : 'Sign in' }}
            </button>
        </form>

        <div class="mt-6 flex items-center justify-between text-sm">
            <NuxtLink to="/forgot-password" class="text-sky-700 hover:underline">
                Forgot password?
            </NuxtLink>
            <NuxtLink to="/signup" class="text-sky-700 hover:underline">
                Need an account? Sign up
            </NuxtLink>
        </div>
    </section>
</template>
