-- Extend the auto-cleanup window from 7 days to 30 days past end_date.
-- Owners and visitors get a longer grace period to glance back at recent sales.

do $$
begin
    if exists (select 1 from cron.job where jobname = 'delete-expired-garage-sales') then
        perform cron.unschedule('delete-expired-garage-sales');
    end if;
end$$;

select cron.schedule(
    'delete-expired-garage-sales',
    '0 3 * * *',
    $$ delete from public.garage_sales where end_date < (current_date - interval '30 days') $$
);
