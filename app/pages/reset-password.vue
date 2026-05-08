<script setup lang="ts">
const supabase = useSupabaseClient()
const router = useRouter()

const password = ref('')
const passwordConfirm = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

// Did the recovery email link exchange a session for us? If the user
// lands here without one (link expired, opened in a different browser,
// etc.) updateUser would fail with a generic error, so we check up front
// and show a friendlier "request a new link" message.
const sessionState = ref<'checking' | 'ready' | 'missing'>('checking')

onMounted(async () => {
    const { data } = await supabase.auth.getSession()
    sessionState.value = data.session ? 'ready' : 'missing'
})

const passwordTooShort = computed(
    () => password.value.length > 0 && password.value.length < 8,
)
// Only show the mismatch message after the user has tabbed/clicked away
// from the confirm field. Re-rendering "passwords don't match" on every
// keystroke is jarring (the user is mid-typing, of course it doesn't
// match yet) and was the slowest INP measurement in our analytics —
// each keystroke forced a re-render of the conditional <p>. Blur-gating
// makes the message accurate and cuts the per-keystroke render cost.
const passwordConfirmTouched = ref(false)
function onConfirmBlur() {
    passwordConfirmTouched.value = true
}
function onConfirmFocus() {
    // Hide the message again once the user comes back to fix it; we
    // don't want stale "doesn't match" sitting under an actively edited
    // field. Re-shows on next blur.
    passwordConfirmTouched.value = false
}
const passwordsMismatch = computed(
    () =>
        passwordConfirmTouched.value &&
        passwordConfirm.value.length > 0 &&
        password.value !== passwordConfirm.value,
)
const canSubmit = computed(
    () =>
        sessionState.value === 'ready' &&
        password.value.length >= 8 &&
        password.value === passwordConfirm.value,
)

async function submit() {
    error.value = null
    if (!canSubmit.value) return
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

        <p
            v-if="sessionState === 'checking'"
            class="mt-6 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600"
        >
            Verifying your reset link…
        </p>

        <div
            v-else-if="sessionState === 'missing'"
            class="mt-6 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900 ring-1 ring-amber-200"
        >
            <p class="font-medium">Your reset link has expired or was already used.</p>
            <p class="mt-1">
                <NuxtLink to="/forgot-password" class="text-sky-700 hover:underline">
                    Request a new one
                </NuxtLink>
                and we'll email a fresh link.
            </p>
        </div>

        <form v-else class="mt-8 space-y-4" @submit.prevent="submit">
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
                <p
                    v-if="passwordTooShort"
                    class="mt-1 text-xs text-amber-700"
                >
                    Use at least 8 characters.
                </p>
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700" for="passwordConfirm">
                    Confirm new password
                </label>
                <input
                    id="passwordConfirm"
                    v-model="passwordConfirm"
                    type="password"
                    autocomplete="new-password"
                    required
                    class="input mt-1"
                    @blur="onConfirmBlur"
                    @focus="onConfirmFocus"
                />
                <p
                    v-if="passwordsMismatch"
                    class="mt-1 text-xs text-red-700"
                >
                    Passwords don't match.
                </p>
            </div>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>

            <button
                type="submit"
                class="btn-primary w-full"
                :disabled="loading || !canSubmit"
            >
                {{ loading ? 'Updating…' : 'Update password' }}
            </button>
        </form>
    </section>
</template>
