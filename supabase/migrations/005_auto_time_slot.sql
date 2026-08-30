-- ============================================================================
-- Migration: 005_auto_time_slot.sql   [ALREADY APPLIED via Supabase MCP]
-- Description: Phase 3 item 6 — auto-detect a member's usual time slot.
-- ============================================================================
--
-- utils/time-slots.ts had detectTimeSlot() but nothing ever called it, and
-- gym_members.auto_time_slot was only ever read, never written. This computes
-- it in the database so the value is correct regardless of which client
-- records the check-in, and is recalculated once per check-in rather than on
-- every render.
--
-- Bucketing happens in Asia/Kolkata: checked_in_at is timestamptz (stored UTC)
-- while the slot boundaries in constants/config.ts are local wall-clock hours
-- (morning 5-11, afternoon 11-16, evening 16-21). If this app ever serves gyms
-- outside IST, this timezone needs to come from the gym record instead.
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
                   WHEN h >= 16 AND h < 21 THEN 'evening'
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

CREATE OR REPLACE FUNCTION public.check_ins_refresh_time_slot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.recalculate_auto_time_slot(NEW.gym_member_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_ins_auto_time_slot ON public.check_ins;
CREATE TRIGGER trg_check_ins_auto_time_slot
AFTER INSERT ON public.check_ins
FOR EACH ROW
EXECUTE FUNCTION public.check_ins_refresh_time_slot();
