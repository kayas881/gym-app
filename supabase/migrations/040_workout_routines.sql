-- ============================================================================
-- Migration: 040_workout_routines.sql
-- Date: 2026-11-04
-- Description: Member-owned workout routines, weekly schedule, custom
--              exercises, and an optional plan snapshot on today's session.
-- ============================================================================
--
-- Sessions and sets are the log of what actually happened. Routines are only
-- a plan. Deleting a routine therefore SET NULL / CASCADE on plan metadata
-- and never touches workout_sessions rows or workout_sets.
--
-- The built-in exercise library lives in the app. Only custom names the
-- member adds are stored, keyed by the same exercise_key Progress uses.
--
-- auth.uid() IS ALWAYS NULL. Policies use get_current_profile_id().
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workout_routines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_workout_routines_name CHECK (char_length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_workout_routines_profile
    ON public.workout_routines (profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.workout_routine_days (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    routine_id  UUID NOT NULL REFERENCES public.workout_routines(id) ON DELETE CASCADE,
    sort_order  INT NOT NULL DEFAULT 0,
    label       TEXT NOT NULL,
    CONSTRAINT chk_workout_routine_days_label CHECK (char_length(btrim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_workout_routine_days_routine
    ON public.workout_routine_days (routine_id, sort_order);

CREATE TABLE IF NOT EXISTS public.workout_routine_exercises (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_id          UUID NOT NULL REFERENCES public.workout_routine_days(id) ON DELETE CASCADE,
    sort_order      INT NOT NULL DEFAULT 0,
    exercise_key    TEXT NOT NULL,
    exercise_name   TEXT NOT NULL,
    target_sets     INT NOT NULL DEFAULT 3,
    target_reps_min INT,
    target_reps_max INT,
    target_weight_kg NUMERIC(6,2),
    target_rir      INT,
    rest_seconds    INT NOT NULL DEFAULT 120,
    notes           TEXT NOT NULL DEFAULT '',
    CONSTRAINT chk_wre_name CHECK (char_length(btrim(exercise_name)) > 0),
    CONSTRAINT chk_wre_sets CHECK (target_sets >= 1 AND target_sets <= 20),
    CONSTRAINT chk_wre_reps_min CHECK (target_reps_min IS NULL OR (target_reps_min >= 1 AND target_reps_min <= 100)),
    CONSTRAINT chk_wre_reps_max CHECK (target_reps_max IS NULL OR (target_reps_max >= 1 AND target_reps_max <= 100)),
    CONSTRAINT chk_wre_weight CHECK (target_weight_kg IS NULL OR (target_weight_kg >= 0 AND target_weight_kg <= 500)),
    CONSTRAINT chk_wre_rir CHECK (target_rir IS NULL OR (target_rir >= 0 AND target_rir <= 10)),
    CONSTRAINT chk_wre_rest CHECK (rest_seconds >= 15 AND rest_seconds <= 600)
);

CREATE INDEX IF NOT EXISTS idx_workout_routine_exercises_day
    ON public.workout_routine_exercises (day_id, sort_order);

-- One assignment per weekday. NULL routine_id is an explicit rest day.
-- A missing row means unscheduled — the member can still start any routine.
CREATE TABLE IF NOT EXISTS public.workout_week_slots (
    profile_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    weekday     INT NOT NULL,
    routine_id  UUID REFERENCES public.workout_routines(id) ON DELETE SET NULL,
    day_id      UUID REFERENCES public.workout_routine_days(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, weekday),
    CONSTRAINT chk_workout_week_slots_day CHECK (weekday >= 1 AND weekday <= 7)
);

CREATE TABLE IF NOT EXISTS public.workout_custom_exercises (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    exercise_key  TEXT NOT NULL,
    name          TEXT NOT NULL,
    primary_muscle TEXT NOT NULL DEFAULT 'unclassified',
    secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
    category      TEXT NOT NULL DEFAULT 'compound',
    equipment     TEXT NOT NULL DEFAULT 'other',
    instructions  TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workout_custom_exercises UNIQUE (profile_id, exercise_key),
    CONSTRAINT chk_wce_name CHECK (char_length(btrim(name)) > 0),
    CONSTRAINT chk_wce_category CHECK (category IN ('compound', 'isolation', 'core'))
);

CREATE INDEX IF NOT EXISTS idx_workout_custom_exercises_profile
    ON public.workout_custom_exercises (profile_id, name);

-- Optional plan on the existing one-session-per-IST-day row. Snapshot keeps
-- planned-vs-actual after the routine is edited or deleted.
ALTER TABLE public.workout_sessions
    ADD COLUMN IF NOT EXISTS plan_routine_id UUID REFERENCES public.workout_routines(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS plan_day_id UUID REFERENCES public.workout_routine_days(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS plan_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

DROP TRIGGER IF EXISTS trg_workout_routines_updated_at ON public.workout_routines;
CREATE TRIGGER trg_workout_routines_updated_at
    BEFORE UPDATE ON public.workout_routines
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workout_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_routine_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_routine_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_week_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_custom_exercises ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workout_routines FROM anon;
REVOKE ALL ON public.workout_routine_days FROM anon;
REVOKE ALL ON public.workout_routine_exercises FROM anon;
REVOKE ALL ON public.workout_week_slots FROM anon;
REVOKE ALL ON public.workout_custom_exercises FROM anon;

DROP POLICY IF EXISTS workout_routines_all ON public.workout_routines;
CREATE POLICY workout_routines_select ON public.workout_routines
    FOR SELECT USING (profile_id = public.get_current_profile_id());
CREATE POLICY workout_routines_insert ON public.workout_routines
    FOR INSERT WITH CHECK (profile_id = public.get_current_profile_id());
CREATE POLICY workout_routines_update ON public.workout_routines
    FOR UPDATE USING (profile_id = public.get_current_profile_id())
    WITH CHECK (profile_id = public.get_current_profile_id());
CREATE POLICY workout_routines_delete ON public.workout_routines
    FOR DELETE USING (profile_id = public.get_current_profile_id());

DROP POLICY IF EXISTS workout_routine_days_select ON public.workout_routine_days;
CREATE POLICY workout_routine_days_select ON public.workout_routine_days
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.workout_routines r
            WHERE r.id = workout_routine_days.routine_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );
CREATE POLICY workout_routine_days_insert ON public.workout_routine_days
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_routines r
            WHERE r.id = workout_routine_days.routine_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );
CREATE POLICY workout_routine_days_update ON public.workout_routine_days
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.workout_routines r
            WHERE r.id = workout_routine_days.routine_id
              AND r.profile_id = public.get_current_profile_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_routines r
            WHERE r.id = workout_routine_days.routine_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );
CREATE POLICY workout_routine_days_delete ON public.workout_routine_days
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.workout_routines r
            WHERE r.id = workout_routine_days.routine_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );

CREATE POLICY workout_routine_exercises_select ON public.workout_routine_exercises
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.workout_routine_days d
            JOIN public.workout_routines r ON r.id = d.routine_id
            WHERE d.id = workout_routine_exercises.day_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );
CREATE POLICY workout_routine_exercises_insert ON public.workout_routine_exercises
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_routine_days d
            JOIN public.workout_routines r ON r.id = d.routine_id
            WHERE d.id = workout_routine_exercises.day_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );
CREATE POLICY workout_routine_exercises_update ON public.workout_routine_exercises
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.workout_routine_days d
            JOIN public.workout_routines r ON r.id = d.routine_id
            WHERE d.id = workout_routine_exercises.day_id
              AND r.profile_id = public.get_current_profile_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workout_routine_days d
            JOIN public.workout_routines r ON r.id = d.routine_id
            WHERE d.id = workout_routine_exercises.day_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );
