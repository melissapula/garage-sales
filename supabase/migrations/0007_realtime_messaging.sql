-- Enable Supabase Realtime publication for the messaging tables so the
-- inbox + thread pages can stream message inserts live. Postgres-changes
-- subscriptions still respect RLS — users only receive events for rows
-- they're allowed to SELECT.

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'messages'
    ) then
        alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'message_threads'
    ) then
        alter publication supabase_realtime add table public.message_threads;
    end if;
end$$;
