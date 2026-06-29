-- The one scheduled job: tally at 12:50 SAST daily.
-- 12:50 SAST == 10:50 UTC (SAST has no DST), so we schedule in UTC.
-- The edge function ALSO finalizes lazily on first results view, so this cron
-- is a robustness guarantee, not a single point of failure.
--
-- Requires the pg_cron extension. On Supabase you can enable it from
-- Database > Extensions, or it is created here if your role permits.

create extension if not exists pg_cron;

-- Finalize "today's" contest using SAST wall-clock date.
create or replace function finalize_today()
returns void
language sql
security definer
set search_path = public
as $$
  select finalize_contest((now() at time zone 'Africa/Johannesburg')::date);
$$;

-- (Re)register the daily job.
select cron.unschedule('best-photo-daily-tally')
where exists (select 1 from cron.job where jobname = 'best-photo-daily-tally');

select cron.schedule('best-photo-daily-tally', '50 10 * * *', $$select finalize_today()$$);
