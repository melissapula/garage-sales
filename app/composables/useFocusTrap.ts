/**
 * Move keyboard focus into a modal on open, trap Tab inside it, and
 * restore focus to the previously focused element on close.
 *
 * Pass the element ref of the modal's root container plus a reactive
 * `active` flag (true while the modal is open). The composable wires up
 * the necessary keydown listener and watcher; nothing else is required.
 *
 * Caveats:
 *   - Containers added via Teleport are still in the document, so
 *     querySelectorAll inside the container works as expected.
 *   - We use the capture phase so the trap runs before any inner
 *     keydown handlers can swallow Tab.
 *   - Hidden focusables (display:none / visibility:hidden / aria-hidden)
 *     are skipped via offsetParent so toolbars that conditionally render
 *     buttons don't break the trap.
 */
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(',')

function focusableWithin(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null,
    )
}

export function useFocusTrap(
    containerRef: Ref<HTMLElement | null>,
    active: Ref<boolean>,
) {
    let previouslyFocused: HTMLElement | null = null

    function onKeydown(ev: KeyboardEvent) {
        if (ev.key !== 'Tab' || !containerRef.value) return
        const focusable = focusableWithin(containerRef.value)
        if (focusable.length === 0) {
            ev.preventDefault()
            containerRef.value.focus()
            return
        }
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        const current = document.activeElement as HTMLElement | null

        if (ev.shiftKey) {
            if (current === first || !containerRef.value.contains(current)) {
                ev.preventDefault()
                last.focus()
            }
        } else {
            if (current === last || !containerRef.value.contains(current)) {
                ev.preventDefault()
                first.focus()
            }
        }
    }

    watch(active, (next) => {
        if (typeof document === 'undefined') return
        if (next) {
            previouslyFocused = (document.activeElement as HTMLElement | null) ?? null
            // Wait a tick so v-if / Teleport mounts the container before
            // we read its focusable children.
            nextTick(() => {
                if (!containerRef.value) return
                const focusable = focusableWithin(containerRef.value)
                if (focusable.length > 0) focusable[0]!.focus()
                else containerRef.value.focus()
            })
            document.addEventListener('keydown', onKeydown, true)
        } else {
            document.removeEventListener('keydown', onKeydown, true)
            if (previouslyFocused && document.body.contains(previouslyFocused)) {
                previouslyFocused.focus()
            }
            previouslyFocused = null
        }
    })

    onBeforeUnmount(() => {
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', onKeydown, true)
        }
    })
}
