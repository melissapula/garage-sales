-- Replace the inbox's N+1 unread-count fan-out with a single round-trip.
--
-- Before this migration, `useMessaging.fetchInbox` fired one `select count`
-- query per thread, replayed on every realtime broadcast. This RPC returns
-- one row per thread the caller is a participant in that has any unread
-- messages from the other side, so the client makes one call regardless of
-- thread count.

create or replace function public.unread_counts_by_thread()
returns table (thread_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
    select thread_id, count(*)::bigint as unread_count
    from public.messages
    where read_at is null
      and sender_id <> auth.uid()
    group by thread_id
$$;

grant execute on function public.unread_counts_by_thread() to authenticated;
