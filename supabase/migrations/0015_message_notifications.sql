-- Idempotency table for the email notifier in
-- `server/api/notifications/message.post.ts`. The endpoint used to be
-- replayable — anyone authed could POST `{messageId}` repeatedly to
-- re-email the recipient — which was a Resend-bill amplification path
-- and a low-grade harassment vector after a "block" feature exists.
--
-- One row per message that we've successfully claimed for email send.
-- Lives in its own table (not as a `messages.notified_at` column) so
-- the claim INSERT doesn't pollute the `messages` realtime publication
-- — the layout's unread-count delta handler treats every messages
-- UPDATE as a mark-read transition (per migration 0012's column-level
-- grant), and a notified_at update would silently double-decrement.

create table public.message_notifications (
    message_id uuid primary key references public.messages (id) on delete cascade,
    notified_at timestamptz not null default now()
);

alter table public.message_notifications enable row level security;

-- No user-facing policies: only the service role (which bypasses RLS)
-- inside the server endpoint writes here. Without any SELECT policy
-- defined, RLS denies all reads from the `authenticated` role too.
