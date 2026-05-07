/**
 * Sign the current user out after `timeoutMs` of no user activity.
 *
 * "Activity" = mouse / keyboard / touch / scroll / wheel events on the
 * window. The timeout is checked on a 1-minute interval AND on tab
 * visibility change — `setInterval` gets throttled aggressively in
 * background tabs (especially on mobile), so the visibility-change
 * check catches the case where the user backgrounds the app for over
 * an hour and then returns.
 *
 * Designed to be called once from the default layout. No-op when the
 * user is signed out.
 *
 * On signout, redirects to `/login?idle=1` so the page can show a
 * "you've been signed out for inactivity" notice.
 */

const ONE_HOUR_MS = 60 * 60 * 1000

const ACTIVITY_EVENTS = [
    'mousemove',
    'keydown',
    'pointerdown',
    'touchstart',
    'scroll',
    'wheel',
] as const

export function useIdleSignout(timeoutMs: number = ONE_HOUR_MS) {
    const user = useSupabaseUser()
    const supabase = useSupabaseClient()
    const router = useRouter()

    let lastActivityAt = Date.now()
    let intervalId: ReturnType<typeof setInterval> | null = null
    // Guard so we don't fire the signOut twice if both the interval
    // and the visibility handler trip on the same idle window.
    let signingOut = false

    function bumpActivity() {
        lastActivityAt = Date.now()
    }

    async function checkIdle() {
        if (signingOut) return
        if (!user.value) return
        if (Date.now() - lastActivityAt < timeoutMs) return
        signingOut = true
        try {
            await supabase.auth.signOut()
            // Layout's user-watcher will react too, but explicitly
            // routing to /login means a user idle on /post or /inbox
            // doesn't end up looking at a logged-out shell of the same
            // page after the auth state flips.
            await router.push({ path: '/login', query: { idle: '1' } })
        } finally {
            signingOut = false
        }
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible') {
            // User returned to the tab — check immediately rather than
            // waiting up to a minute for the next interval tick.
            checkIdle()
        }
    }

    onMounted(() => {
        if (!import.meta.client) return
        bumpActivity()
        for (const evt of ACTIVITY_EVENTS) {
            window.addEventListener(evt, bumpActivity, { passive: true })
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        intervalId = setInterval(checkIdle, 60 * 1000)
    })

    onBeforeUnmount(() => {
        if (!import.meta.client) return
        for (const evt of ACTIVITY_EVENTS) {
            window.removeEventListener(evt, bumpActivity)
        }
        document.removeEventListener('visibilitychange', onVisibilityChange)
        if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
        }
    })

    // Reset the activity clock whenever the user changes (sign-in,
    // account switch). Otherwise a stale `lastActivityAt` from before
    // sign-in could trip an immediate signout.
    watch(user, (next) => {
        if (next) bumpActivity()
    })
}
