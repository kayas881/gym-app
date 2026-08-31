-- ============================================================================
-- Migration: 016_push_helper_and_reminders.sql [APPLIED via Supabase MCP]
-- Description: Phase 5 items 3-4 — send primitive + expiry reminders/alerts.
-- ============================================================================
--
-- These send straight to Expo from Postgres via pg_net rather than going
-- through an Edge Function. A cron job calling our own Edge Function would need
-- the service-role key stored somewhere in the database; hitting Expo directly
-- needs no secret at all. Trade-off: pg_net is fire-and-forget, so unlike the
-- announcement Edge Function these cannot prune DeviceNotRegistered tokens from
-- the response. That pruning still happens on the announcement path, which is
-- the high-volume one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_push_to_profiles(
    p_profile_ids UUID[],
    p_title TEXT,
    p_body TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_messages JSONB;
    v_count    INT;
BEGIN
    IF p_profile_ids IS NULL OR array_length(p_profile_ids, 1) IS NULL THEN
        RETURN 0;
    END IF;

    SELECT jsonb_agg(
               jsonb_build_object(
                   'to', pt.token,
                   'sound', 'default',
                   'title', p_title,
                   'body', p_body,
                   'data', p_data,
                   'channelId', 'default'
               )
           ),
           count(*)
      INTO v_messages, v_count
    FROM public.push_tokens pt
    WHERE pt.profile_id = ANY (p_profile_ids);

    IF v_count IS NULL OR v_count = 0 THEN
        RETURN 0;
    END IF;

    PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Accept', 'application/json'
                   ),
        body    := v_messages
    );

    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_push_to_profiles(UUID[], TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Tracks which expiry a member has already been warned about, so a DAILY job
-- cannot nag the same person every morning for a week.
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.notify_expiring_memberships()
RETURNS TABLE (kind TEXT, notified INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Local calendar day, so "7 days before" means what an IST user expects.
    v_today      DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    v_member_ids UUID[];
    v_owner_ids  UUID[];
    v_sent       INT;
BEGIN
    -- Members whose membership ends in exactly 7 days.
    WITH due AS (
        SELECT s.id, gm.profile_id
        FROM public.subscriptions s
        JOIN public.gym_members gm ON gm.id = s.gym_member_id
        WHERE s.status = 'active'
          AND s.end_date = v_today + 7
          AND s.expiry_notified_at IS NULL
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

    -- Owners whose members expired yesterday.
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
