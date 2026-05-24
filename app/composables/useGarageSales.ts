export type SaleOwnerStatus = 'open' | 'running_late' | 'winding_down' | 'closed';

/**
 * One day on a sale's schedule. A sale always has one or more of these.
 * `start_time` / `end_time` are nullable (the seller may not commit to a
 * specific window). Within a sale, days can be non-contiguous and can
 * each carry their own hours — that's the whole point of `sale_dates`.
 */
export interface SaleDate {
    sale_date: string;
    start_time: string | null;
    end_time: string | null;
}

export interface GarageSale {
    id: string;
    user_id: string;
    title: string;
    description: string | null;
    address: string;
    lat: number;
    lng: number;
    /**
     * Denormalized envelope. `start_date` = min(sale_dates.sale_date),
     * `end_date` = max(sale_dates.sale_date), `start_time`/`end_time` =
     * min/max across rows. Maintained by a trigger on sale_dates inserts/
     * updates/deletes; never edit these columns directly. Kept around so
     * the cleanup cron and `fetchActiveSales` can still cut by date range
     * without a join, and so legacy code paths don't break overnight.
     *
     * For per-day display (cards, detail page, route timeline), prefer
     * `sale_dates` — the envelope can over-claim hours when the days have
     * heterogeneous windows.
     */
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    sale_dates: SaleDate[];
    photos: string[];
    contact_enabled: boolean;
    status: SaleOwnerStatus;
    /**
     * Set when the owner soft-deletes the sale. The row stays in the
     * table for ~30 days so saved-sales / route-stops referencing it
     * can render a "this sale was removed" tombstone instead of just
     * silently vanishing. Browse / my-sales filter these out.
     */
    deleted_at: string | null;
    created_at: string;
}

/** Convenience predicate for tombstone rendering. */
export function isRemovedSale(sale: { deleted_at?: string | null }): boolean {
    return !!sale.deleted_at;
}

/**
 * Return the sale_dates row for a specific calendar day, or null if the
 * sale isn't open that day. Useful on the route detail / timeline where
 * we know the route's date and want that day's actual hours instead of
 * the envelope.
 */
export function findSaleDateOn(sale: GarageSale, day: string): SaleDate | null {
    return sale.sale_dates?.find((d) => d.sale_date === day) ?? null;
}

/**
 * The standard nested select used by every fetcher that needs a full
 * GarageSale. Sorted by `sale_date` so callers can iterate without
 * re-sorting. Kept in one place so a schema change is a one-line edit.
 */
export const GARAGE_SALE_SELECT = '*, sale_dates(sale_date, start_time, end_time)';

/** Sort sale_dates rows in place by ISO date. PostgREST doesn't promise
 *  ordering on embedded resources unless explicitly asked. */
function sortSaleDates(sales: GarageSale[]): GarageSale[] {
    for (const s of sales) {
        if (s.sale_dates) {
            s.sale_dates = [...s.sale_dates].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
        } else {
            s.sale_dates = [];
        }
    }
    return sales;
}

export async function fetchActiveSales() {
    const supabase = useSupabaseClient();
    // Generous cutoff: 1 day before "today" in whichever timezone is
    // running this fetch. SSR runs on Vercel in UTC; a user in CT at
    // 8pm local (1am UTC next day) would otherwise lose any sale ending
    // today, because the server's "today" is one calendar day ahead of
    // theirs. Returning yesterday-UTC's sales too lets the client-side
    // expiry filter in /browse trim with the user's actual local clock.
    // Cost: a handful of extra rows (yesterday's sales, capped at the
    // sales-with-end_date-yesterday set).
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = toLocalISO(yesterday);
    const { data, error } = await supabase
        .from('garage_sales')
        .select(GARAGE_SALE_SELECT)
        .is('deleted_at', null)
        .gte('end_date', cutoff)
        .neq('status', 'closed')
        .order('start_date', { ascending: true });
    if (error) throw error;
    return sortSaleDates((data ?? []) as unknown as GarageSale[]);
}

export interface OverlapConflict {
    id: string;
    title: string;
    address: string;
    /** The specific days from the input that collide with this sale. */
    conflictDates: string[];
}

/**
 * Find an existing active sale by THE SAME USER at the same coordinates
 * whose schedule has at least one day in common with `dates`. Returns
 * null if there's no conflict.
 *
 * Lat/lng are matched within ±0.0001° (~11m) so identical Mapbox geocodes
 * for the same address still match each other even with tiny float drift.
 *
 * Per-day matching matters because a sale can have non-contiguous days
 * (e.g. weekend-1 + weekend-2) — the envelope alone would flag any post
 * on a gap day as a conflict, blocking valid second-listings.
 *
 * Scoping to the same user is intentional: condo neighbors, multi-family
 * sales on a shared cul-de-sac, and flea-market-style multi-vendor events
 * all geocode to within the eps and would otherwise hard-block a totally
 * legitimate post. Same-user duplicate detection still catches the real
 * "I accidentally posted twice" case.
 *
 * `excludeId` lets the edit form skip its own existing row.
 */
export async function findOverlappingSale(
    userId: string,
    lat: number,
    lng: number,
    dates: string[],
    excludeId?: string,
): Promise<OverlapConflict | null> {
    if (dates.length === 0) return null;
    const supabase = useSupabaseClient();
    const eps = 0.0001;
    let q = supabase
        .from('garage_sales')
        .select('id, title, address, sale_dates!inner(sale_date)')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('lat', lat - eps)
        .lte('lat', lat + eps)
        .gte('lng', lng - eps)
        .lte('lng', lng + eps)
        .neq('status', 'closed')
        .in('sale_dates.sale_date', dates)
        .limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    const row = data?.[0] as
        | { id: string; title: string; address: string; sale_dates: { sale_date: string }[] }
        | undefined;
    if (!row) return null;
    const inputSet = new Set(dates);
    const conflictDates = row.sale_dates.map((d) => d.sale_date).filter((d) => inputSet.has(d));
    return {
        id: row.id,
        title: row.title,
        address: row.address,
        conflictDates,
    };
}

/**
 * Same as `findOverlappingSale`, but retries once after a short delay if
 * the underlying request fails (e.g. transient network blip). The post
 * forms use this so they can distinguish "no conflict" from "we couldn't
 * tell", and warn the user in the latter case rather than silently
 * posting a possible duplicate.
 */
export async function findOverlappingSaleWithRetry(
    userId: string,
    lat: number,
    lng: number,
    dates: string[],
    excludeId?: string,
): Promise<OverlapConflict | null> {
    try {
        return await findOverlappingSale(userId, lat, lng, dates, excludeId);
    } catch (firstError) {
        await new Promise((r) => setTimeout(r, 300));
        try {
            return await findOverlappingSale(userId, lat, lng, dates, excludeId);
        } catch (secondError) {
            // Re-throw the second error so the caller can show a soft
            // notice. We log both attempts to ease debugging.
            console.warn('Overlap check failed (1st attempt):', firstError);
            console.warn('Overlap check failed (retry):', secondError);
            throw secondError;
        }
    }
}
