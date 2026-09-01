-- ============================================================================
-- Migration: 029_expire_stale_memberships_uses_ist.sql
-- Date: 2026-09-01
-- Description: Compare membership end dates against the local (IST) date, not
--              the server's UTC date.
-- ============================================================================
--
-- expire_stale_memberships() was the last date-sensitive function still using
-- CURRENT_DATE. Supabase runs in UTC, so between 00:00 and 05:29 IST
-- CURRENT_DATE is still yesterday: a membership whose end_date was yesterday
-- locally kept status 'active' for another five and a half hours, and
-- useMembers() calls this on every fetch, so the Members list and its status
-- badges were the thing showing it.
--
-- Every other function here already buckets in Asia/Kolkata --
-- recalculate_auto_time_slot, gym_peak_hours, notify_expiring_memberships and
-- record_subscription_payment -- so this brings the last one in line with the
-- established idiom, `(now() AT TIME ZONE 'Asia/Kolkata')::date`.
--
-- The direction is safe: IST is ahead of UTC, so this can only expire a lapsed
-- membership *sooner* (correctly, on the local day it actually ended), never
-- expire a valid one early. Checked against live data before applying -- no
-- active subscription changes state either way today.
--
-- Still IST-hardcoded rather than read from the gym record; see the note in
-- migration 005 about serving gyms outside IST.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_memberships(target_gym_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected INTEGER;
    v_today  DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
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
      AND s.end_date < v_today;

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
            AND s.end_date >= v_today
      );

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
