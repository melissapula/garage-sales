-- Two more audit-medium fixes bundled.
--
-- 1. `find_or_create_thread` rejects soft-deleted (`deleted_at`) and
--    closed (`status = 'closed'`) sales. The UI already hides the
--    "Message owner" button on these states, but the RPC is the
--    server-side authority — a buyer who got the URL another way
--    (cached link, share, etc.) could still open a thread, putting a
--    "Removed" or closed sale's title into the seller's inbox forever.
--
-- 2. Partial index on `messages` for the unread-count RPC. The current
--    `messages_thread_idx` covers `(thread_id, created_at)` but the RPC
--    in 0013 filters by `read_at is null` and `sender_id <> auth.uid()`
--    grouped by `thread_id`. At small volume the existing index plus a
--    seq-scan within thread is fine; this partial index keeps the
--    query selective once messages cross ~50k rows.

-- ============================================================================
-- 1. find_or_create_thread — also reject deleted_at + closed sales
-- ============================================================================
create or replace function public.find_or_create_thread(
    p_other_user_id uuid,
    p_sale_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_caller uuid := auth.uid();
    v_thread_id uuid;
    v_sale_owner uuid;
    v_contact_enabled boolean;
    v_status text;
    v_deleted_at timestamptz;
begin
    if v_caller is null then
        raise exception 'Not authenticated';
    end if;
    if p_sale_id is null then
        raise exception 'sale_id is required';
    end if;
    if v_caller = p_other_user_id then
        raise exception 'Cannot message yourself';
    end if;

    select user_id, contact_enabled, status, deleted_at
      into v_sale_owner, v_contact_enabled, v_status, v_deleted_at
    from public.garage_sales where id = p_sale_id;
    if v_sale_owner is null then
        raise exception 'Sale not found';
    end if;
    if v_deleted_at is not null then
        raise exception 'This sale has been removed';
    end if;
    if v_status = 'closed' then
        raise exception 'This sale is closed and not accepting messages';
    end if;
    if not coalesce(v_contact_enabled, false) then
        raise exception 'This seller has disabled messages on this sale';
    end if;

    -- Only buyers can initiate. The other party must be the sale owner;
    -- the caller must not be.
    if v_caller = v_sale_owner then
        raise exception 'Sale owners reply to existing threads — they cannot initiate one';
    end if;
    if p_other_user_id <> v_sale_owner then
        raise exception 'You can only start a conversation with the sale owner';
    end if;

    select id into v_thread_id
    from public.message_threads
    where garage_sale_id = p_sale_id
      and (
          (participant_one_id = v_caller and participant_two_id = p_other_user_id)
          or (participant_one_id = p_other_user_id and participant_two_id = v_caller)
      )
    limit 1;

    if v_thread_id is not null then
        update public.message_threads set
            hidden_for_one = case
                when participant_one_id = v_caller then false
                else hidden_for_one
            end,
            hidden_for_two = case
                when participant_two_id = v_caller then false
                else hidden_for_two
            end
        where id = v_thread_id;
        return v_thread_id;
    end if;

    insert into public.message_threads (
        participant_one_id, participant_two_id, garage_sale_id
    ) values (
        v_caller, p_other_user_id, p_sale_id
    ) returning id into v_thread_id;
    return v_thread_id;
end;
$$;
grant execute on function public.find_or_create_thread(uuid, uuid) to authenticated;

-- ============================================================================
-- 2. Partial index for unread_counts_by_thread()
-- ============================================================================
create index if not exists messages_unread_idx
    on public.messages (thread_id, sender_id)
    where read_at is null;
