<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const route = useRoute()

const error = ref<string | null>(null)

async function processCallback() {
    // PKCE / email-confirmation flow: ?code=… in the URL.
    const code = route.query.code as string | undefined
    if (code) {
        const { error: err } = await supabase.auth.exchangeCodeForSession(code)
        if (err) {
            error.value = err.message
            return
        }
    }

    // For implicit (hash) tokens the Supabase client auto-detects on init.
    // Whichever path we took, ask for the session now.
    const { data } = await supabase.auth.getSession()
    if (data.session) {
        router.push('/browse')
        return
    }

    // No session even after processing — give the page a moment in case the
    // module middleware is still finishing up, then surface a meaningful error.
    setTimeout(async () => {
        const { data: late } = await supabase.auth.getSession()
        if (late.session) {
            router.push('/browse')
        } else {
            error.value =
                "We couldn't confirm your account. The link may have expired or already been used."
        }
    }, 1500)
}

onMounted(processCallback)

// Belt-and-suspenders: if the module finishes setting the user after our check,
// still navigate.
watchEffect(() => {
    if (user.value) router.push('/browse')
})
</script>

<template>
    <section class="mx-auto max-w-md px-4 py-16 text-center">
        <h1 class="font-display text-3xl font-bold text-gray-900">
            {{ error ? 'Confirmation issue' : 'Confirming your account…' }}
        </h1>
        <p v-if="error" class="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {{ error }}
        </p>
        <p v-else class="mt-2 text-gray-600">One moment.</p>

        <div v-if="error" class="mt-6 text-sm">
            <NuxtLink to="/login" class="text-sky-700 hover:underline">Sign in</NuxtLink>
            <span class="mx-2 text-gray-400">·</span>
            <NuxtLink to="/forgot-password" class="text-sky-700 hover:underline">
                Reset password
            </NuxtLink>
            <span class="mx-2 text-gray-400">·</span>
            <NuxtLink to="/signup" class="text-sky-700 hover:underline">Try signup again</NuxtLink>
        </div>
    </section>
</template>
