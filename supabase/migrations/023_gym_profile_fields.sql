-- ============================================================================
-- Migration: 023_gym_profile_fields.sql
-- Description: Give a gym a real profile, not just a name and an address.
-- ============================================================================
--
-- The owner could set exactly three things: name, address, and a single
-- free-text operating-hours string. Meanwhile members had nowhere to find the
-- gym's phone number, nowhere to see which days it is actually open, and no
-- way to know who their gym owner is.
--
-- OPERATING HOURS
--   Stays JSONB rather than becoming seven pairs of columns, because the shape
--   is genuinely a small document and the old free-text value has to keep
--   working. utils/operating-hours.ts owns the schema:
--
--     { "version": 2,
--       "days": { "mon": { "closed": false, "open": "06:00", "close": "22:00" },
--                 ... "sun": { "closed": true,  "open": "",      "close": "" } },
--       "note": "Closed on public holidays",
--       "summary": "Mon-Fri 6:00 AM - 10:00 PM, Sat ..." }
--
--   `summary` is derived on write and kept only so the pre-existing readers
--   that look for operating_hours.summary keep rendering something sensible.
--   Nothing computes from it.
--
-- No backfill: a gym with the legacy { "summary": "..." } value is detected at
-- read time and the owner is prompted to set real hours. Guessing that
-- "6:00 AM - 10:00 PM" meant all seven days would invent a fact about someone's
-- business.
-- ============================================================================

ALTER TABLE public.gyms
    ADD COLUMN IF NOT EXISTS description   TEXT,
    ADD COLUMN IF NOT EXISTS contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    -- Displayed to members as chips. text[] and not a join table: these are
    -- free-form labels the owner types ("Steam room"), not shared entities
    -- anything needs to query across gyms.
    ADD COLUMN IF NOT EXISTS amenities     TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.gyms.operating_hours IS
    'Per-day hours document, version 2. See utils/operating-hours.ts. Legacy '
    'rows may instead hold { "summary": "<free text>" } from before 023.';

-- ---------------------------------------------------------------------------
-- Members need to reach their gym, and to know who runs it.
-- ---------------------------------------------------------------------------
-- can_view_profile() already lets members of the same gym read each other, so
-- the owner's profile row is readable without a policy change. This function
-- exists to constrain WHAT is read: it returns the owner's contact details and
-- nothing else, so the member-facing gym screen can't accidentally select the
-- health notes or emergency contact that a broad `profiles` select would also
-- expose.
CREATE OR REPLACE FUNCTION public.get_gym_owner_card(p_gym_id UUID)
RETURNS TABLE (
    profile_id UUID,
    full_name  TEXT,
    photo_url  TEXT,
    phone      TEXT,
    email      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, p.full_name, p.photo_url, p.phone, p.email
    FROM public.gym_members gm
    JOIN public.profiles p ON p.id = gm.profile_id
    WHERE gm.gym_id = p_gym_id
      AND gm.role = 'owner'
      -- SECURITY DEFINER bypasses RLS, so authorize explicitly: only somebody
      -- attached to this gym may read its owner card.
      AND public.is_gym_member_or_owner(p_gym_id)
    ORDER BY gm.joined_at
    LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gym_owner_card(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gym_owner_card(UUID) TO authenticated;
