-- ============================================================================
-- Migration: 039_workout_sessions.sql
-- Date: 2026-11-02
-- Description: Persist a member's confirmed workout sets. One session per
--              person per IST day; each set belongs to that session.
-- ============================================================================
--
-- WHY THESE TABLES EXIST. The in-app Push-to-Talk flow confirmed a set into
-- phone memory only. Closing the screen, or a second device, lost the log.
-- The extract/transcribe Edge Functions still do not write here: a set is
-- stored only after the member taps Save on the confirm card.
--
-- WHY ONE SESSION PER IST DAY. The screen is "this session" with no start or
-- end control. A calendar day in Asia/Kolkata is the same day the gym uses
-- everywhere else. Reopening the screen reloads today's session.
--
-- WHY client_id ON SETS. Confirm-then-retry on a flaky gym wifi must not
-- insert the same set twice. The phone mints a UUID before the first insert
-- and reuses it. UNIQUE(client_id) turns the retry into the existing row.
--
-- auth.uid() IS ALWAYS NULL. Clerk is a third-party auth provider, so every
-- policy below uses get_current_profile_id() / get_clerk_id(). A managed
-- member (clerk_id NULL) can never satisfy get_current_profile_id(), so they
-- cannot be impersonated and they cannot write these tables from the app
-- (they have no login to reach the screen).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workout_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Which gym membership this log is attached to. SET NULL if the membership
    -- row is removed so the history stays with the profile.
    gym_member_id  UUID REFERENCES public.gym_members(id) ON DELETE SET NULL,
    -- Local gym day, not UTC. CURRENT_DATE would be the UTC date for 5.5 hours
    -- every evening in India.
    started_on     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workout_sessions_profile_day UNIQUE (profile_id, started_on)
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_profile_started
    ON public.workout_sessions (profile_id, started_on DESC);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_gym_member
    ON public.workout_sessions (gym_member_id);

COMMENT ON TABLE public.workout_sessions IS
    'One workout log per signed-in profile per IST calendar day.';

-- ---------------------------------------------------------------------------
-- 2. Sets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workout_sets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
    -- Phone-minted UUID. The retry of a failed insert must land on this row,
    -- not create a second one.
    client_id   UUID NOT NULL,
    exercise    TEXT NOT NULL,
    weight_kg   NUMERIC(6,2),
    reps        INT,
    rir         INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workout_sets_client_id UNIQUE (client_id),
    CONSTRAINT chk_workout_sets_exercise CHECK (char_length(btrim(exercise)) > 0),
    CONSTRAINT chk_workout_sets_weight
        CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 500)),
    CONSTRAINT chk_workout_sets_reps
        CHECK (reps IS NULL OR (reps >= 1 AND reps <= 100)),
    CONSTRAINT chk_workout_sets_rir
        CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10))
);

CREATE INDEX IF NOT EXISTS idx_workout_sets_session_created
    ON public.workout_sets (session_id, created_at DESC);

COMMENT ON COLUMN public.workout_sets.rir IS
    'Reps in reserve. NULL when the member did not log it.';

COMMENT ON COLUMN public.workout_sets.client_id IS
    'Idempotency key minted on the phone before the first insert.';

-- ---------------------------------------------------------------------------
-- 3. updated_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_workout_sessions_updated_at ON public.workout_sessions;
CREATE TRIGGER trg_workout_sessions_updated_at
    BEFORE UPDATE ON public.workout_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_workout_sets_updated_at ON public.workout_sets;
CREATE TRIGGER trg_workout_sets_updated_at
    BEFORE UPDATE ON public.workout_sets
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. RLS — the member sees only their own rows
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;

-- Default privileges already grant ALL to anon / authenticated / service_role.
-- RLS is the real gate; this only closes the anon REST surface so a signed-out
-- client cannot even attempt a write.
REVOKE ALL ON public.workout_sessions FROM anon;
REVOKE ALL ON public.workout_sets FROM anon;

DROP POLICY IF EXISTS workout_sessions_select_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_select_policy ON public.workout_sessions
    FOR SELECT
    USING (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS workout_sessions_insert_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_insert_policy ON public.workout_sessions
    FOR INSERT
    WITH CHECK (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS workout_sessions_update_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_update_policy ON public.workout_sessions
    FOR UPDATE
    USING (profile_id = public.get_current_profile_id())
    WITH CHECK (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS workout_sessions_delete_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_delete_policy ON public.workout_sessions
    FOR DELETE
    USING (profile_id = public.get_current_profile_id());

-- Sets inherit ownership from the session. A member cannot hang a set off
-- someone else's session even if they guess the UUID.
DROP POLICY IF EXISTS workout_sets_select_policy ON public.workout_sets;
CREATE POLICY workout_sets_select_policy ON public.workout_sets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions s
            WHERE s.id = workout_sets.session_id
              AND s.profile_id = public.get_current_profile_id()
        )
    );

DROP POLICY IF EXISTS workout_sets_insert_policy ON public.workout_sets;
CREATE POLICY workout_sets_insert_policy ON public.workout_sets
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_sessions s
            WHERE s.id = workout_sets.session_id
              AND s.profile_id = public.get_current_profile_id()
        )
    );

DROP POLICY IF EXISTS workout_sets_update_policy ON public.workout_sets;
CREATE POLICY workout_sets_update_policy ON public.workout_sets
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions s
            WHERE s.id = workout_sets.session_id
              AND s.profile_id = public.get_current_profile_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_sessions s
            WHERE s.id = workout_sets.session_id
              AND s.profile_id = public.get_current_profile_id()
        )
    );

DROP POLICY IF EXISTS workout_sets_delete_policy ON public.workout_sets;
CREATE POLICY workout_sets_delete_policy ON public.workout_sets
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.workout_sessions s
            WHERE s.id = workout_sets.session_id
              AND s.profile_id = public.get_current_profile_id()
        )
    );

-- ---------------------------------------------------------------------------
-- 5. Find-or-create today's session
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER so RLS still applies. Returns JSONB rather than raising:
-- a RAISE would roll back the insert, and the caller needs a stable reason
-- to keep the set on the phone instead of pretending the save worked.
CREATE OR REPLACE FUNCTION public.ensure_today_workout_session()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_profile UUID := public.get_current_profile_id();
    v_member  UUID;
    v_day     DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    v_id      UUID;
BEGIN
    IF v_profile IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'not_authenticated',
            'message', 'You need to be signed in to save a set.');
    END IF;

    SELECT gm.id INTO v_member
    FROM public.gym_members gm
    WHERE gm.profile_id = v_profile
      AND gm.status IN ('active', 'pending', 'expired')
    ORDER BY gm.joined_at DESC
    LIMIT 1;

    INSERT INTO public.workout_sessions (profile_id, gym_member_id, started_on)
    VALUES (v_profile, v_member, v_day)
    ON CONFLICT (profile_id, started_on) DO NOTHING;

    SELECT id INTO v_id
    FROM public.workout_sessions
    WHERE profile_id = v_profile
      AND started_on = v_day;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'insert_failed',
            'message', 'Could not open today''s session.');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'session_id', v_id,
        'started_on', v_day);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_today_workout_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_today_workout_session() TO authenticated;
