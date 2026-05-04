export type ToastTone = 'error' | 'success' | 'info'

export interface Toast {
    id: number
    message: string
    tone: ToastTone
}

export function useToast() {
    const toasts = useState<Toast[]>('app-toasts', () => [])
    // Monotonic counter (per-request, via useState) — two toasts pushed
    // in the same millisecond used to risk an ID collision under the
    // previous Date.now()+Math.random() scheme. Keeping the counter in
    // useState rather than module scope means it can't leak across
    // simultaneous SSR requests on a shared Node process.
    const nextId = useState<number>('app-toasts-next-id', () => 1)

    function dismiss(id: number) {
        toasts.value = toasts.value.filter((t) => t.id !== id)
    }

    function push(message: string, tone: ToastTone = 'info', timeoutMs = 4500) {
        const id = nextId.value
        nextId.value++
        toasts.value = [...toasts.value, { id, message, tone }]
        if (timeoutMs > 0) {
            setTimeout(() => dismiss(id), timeoutMs)
        }
    }

    return {
        toasts,
        dismiss,
        error: (m: string) => push(m, 'error', 6500),
        success: (m: string) => push(m, 'success', 3500),
        info: (m: string) => push(m, 'info', 4000),
    }
}