CREATE POLICY workout_routine_exercises_delete ON public.workout_routine_exercises
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.workout_routine_days d
            JOIN public.workout_routines r ON r.id = d.routine_id
            WHERE d.id = workout_routine_exercises.day_id
              AND r.profile_id = public.get_current_profile_id()
        )
    );

CREATE POLICY workout_week_slots_select ON public.workout_week_slots
    FOR SELECT USING (profile_id = public.get_current_profile_id());
CREATE POLICY workout_week_slots_insert ON public.workout_week_slots
    FOR INSERT WITH CHECK (profile_id = public.get_current_profile_id());
CREATE POLICY workout_week_slots_update ON public.workout_week_slots
    FOR UPDATE USING (profile_id = public.get_current_profile_id())
    WITH CHECK (profile_id = public.get_current_profile_id());
CREATE POLICY workout_week_slots_delete ON public.workout_week_slots
    FOR DELETE USING (profile_id = public.get_current_profile_id());

CREATE POLICY workout_custom_exercises_select ON public.workout_custom_exercises
    FOR SELECT USING (profile_id = public.get_current_profile_id());
CREATE POLICY workout_custom_exercises_insert ON public.workout_custom_exercises
    FOR INSERT WITH CHECK (profile_id = public.get_current_profile_id());
CREATE POLICY workout_custom_exercises_update ON public.workout_custom_exercises
    FOR UPDATE USING (profile_id = public.get_current_profile_id())
    WITH CHECK (profile_id = public.get_current_profile_id());
CREATE POLICY workout_custom_exercises_delete ON public.workout_custom_exercises
    FOR DELETE USING (profile_id = public.get_current_profile_id());
