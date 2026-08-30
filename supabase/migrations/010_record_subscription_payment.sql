-- ============================================================================
-- Migration: 010_record_subscription_payment.sql [APPLIED via Supabase MCP]
-- Description: Make recording a payment atomic; fix receipt-number collisions.
-- ============================================================================
--
-- hooks/useSubscriptions.createSubscription performed four sequential
-- unguarded writes: read plan -> expire old subscription -> insert new ->
-- set member active. A failure after the insert left a member with a paid
-- subscription but status still 'pending'/'expired' — they stayed in Pending
-- Approvals despite having paid, and the caller reported the whole operation
-- as failed even though the money had been recorded. One function = one
-- transaction: all of it lands or none of it does.
--
-- Receipt numbers were also generated client-side as GYM-YYYYMMDD-XXXX (4
-- random base-36 chars) against a UNIQUE NOT NULL column with no retry, so a
-- collision surfaced as a raw constraint error. Generation moved here with a
-- retry loop.
--
-- SECURITY DEFINER because it writes across subscriptions and gym_members;
-- it authorises explicitly as the gym owner and verifies the plan belongs to
-- the same gym (otherwise an owner could attach another gym's plan by id).
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
    FROM public.gym_members gm
    WHERE gm.id = p_gym_member_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'gym member % not found', p_gym_member_id
            USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can record payments'
            USING ERRCODE = '42501';
    END IF;

    SELECT mp.duration_months INTO v_duration
    FROM public.membership_plans mp
    WHERE mp.id = p_plan_id AND mp.gym_id = v_gym_id;

    IF v_duration IS NULL THEN
        RAISE EXCEPTION 'plan % does not belong to this gym', p_plan_id
            USING ERRCODE = '23503';
    END IF;

    -- Local calendar day, matching utils/date.ts today().
    v_start := COALESCE(p_start_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);

    -- Postgres clamps month arithmetic (Jan 31 + 1 month = Feb 28), the same
    -- rule calculateEndDate() implements client-side.
    v_end := (v_start + make_interval(months => v_duration))::date;

    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE gym_member_id = p_gym_member_id
      AND status = 'active';

    FOR i IN 1..5 LOOP
        v_receipt := 'GYM-' || to_char(v_start, 'YYYYMMDD') || '-' ||
                     upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            INSERT INTO public.subscriptions (
                gym_member_id, plan_id, amount_paid, payment_method,
                start_date, end_date, receipt_number, status
            )
            VALUES (
                p_gym_member_id, p_plan_id, p_amount_paid, p_payment_method,
                v_start, v_end, v_receipt, 'active'
            )
            RETURNING * INTO v_row;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF i = 5 THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    UPDATE public.gym_members
    SET status = 'active', updated_at = now()
    WHERE id = p_gym_member_id;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE) TO anon, authenticated;

-- One-off cleanup: photo_url values written before Storage uploads existed are
-- unreachable local device paths. The app already ignores them (isLocalFileUri),
-- this clears them so the data matches.
UPDATE public.profiles
SET photo_url = NULL
WHERE photo_url LIKE 'file://%' OR photo_url LIKE 'content://%';
