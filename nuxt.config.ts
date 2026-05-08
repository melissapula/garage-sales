// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: true },

    modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase', '@vueuse/nuxt', '@sentry/nuxt/module', '@vite-pwa/nuxt'],

    // PWA — installable + offline-capable. Phase 1 of the mobile rollout
    // before any native-shell (Capacitor) work. The auto-update strategy
    // means new deploys reach users on next page load without needing
    // them to reinstall; the service worker swaps caches under the hood.
    pwa: {
        registerType: 'autoUpdate',
        manifest: {
            // App identity. `id` is intentionally `/` (not the start_url)
            // so future start_url changes don't orphan existing installs
            // into a separate app entry. start_url is what the launcher
            // opens; id is the stable identity Chrome stores per install.
            id: '/',
            name: 'Garage Sale Tracker',
            short_name: 'Garage Sales',
            description: "Find and route the weekend's best garage sales.",
            theme_color: '#F97316',
            background_color: '#FFFBEB',
            display: 'standalone',
            orientation: 'portrait',
            scope: '/',
            start_url: '/browse?source=pwa',
            icons: [
                {
                    src: '/android-chrome-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                },
                {
                    src: '/android-chrome-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                },
                {
                    src: '/android-chrome-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                },
            ],
        },
        workbox: {
            // Precache the core build assets. Don't precache HTML —
            // that's served network-first via runtimeCaching so users
            // always get fresh sale lists / messaging state.
            globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
            navigateFallback: null,
            runtimeCaching: [
                {
                    // Mapbox tiles are immutable per URL — cache aggressively.
                    urlPattern: /^https:\/\/api\.mapbox\.com\/.*/,
                    handler: 'CacheFirst',
                    options: {
                        cacheName: 'mapbox-tiles',
                        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
                    },
                },
                {
                    // Google Fonts CSS + woff2 — long cache OK, files are versioned.
                    urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
                    handler: 'StaleWhileRevalidate',
                    options: { cacheName: 'google-fonts' },
                },
                {
                    // Sale photos in Supabase Storage — cache so a user can
                    // re-open a saved sale offline and still see images.
                    urlPattern: /\/storage\/v1\/object\/public\/sale-photos\/.*/,
                    handler: 'CacheFirst',
                    options: {
                        cacheName: 'sale-photos',
                        expiration: { maxEntries: 100, maxAgeSeconds: 14 * 24 * 60 * 60 },
                    },
                },
            ],
        },
        client: {
            // Don't pop the standard A2HS prompt automatically — it's
            // visually intrusive. Browsers still surface "Install" via
            // the URL bar / menu, and we can add a custom in-app prompt
            // later if conversion needs it.
            installPrompt: false,
        },
        devOptions: {
            // Enable the SW in `npm run dev` so we can spot-check
            // installability locally without needing `npm run build`.
            enabled: true,
            type: 'module',
        },
    },

    // Sentry: silently disabled when NUXT_PUBLIC_SENTRY_DSN isn't set
    // (e.g. local dev). Source maps don't upload without an auth token.
    sentry: {
        sourceMapsUploadOptions: {
            // Enable when SENTRY_AUTH_TOKEN is set in Vercel; otherwise skip.
            telemetry: false,
        },
        autoInjectServerSentry: 'top-level-import',
    },

    tailwindcss: {
        cssPath: '~/assets/css/tailwind.css',
    },

    app: {
        head: {
            title: 'Garage Sale Tracker',
            meta: [
                { name: 'viewport', content: 'width=device-width, initial-scale=1' },
                {
                    name: 'description',
                    content:
                        'Find and post garage sales near you. Build an itinerary and get the best route to hit them all.',
                },
                { name: 'theme-color', content: '#F97316' },
                // iOS PWA: standalone mode + status-bar styling. The
                // newer `mobile-web-app-capable` is the spec name; the
                // `apple-` variant is kept for older iOS versions that
                // ignore the new one. Both are no-ops in regular Safari.
                { name: 'mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
                { name: 'apple-mobile-web-app-title', content: 'Garage Sales' },
            ],
            link: [
                { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
                { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
                { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
                { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
                // @vite-pwa/nuxt generates `/manifest.webmanifest` at build
                // time but doesn't always auto-inject the link in this Nuxt
                // 4 setup, so we link it explicitly.
                { rel: 'manifest', href: '/manifest.webmanifest' },
                { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
                { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
                {
                    rel: 'stylesheet',
                    href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Playfair+Display:wght@600;700&display=swap',
                },
            ],
            script: [
                {
                    defer: true,
                    src: 'https://static.cloudflareinsights.com/beacon.min.js',
                    'data-cf-beacon': '{"token": "e1e7986eef5646efa6ae3c134aa1113a"}',
                },
            ],
        },
    },

    runtimeConfig: {
        // Server-only secrets (never exposed to the browser).
        resendApiKey: process.env.RESEND_API_KEY,
        emailFrom: process.env.EMAIL_FROM || 'Garage Sale Tracker <noreply@frulahomes.com>',
        // Where /api/sale-reports sends user-flagged listings. Override
        // via env in prod once you have a dedicated abuse@ inbox.
        adminEmail: process.env.ADMIN_EMAIL || 'missap1214@gmail.com',
        public: {
            mapboxToken: process.env.MAPBOX_TOKEN,
            siteUrl: process.env.PUBLIC_SITE_URL || 'http://localhost:3000',
            sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',
            hcaptchaSiteKey: process.env.NUXT_PUBLIC_HCAPTCHA_SITE_KEY || '',
        },
    },

    supabase: {
        // Use implicit flow so email confirmation works cross-device.
        // PKCE (the default) stashes a code_verifier in localStorage at signup
        // and requires the confirmation link to be opened in the same browser.
        // Implicit puts session tokens directly in the URL hash, which any
        // device can pick up.
        clientOptions: {
            auth: {
                flowType: 'implicit',
                detectSessionInUrl: true,
                persistSession: true,
                autoRefreshToken: true,
            },
        },
        redirectOptions: {
            login: '/login',
            callback: '/confirm',
            include: [
                '/account',
                '/account/**',
                '/post',
                '/post/**',
                '/my-sales',
                '/itineraries',
                '/itineraries/**',
                '/inbox',
                '/inbox/**',
            ],
            exclude: [
                '/',
                '/browse',
                '/sale/**',
                '/share/**',
                '/login',
                '/signup',
                '/forgot-password',
                '/reset-password',
                '/confirm',
                '/privacy',
                '/terms',
            ],
            cookieRedirect: false,
        },
    },

    routeRules: {
        // Auth + private routes — keep search engines out. These pages
        // are either user-specific or low-content forms that would
        // dilute our crawl budget and pollute the index. Setting
        // `X-Robots-Tag` at the HTTP level is more authoritative than
        // a `<meta>` and applies even to non-HTML responses.
        '/login': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/signup': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/forgot-password': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/reset-password': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/confirm': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/account': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/my-sales': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/post': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/post/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/inbox': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/inbox/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/itineraries': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
        '/itineraries/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },

        // Production-only SWR. Skipped in dev because Nitro's payload
        // cache writes blow up on Windows (ENOENT on
        // .nuxt/cache/nuxt/payload/…). No SWR on `/sale/**` — owner
        // status updates (running_late, winding_down, closed) need to
        // land near-real-time, otherwise a buyer following a stale
        // link sees a "closed" sale the system already considers gone.
        ...(process.env.NODE_ENV === 'production'
            ? {
                  '/privacy': { swr: 86400 },
                  '/terms': { swr: 86400 },
                  '/': { swr: 3600 },
                  '/share/**': { swr: 600 },
              }
            : {}),
    },

    vite: {
        optimizeDeps: {
            include: ['mapbox-gl'],
        },
    },
})
