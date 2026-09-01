-- ============================================================================
-- Migration: 026_evening_slot_ends_at_closing.sql
-- Date: 2026-09-01
-- Description: Extend the evening slot from 21:00 to 22:00 so it reaches the
--              gym's closing time.
-- ============================================================================
--
-- The gym trades 07:00-22:00, but recalculate_auto_time_slot() bucketed evening
-- as `h >= 16 AND h < 21`, so a 21:00-21:59 check-in fell through to NULL and
-- was then discarded by the `WHERE slot IS NOT NULL` filter. Two consequences:
--
--   * A 9-10pm visit never counted towards the member's auto_time_slot.
--   * A member who only ever trains in that hour kept auto_time_slot = NULL and
--     was silently dropped from every evening-targeted announcement, because
--     announcement_recipients() (migration 014) matches on r.slot = 'evening'.
--
-- The staff announcement composer already described the evening slot as
-- "Members attending 4 PM - 10 PM", so this makes the behaviour match what
-- staff were already told. constants/config.ts is updated in step.
--
-- Verified against live data before applying: no member's stored auto_time_slot
-- changes under the new boundary (every existing check-in is at 14:00, 15:00 or
-- 18:00 IST), so the recompute below is a no-op today and exists to keep the
-- column correct for anyone whose history does include a 21:00 visit.
--
-- Slot boundaries remain Asia/Kolkata wall-clock hours and remain hardcoded
-- here, while gyms.operating_hours is per-gym configurable. A gym trading past
-- 22:00 would reintroduce this gap; fixing that properly means deriving the
-- buckets from the gym record, which is a larger change than this.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recalculate_auto_time_slot(target_member_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    detected TEXT;
BEGIN
    SELECT slot INTO detected
    FROM (
        SELECT CASE
                   WHEN h >= 5  AND h < 11 THEN 'morning'
                   WHEN h >= 11 AND h < 16 THEN 'afternoon'
                   WHEN h >= 16 AND h < 22 THEN 'evening'
                   ELSE NULL
               END AS slot
        FROM (
            SELECT EXTRACT(HOUR FROM (c.checked_in_at AT TIME ZONE 'Asia/Kolkata'))::int AS h
            FROM public.check_ins c
            WHERE c.gym_member_id = target_member_id
        ) hours
    ) slots
    WHERE slot IS NOT NULL
    GROUP BY slot
    ORDER BY count(*) DESC, slot
    LIMIT 1;

    UPDATE public.gym_members
    SET auto_time_slot = detected,
        updated_at = now()
    WHERE id = target_member_id;

    RETURN detected;
END;
$$;

-- Bring stored values in line with the new boundary. Only touches members who
-- have at least one check-in; recalculate_auto_time_slot writes NULL for the
-- rest, which is what they already hold.
DO $$
DECLARE
    m UUID;
BEGIN
    FOR m IN
        SELECT DISTINCT gym_member_id FROM public.check_ins
    LOOP
        PERFORM public.recalculate_auto_time_slot(m);
    END LOOP;
END;
$$;

-- Migration 012 revoked EXECUTE on this function from PUBLIC. CREATE OR REPLACE
-- preserves existing grants, so nothing is re-granted here on purpose -- see
-- the note in 012 about the trigger checking EXECUTE at creation time, not on
-- each fire.
