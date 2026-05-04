-- Bemidji Garage Sales — initial schema
-- Tables: garage_sales, itineraries, itinerary_stops
-- RLS: anyone can read sales; only owner can mutate. Itineraries are owner-only.
-- Cleanup: pg_cron job removes sales 7+ days past their end_date.

-- pgcrypto for `gen_random_uuid()`. Hosted Supabase has it pre-installed,
-- but a clean self-hosted target wouldn't, so declare the dependency.
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- ============================================================================
-- garage_sales
-- ============================================================================
create table public.garage_sales (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 120),
    description text check (char_length(description) <= 2000),
    address text not null,
    lat double precision not null,
    lng double precision not null,
    start_date date not null,
    end_date date not null,
    start_time time,
    end_time time,
    photos text[] not null default '{}',
    created_at timestamptz not null default now(),
    constraint date_order check (end_date >= start_date)
);

create index garage_sales_user_id_idx on public.garage_sales (user_id);
create index garage_sales_end_date_idx on public.garage_sales (end_date);
create index garage_sales_location_idx on public.garage_sales (lat, lng);

alter table public.garage_sales enable row level security;

create policy "garage_sales select all"
    on public.garage_sales for select
    using (true);

create policy "garage_sales insert own"
    on public.garage_sales for insert
    with check (auth.uid() = user_id);

create policy "garage_sales update own"
    on public.garage_sales for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "garage_sales delete own"
    on public.garage_sales for delete
    using (auth.uid() = user_id);

-- ============================================================================
-- itineraries
-- ============================================================================
create table public.itineraries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 120),
    created_at timestamptz not null default now()
);

create index itineraries_user_id_idx on public.itineraries (user_id);

alter table public.itineraries enable row level security;

create policy "itineraries select own"
    on public.itineraries for select
    using (auth.uid() = user_id);

create policy "itineraries insert own"
    on public.itineraries for insert
    with check (auth.uid() = user_id);

create policy "itineraries update own"
    on public.itineraries for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "itineraries delete own"
    on public.itineraries for delete
    using (auth.uid() = user_id);

-- ============================================================================
-- itinerary_stops
-- ============================================================================
create table public.itinerary_stops (
    itinerary_id uuid not null references public.itineraries (id) on delete cascade,
    garage_sale_id uuid not null references public.garage_sales (id) on delete cascade,
    position integer not null,
    created_at timestamptz not null default now(),
    primary key (itinerary_id, garage_sale_id)
);

create index itinerary_stops_itinerary_idx on public.itinerary_stops (itinerary_id, position);

alter table public.itinerary_stops enable row level security;

create policy "itinerary_stops select via itinerary"
    on public.itinerary_stops for select
    using (
        exists (
            select 1 from public.itineraries i
            where i.id = itinerary_id and i.user_id = auth.uid()
        )
    );

create policy "itinerary_stops insert via itinerary"
    on public.itinerary_stops for insert
    with check (
        exists (
            select 1 from public.itineraries i
            where i.id = itinerary_id and i.user_id = auth.uid()
        )
    );

create policy "itinerary_stops update via itinerary"
    on public.itinerary_stops for update
    using (
        exists (
            select 1 from public.itineraries i
            where i.id = itinerary_id and i.user_id = auth.uid()
        )
    );

create policy "itinerary_stops delete via itinerary"
    on public.itinerary_stops for delete
    using (
        exists (
            select 1 from public.itineraries i
            where i.id = itinerary_id and i.user_id = auth.uid()
        )
    );

-- ============================================================================
-- Auto-cleanup: delete sales 7+ days past end_date, nightly at 03:00 UTC
-- ============================================================================
select cron.schedule(
    'delete-expired-garage-sales',
    '0 3 * * *',
    $$ delete from public.garage_sales where end_date < (current_date - interval '7 days') $$
);
