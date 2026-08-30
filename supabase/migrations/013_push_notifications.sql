-- ============================================================================
-- Migration: 013_push_notifications.sql  [APPLIED via Supabase MCP]
-- Description: Phase 5 — push token storage and announcement audience resolver.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- push_tokens
-- ---------------------------------------------------------------------------
-- A table rather than a profiles column, because one person can install the
-- app on several devices and each gets its own token. It also gives somewhere
-- to prune tokens Expo reports as DeviceNotRegistered.
--
-- The token is the primary key: Expo tokens are globally unique, and if a
-- device is handed to a different user the token must MOVE to that user rather
-- than be duplicated across two profiles (which would send one person's
-- notifications to the other).
CREATE TABLE IF NOT EXISTS public.push_tokens (
    token       TEXT PRIMARY KEY,
    profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    platform    TEXT CHECK (platform IN ('ios', 'android', 'web')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_profile_id
    ON public.push_tokens(profile_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Users manage only their own tokens. Nothing reads another user's token from
-- the client: sending happens server-side with the service role.
DROP POLICY IF EXISTS "push_tokens_select_policy" ON public.push_tokens;
CREATE POLICY "push_tokens_select_policy" ON public.push_tokens
    FOR SELECT USING (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS "push_tokens_insert_policy" ON public.push_tokens;
CREATE POLICY "push_tokens_insert_policy" ON public.push_tokens
    FOR INSERT WITH CHECK (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS "push_tokens_update_policy" ON public.push_tokens;
CREATE POLICY "push_tokens_update_policy" ON public.push_tokens
    FOR UPDATE USING (profile_id = public.get_current_profile_id())
    WITH CHECK (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS "push_tokens_delete_policy" ON public.push_tokens;
CREATE POLICY "push_tokens_delete_policy" ON public.push_tokens
    FOR DELETE USING (profile_id = public.get_current_profile_id());

DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON public.push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
BEFORE UPDATE ON public.push_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- announcements.notified_at
-- ---------------------------------------------------------------------------
-- Makes the notify Edge Function idempotent. Without it, a retry (or anyone
-- re-invoking the function with a known announcement id) would re-notify the
-- whole gym.
ALTER TABLE public.announcements
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- announcement_recipients
-- ---------------------------------------------------------------------------
-- Mirrors utils/announcement-audience.ts so push targeting matches the in-app
-- feed exactly. Kept in the database rather than reimplemented in the Edge
-- Function, so there is one server-side definition of the rules.
CREATE OR REPLACE FUNCTION public.announcement_recipients(p_announcement_id UUID)
RETURNS TABLE (profile_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id   UUID;
    v_audience TEXT;
    v_author   UUID;
BEGIN
    SELECT a.gym_id, lower(a.target_audience), a.author_id
      INTO v_gym_id, v_audience, v_author
    FROM public.announcements a
    WHERE a.id = p_announcement_id;

    IF v_gym_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT gm.profile_id
    FROM public.gym_members gm
    LEFT JOIN public.profiles p ON p.id = gm.profile_id
    WHERE gm.gym_id = v_gym_id
      AND gm.status <> 'rejected'
      -- Don't notify the author about their own announcement.
      AND gm.profile_id IS DISTINCT FROM v_author
      AND CASE v_audience
            WHEN 'everyone' THEN true
            WHEN 'active'   THEN gm.status = 'active'
            WHEN 'staff'    THEN gm.role IN ('staff', 'owner')
            -- Explicit choice, then the slot detected from check-ins, then the
            -- free-text profile field — same precedence as the client.
            WHEN 'morning'   THEN coalesce(gm.preferred_time_slot, gm.auto_time_slot, lower(p.preferred_gym_timing)) = 'morning'
            WHEN 'afternoon' THEN coalesce(gm.preferred_time_slot, gm.auto_time_slot, lower(p.preferred_gym_timing)) = 'afternoon'
            WHEN 'evening'   THEN coalesce(gm.preferred_time_slot, gm.auto_time_slot, lower(p.preferred_gym_timing)) = 'evening'
            -- Unknown audience: fail closed rather than notifying everyone.
            ELSE false
          END;
END;
$$;

-- Server-side only: the Edge Function calls this with the service role.
REVOKE EXECUTE ON FUNCTION public.announcement_recipients(UUID) FROM PUBLIC, anon, authenticated;
