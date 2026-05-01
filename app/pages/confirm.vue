<script setup lang="ts">
const user = useSupabaseUser()
const router = useRouter()

watchEffect(() => {
    if (user.value) router.push('/browse')
})
</script>

<template>
    <section class="mx-auto max-w-md px-4 py-16 text-center">
        <h1 class="font-display text-3xl font-bold text-gray-900">Confirming your account…</h1>
        <p class="mt-2 text-gray-600">One moment.</p>
    </section>
</template>
