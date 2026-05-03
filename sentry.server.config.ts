import * as Sentry from '@sentry/nuxt'

const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN

if (dsn) {
    Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
    })
}
