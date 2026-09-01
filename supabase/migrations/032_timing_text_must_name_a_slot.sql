-- ============================================================================
-- Migration: 032_timing_text_must_name_a_slot.sql
-- Date: 2026-09-01
-- Description: Stop unusable free text in profiles.preferred_gym_timing from
--              shadowing a member's detected time slot.
-- ============================================================================
--
-- announcement_recipients() resolves a member's slot as:
--
--     coalesce(gm.preferred_time_slot,
--              nullif(lower(trim(p.preferred_gym_timing)), ''),
--              gm.auto_time_slot)
--
-- preferred_gym_timing was collected by the complete-profile signup step as a
-- FREE TEXT field whose placeholder actually suggested the wrong format
-- ("e.g. 6-8 AM or 6-8 PM"). Anyone who followed the hint stored something that
-- matches none of morning/afternoon/evening -- and because coalesce takes the
-- first non-null value, that junk sits ahead of auto_time_slot and shadows it
-- permanently. The member is then silently left out of every slot-targeted
-- announcement, and always will be, even once their check-in history would have
-- placed them correctly.
--
-- Live examples at the time of writing: "10-12 am" and "10-12 pm".
--
-- Fixing it here rather than by scrubbing those two rows, because the input is
-- only one of the ways a value gets in and the shadowing is the actual defect.
-- The signup screen now offers the three slots as a picker, so no new junk is
-- created either.
--
-- Only the coalesce changes; the audience matching below it is untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.announcement_recipients(p_announcement_id UUID)
RETURNS TABLE (profile_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id   UUID;
    v_audience TEXT;
    v_author   UUID;
BEGIN
    SELECT a.gym_id, lower(a.target_audience), a.author_id
      INTO v_gym_id, v_audience, v_author
    FROM public.announcements a
    WHERE a.id = p_announcement_id;

    IF v_gym_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH resolved AS (
        SELECT gm.profile_id,
               gm.role,
               gm.status,
               coalesce(
                   gm.preferred_time_slot,
                   -- Honour the free-text field ONLY when it actually names a
                   -- slot. Anything else falls through to the detected slot
                   -- instead of hiding it.
                   CASE
                       WHEN lower(trim(p.preferred_gym_timing))
                            IN ('morning', 'afternoon', 'evening')
                       THEN lower(trim(p.preferred_gym_timing))
                   END,
                   gm.auto_time_slot
               ) AS slot
        FROM public.gym_members gm
        LEFT JOIN public.profiles p ON p.id = gm.profile_id
        WHERE gm.gym_id = v_gym_id
          AND gm.status NOT IN ('rejected', 'removed')
          AND gm.profile_id IS DISTINCT FROM v_author
    )
    SELECT r.profile_id
    FROM resolved r
    WHERE CASE v_audience
            WHEN 'everyone' THEN true
            WHEN 'active'   THEN r.status = 'active'
            WHEN 'staff'    THEN r.role IN ('staff', 'owner')
            WHEN 'morning'   THEN r.slot = 'morning'
            WHEN 'afternoon' THEN r.slot = 'afternoon'
            WHEN 'evening'   THEN r.slot = 'evening'
            ELSE false
          END;
END;
$$;
