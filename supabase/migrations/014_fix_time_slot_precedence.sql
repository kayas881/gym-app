-- ============================================================================
-- Migration: 014_fix_time_slot_precedence.sql [APPLIED via Supabase MCP]
-- Description: An explicitly chosen time slot must beat the auto-detected one.
-- ============================================================================
--
-- The previous precedence was:
--   gym_members.preferred_time_slot -> gym_members.auto_time_slot
--                                   -> profiles.preferred_gym_timing
--
-- gym_members.preferred_time_slot is written by nothing in the app (null for
-- every member). The member profile screen saves the user's choice to
-- profiles.preferred_gym_timing — which sat LAST, behind auto_time_slot. So a
-- member who explicitly picked "morning" but had one evening check-in was
-- targeted as evening: detection silently overrode an explicit preference.
--
-- Mirrored in utils/announcement-audience.ts so push and the in-app feed agree.
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
                   -- What the member profile screen actually saves. Free text
                   -- there ("10-12 pm") simply matches no slot.
                   nullif(lower(trim(p.preferred_gym_timing)), ''),
                   -- Fallback: detected from check-in history.
                   gm.auto_time_slot
               ) AS slot
        FROM public.gym_members gm
        LEFT JOIN public.profiles p ON p.id = gm.profile_id
        WHERE gm.gym_id = v_gym_id
          AND gm.status <> 'rejected'
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

REVOKE EXECUTE ON FUNCTION public.announcement_recipients(UUID) FROM PUBLIC, anon, authenticated;
