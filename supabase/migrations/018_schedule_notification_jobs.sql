-- ============================================================================
-- Migration: 018_schedule_notification_jobs.sql [APPLIED via Supabase MCP]
-- Description: pg_cron schedules for the notification jobs.
-- ============================================================================
--
-- pg_cron schedules in UTC. Users are in IST (UTC+5:30), so these times are
-- chosen for a sensible LOCAL hour — an overnight reminder is worse than none:
--   03:30 UTC = 09:00 IST daily   (expiry reminders)
--   04:00 UTC = 09:30 IST Monday  (weekly summary)
-- ============================================================================

-- Unschedule first so this migration is safe to re-run.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('daily-expiry-reminders', 'weekly-owner-summary');

SELECT cron.schedule(
    'daily-expiry-reminders',
    '30 3 * * *',
    $$SELECT public.notify_expiring_memberships();$$
);

SELECT cron.schedule(
    'weekly-owner-summary',
    '0 4 * * 1',
    $$SELECT public.send_weekly_owner_summary();$$
);
