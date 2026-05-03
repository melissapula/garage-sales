// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: true },

    modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase', '@vueuse/nuxt', '@sentry/nuxt/module'],

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
            ],
            link: [
                { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
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

    vite: {
        optimizeDeps: {
            include: ['mapbox-gl'],
        },
    },
})
