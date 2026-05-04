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
