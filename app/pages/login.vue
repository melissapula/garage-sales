<script setup lang="ts">
import VueHcaptcha from '@hcaptcha/vue3-hcaptcha'

const supabase = useSupabaseClient()
const config = useRuntimeConfig()
const router = useRouter()
const route = useRoute()

const hcaptchaSiteKey = (config.public.hcaptchaSiteKey as string) || ''
const captchaEnabled = computed(() => hcaptchaSiteKey.length > 0)

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const captchaToken = ref<string | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const hcaptchaRef = ref<InstanceType<typeof VueHcaptcha> | null>(null)

const justConfirmed = computed(() => route.query.confirmed === '1')
const signedOutForIdle = computed(() => route.query.idle === '1')
const passwordType = computed(() => (showPassword.value ? 'text' : 'password'))
const canSubmit = computed(
    () =>
        email.value.length > 0 &&
        password.value.length > 0 &&
        (!captchaEnabled.value || captchaToken.value !== null),
)

function onCaptchaVerify(token: string) {
    captchaToken.value = token
}
function onCaptchaExpired() {
    captchaToken.value = null
}
function onCaptchaError() {
    captchaToken.value = null
}

async function submit() {
    error.value = null
    if (!canSubmit.value) return
    loading.value = true
    const { error: err } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
        options: captchaToken.value ? { captchaToken: captchaToken.value } : undefined,
    })
    loading.value = false
    if (captchaEnabled.value) {
        captchaToken.value = null
        hcaptchaRef.value?.reset()
    }
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
        <p class="mt-2 text-gray-600">Welcome back to Garage Sale Tracker.</p>

        <div
            v-if="justConfirmed"
            class="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800"
        >
            <p class="font-medium">Email confirmed!</p>
            <p class="mt-1">Sign in below to continue.</p>
        </div>

        <div
            v-if="signedOutForIdle"
            class="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800"
        >
            <p class="font-medium">You've been signed out for inactivity.</p>
            <p class="mt-1">Sign in again to pick up where you left off.</p>
        </div>

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
                <div class="flex items-center justify-between">
                    <label class="block text-sm font-medium text-gray-700" for="password">
                        Password
                    </label>
                    <button
                        type="button"
                        class="text-xs font-medium text-sky-700 hover:underline"
                        @click="showPassword = !showPassword"
                    >
                        {{ showPassword ? 'Hide' : 'Show' }}
                    </button>
                </div>
                <div class="relative mt-1">
                    <input
                        id="password"
                        v-model="password"
                        :type="passwordType"
                        autocomplete="current-password"
                        required
                        class="input pr-11"
                    />
                    <button
                        type="button"
                        class="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-400 hover:text-gray-700"
                        :aria-label="showPassword ? 'Hide password' : 'Show password'"
                        @click="showPassword = !showPassword"
                    >
                        <svg
                            v-if="!showPassword"
                            class="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                            />
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                        </svg>
                        <svg
                            v-else
                            class="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            <div v-if="captchaEnabled" class="flex justify-center">
                <VueHcaptcha
                    ref="hcaptchaRef"
                    :sitekey="hcaptchaSiteKey"
                    @verify="onCaptchaVerify"
                    @expired="onCaptchaExpired"
                    @error="onCaptchaError"
                />
            </div>

            <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {{ error }}
            </p>

            <button
                type="submit"
                class="btn-primary w-full"
                :disabled="loading || !canSubmit"
            >
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
