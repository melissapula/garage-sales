-- Public storage bucket for garage-sale photos.
-- Files are organized as `<user_id>/<uuid>.<ext>` so the RLS policies can
-- check ownership by the first path segment.

insert into storage.buckets (id, name, public)
values ('sale-photos', 'sale-photos', true)
on conflict (id) do nothing;

-- Anyone can read photos. Public bucket, but the policy is required for the
-- REST endpoint when RLS is enabled.
drop policy if exists "sale-photos public read" on storage.objects;
create policy "sale-photos public read"
    on storage.objects for select
    using (bucket_id = 'sale-photos');

-- Authenticated users can upload only into their own folder.
drop policy if exists "sale-photos owner insert" on storage.objects;
create policy "sale-photos owner insert"
    on storage.objects for insert
    with check (
        bucket_id = 'sale-photos'
        and auth.role() = 'authenticated'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Authenticated users can update only their own files.
drop policy if exists "sale-photos owner update" on storage.objects;
create policy "sale-photos owner update"
    on storage.objects for update
    using (
        bucket_id = 'sale-photos'
        and auth.role() = 'authenticated'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Authenticated users can delete only their own files.
drop policy if exists "sale-photos owner delete" on storage.objects;
create policy "sale-photos owner delete"
    on storage.objects for delete
    using (
        bucket_id = 'sale-photos'
        and auth.role() = 'authenticated'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
