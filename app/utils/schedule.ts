/**
 * Helpers for the per-day schedule editor on /post and /post/[id].
 *
 * A `ScheduleDay` is one form row: a date plus a start/end time. The DB
 * shape (`SaleDate` in useGarageSales) allows nullable times, but the
 * form always requires both — matches the legacy single-window post form.
 */

export interface ScheduleDay {
    date: string;
    start_time: string;
    end_time: string;
}

/**
 * Defaults for a fresh day row. 9 AM – 5 PM matches the typical garage
 * sale window and means most posts can submit after just picking a date.
 * Sellers with different hours overwrite per row.
 */
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '17:00';

export function emptyDay(date = ''): ScheduleDay {
    return { date, start_time: DEFAULT_START_TIME, end_time: DEFAULT_END_TIME };
}

export interface ScheduleValidationOptions {
    /** Allow dates in the past. Edit form sets this — a sale already in
     *  progress may have already-past start days that we shouldn't reject. */
    allowPastDates?: boolean;
    /** Require at least one day that's today or later. Edit form sets this
     *  to mirror the legacy "end_date can't be in the past" rule. */
    requireFutureEnd?: boolean;
}

/** Returns null if all rows are valid; else a human-readable message. */
export function validateSchedule(
    days: ScheduleDay[],
    options: ScheduleValidationOptions = {},
): string | null {
    if (days.length === 0) return 'Add at least one day.';
    const today = todayLocalISO();
    const seen = new Set<string>();
    for (let i = 0; i < days.length; i++) {
        const d = days[i]!;
        const label = `Day ${i + 1}`;
        if (!d.date) return `Pick a date for ${label}.`;
        if (!options.allowPastDates && d.date < today) {
            return `${label} can't be in the past.`;
        }
        if (seen.has(d.date)) {
            return `${label} (${d.date}) is on the schedule twice.`;
        }
        seen.add(d.date);
        if (!d.start_time) return `Pick a start time for ${label}.`;
        if (!d.end_time) return `Pick an end time for ${label}.`;
        if (d.end_time <= d.start_time) {
            return `End time must be after start time on ${label}.`;
        }
    }
    if (options.requireFutureEnd) {
        const sorted = [...seen].sort();
        const last = sorted[sorted.length - 1];
        if (last && last < today) {
            return "Add at least one day that's today or later.";
        }
    }
    return null;
}

/**
 * Compute the envelope to write to garage_sales on insert. The DB trigger
 * recomputes this from sale_dates after we insert the rows, but we pass
 * matching values so the row is never momentarily inconsistent (and so
 * NOT NULL columns are satisfied on insert).
 */
export function scheduleEnvelope(days: ScheduleDay[]): {
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
} {
    const dates = days.map((d) => d.date).sort();
    const starts = days
        .map((d) => d.start_time)
        .filter((t): t is string => !!t)
        .sort();
    const ends = days
        .map((d) => d.end_time)
        .filter((t): t is string => !!t)
        .sort();
    return {
        start_date: dates[0]!,
        end_date: dates[dates.length - 1]!,
        start_time: starts.length ? starts[0]! : null,
        end_time: ends.length ? ends[ends.length - 1]! : null,
    };
}

/** Sorted list of unique YYYY-MM-DD strings in the schedule. */
export function scheduleDates(days: ScheduleDay[]): string[] {
    return [...new Set(days.map((d) => d.date))].sort();
}
