<script setup lang="ts">
useSeoMeta({
    title: 'Privacy Policy — Garage Sale Tracker',
    description: 'How Garage Sale Tracker collects, uses, and protects your data.',
})
</script>

<template>
    <section class="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <h1 class="font-display text-3xl font-bold text-gray-900 sm:text-4xl">Privacy Policy</h1>
        <p class="mt-2 text-sm text-gray-500">Last updated: May 3, 2026</p>

        <div class="prose-content mt-8 space-y-5 text-gray-800">
            <p>
                Garage Sale Tracker is a small community tool for finding and posting local garage
                sales. This policy explains, in plain English, what data the app collects, how it's
                used, and what your rights are. If something here is unclear,
                <a href="mailto:missap1214@gmail.com" class="text-sky-700 hover:underline">reach out</a>.
            </p>

            <h2 class="font-display text-xl font-bold text-gray-900">What we collect</h2>
            <ul class="ml-5 list-disc space-y-1.5">
                <li>
                    <strong>Account info:</strong> your email and a hashed password (we never store
                    your password in plain text).
                </li>
                <li>
                    <strong>Profile:</strong> a display name (auto-set to the part of your email
                    before the @, editable on the Account page).
                </li>
                <li>
                    <strong>Content you post:</strong> sale title, description, address, dates,
                    times, and photos you upload.
                </li>
                <li>
                    <strong>App activity:</strong> sales you save, routes you build, messages you
                    send.
                </li>
                <li>
                    <strong>Analytics:</strong> page-view counts and referring URLs via Cloudflare
                    Web Analytics. No cookies, no fingerprinting, no tracking across sites.
                </li>
            </ul>

            <h2 class="font-display text-xl font-bold text-gray-900">How we use it</h2>
            <ul class="ml-5 list-disc space-y-1.5">
                <li>To run the app — sign you in, save your sales, route you between stops.</li>
                <li>
                    To send transactional emails (account confirmation, password reset, message
                    notifications). Sent via Resend.
                </li>
                <li>To understand which features people actually use, in aggregate.</li>
            </ul>

            <h2 class="font-display text-xl font-bold text-gray-900">What we don't do</h2>
            <ul class="ml-5 list-disc space-y-1.5">
                <li>We don't sell your data.</li>
                <li>We don't share it with advertisers.</li>
                <li>We don't run programmatic ad networks on the site.</li>
                <li>We don't track you across other websites.</li>
            </ul>

            <h2 class="font-display text-xl font-bold text-gray-900">Third-party services</h2>
            <p>The app relies on a few outside services to function:</p>
            <ul class="ml-5 list-disc space-y-1.5">
                <li>
                    <strong>Supabase</strong> — hosts the database, handles auth and image storage
                    (US-based).
                </li>
                <li>
                    <strong>Vercel</strong> — hosts the website and serves it to your browser.
                </li>
                <li>
                    <strong>Cloudflare</strong> — DNS for the domain and privacy-friendly,
                    cookie-free web analytics.
                </li>
                <li>
                    <strong>Mapbox</strong> — provides the map tiles and address lookup. Your IP
                    address is sent so the map can return locally-relevant results.
                </li>
                <li><strong>Resend</strong> — delivers transactional emails.</li>
            </ul>

            <h2 class="font-display text-xl font-bold text-gray-900">Your rights</h2>
            <ul class="ml-5 list-disc space-y-1.5">
                <li>
                    <strong>View and edit</strong> your display name on the
                    <NuxtLink to="/account" class="text-sky-700 hover:underline">Account page</NuxtLink>.
                </li>
                <li>
                    <strong>Edit or delete</strong> any sale you've posted on the
                    <NuxtLink to="/my-sales" class="text-sky-700 hover:underline">My sales page</NuxtLink>.
                </li>
                <li>
                    <strong>Delete your entire account</strong> at any time from the Account page
                    — this also wipes your sales, photos, saved list, routes, and message
                    threads. Permanently. No questions asked.
                </li>
                <li>
                    <strong>Ask questions</strong> about your data anytime by emailing
                    <a href="mailto:missap1214@gmail.com" class="text-sky-700 hover:underline">missap1214@gmail.com</a>.
                </li>
            </ul>

            <h2 class="font-display text-xl font-bold text-gray-900">Cookies</h2>
            <p>
                We use one functional cookie to keep you signed in. We don't use any tracking or
                advertising cookies. Cloudflare Web Analytics is cookie-free.
            </p>

            <h2 class="font-display text-xl font-bold text-gray-900">Changes to this policy</h2>
            <p>
                If anything material changes, the "Last updated" date at the top changes too, and
                significant changes will be announced in-app.
            </p>

            <h2 class="font-display text-xl font-bold text-gray-900">Contact</h2>
            <p>
                Questions about anything on this page? Email
                <a href="mailto:missap1214@gmail.com" class="text-sky-700 hover:underline">missap1214@gmail.com</a>.
            </p>
        </div>
    </section>
</template>

<style scoped>
.prose-content h2 {
    margin-top: 1.75em;
    margin-bottom: 0.5em;
}
.prose-content p {
    line-height: 1.6;
}
.prose-content ul {
    line-height: 1.6;
}
</style>
