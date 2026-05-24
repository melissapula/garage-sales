import type { SaleOwnerStatus } from '~/composables/useGarageSales';

export interface StatusOption {
    value: SaleOwnerStatus;
    label: string;
    short: string;
    icon: string;
    /** Tone for badges/banners. */
    tone: 'open' | 'warn' | 'caution' | 'closed';
    description: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
    {
        value: 'open',
        label: 'Open',
        short: 'Open',
        icon: '🟢',
        tone: 'open',
        description: 'Sale is happening as posted.',
    },
    {
        value: 'running_late',
        label: 'Running late',
        short: 'Late start',
        icon: '⏰',
        tone: 'warn',
        description: "I'm running behind — sale will start a little later than posted.",
    },
    {
        value: 'winding_down',
        label: 'Winding down',
        short: 'Winding down',
        icon: '⚠️',
        tone: 'caution',
        description: 'Most things are claimed — limited stuff left.',
    },
    {
        value: 'closed',
        label: 'Closed early',
        short: 'Closed',
        icon: '🚫',
        tone: 'closed',
        description: "Sale ended early. It's hidden from the map.",
    },
];

export function statusOption(value: SaleOwnerStatus): StatusOption {
    return STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[0]!;
}

const TONE_BADGE_CLASSES: Record<StatusOption['tone'], string> = {
    open: 'bg-green-100 text-green-800',
    warn: 'bg-amber-100 text-amber-800',
    caution: 'bg-orange-100 text-orange-800',
    closed: 'bg-gray-200 text-gray-700',
};

const TONE_BANNER_CLASSES: Record<StatusOption['tone'], string> = {
    open: 'bg-green-50 text-green-900 ring-green-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    caution: 'bg-orange-50 text-orange-900 ring-orange-200',
    closed: 'bg-gray-100 text-gray-700 ring-gray-300',
};

export function statusBadgeClass(status: SaleOwnerStatus): string {
    return TONE_BADGE_CLASSES[statusOption(status).tone];
}

export function statusBannerClass(status: SaleOwnerStatus): string {
    return TONE_BANNER_CLASSES[statusOption(status).tone];
}
