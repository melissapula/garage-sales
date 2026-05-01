<script setup lang="ts">
import type { EmailOtpType } from '@supabase/supabase-js'

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const route = useRoute()

const error = ref<string | null>(null)

async function processCallback() {
    // 1. Server-side error (e.g. expired link).
    const errDesc = route.query.error_description as string | undefined
    if (errDesc) {
        error.value = decodeURIComponent(errDesc)
        return
    }

    // 2. Token hash flow (recommended for cross-device email links).
    //    Supabase email template needs {{ .TokenHash }} and a type for this
    //    to work — see README/CLAUDE.md.
    const tokenHash = route.query.token_hash as string | undefined
    const otpType = route.query.type as EmailOtpType | undefined
    if (tokenHash && otpType) {
        const { error: err } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
        })
        if (err) {
            error.value = err.message
            return
        }
        // Recovery (password reset) → land on the reset-password form.
        // Signup / email change / other → straight into the app.
        router.push(otpType === 'recovery' ? '/reset-password' : '/browse')
        return
    }

    // 3. PKCE flow: ?code=… in the URL. Only succeeds on the same device
    //    that initiated signup; otherwise we treat it as "verified but no
    //    local session" and bounce to login with a friendly banner.
    const code = route.query.code as string | undefined
    if (code) {
        const { error: err } = await supabase.auth.exchangeCodeForSession(code)
        if (!err) {
            router.push('/browse')
            return
        }
        // Most common case: cross-device click. The email confirmation has
        // succeeded server-side; the user just needs to sign in fresh here.
        router.push('/login?confirmed=1')
        return
    }

    // Implicit flow recovery sometimes arrives with `?type=recovery` in the
    // URL while the session lands in the hash. If we have a session by now
    // and the type indicates recovery, send them to the reset form.
    if (otpType === 'recovery') {
        const { data } = await supabase.auth.getSession()
        if (data.session) {
            router.push('/reset-password')
            return
        }
    }

    // 4. Implicit flow: hash tokens auto-detected by the client on init.
    //    Give it a beat to settle, then check.
    setTimeout(async () => {
        const { data } = await supabase.auth.getSession()
        if (data.session) {
            router.push('/browse')
        } else {
            error.value =
                "We couldn't confirm your account. The link may have expired or already been used."
        }
    }, 1500)
}

onMounted(processCallback)

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
