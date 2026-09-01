-- ============================================================================
-- Migration: 027_staff_can_read_member_coverage.sql
-- Date: 2026-09-01
-- Description: Let staff see when a member's membership runs to, without
--              showing them what anyone paid.
-- ============================================================================
--
-- THE BUG. subscriptions_select_policy is
--
--     gm.profile_id = get_current_profile_id() OR is_gym_owner(gm.gym_id)
--
-- with no staff branch, so on the staff Members screen the embedded
-- `subscriptions ( end_date, status )` in useMembers came back as an EMPTY
-- ARRAY for everyone except the signed-in staff member themselves. Nothing
-- errored. Consequences seen on device:
--
--   * Aman, who holds two active subscriptions covering 2026-08-31 to
--     2027-03-01, was captioned "No plan recorded".
--   * He was also listed under the "No Plan" filter, which is meant to surface
--     people training for free -- so the one screen a front-desk staffer would
--     use to check whether someone has paid was telling them the opposite.
--   * The signed-in staff member's own row showed "Paid to 30 Sept 2026",
--     because that single row was visible under the profile_id branch. That
--     inconsistency is what made the bug visible at all.
--
-- THE FIX, and why it is not just "add staff to the policy". RLS is row-level,
-- so widening subscriptions_select_policy would also hand staff amount_paid and
-- receipt_number. No staff screen reads either (checked: app/(staff)/** has no
-- reference to amount, payment, receipt or revenue), and gym revenue is the
-- owner's business, so this exposes only the coverage dates through a
-- SECURITY DEFINER function instead. The policy itself is left untouched.
--
-- coverage_end is max(end_date) across ACTIVE rows, not the row covering today:
-- a member who renews early legitimately holds two active subscriptions, and
-- "when does access end" is the later one. See the subscription coverage model
-- established in migration 024.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gym_member_coverage(target_gym_id UUID)
RETURNS TABLE (member_id UUID, coverage_end DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT gm.id AS member_id,
           max(s.end_date) AS coverage_end
    FROM public.gym_members gm
    LEFT JOIN public.subscriptions s
           ON s.gym_member_id = gm.id
          AND s.status = 'active'
    -- Gate inside the function: it is SECURITY DEFINER, so without this a plain
    -- member could call it and read the whole gym's coverage. A member who is
    -- neither staff nor owner gets zero rows.
    WHERE gm.gym_id = target_gym_id
      AND public.is_gym_staff_or_owner(target_gym_id)
    GROUP BY gm.id;
$$;

-- Called directly by the client, so authenticated needs EXECUTE. Postgres
-- grants EXECUTE to PUBLIC by default and anon/authenticated inherit it, so the
-- revoke has to target PUBLIC to do anything at all -- see migration 012.
REVOKE EXECUTE ON FUNCTION public.gym_member_coverage(UUID) FROM PUBLIC;
-- Supabase's default privileges re-grant EXECUTE to anon and authenticated on
-- new functions in public, so a revoke aimed only at PUBLIC leaves anon holding
-- an explicit grant. Harmless in itself -- an anon caller has no clerk id, so
-- is_gym_staff_or_owner() is false and the function returns zero rows -- but
-- revoked anyway to keep the reachable surface honest.
REVOKE EXECUTE ON FUNCTION public.gym_member_coverage(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.gym_member_coverage(UUID) TO authenticated;
