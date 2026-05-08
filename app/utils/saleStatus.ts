export type SaleStatus = 'active' | 'upcoming' | 'past'

export interface SaleDates {
    start_date: string
    end_date: string
}

export function saleStatus(sale: SaleDates, today = new Date()): SaleStatus {
    const todayStr = toLocalISO(today)
    if (sale.end_date < todayStr) return 'past'
    if (sale.start_date > todayStr) return 'upcoming'
    return 'active'
}

/** True when the sale's end_date is before today (local timezone). */
export function isExpiredSale(sale: SaleDates, today = new Date()): boolean {
    return saleStatus(sale, today) === 'past'
}

/**
 * Tailwind classes for the row container of a saved-sale / route-stop
 * list item. Centralizes the tombstone (red) / expired (yellow) /
 * normal (white) tone so /itineraries/index.vue and
 * /itineraries/[id].vue stay in sync as the styling evolves.
 */
export function saleRowToneClasses(
    sale: SaleDates & { deleted_at?: string | null },
): string {
    if (isRemovedSale(sale)) return 'bg-red-50 ring-red-200'
    if (isExpiredSale(sale)) return 'bg-yellow-50 ring-yellow-200'
    return 'bg-white ring-orange-100'
}

export function pinColor(status: SaleStatus): string {
    if (status === 'active') return '#22C55E'
    if (status === 'upcoming') return '#EAB308'
    return '#9CA3AF'
}

export function formatDateRange(startDate: string, endDate: string): string {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    const start = new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', opts)
    if (startDate === endDate) return start
    const end = new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', opts)
    return `${start} – ${end}`
}

export function formatTimeRange(startTime: string | null, endTime: string | null): string {
    if (!startTime && !endTime) return ''
    const fmt = (t: string) => {
        const [h, m] = t.split(':').map(Number)
        const d = new Date()
        d.setHours(h ?? 0, m ?? 0, 0, 0)
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    if (startTime && endTime) return `${fmt(startTime)} – ${fmt(endTime)}`
    return fmt(startTime || endTime!)
}

export interface ScheduleDayLabel {
    /** ISO YYYY-MM-DD; useful as a stable v-for key. */
    date: string
    /** Human label, e.g. "Sat, May 9". */
    dateLabel: string
    /** Human label, e.g. "8:00 AM – 5:00 PM". May be empty. */
    timeLabel: string
}

export interface ScheduleSummary {
    /** One-line compact form for cards. */
    compact: string
    /** Per-day rows for the detail page / route timeline. */
    days: ScheduleDayLabel[]
    /** True when the compact form loses information vs the per-day list
     *  (non-contiguous dates or varying hours across days). Detail pages
     *  use this to decide whether to render the expanded list. */
    hasVariation: boolean
}

interface ScheduleInput {
    start_date: string
    end_date: string
    start_time: string | null
    end_time: string | null
    sale_dates?: ReadonlyArray<{
        sale_date: string
        start_time: string | null
        end_time: string | null
    }> | null
}

function formatDayLabel(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    })
}

/**
 * Build both the one-line compact label (for cards) and the per-day
 * rows (for detail pages). Falls back to the envelope columns when
 * `sale_dates` is missing — old fetchers, server-side rendering before
 * the join lands, or third-party data dumped through the public API.
 */
export function summarizeSchedule(sale: ScheduleInput): ScheduleSummary {
    const rows = sale.sale_dates ?? []

    // Fallback: synthesize one row per day in [start_date, end_date]
    // using the envelope times. Matches the pre-0018 behavior 1:1.
    if (rows.length === 0) {
        const compactRange = formatDateRange(sale.start_date, sale.end_date)
        const compactTime = formatTimeRange(sale.start_time, sale.end_time)
        return {
            compact: compactTime ? `${compactRange} · ${compactTime}` : compactRange,
            days: [
                {
                    date: sale.start_date,
                    dateLabel: compactRange,
                    timeLabel: compactTime,
                },
            ],
            hasVariation: false,
        }
    }

    const sorted = [...rows].sort((a, b) => a.sale_date.localeCompare(b.sale_date))
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!

    const isContiguous = (() => {
        const ms = 24 * 60 * 60 * 1000
        for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1]!.sale_date + 'T00:00:00').getTime()
            const cur = new Date(sorted[i]!.sale_date + 'T00:00:00').getTime()
            if (cur - prev !== ms) return false
        }
        return true
    })()

    const allSameTimes = sorted.every(
        (d) => d.start_time === first.start_time && d.end_time === first.end_time,
    )

    const days: ScheduleDayLabel[] = sorted.map((d) => ({
        date: d.sale_date,
        dateLabel: formatDayLabel(d.sale_date),
        timeLabel: formatTimeRange(d.start_time, d.end_time),
    }))

    let compact: string
    if (isContiguous && allSameTimes) {
        const range = formatDateRange(first.sale_date, last.sale_date)
        const timeStr = formatTimeRange(first.start_time, first.end_time)
        compact = timeStr ? `${range} · ${timeStr}` : range
    } else if (isContiguous) {
        compact = `${formatDateRange(first.sale_date, last.sale_date)} · varied hours`
    } else {
        compact = `${sorted.length} days · ${formatDateRange(first.sale_date, last.sale_date)}`
    }

    return {
        compact,
        days,
        hasVariation: !isContiguous || !allSameTimes,
    }
}
