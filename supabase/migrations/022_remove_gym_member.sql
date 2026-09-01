-- ============================================================================
-- Migration: 022_remove_gym_member.sql
-- Description: Let an owner remove a member who has left the gym.
-- ============================================================================
--
-- PROBLEM
--   'rejected' was only ever written while status = 'pending' (see
--   members/pending.tsx and the Reject button on members/[id].tsx). Once a
--   member was approved there was no way to get them out again. A member who
--   quit stayed in the member list, in the dashboard counts, and -- the part
--   that actually leaks -- in announcement_recipients(), so they kept
--   receiving the gym's push notifications indefinitely.
--
-- WHY A NEW STATUS AND NOT 'rejected'
--   "We never let this person in" and "this person used to train here" are
--   different facts. Reusing 'rejected' would show a former member of two
--   years as a rejected application, and would make the two impossible to
--   tell apart in history.
--
-- WHY AN RPC AND NOT AN UPDATE FROM THE CLIENT
--   Removing has to do three things that must not disagree with each other:
--     1. flip gym_members.status
--     2. expire any still-active subscription -- otherwise the 7-day expiry
--        reminder in notify_expiring_memberships() still fires for someone
--        who no longer trains here
--     3. drop any pending renewal request, which would otherwise sit in the
--        owner's queue forever
--   Three separate client updates could half-apply. This is one transaction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Allow the new status value.
-- ---------------------------------------------------------------------------
ALTER TABLE public.gym_members
    DROP CONSTRAINT IF EXISTS gym_members_status_check;

ALTER TABLE public.gym_members
    ADD CONSTRAINT gym_members_status_check
    CHECK (status IN ('pending', 'active', 'expired', 'rejected', 'removed'));

-- ---------------------------------------------------------------------------
-- 2. Removal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_gym_member(p_gym_member_id UUID)
RETURNS public.gym_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id UUID;
    v_role   TEXT;
    v_row    public.gym_members;
BEGIN
    SELECT gm.gym_id, gm.role INTO v_gym_id, v_role
    FROM public.gym_members gm WHERE gm.id = p_gym_member_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'gym member % not found', p_gym_member_id
            USING ERRCODE = '23503';
    END IF;

    -- SECURITY DEFINER bypasses RLS, so authorize explicitly. Owner only:
    -- staff can approve applications and chat, but removing a paying customer
    -- is not theirs to do.
    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can remove members'
            USING ERRCODE = '42501';
    END IF;

    -- The gym creator holds a gym_members row with role 'owner' (see
    -- setup-gym.tsx) and it appears in the member list like anyone else.
    -- Removing it would lock the owner out of their own gym with no way back.
    IF v_role = 'owner' THEN
        RAISE EXCEPTION 'the gym owner cannot be removed'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.gym_members
    SET status = 'removed', updated_at = now()
    WHERE id = p_gym_member_id
    RETURNING * INTO v_row;

    -- Stops notify_expiring_memberships() reminding a former member to renew.
    -- Payment history is left untouched: they really did pay, and the receipts
    -- have to stay auditable.
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE gym_member_id = p_gym_member_id AND status = 'active';

    UPDATE public.renewal_requests
    SET status = 'rejected', updated_at = now()
    WHERE gym_member_id = p_gym_member_id AND status = 'pending';

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_gym_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_gym_member(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Undo, because removal is destructive and mis-taps happen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_gym_member(p_gym_member_id UUID)
RETURNS public.gym_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id UUID;
    v_row    public.gym_members;
BEGIN
    SELECT gm.gym_id INTO v_gym_id
    FROM public.gym_members gm WHERE gm.id = p_gym_member_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'gym member % not found', p_gym_member_id
            USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can restore members'
            USING ERRCODE = '42501';
    END IF;

    -- Restores to 'active' rather than to whatever they were before, because
    -- the previous status is not recorded. This is not a free membership: the
    -- subscription stayed expired, so expire_stale_memberships() flips them
    -- back to 'expired' on the owner's next member-list load, and until then
    -- they appear under the "No Plan" filter. Either way the owner sees the
    -- member owes money.
    UPDATE public.gym_members
    SET status = 'active', updated_at = now()
    WHERE id = p_gym_member_id AND status = 'removed'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'gym member % is not removed', p_gym_member_id
            USING ERRCODE = '22023';
    END IF;

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_gym_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_gym_member(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Stop notifying removed members.
-- ---------------------------------------------------------------------------
-- Body is 014's, with the exclusion widened from 'rejected' to both terminal
-- statuses. Re-stated in full because CREATE OR REPLACE needs the whole
-- definition -- see 014 for the time-slot precedence reasoning.
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
                   nullif(lower(trim(p.preferred_gym_timing)), ''),
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

REVOKE EXECUTE ON FUNCTION public.announcement_recipients(UUID)
    FROM PUBLIC, anon, authenticated;
