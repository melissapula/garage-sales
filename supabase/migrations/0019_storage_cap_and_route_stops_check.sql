-- Two small audit fixes bundled.
--
-- 1. `sale-photos` storage bucket gains a 5 MB per-file size cap.
--    Client-side compression in `useSalePhotos.compressImage` (max 1920px,
--    JPEG ~0.85) keeps real-world uploads well under this, but a determined
--    user could `curl` an arbitrarily large file directly to the Storage
--    REST endpoint. The bucket-level limit is the only enforcement that
--    survives a client bypass.
--
-- 2. `route_stops` UPDATE policy gains a `WITH CHECK` clause so the NEW row
--    is validated, not just the OLD. Without the check a user could UPDATE
--    their own stop's `route_id` to point at a different route (theirs or
--    anyone else's), effectively moving the stop. The USING clause already
--    blocks that on read, but the write itself wasn't gated.

-- 1. Storage bucket file-size limit.
update storage.buckets
set file_size_limit = 5242880  -- 5 MB
where id = 'sale-photos';

-- 2. route_stops UPDATE — re-create with both USING and WITH CHECK.
drop policy if exists "route_stops update via route" on public.route_stops;

create policy "route_stops update via route"
    on public.route_stops for update
    using (
        exists (
            select 1 from public.routes r
            where r.id = route_id and r.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.routes r
            where r.id = route_id and r.user_id = auth.uid()
        )
    );
