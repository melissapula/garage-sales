<script setup lang="ts">
import type { GarageSale } from '~/composables/useGarageSales'

const route = useRoute()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const id = route.params.id as string

const { data: sale, error } = await useAsyncData(`sale-${id}`, async () => {
    const { data, error: err } = await supabase
        .from('garage_sales')
        .select('*')
        .eq('id', id)
        .maybeSingle()
    if (err) throw err
    return data as GarageSale | null
})

const isOwner = computed(() => sale.value && user.value && sale.value.user_id === user.value.id)
const status = computed(() => (sale.value ? saleStatus(sale.value) : null))

const { isSaved, save, unsave, refresh: refreshSaved } = useSavedSales()
const { deletePhotos } = useSalePhotos()

const config = useRuntimeConfig()
const shareUrl = computed(() => `${config.public.siteUrl}/sale/${id}`)

useSeoMeta({
    title: () => (sale.value ? `${sale.value.title} — Bemidji Garage Sales` : 'Garage sale'),
    description: () =>
        sale.value
            ? `${sale.value.title} at ${sale.value.address}. ${formatDateRange(sale.value.start_date, sale.value.end_date)}.`
            : '',
    ogTitle: () => (sale.value ? sale.value.title : 'Garage sale'),
    ogDescription: () =>
        sale.value
            ? `📍 ${sale.value.address} · 📅 ${formatDateRange(sale.value.start_date, sale.value.end_date)}${
                  sale.value.start_time && sale.value.end_time
                      ? ` · ${formatTimeRange(sale.value.start_time, sale.value.end_time)}`
                      : ''
              }`
            : '',
    ogImage: () => sale.value?.photos?.[0] ?? `${config.public.siteUrl}/og-image.png`,
    ogUrl: () => shareUrl.value,
    ogType: 'website',
    twitterCard: 'summary_large_image',
})

function shareToFacebook() {
    if (!sale.value) return
    const u = encodeURIComponent(shareUrl.value)
    // FB ignores `quote` for most pages now, but include it as a hint.
    const quote = encodeURIComponent(
        `${sale.value.title}\n📍 ${sale.value.address}\n📅 ${formatDateRange(sale.value.start_date, sale.value.end_date)}`,
    )
    const url = `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${quote}`
    window.open(url, '_blank', 'width=626,height=436,noopener,noreferrer')
}

const copied = ref(false)
async function copyLink() {
    try {
        await navigator.clipboard.writeText(shareUrl.value)
        copied.value = true
        setTimeout(() => (copied.value = false), 2000)
    } catch {
        // fall back to a prompt
        window.prompt('Copy this link:', shareUrl.value)
    }
}

const messaging = ref(false)
async function messageOwner() {
    if (!sale.value) return
    if (!user.value) {
        navigateTo('/login')
        return
    }
    messaging.value = true
    try {
        const threadId = await findOrCreateThread(sale.value.user_id, sale.value.id)
        navigateTo(`/inbox/${threadId}`)
    } catch (e) {
        alert(e instanceof Error ? e.message : 'Could not start a thread')
    } finally {
        messaging.value = false
    }
}
onMounted(refreshSaved)
watch(user, refreshSaved)

const toggling = ref(false)
async function toggleSaved() {
    if (!sale.value) return
    if (!user.value) {
        navigateTo('/login')
        return
    }
    toggling.value = true
    if (isSaved(sale.value.id)) {
        await unsave(sale.value.id)
    } else {
        await save(sale.value.id)
    }
    toggling.value = false
}

async function deleteSale() {
    if (!sale.value) return
    if (!confirm('Delete this garage sale? This cannot be undone.')) return
    const photoUrls = sale.value.photos ?? []
    const { error: err } = await supabase.from('garage_sales').delete().eq('id', sale.value.id)
    if (err) {
        alert(err.message)
        return
    }
    // Best-effort cleanup of photos in storage.
    if (photoUrls.length) deletePhotos(photoUrls).catch(() => {})
    router.push('/browse')
}
</script>

