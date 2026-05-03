-- Public route sharing: an owner can flag a route as is_public=true so
-- anyone with the URL can view a read-only copy at /share/<id>.
--
-- Editing remains owner-only (existing UPDATE/DELETE policies are unchanged).

alter table public.routes
    add column if not exists is_public boolean not null default false;

create index if not exists routes_public_idx
    on public.routes (is_public)
    where is_public;

-- Allow SELECT on routes when the row is public.
drop policy if exists "routes select own" on public.routes;
create policy "routes select own or public"
    on public.routes for select
    using (auth.uid() = user_id or is_public = true);

-- Same for route_stops — anyone can read stops of a public route.
drop policy if exists "route_stops select via route" on public.route_stops;
create policy "route_stops select via route"
    on public.route_stops for select
    using (
        exists (
            select 1 from public.routes r
            where r.id = route_id
              and (r.user_id = auth.uid() or r.is_public = true)
        )
    );
