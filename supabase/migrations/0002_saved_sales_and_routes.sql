-- Restructure: split "itineraries" into a flat saved-sales wishlist and
-- date-scoped routes. The wishlist is what users tap "Let's go!" to add to;
-- routes are daily plans assembled from that wishlist.

drop table if exists public.itinerary_stops cascade;
drop table if exists public.itineraries cascade;

-- ============================================================================
-- saved_sales — flat wishlist of garage sales the user wants to visit
-- ============================================================================
create table public.saved_sales (
    user_id uuid not null references auth.users (id) on delete cascade,
    garage_sale_id uuid not null references public.garage_sales (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, garage_sale_id)
);

create index saved_sales_user_idx on public.saved_sales (user_id, created_at desc);

alter table public.saved_sales enable row level security;

create policy "saved_sales select own"
    on public.saved_sales for select
    using (auth.uid() = user_id);

create policy "saved_sales insert own"
    on public.saved_sales for insert
    with check (auth.uid() = user_id);

create policy "saved_sales delete own"
    on public.saved_sales for delete
    using (auth.uid() = user_id);

-- ============================================================================
-- routes — a planned outing for a specific day
-- ============================================================================
create table public.routes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 120),
    route_date date not null,
    created_at timestamptz not null default now()
);

create index routes_user_idx on public.routes (user_id, route_date);

alter table public.routes enable row level security;

create policy "routes select own"
    on public.routes for select
    using (auth.uid() = user_id);

create policy "routes insert own"
    on public.routes for insert
    with check (auth.uid() = user_id);

create policy "routes update own"
    on public.routes for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "routes delete own"
    on public.routes for delete
    using (auth.uid() = user_id);

-- ============================================================================
-- route_stops — ordered sales within a route
-- ============================================================================
create table public.route_stops (
    route_id uuid not null references public.routes (id) on delete cascade,
    garage_sale_id uuid not null references public.garage_sales (id) on delete cascade,
    position integer not null,
    primary key (route_id, garage_sale_id)
);

create index route_stops_route_idx on public.route_stops (route_id, position);

alter table public.route_stops enable row level security;

create policy "route_stops select via route"
    on public.route_stops for select
    using (
        exists (
            select 1 from public.routes r
            where r.id = route_id and r.user_id = auth.uid()
        )
    );

create policy "route_stops insert via route"
    on public.route_stops for insert
    with check (
        exists (
            select 1 from public.routes r
            where r.id = route_id and r.user_id = auth.uid()
        )
    );

create policy "route_stops update via route"
    on public.route_stops for update
    using (
        exists (
            select 1 from public.routes r
            where r.id = route_id and r.user_id = auth.uid()
        )
    );

create policy "route_stops delete via route"
    on public.route_stops for delete
    using (
        exists (
            select 1 from public.routes r
            where r.id = route_id and r.user_id = auth.uid()
        )
    );
