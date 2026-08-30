-- ============================================================================
-- Migration: 007_mark_chat_message_read.sql  [ALREADY APPLIED via Supabase MCP]
-- Description: Phase 4 — the missing RPC behind staff-chat read receipts.
-- ============================================================================
--
-- hooks/useStaffChat.ts calls rpc('mark_chat_message_read'), but the function
-- was never created. Every call failed, and because the hook discards the
-- result it failed silently, so unread counts never cleared.
--
-- SECURITY DEFINER on purpose: staff_chat_messages has no UPDATE policy (by
-- design — messages shouldn't be editable). This function is the one sanctioned
-- write path, so it carries its own authorisation checks.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_chat_message_read(
    p_message_id UUID,
    p_profile_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    msg_gym_id UUID;
BEGIN
    SELECT gym_id INTO msg_gym_id
    FROM public.staff_chat_messages
    WHERE id = p_message_id;

    IF msg_gym_id IS NULL THEN
        RETURN;
    END IF;

    IF NOT public.is_gym_staff_or_owner(msg_gym_id) THEN
        RAISE EXCEPTION 'not authorized for this gym''s chat'
            USING ERRCODE = '42501';
    END IF;

    IF p_profile_id IS DISTINCT FROM public.get_current_profile_id() THEN
        RAISE EXCEPTION 'can only mark messages read for yourself'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.staff_chat_messages
    SET read_by = coalesce(read_by, '{}'::uuid[]) || p_profile_id
    WHERE id = p_message_id
      AND NOT (p_profile_id = ANY (coalesce(read_by, '{}'::uuid[])));
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_chat_message_read(UUID, UUID) TO anon, authenticated;
