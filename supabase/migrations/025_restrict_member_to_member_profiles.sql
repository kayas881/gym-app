-- =============================================================================
-- Migration: 025_restrict_member_to_member_profiles.sql
-- Date: 2026-09-01
-- Description: Stop one gym member from reading another member's profile row.
--
-- profiles_select_policy is `can_view_profile(id, clerk_id)`, and that function
-- had a blanket "we are in the same gym" branch. profiles holds phone, email,
-- address, date_of_birth, gender, emergency_contact_name/phone and
-- health_notes, so any member could read every other member's medical notes and
-- next of kin. Nothing in the app queried that member-to-member today, so this
-- closes the hole rather than fixing a visible bug -- it was one careless
-- `select *` away from leaking.
--
-- What still has to work, and why each branch below exists:
--   * The owner reads every member (members list, member detail, payments).
--   * Staff read members too -- staff are gym_members rows with role='staff',
--     which is the only reason the old same-gym branch could not just be
--     deleted.
--   * A member reads whoever authored an announcement. announcements_insert_policy
--     is is_gym_staff_or_owner, so that author can be staff, not just the owner.
--   * A member reads the gym owner (gym info, contact card).
-- Member -> member is the only relationship that goes away.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_view_profile(
    target_profile_id UUID,
    target_clerk_id   TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        -- 1. Own profile.
        target_clerk_id = public.get_clerk_id()

        -- 2. Caller runs a gym the target belongs to: owner -> anyone,
        --    staff -> member/staff.
        OR EXISTS (
            SELECT 1
            FROM public.gym_members gm_target
            WHERE gm_target.profile_id = target_profile_id
              AND public.is_gym_staff_or_owner(gm_target.gym_id)
        )

        -- 3. Target runs a gym the caller belongs to: lets a member see the
        --    owner or a staff member who posted an announcement.
        OR EXISTS (
            SELECT 1
            FROM public.gym_members gm_self
            JOIN public.gym_members gm_target
              ON gm_target.gym_id = gm_self.gym_id
            WHERE gm_self.profile_id = public.get_current_profile_id()
              AND gm_target.profile_id = target_profile_id
              AND gm_target.role IN ('owner', 'staff')
              AND gm_target.status = 'active'
        )

        -- 4. Target is the registered owner of a gym the caller belongs to,
        --    even if that owner has no gym_members row of their own.
        OR EXISTS (
            SELECT 1
            FROM public.gyms g
            JOIN public.gym_members gm ON g.id = gm.gym_id
            WHERE gm.profile_id = public.get_current_profile_id()
              AND g.owner_clerk_id = target_clerk_id
        );
$$;

-- Grants are deliberately left alone. Unlike the trigger functions in migration
-- 012, this one is called from an RLS policy, so EXECUTE is checked on every
-- query against profiles -- revoking from PUBLIC would turn a future anon read
-- into a permission error instead of an empty result, and buys nothing: the
-- function only reports whether the caller may see a row it could just select.
