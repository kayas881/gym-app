-- ============================================================================
-- Migration: 020_record_payment_resolves_renewal.sql [APPLIED via Supabase MCP]
-- Description: Recording a payment closes any open renewal request.
-- ============================================================================
--
-- Without this the owner would have to record the payment AND separately clear
-- the request, and a stale 'pending' row would sit in the queue forever. Doing
-- it inside record_subscription_payment keeps it in the same transaction as the
-- payment, so the two can never disagree.
--
-- Full function body lives in 010; this migration only adds the closing UPDATE.
-- Re-stated in full here because CREATE OR REPLACE needs the whole definition —
-- see 010_record_subscription_payment.sql for the reasoning behind the rest.
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

    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE gym_member_id = p_gym_member_id AND status = 'active';

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

    -- Close any open renewal request for this member.
    UPDATE public.renewal_requests
    SET status = 'approved', updated_at = now()
    WHERE gym_member_id = p_gym_member_id AND status = 'pending';

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE) TO authenticated;
