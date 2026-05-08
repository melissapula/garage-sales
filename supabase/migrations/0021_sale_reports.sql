-- Persist sale reports so we can rate-limit reporters and dedupe
-- repeat reports of the same sale by the same user. CLAUDE.md anticipated
-- this transition: "Phase 1 has no `sale_reports` table — we just email
-- and let the admin decide. If volume picks up, we add persistence + a
-- queue." A logged-in user can otherwise spam `/api/sale-reports` and
-- bury the admin inbox; without a (reporter, sale) unique constraint
-- there's also no protection against the same user filing the same
-- complaint repeatedly.
--
-- The endpoint is the only writer; users have no SELECT/INSERT/UPDATE
-- /DELETE policies. RLS is on so a future client-side admin tool would
-- need its own policy.

create table if not exists public.sale_reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references auth.users(id) on delete cascade,
    sale_id uuid not null references public.garage_sales(id) on delete cascade,
    reason text not null,
    notes text,
    created_at timestamptz not null default now(),
    unique (reporter_id, sale_id)
);

-- Reporter-side rate-limit lookup: "how many reports has this user filed
-- in the last hour?" needs an index on (reporter_id, created_at desc).
create index if not exists sale_reports_reporter_recent_idx
    on public.sale_reports (reporter_id, created_at desc);

-- Sale-side admin lookup: "how many users have reported this sale?".
create index if not exists sale_reports_sale_idx
    on public.sale_reports (sale_id);

alter table public.sale_reports enable row level security;
-- No user-facing policies. Service role bypasses RLS; the API endpoint
-- is the single writer.
