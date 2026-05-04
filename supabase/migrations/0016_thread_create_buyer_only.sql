-- Tighten `find_or_create_thread` so only the *buyer* (the user who is
-- not the sale owner) can initiate a thread, and the other participant
-- must be the sale owner. The previous version (migration 0014) allowed
-- either party to be the sale owner, which let a sale owner spawn empty
-- threads against arbitrary user ids — those rows would show in the
-- target's inbox immediately, a low-grade harassment / spam vector.
--
-- The current UI's only entry point is "Message owner" on
-- `/sale/[id]`, which is gated by `!isOwner` — so this server-side
-- check matches the UX intent. If a future feature lets owners
-- proactively reach out to interested buyers it'll need its own RPC.

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

    select user_id, contact_enabled into v_sale_owner, v_contact_enabled
    from public.garage_sales where id = p_sale_id;
    if v_sale_owner is null then
        raise exception 'Sale not found';
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
