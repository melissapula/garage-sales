import type { GarageSale } from '~/composables/useGarageSales'

export type TimeBucket = 'morning' | 'afternoon' | 'evening'

export interface FilterLocation {
    lat: number
    lng: number
    label: string
}

export interface DateRange {
    /** Inclusive lower bound, ISO `YYYY-MM-DD`. `null` means open-ended. */
    start: string | null
    /** Inclusive upper bound, ISO `YYYY-MM-DD`. `null` means open-ended. */
    end: string | null
}

export interface BrowseFiltersValue {
    dateRange: DateRange
    timeBuckets: TimeBucket[]
    location: FilterLocation | null
    radiusMiles: number
}

export function emptyFilters(): BrowseFiltersValue {
    return {
        dateRange: { start: null, end: null },
        timeBuckets: [],
        location: null,
        radiusMiles: 25,
    }
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

/**
 * True when ANY day in the sale's per-day schedule falls within the
 * picker's `[start, end]` range. Either bound on the picker may be
 * null (open-ended on that side).
 *
 * Uses per-day matching instead of the envelope so a sale with
 * non-contiguous dates (Weekend 1 + Weekend 2) doesn't get falsely
 * matched on the gap days, and isn't falsely rejected when the picker
 * range only overlaps one of its weekends. Falls back to the envelope
 * if `sale_dates` is empty (legacy fetchers).
 */
function saleOverlapsRange(sale: GarageSale, range: DateRange): boolean {
    const dates = sale.sale_dates ?? []
    if (dates.length === 0) {
        if (range.start && sale.end_date < range.start) return false
        if (range.end && sale.start_date > range.end) return false
        return true
    }
    return dates.some((d) => {
        if (range.start && d.sale_date < range.start) return false
        if (range.end && d.sale_date > range.end) return false
        return true
    })
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

function windowOverlapsBucket(
    startTime: string | null,
    endTime: string | null,
    bucket: TimeBucket,
): boolean {
    // No time set on a day is treated as "all day" (matches all buckets).
    if (!startTime || !endTime) return true
    const start = timeToMinutes(startTime)
    const end = timeToMinutes(endTime)
    const range = BUCKET_RANGES[bucket]
    return start < range.endMin && end > range.startMin
}

function saleMatchesBucket(sale: GarageSale, bucket: TimeBucket): boolean {
    // A sale matches a bucket if ANY of its days has a window overlapping
    // that bucket. Heterogeneous-hour sales (Thu/Fri 8–5, Sat 8–2) match
    // morning + afternoon (Thu/Fri) but only morning (Sat) — the union is
    // morning + afternoon, which is what the user expects to see.
    const dates = sale.sale_dates ?? []
    if (dates.length === 0) {
        return windowOverlapsBucket(sale.start_time, sale.end_time, bucket)
    }
    return dates.some((d) => windowOverlapsBucket(d.start_time, d.end_time, bucket))
}

export function applyFilters(sales: GarageSale[], filters: BrowseFiltersValue): GarageSale[] {
    return sales.filter((sale) => {
        if (filters.dateRange.start || filters.dateRange.end) {
            if (!saleOverlapsRange(sale, filters.dateRange)) return false
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
