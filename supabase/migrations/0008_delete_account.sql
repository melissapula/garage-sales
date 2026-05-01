-- Self-serve account deletion. Lets an authenticated user delete their own
-- auth.users row, which cascades through every table with an ON DELETE
-- CASCADE FK back to auth.users (profiles, garage_sales, saved_sales,
-- routes, route_stops, message_threads, messages).
--
-- Storage cleanup of the user's photos is handled by the client BEFORE
-- this RPC is called, while the user still has an active session.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    me uuid := auth.uid();
begin
    if me is null then
        raise exception 'Not authenticated';
    end if;
    delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
