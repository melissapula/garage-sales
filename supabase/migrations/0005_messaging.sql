-- Messaging system: per-sale contact toggle, message threads, messages.

-- ============================================================================
-- garage_sales: opt out of being contacted
-- ============================================================================
alter table public.garage_sales
add column if not exists contact_enabled boolean not null default true;

-- ============================================================================
-- message_threads — a conversation between two users, optionally about a sale
-- ============================================================================
create table public.message_threads (
    id uuid primary key default gen_random_uuid(),
    participant_one_id uuid not null references auth.users (id) on delete cascade,
    participant_two_id uuid not null references auth.users (id) on delete cascade,
    garage_sale_id uuid references public.garage_sales (id) on delete set null,
    last_message_at timestamptz not null default now(),
    last_message_preview text,
    created_at timestamptz not null default now(),
    constraint different_participants check (participant_one_id <> participant_two_id)
);

create index message_threads_p1_idx
    on public.message_threads (participant_one_id, last_message_at desc);
create index message_threads_p2_idx
    on public.message_threads (participant_two_id, last_message_at desc);
create index message_threads_sale_idx
    on public.message_threads (garage_sale_id);

alter table public.message_threads enable row level security;

create policy "threads select participant"
    on public.message_threads for select
    using (auth.uid() = participant_one_id or auth.uid() = participant_two_id);

create policy "threads insert as participant"
    on public.message_threads for insert
    with check (auth.uid() = participant_one_id or auth.uid() = participant_two_id);

create policy "threads update as participant"
    on public.message_threads for update
    using (auth.uid() = participant_one_id or auth.uid() = participant_two_id);

create policy "threads delete as participant"
    on public.message_threads for delete
    using (auth.uid() = participant_one_id or auth.uid() = participant_two_id);

-- ============================================================================
-- messages
-- ============================================================================
create table public.messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.message_threads (id) on delete cascade,
    sender_id uuid not null references auth.users (id) on delete cascade,
    body text not null check (char_length(body) between 1 and 4000),
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create index messages_thread_idx on public.messages (thread_id, created_at);

alter table public.messages enable row level security;

create policy "messages select participant"
    on public.messages for select
    using (
        exists (
            select 1 from public.message_threads t
            where t.id = thread_id
              and (auth.uid() = t.participant_one_id or auth.uid() = t.participant_two_id)
        )
    );

create policy "messages insert as sender"
    on public.messages for insert
    with check (
        auth.uid() = sender_id
        and exists (
            select 1 from public.message_threads t
            where t.id = thread_id
              and (auth.uid() = t.participant_one_id or auth.uid() = t.participant_two_id)
        )
    );

-- Recipient (anyone in the thread who isn't the sender) can mark a message as read.
create policy "messages update mark read"
    on public.messages for update
    using (
        auth.uid() <> sender_id
        and exists (
            select 1 from public.message_threads t
            where t.id = thread_id
              and (auth.uid() = t.participant_one_id or auth.uid() = t.participant_two_id)
        )
    )
    with check (auth.uid() <> sender_id);

-- ============================================================================
-- Trigger: keep thread.last_message_at and preview in sync with new messages
-- ============================================================================
create or replace function public.update_thread_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.message_threads
    set
        last_message_at = new.created_at,
        last_message_preview = left(new.body, 200)
    where id = new.thread_id;
    return new;
end;
$$;

drop trigger if exists messages_update_thread on public.messages;
create trigger messages_update_thread
    after insert on public.messages
    for each row execute function public.update_thread_on_message();
