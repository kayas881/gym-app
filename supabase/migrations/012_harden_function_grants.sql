-- ============================================================================
-- Migration: 012_harden_function_grants.sql [APPLIED via Supabase MCP]
-- Description: Hardening pass from the Supabase security advisor.
-- ============================================================================
--
-- NOTE ON REVOKING: Postgres grants EXECUTE to PUBLIC by default on
-- CREATE FUNCTION. Revoking from `anon`/`authenticated` alone does nothing —
-- they still inherit it from PUBLIC. The grant must be revoked from PUBLIC and
-- then handed back to the roles that need it. (Verified with
-- has_function_privilege(); the first attempt at this changed nothing.)
--
-- DELIBERATELY UNTOUCHED: get_clerk_id, get_current_profile_id, is_gym_owner,
-- is_gym_staff_or_owner, is_gym_member_or_owner, can_view_profile. These are
-- the predicates inside the RLS policies, and Postgres checks EXECUTE against
-- the querying role when evaluating a policy — revoking them would break every
-- policy in the schema. They are also harmless to call directly: each returns
-- only a boolean or the caller's own id, and null/false when unauthenticated.
-- ============================================================================

-- 1. Pin the search_path on the updated_at trigger helper. It is SECURITY
--    INVOKER so the risk is low, but it is attached to every table and every
--    other function here already sets it.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- 2. Trigger-only functions should not be reachable over the REST API.
--    Postgres checks EXECUTE when a trigger is CREATED, not each time it fires,
--    so the check_ins trigger keeps working. (Verified by inserting a check_in
--    inside a DO block that then aborted: the trigger ran without a permission
--    error and nothing persisted.)
--
--    recalculate_auto_time_slot mattered most: SECURITY DEFINER, writes
--    gym_members.auto_time_slot, and has no authorisation check of its own —
--    it cannot have one, because the trigger runs as the checking-in member,
--    who is neither staff nor owner. Closing the RPC route is the correct fix
--    rather than adding a guard that would break check-in.
REVOKE EXECUTE ON FUNCTION public.recalculate_auto_time_slot(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_ins_refresh_time_slot() FROM PUBLIC, anon, authenticated;

-- 3. Guarded RPCs: signed-in callers only. Their internal checks would reject
--    an anonymous caller anyway; this removes the surface.
REVOKE EXECUTE ON FUNCTION public.expire_stale_memberships(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.expire_stale_memberships(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_chat_message_read(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_chat_message_read(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_subscription_payment(UUID, UUID, NUMERIC, TEXT, DATE) TO authenticated;
