import type { GarageSale } from '~/composables/useGarageSales'

export type TimeBucket = 'morning' | 'afternoon' | 'evening'

export interface BrowseFiltersValue {
    days: string[]
    timeBuckets: TimeBucket[]
}

export function emptyFilters(): BrowseFiltersValue {
    return { days: [], timeBuckets: [] }
}

function saleSpansDay(sale: GarageSale, iso: string): boolean {
    return sale.start_date <= iso && iso <= sale.end_date
}

const BUCKET_RANGES: Record<TimeBucket, { startMin: number; endMin: number }> = {
    morning: { startMin: 0, endMin: 12 * 60 },
    afternoon: { startMin: 12 * 60, endMin: 17 * 60 },
    evening: { startMin: 17 * 60, endMin: 24 * 60 },
}

function timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
}

function saleMatchesBucket(sale: GarageSale, bucket: TimeBucket): boolean {
    // Sales without a time set are treated as "all day".
    if (!sale.start_time || !sale.end_time) return true
    const start = timeToMinutes(sale.start_time)
    const end = timeToMinutes(sale.end_time)
    const range = BUCKET_RANGES[bucket]
    return start < range.endMin && end > range.startMin
}

export function applyFilters(sales: GarageSale[], filters: BrowseFiltersValue): GarageSale[] {
    return sales.filter((sale) => {
        if (filters.days.length > 0) {
            if (!filters.days.some((d) => saleSpansDay(sale, d))) return false
        }
        if (filters.timeBuckets.length > 0) {
            if (!filters.timeBuckets.some((b) => saleMatchesBucket(sale, b))) return false
        }
        return true
    })
}
