// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: true },

    modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase', '@vueuse/nuxt'],

    tailwindcss: {
        cssPath: '~/assets/css/tailwind.css',
    },

    app: {
        head: {
            title: 'Bemidji Garage Sales',
            meta: [
                { name: 'viewport', content: 'width=device-width, initial-scale=1' },
                {
                    name: 'description',
                    content:
                        'Find and post garage sales in Bemidji and the surrounding area. Build an itinerary and get the best route to hit them all.',
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
        },
    },

    runtimeConfig: {
        public: {
            mapboxToken: process.env.MAPBOX_TOKEN,
            siteUrl: process.env.PUBLIC_SITE_URL || 'http://localhost:3000',
        },
    },

    supabase: {
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
            exclude: ['/', '/browse', '/sale/**', '/login', '/signup', '/forgot-password', '/reset-password'],
            cookieRedirect: false,
        },
    },

    vite: {
        optimizeDeps: {
            include: ['mapbox-gl'],
        },
    },
})
