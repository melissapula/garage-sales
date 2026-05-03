import type { GarageSale } from '~/composables/useGarageSales'

export type TimeBucket = 'morning' | 'afternoon' | 'evening'

export interface FilterLocation {
    lat: number
    lng: number
    label: string
}

export interface BrowseFiltersValue {
    days: string[]
    timeBuckets: TimeBucket[]
    location: FilterLocation | null
    radiusMiles: number
}

export const RADIUS_OPTIONS = [10, 25, 50, 100] as const

export function emptyFilters(): BrowseFiltersValue {
    return { days: [], timeBuckets: [], location: null, radiusMiles: 25 }
}

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
): number {
    const R = 3958.8
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
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
        if (filters.location) {
            const dist = haversineMiles(
                filters.location.lat,
                filters.location.lng,
                sale.lat,
                sale.lng,
            )
            if (dist > filters.radiusMiles) return false
        }
        return true
    })
}
