-- Back to the overnight-spanning schedule, permanently: submit 2:00pm ->
-- 11:30am (next day), vote 11:35am-12:55pm, winner announced 1:00pm.
-- Reschedule the daily tally cron to match (12:55pm SAST == 10:55 UTC; SAST
-- has no DST).
--
-- Today (2026-07-11) is a one-time transition: the edge function extends
-- today's already-open round straight through to tomorrow's cutoff instead
-- of applying the normal 11:30am same-day close, so nothing gets cut short
-- mid-cycle. See TRANSITION_DATE in supabase/functions/api/index.ts.

select cron.unschedule('best-photo-daily-tally')
where exists (select 1 from cron.job where jobname = 'best-photo-daily-tally');

select cron.schedule('best-photo-daily-tally', '55 10 * * *', $$select finalize_today()$$);
