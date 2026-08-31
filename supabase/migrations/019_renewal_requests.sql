-- ============================================================================
-- Migration: 019_renewal_requests.sql [APPLIED via Supabase MCP]
-- Description: Phase 6 item 3 — member-initiated renewal requests.
-- ============================================================================
--
-- app/(member)/renew.tsx previously persisted NOTHING: the member picked a plan,
-- was told to pay at the desk, and the owner got no signal. It couldn't write to
-- `subscriptions` because that table is owner-only (is_gym_owner) — the right
-- call, but it left the flow one-third built.
--
-- A dedicated table rather than reusing subscriptions.status='pending_renewal':
-- subscriptions.receipt_number is UNIQUE NOT NULL, so an unpaid request would
-- need a placeholder receipt sitting in the member's payment history. A renewal
-- request is not a payment and belongs in its own table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.renewal_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id         UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    gym_member_id  UUID NOT NULL REFERENCES public.gym_members(id) ON DELETE CASCADE,
    plan_id        UUID NOT NULL REFERENCES public.membership_plans(id),
    status         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renewal_requests_gym_status
    ON public.renewal_requests(gym_id, status);

-- One open request per member: re-requesting updates the existing row rather
-- than stacking duplicates in the owner's queue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_renewal_requests_open
    ON public.renewal_requests(gym_member_id)
    WHERE status = 'pending';

ALTER TABLE public.renewal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "renewal_requests_select_policy" ON public.renewal_requests;
CREATE POLICY "renewal_requests_select_policy" ON public.renewal_requests
    FOR SELECT
    USING (
        public.is_gym_staff_or_owner(gym_id)
        OR EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = renewal_requests.gym_member_id
              AND gm.profile_id = public.get_current_profile_id()
        )
    );

-- The member creates their own request, for their own membership, in their own
-- gym, choosing an ACTIVE plan that belongs to that gym.
DROP POLICY IF EXISTS "renewal_requests_insert_policy" ON public.renewal_requests;
CREATE POLICY "renewal_requests_insert_policy" ON public.renewal_requests
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = renewal_requests.gym_member_id
              AND gm.profile_id = public.get_current_profile_id()
              AND gm.gym_id = renewal_requests.gym_id
        )
        AND EXISTS (
            SELECT 1 FROM public.membership_plans mp
            WHERE mp.id = renewal_requests.plan_id
              AND mp.gym_id = renewal_requests.gym_id
              AND mp.is_active
        )
    );

DROP POLICY IF EXISTS "renewal_requests_update_policy" ON public.renewal_requests;
CREATE POLICY "renewal_requests_update_policy" ON public.renewal_requests
    FOR UPDATE
    USING (public.is_gym_owner(gym_id))
    WITH CHECK (public.is_gym_owner(gym_id));

-- A member may withdraw their own pending request.
DROP POLICY IF EXISTS "renewal_requests_delete_policy" ON public.renewal_requests;
CREATE POLICY "renewal_requests_delete_policy" ON public.renewal_requests
    FOR DELETE
    USING (
        status = 'pending'
        AND EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = renewal_requests.gym_member_id
              AND gm.profile_id = public.get_current_profile_id()
        )
    );

DROP TRIGGER IF EXISTS trg_renewal_requests_updated_at ON public.renewal_requests;
CREATE TRIGGER trg_renewal_requests_updated_at
BEFORE UPDATE ON public.renewal_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notify the gym owner when a request arrives.
CREATE OR REPLACE FUNCTION public.notify_renewal_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_name TEXT;
    v_plan_name   TEXT;
    v_owner_ids   UUID[];
BEGIN
    SELECT p.full_name INTO v_member_name
    FROM public.gym_members gm
    JOIN public.profiles p ON p.id = gm.profile_id
    WHERE gm.id = NEW.gym_member_id;

    SELECT mp.name INTO v_plan_name
    FROM public.membership_plans mp WHERE mp.id = NEW.plan_id;

    SELECT array_agg(gm.profile_id) INTO v_owner_ids
    FROM public.gym_members gm
    WHERE gm.gym_id = NEW.gym_id AND gm.role = 'owner';

    PERFORM public.send_push_to_profiles(
        v_owner_ids,
        'Renewal request',
        coalesce(v_member_name, 'A member') || ' requested ' ||
            coalesce(v_plan_name, 'a plan') || '.',
        jsonb_build_object('type', 'renewal_request', 'request_id', NEW.id)
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_renewal_request_notify ON public.renewal_requests;
CREATE TRIGGER trg_renewal_request_notify
AFTER INSERT ON public.renewal_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_renewal_request();

-- NOTE: record_subscription_payment (migration 020) closes any open request for
-- the member in the same transaction as the payment.
