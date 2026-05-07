-- Per-day schedule for a garage sale.
--
-- Before this migration: a sale had a single contiguous (start_date,
-- end_date) range with one (start_time, end_time) window applied to every
-- day. Sellers with varying daily hours (Thu/Fri 8-5, Sat 8-2) had to
-- pick one window and lie in the description. Sales with a non-contiguous
-- schedule (Weekend 1 + Weekend 2) had to either over-claim "open
-- May 7-16" or post twice as separate listings.
--
-- After: each day is its own row in `sale_dates` with its own optional
-- start/end time. The four legacy columns on `garage_sales` stay as a
-- denormalized envelope (min/max across rows), maintained by a trigger,
-- so existing range queries (the cleanup cron, fetchActiveSales) keep
-- working without an immediate join.
--
-- Backfill: every existing garage_sales row expands into one sale_dates
-- row per day in [start_date, end_date], inheriting the parent times.
-- That preserves the current display + filter behavior 1:1; the new
-- post form is what introduces per-day variation going forward.

-- ============================================================================
-- sale_dates
-- ============================================================================
create table public.sale_dates (
    sale_id uuid not null references public.garage_sales (id) on delete cascade,
    sale_date date not null,
    start_time time,
    end_time time,
    primary key (sale_id, sale_date),
    -- NULL on either side means "no time set" → matches all time-bucket
    -- filters. Equal times (a 0-minute window) are tolerated because the
    -- pre-0018 multi-day form allowed them; the new post form still
    -- requires `end_time > start_time`, but legacy rows shouldn't fail
    -- the backfill.
    constraint sale_dates_time_order check (
        start_time is null or end_time is null or end_time >= start_time
    )
);

create index sale_dates_sale_date_idx on public.sale_dates (sale_date);

alter table public.sale_dates enable row level security;

-- Public read mirrors garage_sales (anyone can browse).
create policy "sale_dates select all"
    on public.sale_dates for select
    using (true);

-- Mutations gated by ownership of the parent sale. We can't reuse the
-- garage_sales policies directly because the auth.uid() check needs to
-- hop through the parent row.
create policy "sale_dates insert via parent owner"
    on public.sale_dates for insert
    with check (
        exists (
            select 1 from public.garage_sales gs
            where gs.id = sale_id and gs.user_id = auth.uid()
        )
    );

create policy "sale_dates update via parent owner"
    on public.sale_dates for update
    using (
        exists (
            select 1 from public.garage_sales gs
            where gs.id = sale_id and gs.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.garage_sales gs
            where gs.id = sale_id and gs.user_id = auth.uid()
        )
    );

create policy "sale_dates delete via parent owner"
    on public.sale_dates for delete
    using (
        exists (
            select 1 from public.garage_sales gs
            where gs.id = sale_id and gs.user_id = auth.uid()
        )
    );

-- ============================================================================
-- Backfill — one sale_dates row per day in each existing sale's range
-- ============================================================================
insert into public.sale_dates (sale_id, sale_date, start_time, end_time)
select
    gs.id,
    d::date,
    gs.start_time,
    gs.end_time
from public.garage_sales gs
cross join lateral generate_series(gs.start_date, gs.end_date, '1 day'::interval) d
on conflict (sale_id, sale_date) do nothing;

-- ============================================================================
-- Envelope trigger — keep garage_sales (start/end_date, start/end_time)
-- in sync as a denormalized min/max over sale_dates.
-- ============================================================================
-- security definer so the trigger updates garage_sales using its owner
-- role, regardless of the caller's RLS context. The fired UPDATE is pure
-- housekeeping over a row the caller already had to own (via the
-- sale_dates RLS check above).
create or replace function public.update_garage_sale_envelope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    target_id uuid;
    env record;
begin
    target_id := coalesce(new.sale_id, old.sale_id);

    select
        min(sale_date) as min_date,
        max(sale_date) as max_date,
        min(start_time) as min_start,
        max(end_time) as max_end
    into env
    from public.sale_dates
    where sale_id = target_id;

    -- If every sale_dates row was just removed, leave the envelope alone.
    -- The post / edit forms guarantee at least one row, so this branch
    -- mostly protects against the cascade-delete case where the parent
    -- is already gone.
    if env.min_date is null then
        return null;
    end if;

    update public.garage_sales gs
    set
        start_date = env.min_date,
        end_date = env.max_date,
        start_time = env.min_start,
        end_time = env.max_end
    where gs.id = target_id;

    return null;
end;
$$;

create trigger sale_dates_envelope_trigger
    after insert or update or delete on public.sale_dates
    for each row
    execute function public.update_garage_sale_envelope();
