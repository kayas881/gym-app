-- ============================================================================
-- Migration: 003_expire_stale_memberships.sql
-- Description: Transition lapsed memberships to 'expired'.
-- ============================================================================
--
-- PROBLEM
--   Nothing in the app ever wrote gym_members.status = 'expired'. The only
--   writers were approve (-> 'active'), reject (-> 'rejected') and
--   createSubscription (-> 'active'). So a membership whose subscription
--   end_date had long passed still read as 'active' forever, which meant:
--     - the "Expired" filter on the member list was permanently empty
--     - the dashboard's "Active Members" card counted lapsed members
--     - status badges never reflected reality
--
-- APPROACH
--   A SECURITY DEFINER function the owner-facing screens call on load. It
--   updates the stored status so every consumer (lists, dashboard, badges)
--   sees the truth without each one re-deriving expiry. Phase 5's scheduled
--   Edge Function can call this exact function instead of duplicating logic.
--
-- TWO THINGS THIS DELIBERATELY DOES NOT DO
--   1. It never expires owners or staff. They hold gym_members rows but have
--      no subscriptions, so "active with no current subscription" would
--      otherwise match the gym owner and lock them out of their own gym.
--   2. It never expires a member who has NO subscription history at all.
--      "Approve without payment" is a supported flow (see members/pending.tsx)
--      that activates a member before any payment exists; expiring them
--      immediately would undo that the moment the owner opened a screen.
--      Only members who HAD a subscription and no longer have a current one
--      are expired.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_memberships(target_gym_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected INTEGER;
BEGIN
    -- SECURITY DEFINER bypasses RLS, so authorize explicitly. Without this,
    -- any signed-in user could mutate any gym's membership statuses.
    IF NOT public.is_gym_staff_or_owner(target_gym_id) THEN
        RAISE EXCEPTION 'not authorized for gym %', target_gym_id
            USING ERRCODE = '42501';
    END IF;

    -- Retire subscriptions whose term has ended, so subscription history and
    -- membership status stay consistent with each other.
    UPDATE public.subscriptions s
    SET status = 'expired',
        updated_at = now()
    FROM public.gym_members gm
    WHERE s.gym_member_id = gm.id
      AND gm.gym_id = target_gym_id
      AND s.status = 'active'
      AND s.end_date < CURRENT_DATE;

    -- Expire members whose subscriptions have all lapsed.
    UPDATE public.gym_members gm
    SET status = 'expired',
        updated_at = now()
    WHERE gm.gym_id = target_gym_id
      AND gm.status = 'active'
      AND gm.role = 'member'
      AND EXISTS (
          SELECT 1 FROM public.subscriptions s
          WHERE s.gym_member_id = gm.id
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.subscriptions s
          WHERE s.gym_member_id = gm.id
            AND s.end_date >= CURRENT_DATE
      );

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- PostgREST calls this as the signed-in role, so it needs EXECUTE.
GRANT EXECUTE ON FUNCTION public.expire_stale_memberships(UUID) TO anon, authenticated;
