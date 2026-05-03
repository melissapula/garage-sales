import * as Sentry from '@sentry/nuxt'

// Only initialize if a DSN is set. Lets local dev (and any deploy
// without the env var) run without Sentry chatter.
const dsn = process.env.NUXT_PUBLIC_SENTRY_DSN

if (dsn) {
    Sentry.init({
        dsn,
        // Capture 10% of regular transactions for performance monitoring.
        // Free tier (5k errors/mo) is the binding constraint, not perf events.
        tracesSampleRate: 0.1,
        // Don't grab session replays by default — they're heavy.
        replaysSessionSampleRate: 0,
        // But do replay sessions where an error happened, for 10% of errors.
        replaysOnErrorSampleRate: 0.1,
    })
}
