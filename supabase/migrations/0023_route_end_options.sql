-- Explicit end-location options for a route:
--   'round_trip' — drive back to the start point (legacy default)
--   'last_stop'  — end at the last sale in the visit order
--   'address'    — end at a user-supplied custom address (e.g. a friend's
--                  house, the office, a different city than the start)
--
-- end_address / end_lat / end_lng only carry meaning when end_mode = 'address'.
-- Default is 'round_trip' so existing rows keep the behavior they had before
-- this migration. The check constraint enforces that 'address' mode has the
-- coords populated; the text label is optional (UI fills it from the geocoder).

alter table public.routes
    add column if not exists end_mode text not null default 'round_trip',
    add column if not exists end_address text,
    add column if not exists end_lat double precision,
    add column if not exists end_lng double precision;

alter table public.routes
    drop constraint if exists routes_end_mode_check;
alter table public.routes
    add constraint routes_end_mode_check
        check (end_mode in ('round_trip','last_stop','address'));

alter table public.routes
    drop constraint if exists routes_end_address_coords_check;
alter table public.routes
    add constraint routes_end_address_coords_check
        check (
            end_mode <> 'address'
            or (end_lat is not null and end_lng is not null)
        );
