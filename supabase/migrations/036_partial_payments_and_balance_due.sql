-- ============================================================================
-- Migration: 036_partial_payments_and_balance_due.sql
-- Date: 2026-09-04
-- Description: Let a member pay part of a plan now and the rest later, and make
--              the outstanding balance impossible to lose track of.
-- ============================================================================
--
-- THE PROBLEM, from the gym owner. A member buys a 1000 plan, hands over 800,
-- and says they will bring the other 200. With one member that is a mental
-- note. With thirty it is money quietly lost, because nothing in the app could
-- express "this plan is underpaid".
--
-- WHY A LEDGER RATHER THAN A `balance_due` COLUMN. Subtracting on a single
-- amount_paid column would answer "how much is owed" but not "when did they pay
-- the 800, when did the 200 arrive, and which one was cash". Instalments each
-- need their own receipt, so they need their own rows. subscription_payments is
-- the record of money actually received; subscriptions.amount_paid becomes a
-- maintained total so the many existing reads of it keep working unchanged.
--
-- WHY plan_price IS SNAPSHOTTED. The expected amount cannot be read from
-- membership_plans at display time: the owner can edit a plan's price, and that
-- must not silently rewrite what an old member was supposed to have paid, nor
-- invent a balance on a settled subscription.
--
-- DELIBERATELY NOT DONE: a balance does not restrict access. The owner has
-- already let them train; this tracks the debt, it does not police it. Nothing
-- here touches check-in, expiry, or the coverage rules from migration 024.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. What the plan cost when it was sold.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS plan_price NUMERIC;

-- Best effort for history: today's plan price is the only figure available for
-- rows sold before this column existed. NULL where the plan is gone, which the
-- app reads as "expected amount unknown" and therefore no balance.
UPDATE public.subscriptions s
SET plan_price = mp.price
FROM public.membership_plans mp
WHERE mp.id = s.plan_id
  AND s.plan_price IS NULL;

-- ---------------------------------------------------------------------------
-- 2. The ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL
                    REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    amount          NUMERIC NOT NULL CHECK (amount > 0),
    payment_method  TEXT,
    paid_on         DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
    receipt_number  TEXT UNIQUE,
    note            TEXT,
    recorded_by     UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_payments_subscription_idx
    ON public.subscription_payments (subscription_id);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Mirrors subscriptions_select_policy exactly: the member sees their own
-- payments, the gym owner sees their gym's. Staff are excluded here as they are
-- there -- migration 027 gave staff coverage DATES precisely so they would not
-- need to see money.
DROP POLICY IF EXISTS subscription_payments_select_policy ON public.subscription_payments;
CREATE POLICY subscription_payments_select_policy ON public.subscription_payments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.subscriptions s
            JOIN public.gym_members gm ON gm.id = s.gym_member_id
            WHERE s.id = subscription_payments.subscription_id
              AND (
                  gm.profile_id = public.get_current_profile_id()
                  OR public.is_gym_owner(gm.gym_id)
              )
        )
    );

-- No INSERT/UPDATE/DELETE policies on purpose. Every write goes through the
-- SECURITY DEFINER functions below, so the owner check and the
-- "cannot overpay the balance" rule cannot be bypassed by a direct table write.

-- ---------------------------------------------------------------------------
-- 3. Keep subscriptions.amount_paid as the maintained total.
-- ---------------------------------------------------------------------------
-- Everything already reading amount_paid -- payment history, receipts, the
-- owner's revenue figures -- keeps working without knowing the ledger exists.
CREATE OR REPLACE FUNCTION public.subscription_payments_sync_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_subscription UUID := COALESCE(NEW.subscription_id, OLD.subscription_id);
BEGIN
    UPDATE public.subscriptions s
    SET amount_paid = COALESCE((
            SELECT sum(sp.amount)
            FROM public.subscription_payments sp
            WHERE sp.subscription_id = v_subscription
        ), 0),
        updated_at = now()
    WHERE s.id = v_subscription;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_payments_sync ON public.subscription_payments;
CREATE TRIGGER trg_subscription_payments_sync
AFTER INSERT OR UPDATE OR DELETE ON public.subscription_payments
FOR EACH ROW
EXECUTE FUNCTION public.subscription_payments_sync_total();

-- ---------------------------------------------------------------------------
-- 4. Backfill: every existing subscription becomes one paid-in-full ledger row.
-- ---------------------------------------------------------------------------
-- Reuses the subscription's own receipt number so an existing printed receipt
-- still matches the ledger entry it refers to.
INSERT INTO public.subscription_payments
    (subscription_id, amount, payment_method, paid_on, receipt_number, note)
SELECT s.id, s.amount_paid, s.payment_method, s.start_date, s.receipt_number,
       'Recorded before instalments were supported'
FROM public.subscriptions s
WHERE s.amount_paid > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.subscription_payments sp
      WHERE sp.subscription_id = s.id
  );

