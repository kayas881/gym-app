-- ============================================================================
-- Migration: 038_member_claim_codes.sql
-- Date: 2026-09-04
-- Description: Let a member the owner created claim an app login for that same
--              record, keeping all their history.
-- ============================================================================
--
-- Migration 037 made members exist without the app. This is the bridge back: the
-- owner generates a short code for one member, hands it over however suits
-- (says it, writes it on the receipt, WhatsApps it), and the member enters it
-- after signing up.
--
-- ADOPT, DO NOT MERGE. At claim time there are two profiles:
--   P1 - the managed record. Holds the membership, subscriptions, payment
--        ledger, check-ins, complaints. No clerk_id.
--   P2 - created moments ago by signing up. Has the clerk_id, no history.
-- "Merging" sounds symmetrical but every foreign key points at P1, so moving
-- them to P2 is a multi-table rewrite that can half-fail and orphan someone's
-- payment history. Instead the clerk_id moves ONTO P1, P1's blanks are filled
-- from P2, and P2 is deleted. One transaction, no foreign key ever moves.
--
-- WHY THE CODE IS 6 CHARACTERS, NOT 4 DIGITS. Same unambiguous alphabet as the
-- gym join code: ~887 million combinations, so brute force is dead on arrival
-- and no lockout is needed to prop it up. A small code space would have forced a
-- short expiry to compensate; a large one lets the code live 7 days, which
-- matters because the realistic failure is not an attacker, it is the member
-- getting home after work and finding the code already dead.
--
-- WHY RATE LIMITING IS PER ACCOUNT, NOT PER CODE. Locking a code after N wrong
-- guesses protects nothing (an attacker sweeps the space, they do not retry one
-- code) and is a denial of service: anyone could burn legitimate codes without
-- ever knowing they existed. The limit belongs on the caller.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.member_claim_codes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_member_id UUID NOT NULL REFERENCES public.gym_members(id) ON DELETE CASCADE,
    code          TEXT NOT NULL UNIQUE,
    created_by    UUID REFERENCES public.profiles(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    claimed_at    TIMESTAMPTZ,
    -- The email of the account that claimed it. Audit only: it is the one field
    -- that would reveal the WRONG person having claimed a code, since after
    -- adoption the profile itself carries the member's own name either way.
    claimed_by_email TEXT,
    revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS member_claim_codes_member_idx
    ON public.member_claim_codes (gym_member_id);

ALTER TABLE public.member_claim_codes ENABLE ROW LEVEL SECURITY;

-- The owner reads status. Nobody writes directly; the functions below are
-- SECURITY DEFINER, and the claimer never needs to SELECT a code - they hand it
-- to claim_member_record() which looks it up on their behalf. That also means a
-- signed-in stranger cannot enumerate live codes.
DROP POLICY IF EXISTS member_claim_codes_select_policy ON public.member_claim_codes;
CREATE POLICY member_claim_codes_select_policy ON public.member_claim_codes
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = member_claim_codes.gym_member_id
              AND public.is_gym_owner(gm.gym_id)
        )
    );

-- ---------------------------------------------------------------------------
-- Attempt log, for rate limiting.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_claim_attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id     TEXT NOT NULL,
    code_tried   TEXT,
    succeeded    BOOLEAN NOT NULL DEFAULT false,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_claim_attempts_clerk_idx
    ON public.member_claim_attempts (clerk_id, attempted_at DESC);

-- RLS on with no policies at all: nothing reaches this table except the
-- SECURITY DEFINER function that writes it.
ALTER TABLE public.member_claim_attempts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Generating a code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_member_claim_code(p_gym_member_id UUID)
RETURNS public.member_claim_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_gym_id    UUID;
    v_clerk_id  TEXT;
    v_candidate TEXT;
    v_row       public.member_claim_codes;
    i           INT;
    j           INT;
