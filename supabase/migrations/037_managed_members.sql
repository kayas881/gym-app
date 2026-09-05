-- ============================================================================
-- Migration: 037_managed_members.sql
-- Date: 2026-09-04
-- Description: Let a gym member exist without ever downloading the app.
-- ============================================================================
--
-- THE PROBLEM. A member only existed if they completed five steps: download,
-- sign up, fill a profile, enter a gym code, wait for approval. Everyone who did
-- not finish that did not exist in the system at all -- so the owner could not
-- record their payment, see their dues, or count them anywhere. He ended up
-- running the app AND a notebook, and two systems that disagree are worse than
-- one notebook.
--
-- THE MODEL. A member is a record the OWNER creates. An app login is an optional
-- upgrade attached to it later (migration 038, claim codes). This is how any
-- business-facing tool works: the practice owns the patient record whether or
-- not the patient ever uses the portal.
--
-- WHY THIS IS A SMALL CHANGE HERE. Everything downstream -- gym_members,
-- subscriptions, subscription_payments, check_ins, complaints -- already keys off
-- profile_id, never clerk_id. So one nullable column unlocks it.
--
-- WHY IT IS ALSO SAFE. get_current_profile_id() is
-- `SELECT id FROM profiles WHERE clerk_id = get_clerk_id()`, and in SQL
-- `NULL = NULL` is not true. A profile with no clerk_id therefore matches no
-- signed-in user, so every existing RLS policy already treats managed members as
-- "belongs to nobody" without a single policy change.
--
-- Note gym_members.profile_id stays NOT NULL -- a managed member still has a
-- profile row, it just has no login attached. Nothing that compares profile_id
-- is affected.
-- ============================================================================

ALTER TABLE public.profiles
    ALTER COLUMN clerk_id DROP NOT NULL;

COMMENT ON COLUMN public.profiles.clerk_id IS
    'Clerk user id, or NULL for a member the gym owner created who has not '
    'claimed an app login yet. NULL is what makes a profile "managed": '
    'get_current_profile_id() can never resolve to it, so RLS treats it as '
    'belonging to no signed-in user.';

-- ---------------------------------------------------------------------------
-- Creating one.
-- ---------------------------------------------------------------------------
-- Has to be a function rather than a direct insert: profiles_insert_policy is
-- `clerk_id = get_clerk_id()`, which a NULL clerk_id can never satisfy. Doing it
-- here also keeps the profile and the membership in one transaction, so a member
-- can never end up with a profile and no gym.
CREATE OR REPLACE FUNCTION public.create_managed_member(
    p_gym_id    UUID,
    p_full_name TEXT,
    p_phone     TEXT DEFAULT NULL,
    p_photo_url TEXT DEFAULT NULL
)
RETURNS public.gym_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_row        public.gym_members;
    v_name       TEXT := nullif(trim(p_full_name), '');
    v_phone      TEXT := nullif(trim(p_phone), '');
BEGIN
    IF NOT public.is_gym_owner(p_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can add members' USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'a name is required' USING ERRCODE = '22023';
    END IF;

    -- email is left NULL on purpose. profiles.email is UNIQUE, so inventing a
    -- placeholder would collide on the second member.
    INSERT INTO public.profiles (clerk_id, full_name, phone, photo_url)
    VALUES (NULL, v_name, v_phone, nullif(trim(p_photo_url), ''))
    RETURNING id INTO v_profile_id;

    INSERT INTO public.gym_members (gym_id, profile_id, role, status)
    VALUES (p_gym_id, v_profile_id, 'member', 'active')
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_managed_member(UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_managed_member(UUID, TEXT, TEXT, TEXT)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- Editing one.
-- ---------------------------------------------------------------------------
-- Needed for the flow to be usable at all: a managed member cannot fix their own
-- typo, because they have no way to sign in. Refuses once a login is attached --
-- from that point the details are the member's own to change, and the owner
-- silently rewriting them would be wrong.
CREATE OR REPLACE FUNCTION public.update_managed_member(
    p_gym_member_id UUID,
    p_full_name     TEXT,
    p_phone         TEXT DEFAULT NULL,
    p_photo_url     TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gym_id     UUID;
    v_profile_id UUID;
    v_clerk_id   TEXT;
    v_row        public.profiles;
    v_name       TEXT := nullif(trim(p_full_name), '');
BEGIN
    SELECT gm.gym_id, p.id, p.clerk_id
      INTO v_gym_id, v_profile_id, v_clerk_id
    FROM public.gym_members gm
    JOIN public.profiles p ON p.id = gm.profile_id
    WHERE gm.id = p_gym_member_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'member % not found', p_gym_member_id USING ERRCODE = '23503';
    END IF;

    IF NOT public.is_gym_owner(v_gym_id) THEN
        RAISE EXCEPTION 'only the gym owner can edit members' USING ERRCODE = '42501';
    END IF;

    IF v_clerk_id IS NOT NULL THEN
        RAISE EXCEPTION 'this member has their own app login and edits their own details'
            USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'a name is required' USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles
    SET full_name  = v_name,
        phone      = nullif(trim(p_phone), ''),
        photo_url  = COALESCE(nullif(trim(p_photo_url), ''), photo_url),
        updated_at = now()
    WHERE id = v_profile_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_managed_member(UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_managed_member(UUID, TEXT, TEXT, TEXT)
    TO authenticated;
