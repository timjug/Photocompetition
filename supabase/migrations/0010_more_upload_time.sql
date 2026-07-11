-- More time to upload on weak wifi: submit 3:30pm -> 1:00pm (next day),
-- vote 1:05pm-2:25pm, winner announced 2:30pm.
-- Reschedule the daily tally cron to match (2:25pm SAST == 12:25 UTC; SAST
-- has no DST).

select cron.unschedule('best-photo-daily-tally')
where exists (select 1 from cron.job where jobname = 'best-photo-daily-tally');

select cron.schedule('best-photo-daily-tally', '25 12 * * *', $$select finalize_today()$$);
