-- ============================================================================
-- Migration: 021_expiry_notify_only_when_deliverable.sql [APPLIED via MCP]
-- Description: Don't burn expiry_notified_at for members with no device.
-- ============================================================================
--
-- The previous version claimed expiry_notified_at for every subscription due in
-- 7 days and THEN sent. A member with no push token registered was marked
-- "warned" despite nothing being delivered — and since this reminder only fires
-- at exactly 7 days out, installing the app the next day meant never receiving
-- it. Caught while testing: the job reported 0 sent but had already set the flag.
--
-- Now only members who actually have a registered device are claimed and sent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_expiring_memberships()
RETURNS TABLE (kind TEXT, notified INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today      DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    v_member_ids UUID[];
    v_owner_ids  UUID[];
    v_sent       INT;
BEGIN
    WITH due AS (
        SELECT s.id, gm.profile_id
        FROM public.subscriptions s
        JOIN public.gym_members gm ON gm.id = s.gym_member_id
        WHERE s.status = 'active'
          AND s.end_date = v_today + 7
          AND s.expiry_notified_at IS NULL
          -- Only claim members we can actually reach.
          AND EXISTS (
              SELECT 1 FROM public.push_tokens pt
              WHERE pt.profile_id = gm.profile_id
          )
    ), marked AS (
        UPDATE public.subscriptions s
        SET expiry_notified_at = now()
        FROM due
        WHERE s.id = due.id
        RETURNING due.profile_id
    )
    SELECT array_agg(DISTINCT profile_id) INTO v_member_ids FROM marked;

    v_sent := public.send_push_to_profiles(
        v_member_ids,
        'Membership expiring soon',
        'Your gym membership expires in 7 days. Renew to keep your access.',
        jsonb_build_object('type', 'membership_expiring')
    );
    kind := 'member_7_day_reminder';
    notified := coalesce(v_sent, 0);
    RETURN NEXT;

    SELECT array_agg(DISTINCT owner_gm.profile_id) INTO v_owner_ids
    FROM public.subscriptions s
    JOIN public.gym_members gm       ON gm.id = s.gym_member_id
    JOIN public.gym_members owner_gm ON owner_gm.gym_id = gm.gym_id
                                    AND owner_gm.role = 'owner'
    WHERE s.end_date = v_today - 1
      AND s.status IN ('active', 'expired');

    v_sent := public.send_push_to_profiles(
        v_owner_ids,
        'A membership has expired',
        'One or more members'' plans expired yesterday. Review them in Members.',
        jsonb_build_object('type', 'membership_expired_owner')
    );
    kind := 'owner_expiry_alert';
    notified := coalesce(v_sent, 0);
    RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_expiring_memberships() FROM PUBLIC, anon, authenticated;
