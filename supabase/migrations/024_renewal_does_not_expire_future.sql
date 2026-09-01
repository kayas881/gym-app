-- ============================================================================
-- Migration: 024_renewal_does_not_expire_future.sql
-- Description: An early renewal must not expire the period still running.
-- ============================================================================
--
-- PROBLEM
--   record_subscription_payment expired EVERY active subscription
--   unconditionally. That was tolerable while renewals always started today,
--   because the old period really was being replaced. Once the app started
--   defaulting an early renewal to the day after the current plan ends (see
--   utils/date.ts renewalStartDate), the two rows no longer overlap at all —
--   and the still-valid period was being marked expired anyway.
--
--   Aman, live, after one early renewal:
--     6 Months  30 Aug 2026 - 28 Feb 2027  expired   (genuinely superseded)
--     3 Months  31 Aug 2026 - 30 Nov 2026  expired   <- covers TODAY
--     3 Months  01 Dec 2026 - 01 Mar 2027  active    <- has not STARTED
--
--   So his only 'active' subscription did not cover today, and the one that
--   did was flagged expired. Downstream that meant: the member's home screen
--   showed a plan dated "1 Dec - 1 Mar" with Plan Progress stuck at 0% for
--   three months, and Payment History labelled the future row "CURRENT PLAN"
--   while leaving the row he is actually training under unlabelled.
--
-- FIX
--   Only expire subscriptions the new one actually supersedes — those whose
--   period OVERLAPS it. A subscription that ends before the new one begins is
--   not superseded; it is the period currently being used, and it expires on
--   its own end date via expire_stale_memberships().
--
--   This means a member can legitimately hold two 'active' subscriptions: the
--   one covering today and the one starting when it ends. 'active' therefore
--   means "paid for and not superseded", not "in effect right now". Callers
--   that need "right now" must compare dates — useSubscriptions does, and
--   useMembers already takes max(end_date), which is the member's real
--   coverage end.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_subscription_payment(
    p_gym_member_id UUID,
    p_plan_id UUID,
    p_amount_paid NUMERIC,
    p_payment_method TEXT,
    p_start_date DATE DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id   UUID;
    v_duration INT;
    v_start    DATE;
    v_end      DATE;
    v_receipt  TEXT;
    v_row      public.subscriptions;
BEGIN
    SELECT gm.gym_id INTO v_gym_id
    FROM public.gym_members gm WHERE gm.id = p_gym_member_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'gym member % not found', p_gym_member_id USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can record payments' USING ERRCODE = '42501';
    END IF;

    SELECT mp.duration_months INTO v_duration
    FROM public.membership_plans mp
    WHERE mp.id = p_plan_id AND mp.gym_id = v_gym_id;

    IF v_duration IS NULL THEN
        RAISE EXCEPTION 'plan % does not belong to this gym', p_plan_id USING ERRCODE = '23503';
    END IF;

    v_start := COALESCE(p_start_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
    v_end := (v_start + make_interval(months => v_duration))::date;

    -- Only what this payment actually replaces. `end_date >= v_start` is the
    -- overlap test: a period finishing before the new one opens is untouched.
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE gym_member_id = p_gym_member_id
      AND status = 'active'
      AND end_date >= v_start;

    FOR i IN 1..5 LOOP
        v_receipt := 'GYM-' || to_char(v_start, 'YYYYMMDD') || '-' ||
                     upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            INSERT INTO public.subscriptions (
                gym_member_id, plan_id, amount_paid, payment_method,
                start_date, end_date, receipt_number, status
            ) VALUES (
                p_gym_member_id, p_plan_id, p_amount_paid, p_payment_method,
                v_start, v_end, v_receipt, 'active'
            ) RETURNING * INTO v_row;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF i = 5 THEN RAISE; END IF;
        END;
    END LOOP;

    UPDATE public.gym_members
    SET status = 'active', updated_at = now()
    WHERE id = p_gym_member_id;

    UPDATE public.renewal_requests
    SET status = 'approved', updated_at = now()
    WHERE gym_member_id = p_gym_member_id AND status = 'pending';

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- Repair the rows the old behaviour wrongly expired.
-- ---------------------------------------------------------------------------
-- Deliberately narrow. A row is resurrected only if it has not lapsed AND no
-- LATER-recorded subscription overlaps it — the same rule the function now
-- applies. Aman's 6-month row stays expired, because the 31 Aug renewal
-- genuinely did supersede it (30 Nov >= 30 Aug and 31 Aug <= 28 Feb), while
-- his 31 Aug - 30 Nov row comes back, because 1 Dec is after 30 Nov.
--
-- A blanket "un-expire anything not yet lapsed" would have resurrected that
-- 6-month row too, handing him a period he had already been refunded out of
-- in effect.
UPDATE public.subscriptions s
SET status = 'active', updated_at = now()
WHERE s.status = 'expired'
  AND s.end_date >= CURRENT_DATE
  AND NOT EXISTS (
      SELECT 1
      FROM public.subscriptions later
      WHERE later.gym_member_id = s.gym_member_id
        AND later.id <> s.id
        AND later.created_at > s.created_at
        AND later.start_date <= s.end_date
        AND later.end_date >= s.start_date
  );

-- ---------------------------------------------------------------------------
-- Don't chase a member who has already renewed.
-- ---------------------------------------------------------------------------
-- With two concurrent 'active' rows, the 7-day reminder would have fired on
-- 23 Nov for a period ending 30 Nov — telling a member who is paid up through
-- March that his membership was about to lapse, and alerting the owner the
-- day after it "expired". Both now ignore a subscription that a later one
-- already continues. Body is 021's; see it for the deliverability reasoning.
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
          AND EXISTS (
              SELECT 1 FROM public.push_tokens pt
              WHERE pt.profile_id = gm.profile_id
          )
          -- Already renewed: a later period continues this one.
          AND NOT EXISTS (
              SELECT 1 FROM public.subscriptions nxt
              WHERE nxt.gym_member_id = s.gym_member_id
                AND nxt.status = 'active'
                AND nxt.end_date > s.end_date
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
      AND s.status IN ('active', 'expired')
      AND NOT EXISTS (
          SELECT 1 FROM public.subscriptions nxt
          WHERE nxt.gym_member_id = s.gym_member_id
            AND nxt.status = 'active'
            AND nxt.end_date > s.end_date
      );

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
