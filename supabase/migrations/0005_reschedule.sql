-- Push submissions/voting back by 30 minutes: submit closes 11:30, voting runs
-- 11:30-12:55, tally/announce still at 13:00. Reschedule the daily tally cron
-- to match (12:55 SAST == 10:55 UTC; SAST has no DST).

select cron.unschedule('best-photo-daily-tally')
where exists (select 1 from cron.job where jobname = 'best-photo-daily-tally');

select cron.schedule('best-photo-daily-tally', '55 10 * * *', $$select finalize_today()$$);
