-- Hard cap on profiles.display_name length. The /account form already
-- caps the input at 60 chars, but a curl that bypasses the form (or a
-- future code path that forgets to validate) could write an arbitrarily
-- long string — which then renders into every inbox preview, every
-- message, every share card. 80 leaves headroom above the 60-char form
-- limit (and above RFC 5321's 64-char local-part cap that
-- `handle_new_user` could feed in via email seeding).

-- Truncate any existing rows that would fail the new check. None are
-- expected (frontend caps at 60), but this keeps the migration idempotent
-- if Missa applies it after a stray manual update.
update public.profiles
   set display_name = left(display_name, 80)
 where char_length(display_name) > 80;

alter table public.profiles
    add constraint profiles_display_name_length
    check (char_length(display_name) <= 80);

-- Belt-and-suspenders on the signup trigger: clamp the seeded value so
-- a freshly created auth user with an unusually long
-- `raw_user_meta_data.display_name` (or a contrived email) can't trip
-- the new check at insert time.
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
        left(
            coalesce(
                nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                split_part(new.email, '@', 1)
            ),
            80
        )
    )
    on conflict (id) do nothing;
    return new;
end;
$$;
