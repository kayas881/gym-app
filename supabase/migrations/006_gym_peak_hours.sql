-- ============================================================================
-- Migration: 006_gym_peak_hours.sql   [ALREADY APPLIED via Supabase MCP]
-- Description: Phase 3 item 7 — hourly check-in distribution for the chart.
-- ============================================================================
--
-- Deliberately SECURITY INVOKER (the default) rather than DEFINER: the
-- existing check_ins_select_policy already limits rows to a gym's staff/owner
-- (or the member themselves), so RLS performs the authorisation. A DEFINER
-- function would bypass RLS and need its own hand-written guard, which is a
-- second place to get wrong.
--
-- Hours are bucketed in Asia/Kolkata to match the trigger in 005 — grouping on
-- the raw UTC hour would shift every bar by 5.5 hours.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gym_peak_hours(
    target_gym_id UUID,
    days_back INT DEFAULT 30
)
RETURNS TABLE (hour_of_day INT, check_in_count BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        EXTRACT(HOUR FROM (c.checked_in_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour_of_day,
        count(*)::bigint AS check_in_count
    FROM public.check_ins c
    WHERE c.gym_id = target_gym_id
      AND c.checked_in_at >= now() - make_interval(days => days_back)
    GROUP BY 1
    ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.gym_peak_hours(UUID, INT) TO anon, authenticated;