<template>
    <section class="mx-auto max-w-2xl px-4 py-8">
        <NuxtLink to="/browse" class="text-sm text-sky-700 hover:underline">
            ← Back to map
        </NuxtLink>

        <div v-if="error" class="mt-6 rounded-lg bg-red-50 p-4 text-red-700">
            {{ error.message }}
        </div>
        <div v-else-if="!sale" class="mt-6 rounded-lg bg-gray-100 p-6 text-center text-gray-600">
            This sale isn't here. Maybe it ended.
        </div>

        <article v-else class="mt-4">
            <div class="mb-3">
                <span
                    v-if="status === 'active'"
                    class="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800"
                >
                    Happening now
                </span>
                <span
                    v-else-if="status === 'upcoming'"
                    class="inline-block rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800"
                >
                    Upcoming
                </span>
            </div>

            <h1 class="font-display text-3xl font-bold text-gray-900 sm:text-4xl">
                {{ sale.title }}
            </h1>

            <p class="mt-2 text-gray-700">📍 {{ sale.address }}</p>
            <p class="mt-1 text-gray-700">
                📅 {{ formatDateRange(sale.start_date, sale.end_date) }}
                <template v-if="sale.start_time || sale.end_time">
                    · {{ formatTimeRange(sale.start_time, sale.end_time) }}
                </template>
            </p>

            <div
                v-if="sale.photos && sale.photos.length"
                class="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
                <a
                    v-for="(url, i) in sale.photos"
                    :key="url"
                    :href="url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="aspect-square overflow-hidden rounded-xl bg-gray-100 ring-1 ring-orange-100 transition hover:ring-2 hover:ring-brand-500"
                >
                    <img
                        :src="url"
                        :alt="`Photo ${i + 1}`"
                        loading="lazy"
                        class="h-full w-full object-cover"
                    />
                </a>
            </div>

            <p
                v-if="sale.description"
                class="mt-6 whitespace-pre-line rounded-xl bg-white p-4 text-gray-800 ring-1 ring-orange-100"
            >
                {{ sale.description }}
            </p>

            <div class="mt-8 flex flex-wrap gap-3">
                <button
                    v-if="user && !isSaved(sale.id)"
                    class="btn-primary"
                    :disabled="toggling"
                    @click="toggleSaved"
                >
                    {{ toggling ? 'Saving…' : "Let's go!" }}
                </button>
                <button
                    v-else-if="user"
                    class="rounded-lg bg-green-50 px-5 py-2.5 font-medium text-green-700 ring-1 ring-green-200 hover:bg-green-100 disabled:opacity-50"
                    :disabled="toggling"
                    @click="toggleSaved"
                >
                    ✓ On your list — remove?
                </button>
                <NuxtLink v-else to="/login" class="btn-primary">
                    Sign in to save
                </NuxtLink>

                <button
                    v-if="user && !isOwner && sale.contact_enabled"
                    class="btn-secondary"
                    :disabled="messaging"
                    @click="messageOwner"
                >
                    {{ messaging ? 'Opening…' : '💬 Message owner' }}
                </button>

                <template v-if="isOwner">
                    <NuxtLink :to="`/post/${sale.id}`" class="btn-secondary">Edit</NuxtLink>
                    <button class="text-sm text-red-700 hover:underline" @click="deleteSale">
                        Delete
                    </button>
                </template>
            </div>

            <div class="mt-8 border-t border-orange-100 pt-6">
                <h2 class="font-display text-lg font-bold text-gray-900">Share this sale</h2>
                <p class="mt-1 text-sm text-gray-600">
                    Posting to a Bemidji garage sale group? Share the link and pick the group when
                    Facebook opens.
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        class="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-[#166FE5]"
                        @click="shareToFacebook"
                    >
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                            <path
                                d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                            />
                        </svg>
                        Share to Facebook
                    </button>
                    <button
                        type="button"
                        class="btn-secondary !min-h-[44px] !px-4 !py-2.5"
                        @click="copyLink"
                    >
                        {{ copied ? '✓ Copied!' : '🔗 Copy link' }}
                    </button>
                </div>
            </div>
        </article>
    </section>
</template>
