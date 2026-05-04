-- Per-user thread hiding: replace physical thread DELETE with a hide
-- mechanism so one participant clearing a conversation can't wipe the
-- other side's copy of the messages.
--
-- Before this migration, "Delete this conversation" cascade-deleted the
-- whole `message_threads` row, which cascade-deleted every `messages`
-- row in it — including messages the OTHER participant had sent and
-- might want as a record. Now each side gets their own independent
-- visibility flag, and a fresh message resurfaces the thread for the
-- recipient if they had hidden it earlier.

-- ============================================================================
-- Per-side visibility flags
-- ============================================================================
alter table public.message_threads
    add column if not exists hidden_for_one boolean not null default false,
    add column if not exists hidden_for_two boolean not null default false;

-- ============================================================================
-- Tighten SELECT so a hidden thread disappears for its hider only.
-- Both inbox queries and the per-thread page rely on this RLS, so
-- hidden threads naturally fall out of the UI.
-- ============================================================================
drop policy if exists "threads select participant" on public.message_threads;
create policy "threads select participant"
    on public.message_threads for select
    using (
        (auth.uid() = participant_one_id and not hidden_for_one)
        or (auth.uid() = participant_two_id and not hidden_for_two)
    );

-- ============================================================================
-- Update the on-insert trigger to also un-hide for the recipient.
-- Combined with last_message_at / preview maintenance, this is the one
-- place where a new message reshapes inbox state.
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
        last_message_preview = left(new.body, 200),
        -- A new message un-hides the thread for whoever DIDN'T send it.
        -- The sender's own hide flag is left alone.
        hidden_for_one = case
            when participant_one_id <> new.sender_id then false
            else hidden_for_one
        end,
        hidden_for_two = case
            when participant_two_id <> new.sender_id then false
            else hidden_for_two
        end
    where id = new.thread_id;
    return new;
end;
$$;

-- ============================================================================
-- User-facing hide RPC. Security definer so it can update the row
-- without a user-facing UPDATE policy on message_threads (the broad
-- one was dropped in 0012). The function itself verifies the caller is
-- one of the two participants before flipping the appropriate flag.
-- ============================================================================
create or replace function public.hide_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_caller uuid := auth.uid();
    v_one uuid;
    v_two uuid;
begin
    if v_caller is null then
        raise exception 'Not authenticated';
    end if;
    select participant_one_id, participant_two_id into v_one, v_two
    from public.message_threads where id = p_thread_id;
    if v_one is null then
        raise exception 'Thread not found';
    end if;
    if v_caller = v_one then
        update public.message_threads set hidden_for_one = true where id = p_thread_id;
    elsif v_caller = v_two then
        update public.message_threads set hidden_for_two = true where id = p_thread_id;
    else
        raise exception 'Not a participant';
    end if;
end;
$$;
grant execute on function public.hide_thread(uuid) to authenticated;

-- ============================================================================
-- find_or_create_thread RPC. Replaces the JS find-or-create dance,
-- which had a hole: if the caller had hidden an existing thread, the
-- SELECT RLS hid it from their lookup query, and they'd insert a
-- duplicate alongside the hidden one. Doing this server-side, with
-- security definer, lets us see the existing row, un-hide it for the
-- caller, and avoid the duplicate entirely.
--
-- Mirrors the constraints from migration 0012's INSERT policy: the
-- sale must exist, contact must be enabled, and the sale owner must
-- be one of the two participants.
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
    if v_sale_owner <> v_caller and v_sale_owner <> p_other_user_id then
        raise exception 'Other user is not the sale owner';
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
-- Drop the user-facing DELETE policy. Hiding is the only way to clear
-- a thread from your inbox now — the row + messages stay intact for
-- the other participant.
-- ============================================================================
drop policy if exists "threads delete as participant" on public.message_threads;
