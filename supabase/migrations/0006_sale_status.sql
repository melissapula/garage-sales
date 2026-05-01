-- Owner-controlled sale status. Lets a seller flag mid-sale conditions
-- ("running late starting", "winding down", "closed early") that buyers see
-- before driving over.

alter table public.garage_sales
    add column if not exists status text not null default 'open'
        check (status in ('open', 'running_late', 'winding_down', 'closed'));

-- Index helps the browse query that filters out closed sales.
create index if not exists garage_sales_status_idx
    on public.garage_sales (status)
    where status <> 'open';
