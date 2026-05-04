-- Lock down the messaging RLS surface against three real bugs found by audit:
--   1. The "messages update mark read" policy restricted *who* could update,
--      but not *which columns* — recipients could rewrite `body`, `sender_id`,
--      `created_at`, etc. on any message they could mark read.
--   2. The "threads insert as participant" policy let any authed user insert
--      a thread against any other user, so an attacker could spam empty
--      threads into arbitrary inboxes.
--   3. The "threads update as participant" policy let either participant
--      overwrite `last_message_preview` / `last_message_at` (or any column).
--      The UI doesn't update threads directly anyway — those columns are
--      maintained by the `messages_update_thread` trigger (security definer).

-- ============================================================================
-- 1. Restrict messages UPDATE to the read_at column only.
-- ============================================================================
-- The existing "messages update mark read" RLS policy still gates WHO can
-- update (non-sender thread participants); this column grant gates WHICH
-- columns, so the two layers together limit the operation to a read receipt.
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

-- ============================================================================
-- 2. Tighten thread INSERT: require a real sale with contact_enabled=true,
-- and require the sale's owner to be one of the two participants.
-- ============================================================================
drop policy if exists "threads insert as participant" on public.message_threads;
create policy "threads insert about a contactable sale"
    on public.message_threads for insert
    with check (
        (auth.uid() = participant_one_id or auth.uid() = participant_two_id)
        and garage_sale_id is not null
        and exists (
            select 1
            from public.garage_sales s
            where s.id = garage_sale_id
              and s.contact_enabled = true
              and (s.user_id = participant_one_id or s.user_id = participant_two_id)
        )
    );

-- ============================================================================
-- 3. Drop the broad UPDATE policy on threads.
-- ============================================================================
-- The trigger that maintains last_message_at / last_message_preview runs as
-- security definer, so dropping the user-facing UPDATE policy doesn't affect
-- it. Select and Delete policies are unchanged.
drop policy if exists "threads update as participant" on public.message_threads;
