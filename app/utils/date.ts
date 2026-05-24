/**
 * Local-timezone date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` always returns the *UTC* date,
 * which shifts to "tomorrow" between roughly 6pm and midnight in any
 * Western Hemisphere timezone. The app filters / validates / labels by
 * "today" everywhere — `fetchActiveSales`, `saleStatus`, `post.vue`'s
 * `:min`, the day chips in `BrowseFilters` — so those edges all flip a
 * few hours early. Use `todayLocalISO()` for today and `toLocalISO()`
 * to format any specific Date in the user's local zone.
 */

export function toLocalISO(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function todayLocalISO(): string {
    return toLocalISO(new Date());
}