BEGIN
    SELECT gm.gym_id, p.clerk_id
      INTO v_gym_id, v_clerk_id
    FROM public.gym_members gm
    JOIN public.profiles p ON p.id = gm.profile_id
    WHERE gm.id = p_gym_member_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'member % not found', p_gym_member_id USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can create claim codes' USING ERRCODE = '42501';
    END IF;

    IF v_clerk_id IS NOT NULL THEN
        RAISE EXCEPTION 'this member already has an app login' USING ERRCODE = '22023';
    END IF;

    -- One live code per member. Generating a new one silently retires the old,
    -- which is what "regenerate" has to mean if the owner suspects the first
    -- code went astray.
    UPDATE public.member_claim_codes
    SET revoked_at = now()
    WHERE gym_member_id = p_gym_member_id
      AND claimed_at IS NULL
      AND revoked_at IS NULL;

    FOR i IN 1..10 LOOP
        v_candidate := '';
        FOR j IN 1..6 LOOP
            v_candidate := v_candidate ||
                substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        END LOOP;

        BEGIN
            INSERT INTO public.member_claim_codes
                (gym_member_id, code, created_by, expires_at)
            VALUES (p_gym_member_id, v_candidate, public.get_current_profile_id(),
                    now() + interval '7 days')
            RETURNING * INTO v_row;
            RETURN v_row;
        EXCEPTION WHEN unique_violation THEN
            IF i = 10 THEN RAISE; END IF;
        END;
    END LOOP;

    RAISE EXCEPTION 'could not allocate a unique claim code';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.generate_member_claim_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_member_claim_code(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_member_claim_code(p_code_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_gym_id UUID;
BEGIN
    SELECT gm.gym_id INTO v_gym_id
    FROM public.member_claim_codes c
    JOIN public.gym_members gm ON gm.id = c.gym_member_id
    WHERE c.id = p_code_id;

    IF v_gym_id IS NULL THEN
        RAISE EXCEPTION 'code not found' USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can revoke claim codes' USING ERRCODE = '42501';
    END IF;

    UPDATE public.member_claim_codes
    SET revoked_at = now()
    WHERE id = p_code_id AND claimed_at IS NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.revoke_member_claim_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_member_claim_code(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Claiming: the careful one.
-- ---------------------------------------------------------------------------
-- RETURNS JSONB rather than raising, and that is not a style choice.
--
-- PL/pgSQL rolls back everything a function did when it raises, so an
-- `INSERT INTO member_claim_attempts` followed by `RAISE EXCEPTION` logs
-- nothing at all. Written that way the attempts table stayed empty, the count
-- never reached the limit, and the rate limiting was decorative -- verified by
-- calling it with a bad code three times and finding zero rows logged.
--
-- Returning normally lets the attempt row commit, which is the whole basis of
-- the limit. Callers check `ok` and show `message`.
--
-- Only genuinely guessable failures count toward the limit. Being signed out
-- still raises (there is no identity to rate limit). A valid code that hits a
-- duplicate-membership conflict is not a guess, so it does not count either --
-- otherwise an honest member could lock themselves out by retrying.
CREATE OR REPLACE FUNCTION public.claim_member_record(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_clerk_id   TEXT := public.get_clerk_id();
    v_code       TEXT := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    v_recent     INT;
    v_row        public.member_claim_codes;
    v_member     public.gym_members;
    v_p1         UUID;
    v_p2         UUID := public.get_current_profile_id();
    v_p2_row     public.profiles;
    v_other_gyms INT;
BEGIN
    IF v_clerk_id IS NULL THEN
        RAISE EXCEPTION 'you must be signed in to claim a membership' USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_recent
    FROM public.member_claim_attempts
    WHERE clerk_id = v_clerk_id
      AND succeeded = false
      AND attempted_at > now() - interval '1 hour';

    -- Not logged: logging a blocked attempt would keep pushing the window out
    -- and lock an honest member out indefinitely.
    IF v_recent >= 5 THEN
        RETURN jsonb_build_object(
            'ok', false, 'reason', 'rate_limited',
            'message', 'Too many incorrect codes. Please wait an hour and try again.');
    END IF;

    SELECT * INTO v_row
    FROM public.member_claim_codes
    WHERE code = v_code
      AND claimed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now();

    IF v_row.id IS NULL THEN
        INSERT INTO public.member_claim_attempts (clerk_id, code_tried, succeeded)
        VALUES (v_clerk_id, v_code, false);
        RETURN jsonb_build_object(
            'ok', false, 'reason', 'invalid_code',
            'message', 'That code is not valid, has expired, or has already been used.');
    END IF;

    SELECT * INTO v_member FROM public.gym_members WHERE id = v_row.gym_member_id;
    v_p1 := v_member.profile_id;

    -- Re-checked rather than trusted: the record could have been claimed between
    -- the code being generated and redeemed.
    IF (SELECT p.clerk_id FROM public.profiles p WHERE p.id = v_p1) IS NOT NULL THEN
        INSERT INTO public.member_claim_attempts (clerk_id, code_tried, succeeded)
        VALUES (v_clerk_id, v_code, false);
        RETURN jsonb_build_object(
            'ok', false, 'reason', 'already_claimed',
            'message', 'That membership has already been claimed.');
    END IF;

    SELECT * INTO v_p2_row FROM public.profiles WHERE id = v_p2;
    IF v_p2_row.id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'reason', 'no_profile',
            'message', 'Your profile is not ready yet. Please try again in a moment.');
    END IF;

    -- gym_members.profile_id is ON DELETE CASCADE, so deleting P2 would silently
    -- destroy any membership it holds. Refuse rather than lose one.
    SELECT count(*) INTO v_other_gyms
    FROM public.gym_members gm
    WHERE gm.profile_id = v_p2 AND gm.gym_id <> v_member.gym_id;

    IF v_other_gyms > 0 THEN
        RETURN jsonb_build_object(
            'ok', false, 'reason', 'other_gym',
            'message', 'This account already belongs to another gym.');
    END IF;

    -- A pending request to this same gym is an empty placeholder and can go. An
    -- active or expired one means two real records for one human, which needs a
    -- person to decide, not a silent merge.
    IF EXISTS (
        SELECT 1 FROM public.gym_members gm
        WHERE gm.profile_id = v_p2 AND gm.gym_id = v_member.gym_id
          AND gm.status <> 'pending'
    ) THEN
        RETURN jsonb_build_object(
            'ok', false, 'reason', 'duplicate_member',
            'message', 'This account is already a member of this gym. Ask the gym owner to sort out the duplicate.');
    END IF;

    DELETE FROM public.gym_members
    WHERE profile_id = v_p2 AND gym_id = v_member.gym_id AND status = 'pending';

    -- push_tokens.profile_id is ON DELETE CASCADE too. Repoint rather than lose
    -- it, or the member gets no notifications until they happen to relaunch.
    UPDATE public.push_tokens SET profile_id = v_p1 WHERE profile_id = v_p2;

    -- P2 goes first so it releases the clerk_id and email unique constraints
    -- before P1 takes them.
    DELETE FROM public.profiles WHERE id = v_p2;

    UPDATE public.profiles p
    SET clerk_id             = v_clerk_id,
        email                = COALESCE(p.email, v_p2_row.email),
        phone                = COALESCE(p.phone, v_p2_row.phone),
        photo_url            = COALESCE(p.photo_url, v_p2_row.photo_url),
        date_of_birth        = COALESCE(p.date_of_birth, v_p2_row.date_of_birth),
        gender               = COALESCE(p.gender, v_p2_row.gender),
        address              = COALESCE(p.address, v_p2_row.address),
        health_notes         = COALESCE(p.health_notes, v_p2_row.health_notes),
        fitness_goal         = COALESCE(p.fitness_goal, v_p2_row.fitness_goal),
        preferred_gym_timing = COALESCE(p.preferred_gym_timing, v_p2_row.preferred_gym_timing),
        updated_at           = now()
    WHERE p.id = v_p1;

    UPDATE public.member_claim_codes
    SET claimed_at = now(), claimed_by_email = v_p2_row.email
    WHERE id = v_row.id;

    INSERT INTO public.member_claim_attempts (clerk_id, code_tried, succeeded)
    VALUES (v_clerk_id, v_code, true);

    RETURN jsonb_build_object(
        'ok', true,
        'gym_member_id', v_member.id,
        'gym_id', v_member.gym_id,
        'message', 'Membership linked.');
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_member_record(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_member_record(TEXT) TO authenticated;
