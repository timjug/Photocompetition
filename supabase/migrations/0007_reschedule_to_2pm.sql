-- Shift the whole daily cycle back by 1 hour: submissions now close 12:30pm,
-- voting runs 12:35pm-1:55pm, winner announced 2:00pm (was 1:00pm). This also
-- gives an extra hour to upload a photo. Reschedule the daily tally cron to
-- match (1:55pm SAST == 11:55 UTC; SAST has no DST).

select cron.unschedule('best-photo-daily-tally')
where exists (select 1 from cron.job where jobname = 'best-photo-daily-tally');

select cron.schedule('best-photo-daily-tally', '55 11 * * *', $$select finalize_today()$$);
