-- Public profile per auth user. Backs the "display name" shown in messaging.
-- Auto-populated from email on signup; users can update their own row.

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null,
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Display names are publicly readable so they can be shown in inbox/threads.
create policy "profiles select all"
    on public.profiles for select
    using (true);

create policy "profiles update own"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user is created. Default
-- display name is the local part of their email; users can change it later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
            split_part(new.email, '@', 1)
        )
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Backfill existing users so messaging works for accounts created before this migration.
insert into public.profiles (id, display_name)
select u.id, split_part(u.email, '@', 1)
from auth.users u
where u.id not in (select id from public.profiles);
