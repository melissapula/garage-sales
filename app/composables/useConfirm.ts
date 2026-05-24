export type ConfirmTone = 'default' | 'danger';

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: ConfirmTone;
}

interface PendingConfirm {
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
}

export function useConfirm() {
    const pending = useState<PendingConfirm | null>('app-confirm', () => null);

    function confirm(options: ConfirmOptions): Promise<boolean> {
        return new Promise((resolve) => {
            pending.value = { options, resolve };
        });
    }

    function answer(ok: boolean) {
        const p = pending.value;
        if (!p) return;
        pending.value = null;
        p.resolve(ok);
    }

    return { pending, confirm, answer };
}
