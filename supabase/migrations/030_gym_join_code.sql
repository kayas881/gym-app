-- ============================================================================
-- Migration: 030_gym_join_code.sql
-- Date: 2026-09-01
-- Description: Give every gym a short, human-typable join code.
-- ============================================================================
--
-- Joining a gym meant pasting the gym's UUID: setup-gym.tsx looked the gym up
-- with `.eq('id', trimmedCode)` and the field literally said "Paste Gym ID
-- here...". A UUID cannot be read out over a phone, written on a whiteboard, or
-- typed without a mistake, so in practice the owner had to be reachable to copy
-- and send it -- and the owner is not always at the gym.
--
-- A six-character code fixes the parts a QR cannot: it can be spoken, printed
-- under the QR as a fallback when a camera will not focus, and pasted into
-- WhatsApp. The QR is the fast path at the counter; this is the primitive under
-- it.
--
-- Alphabet excludes I, L, O, 0 and 1 -- the glyphs people misread and mistype.
-- 31^6 is about 887 million combinations, and the unique index is the real
-- guarantee rather than the odds.
-- ============================================================================

ALTER TABLE public.gyms
    ADD COLUMN IF NOT EXISTS join_code TEXT;

-- Created before the backfill so a collision cannot slip through: NULLs do not
-- conflict, and the loop below re-rolls on a unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS gyms_join_code_key
    ON public.gyms (join_code);

CREATE OR REPLACE FUNCTION public.generate_gym_join_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    candidate TEXT;
    i INT;
    attempts INT := 0;
BEGIN
    LOOP
        candidate := '';
        FOR i IN 1..6 LOOP
            candidate := candidate ||
                substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        END LOOP;

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.gyms WHERE join_code = candidate
        );

        attempts := attempts + 1;
        IF attempts > 50 THEN
            RAISE EXCEPTION 'could not allocate a unique gym join code';
        END IF;
    END LOOP;

    RETURN candidate;
END;
$$;

-- Backfill one row at a time so each generated code is visible to the next
-- collision check. A single set-based UPDATE would check against the
-- pre-statement snapshot and could hand two gyms the same code.
DO $$
DECLARE
    g UUID;
BEGIN
    FOR g IN SELECT id FROM public.gyms WHERE join_code IS NULL LOOP
        UPDATE public.gyms
        SET join_code = public.generate_gym_join_code()
        WHERE id = g;
    END LOOP;
END;
$$;

ALTER TABLE public.gyms
    ALTER COLUMN join_code SET NOT NULL,
    ALTER COLUMN join_code SET DEFAULT public.generate_gym_join_code();

-- No separate lookup index: gyms_join_code_key above already serves equality
-- lookups on join_code. And no lookup function is needed either --
-- gyms_select_policy ends in `OR get_clerk_id() IS NOT NULL`, so a signed-in
-- user who is not yet a member can already read gym rows and query this
-- directly -- that clause lets any signed-in user read every gym row, which is
-- worth revisiting on its own but is what makes joining work at all today.
