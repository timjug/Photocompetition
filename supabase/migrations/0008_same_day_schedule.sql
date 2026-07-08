-- New daily schedule, effective today and going forward: the whole contest
-- now runs within a single calendar day instead of spanning overnight.
--   submit:  05:00 -> 18:00
--   vote:    18:05 -> 18:55
--   winner announced: 19:00
-- Reschedule the daily tally cron to match (18:55 SAST == 16:55 UTC; SAST has
-- no DST).

select cron.unschedule('best-photo-daily-tally')
where exists (select 1 from cron.job where jobname = 'best-photo-daily-tally');

select cron.schedule('best-photo-daily-tally', '55 16 * * *', $$select finalize_today()$$);