-- ---------------------------------------------------------------------------
-- 5. Selling a plan now snapshots the price and opens the ledger.
-- ---------------------------------------------------------------------------
-- Unchanged from migration 024 except for the price snapshot and writing the
-- first ledger row instead of setting amount_paid directly. p_amount_paid may
-- legitimately be less than the plan price -- that is the whole point -- and the
-- shortfall simply shows as the balance.
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
    v_price    NUMERIC;
    v_start    DATE;
    v_end      DATE;
    v_receipt  TEXT;
    v_row      public.subscriptions;
    v_actor    UUID := public.get_current_profile_id();
BEGIN
    SELECT gm.gym_id INTO v_gym_id
    FROM public.gym_members gm WHERE gm.id = p_gym_member_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'gym member % not found', p_gym_member_id USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can record payments' USING ERRCODE = '42501';
    END IF;

    SELECT mp.duration_months, mp.price INTO v_duration, v_price
    FROM public.membership_plans mp
    WHERE mp.id = p_plan_id AND mp.gym_id = v_gym_id;

    IF v_duration IS NULL THEN
        RAISE EXCEPTION 'plan % does not belong to this gym', p_plan_id USING ERRCODE = '23503';
    END IF;

    IF p_amount_paid < 0 THEN
        RAISE EXCEPTION 'payment cannot be negative' USING ERRCODE = '22023';
    END IF;

    IF p_amount_paid > v_price THEN
        RAISE EXCEPTION 'payment of % is more than the plan price of %', p_amount_paid, v_price
            USING ERRCODE = '22023';
    END IF;

    v_start := COALESCE(p_start_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
    v_end := (v_start + make_interval(months => v_duration))::date;

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
                gym_member_id, plan_id, amount_paid, plan_price, payment_method,
                start_date, end_date, receipt_number, status
            ) VALUES (
                p_gym_member_id, p_plan_id, 0, v_price, p_payment_method,
                v_start, v_end, v_receipt, 'active'
            ) RETURNING * INTO v_row;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF i = 5 THEN RAISE; END IF;
        END;
    END LOOP;

    -- amount_paid is set by the ledger trigger, not written directly, so there
    -- is one source of truth for money received.
    IF p_amount_paid > 0 THEN
        INSERT INTO public.subscription_payments
            (subscription_id, amount, payment_method, paid_on, receipt_number, recorded_by)
        VALUES (v_row.id, p_amount_paid, p_payment_method, v_start, v_receipt, v_actor);
    END IF;

    UPDATE public.gym_members
    SET status = 'active', updated_at = now()
    WHERE id = p_gym_member_id;

    UPDATE public.renewal_requests
    SET status = 'approved', updated_at = now()
    WHERE gym_member_id = p_gym_member_id AND status = 'pending';

    -- Re-read so the caller gets the amount_paid the trigger just wrote.
    SELECT * INTO v_row FROM public.subscriptions WHERE id = v_row.id;
    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Settling an outstanding balance later.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_balance_payment(
    p_subscription_id UUID,
    p_amount NUMERIC,
    p_payment_method TEXT,
    p_paid_on DATE DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id      UUID;
    v_outstanding NUMERIC;
    v_paid_on     DATE;
    v_receipt     TEXT;
    v_row         public.subscriptions;
    v_actor       UUID := public.get_current_profile_id();
BEGIN
    SELECT gm.gym_id,
           COALESCE(s.plan_price, 0) - COALESCE(s.amount_paid, 0)
      INTO v_gym_id, v_outstanding
    FROM public.subscriptions s
    JOIN public.gym_members gm ON gm.id = s.gym_member_id
    WHERE s.id = p_subscription_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'subscription % not found', p_subscription_id USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can record payments' USING ERRCODE = '42501';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'payment must be greater than zero' USING ERRCODE = '22023';
    END IF;

    -- Refuses to take more than is owed rather than silently creating a credit
    -- the app has nowhere to show.
    IF p_amount > v_outstanding THEN
        RAISE EXCEPTION 'payment of % is more than the % still outstanding', p_amount, v_outstanding
            USING ERRCODE = '22023';
    END IF;

    v_paid_on := COALESCE(p_paid_on, (now() AT TIME ZONE 'Asia/Kolkata')::date);

    FOR i IN 1..5 LOOP
        v_receipt := 'GYM-' || to_char(v_paid_on, 'YYYYMMDD') || '-' ||
                     upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            INSERT INTO public.subscription_payments
                (subscription_id, amount, payment_method, paid_on, receipt_number, recorded_by)
            VALUES (p_subscription_id, p_amount, p_payment_method, v_paid_on, v_receipt, v_actor);
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF i = 5 THEN RAISE; END IF;
        END;
    END LOOP;

    SELECT * INTO v_row FROM public.subscriptions WHERE id = p_subscription_id;
    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_balance_payment(UUID, NUMERIC, TEXT, DATE)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_balance_payment(UUID, NUMERIC, TEXT, DATE)
    TO authenticated;
