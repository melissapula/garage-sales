-- Soft-delete `garage_sales` so saved-sales / route-stops referencing
-- a removed listing show a "this sale was removed" notice rather than
-- silently disappearing from the user's lists.
--
-- Before this migration: `saved_sales.garage_sale_id` and
-- `route_stops.garage_sale_id` both have `on delete cascade` → an
-- owner deleting their post would silently wipe the row from every
-- user's wishlist + every planned route. After: the "Delete" button
-- sets `deleted_at` instead, the listing disappears from /browse and
-- /my-sales, but the row stays in the table so saved + route-stop
-- joins keep returning the (now greyed-out, "Removed") sale data.
--
-- The nightly cleanup cron also clears tombstones older than 30 days,
-- at which point the FK cascade finally runs and drops the saved /
-- route-stop rows for good.

alter table public.garage_sales
    add column if not exists deleted_at timestamptz;

-- Partial index — only useful rows participate. Most sales are not
-- deleted, so a full index would be mostly null entries.
create index if not exists garage_sales_deleted_at_idx
    on public.garage_sales (deleted_at)
    where deleted_at is not null;

-- Re-schedule the cron to also purge tombstones >30 days old.
do $$
begin
    if exists (select 1 from cron.job where jobname = 'delete-expired-garage-sales') then
        perform cron.unschedule('delete-expired-garage-sales');
    end if;
end$$;

select cron.schedule(
    'delete-expired-garage-sales',
    '0 3 * * *',
    $$
        delete from public.garage_sales
        where end_date < (current_date - interval '30 days')
           or deleted_at < (now() - interval '30 days')
    $$
);
