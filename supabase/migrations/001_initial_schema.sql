-- ============================================================================
-- Migration: 001_initial_schema.sql
-- Description: Initial schema for Gym Management Application
-- Target: Supabase / PostgreSQL (Clerk Authentication integration)
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 1: TABLE DEFINITIONS
-- ============================================================================

-- 1. PROFILES (Linked to Clerk Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT,
    photo_url TEXT,
    date_of_birth DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    address TEXT,
    health_notes TEXT,
    fitness_goal TEXT CHECK (fitness_goal IN ('weight_loss', 'muscle_gain', 'general_fitness', 'flexibility', 'endurance', 'other')),
    preferred_gym_timing TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. GYMS
CREATE TABLE IF NOT EXISTS public.gyms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_clerk_id TEXT NOT NULL REFERENCES public.profiles(clerk_id) ON UPDATE CASCADE,
    name TEXT NOT NULL,
    logo_url TEXT,
    address TEXT,
    operating_hours JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. GYM MEMBERS
CREATE TABLE IF NOT EXISTS public.gym_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'member')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'rejected')),
    preferred_time_slot TEXT CHECK (preferred_time_slot IN ('morning', 'afternoon', 'evening')),
    auto_time_slot TEXT CHECK (auto_time_slot IN ('morning', 'afternoon', 'evening')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_gym_members_gym_profile UNIQUE(gym_id, profile_id)
);

-- 4. MEMBERSHIP PLANS
CREATE TABLE IF NOT EXISTS public.membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    duration_months INT NOT NULL CHECK (duration_months > 0),
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_member_id UUID NOT NULL REFERENCES public.gym_members(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES public.membership_plans(id),
    amount_paid DECIMAL(10,2) NOT NULL CHECK (amount_paid >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'online')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    receipt_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'pending_renewal')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. CHECK-INS
CREATE TABLE IF NOT EXISTS public.check_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_member_id UUID NOT NULL REFERENCES public.gym_members(id) ON DELETE CASCADE,
    gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    target_audience TEXT NOT NULL CHECK (target_audience IN ('everyone', 'active', 'morning', 'afternoon', 'evening', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. COMPLAINTS
CREATE TABLE IF NOT EXISTS public.complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.gym_members(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved')),
    owner_response TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. STAFF CHAT MESSAGES
CREATE TABLE IF NOT EXISTS public.staff_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_by UUID[] NOT NULL DEFAULT '{}'
);

-- ============================================================================
-- SECTION 2: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_gym_members_gym_id ON public.gym_members(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_members_profile_id ON public.gym_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_gym_member_id ON public.subscriptions(gym_member_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_gym_member_id ON public.check_ins(gym_member_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_gym_id_checked_in_at ON public.check_ins(gym_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_gym_id ON public.announcements(gym_id);
CREATE INDEX IF NOT EXISTS idx_complaints_gym_id ON public.complaints(gym_id);

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_gyms_owner_clerk_id ON public.gyms(owner_clerk_id);
CREATE INDEX IF NOT EXISTS idx_membership_plans_gym_id ON public.membership_plans(gym_id);
CREATE INDEX IF NOT EXISTS idx_staff_chat_messages_gym_id_created_at ON public.staff_chat_messages(gym_id, created_at ASC);

-- ============================================================================
-- SECTION 3: UPDATED_AT TRIGGER FUNCTION & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_gyms_updated_at ON public.gyms;
CREATE TRIGGER trg_gyms_updated_at
    BEFORE UPDATE ON public.gyms
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_gym_members_updated_at ON public.gym_members;
CREATE TRIGGER trg_gym_members_updated_at
    BEFORE UPDATE ON public.gym_members
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_membership_plans_updated_at ON public.membership_plans;
CREATE TRIGGER trg_membership_plans_updated_at
    BEFORE UPDATE ON public.membership_plans
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON public.announcements;
CREATE TRIGGER trg_announcements_updated_at
    BEFORE UPDATE ON public.announcements
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_complaints_updated_at ON public.complaints;
CREATE TRIGGER trg_complaints_updated_at
    BEFORE UPDATE ON public.complaints
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SECTION 4: ROW LEVEL SECURITY (RLS) & POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_chat_messages ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RLS Helper Functions
-- ----------------------------------------------------------------------------

-- Extract Clerk User ID from auth JWT claims
CREATE OR REPLACE FUNCTION public.get_clerk_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(
        auth.jwt() ->> 'sub',
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
        nullif(current_setting('request.jwt.claim.sub', true), '')
    );
$$;

-- Get current profile ID for authenticated Clerk user
CREATE OR REPLACE FUNCTION public.get_current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.profiles WHERE clerk_id = public.get_clerk_id() LIMIT 1;
$$;

-- Check if current user is owner of a specific gym
CREATE OR REPLACE FUNCTION public.is_gym_owner(check_gym_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.gyms
        WHERE id = check_gym_id
          AND owner_clerk_id = public.get_clerk_id()
    );
$$;

-- Check if current user is owner or active staff member of a specific gym
CREATE OR REPLACE FUNCTION public.is_gym_staff_or_owner(check_gym_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.gyms
        WHERE id = check_gym_id
          AND owner_clerk_id = public.get_clerk_id()
    )
    OR EXISTS (
        SELECT 1 FROM public.gym_members gm
        WHERE gm.gym_id = check_gym_id
          AND gm.profile_id = public.get_current_profile_id()
          AND gm.role IN ('owner', 'staff')
          AND gm.status = 'active'
    );
$$;

-- Check if current user is affiliated with gym (owner or any gym member)
CREATE OR REPLACE FUNCTION public.is_gym_member_or_owner(check_gym_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.gyms
        WHERE id = check_gym_id
          AND owner_clerk_id = public.get_clerk_id()
    )
    OR EXISTS (
        SELECT 1 FROM public.gym_members gm
        WHERE gm.gym_id = check_gym_id
          AND gm.profile_id = public.get_current_profile_id()
    );
$$;

-- Check if current user can view a target profile (self or shares a gym)
CREATE OR REPLACE FUNCTION public.can_view_profile(target_profile_id UUID, target_clerk_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        -- Own profile
        target_clerk_id = public.get_clerk_id()
        -- Member of the same gym
        OR EXISTS (
            SELECT 1
            FROM public.gym_members gm1
            JOIN public.gym_members gm2 ON gm1.gym_id = gm2.gym_id
            WHERE gm1.profile_id = public.get_current_profile_id()
              AND gm2.profile_id = target_profile_id
        )
        -- Target is a member in a gym owned by current user
        OR EXISTS (
            SELECT 1
            FROM public.gym_members gm
            JOIN public.gyms g ON gm.gym_id = g.id
            WHERE g.owner_clerk_id = public.get_clerk_id()
              AND gm.profile_id = target_profile_id
        )
        -- Target is the owner of a gym current user belongs to
        OR EXISTS (
            SELECT 1
            FROM public.gyms g
            JOIN public.gym_members gm ON g.id = gm.gym_id
            WHERE gm.profile_id = public.get_current_profile_id()
              AND g.owner_clerk_id = target_clerk_id
        );
$$;

-- ----------------------------------------------------------------------------
-- 1. Profiles Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
    FOR SELECT
    USING (public.can_view_profile(id, clerk_id));

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
    FOR INSERT
    WITH CHECK (clerk_id = public.get_clerk_id());

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
    FOR UPDATE
    USING (clerk_id = public.get_clerk_id())
    WITH CHECK (clerk_id = public.get_clerk_id());

-- ----------------------------------------------------------------------------
-- 2. Gyms Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "gyms_select_policy" ON public.gyms;
CREATE POLICY "gyms_select_policy" ON public.gyms
    FOR SELECT
    USING (public.is_gym_member_or_owner(id));

DROP POLICY IF EXISTS "gyms_insert_policy" ON public.gyms;
CREATE POLICY "gyms_insert_policy" ON public.gyms
    FOR INSERT
    WITH CHECK (
        public.get_clerk_id() IS NOT NULL
        AND owner_clerk_id = public.get_clerk_id()
    );

DROP POLICY IF EXISTS "gyms_update_policy" ON public.gyms;
CREATE POLICY "gyms_update_policy" ON public.gyms
    FOR UPDATE
    USING (owner_clerk_id = public.get_clerk_id())
    WITH CHECK (owner_clerk_id = public.get_clerk_id());

-- ----------------------------------------------------------------------------
-- 3. Gym Members Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "gym_members_select_policy" ON public.gym_members;
CREATE POLICY "gym_members_select_policy" ON public.gym_members
    FOR SELECT
    USING (
        profile_id = public.get_current_profile_id()
        OR public.is_gym_staff_or_owner(gym_id)
    );

DROP POLICY IF EXISTS "gym_members_insert_policy" ON public.gym_members;
CREATE POLICY "gym_members_insert_policy" ON public.gym_members
    FOR INSERT
    WITH CHECK (
        profile_id = public.get_current_profile_id()
    );

DROP POLICY IF EXISTS "gym_members_update_policy" ON public.gym_members;
CREATE POLICY "gym_members_update_policy" ON public.gym_members
    FOR UPDATE
    USING (public.is_gym_owner(gym_id))
    WITH CHECK (public.is_gym_owner(gym_id));

-- ----------------------------------------------------------------------------
-- 4. Membership Plans Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "membership_plans_select_policy" ON public.membership_plans;
CREATE POLICY "membership_plans_select_policy" ON public.membership_plans
    FOR SELECT
    USING (public.is_gym_member_or_owner(gym_id));

DROP POLICY IF EXISTS "membership_plans_insert_policy" ON public.membership_plans;
CREATE POLICY "membership_plans_insert_policy" ON public.membership_plans
    FOR INSERT
    WITH CHECK (public.is_gym_owner(gym_id));

DROP POLICY IF EXISTS "membership_plans_update_policy" ON public.membership_plans;
CREATE POLICY "membership_plans_update_policy" ON public.membership_plans
    FOR UPDATE
    USING (public.is_gym_owner(gym_id))
    WITH CHECK (public.is_gym_owner(gym_id));

DROP POLICY IF EXISTS "membership_plans_delete_policy" ON public.membership_plans;
CREATE POLICY "membership_plans_delete_policy" ON public.membership_plans
    FOR DELETE
    USING (public.is_gym_owner(gym_id));

-- ----------------------------------------------------------------------------
-- 5. Subscriptions Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "subscriptions_select_policy" ON public.subscriptions;
CREATE POLICY "subscriptions_select_policy" ON public.subscriptions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = subscriptions.gym_member_id
              AND (
                  gm.profile_id = public.get_current_profile_id()
                  OR public.is_gym_owner(gm.gym_id)
              )
        )
    );

DROP POLICY IF EXISTS "subscriptions_insert_policy" ON public.subscriptions;
CREATE POLICY "subscriptions_insert_policy" ON public.subscriptions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = subscriptions.gym_member_id
              AND public.is_gym_owner(gm.gym_id)
        )
    );

DROP POLICY IF EXISTS "subscriptions_update_policy" ON public.subscriptions;
CREATE POLICY "subscriptions_update_policy" ON public.subscriptions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = subscriptions.gym_member_id
              AND public.is_gym_owner(gm.gym_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = subscriptions.gym_member_id
              AND public.is_gym_owner(gm.gym_id)
        )
    );

-- ----------------------------------------------------------------------------
-- 6. Check-ins Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "check_ins_select_policy" ON public.check_ins;
CREATE POLICY "check_ins_select_policy" ON public.check_ins
    FOR SELECT
    USING (
        public.is_gym_staff_or_owner(gym_id)
        OR EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = check_ins.gym_member_id
              AND gm.profile_id = public.get_current_profile_id()
        )
    );

DROP POLICY IF EXISTS "check_ins_insert_policy" ON public.check_ins;
CREATE POLICY "check_ins_insert_policy" ON public.check_ins
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = check_ins.gym_member_id
              AND gm.profile_id = public.get_current_profile_id()
              AND gm.gym_id = check_ins.gym_id
              AND gm.status = 'active'
        )
    );

-- ----------------------------------------------------------------------------
-- 7. Announcements Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "announcements_select_policy" ON public.announcements;
CREATE POLICY "announcements_select_policy" ON public.announcements
    FOR SELECT
    USING (public.is_gym_member_or_owner(gym_id));

DROP POLICY IF EXISTS "announcements_insert_policy" ON public.announcements;
CREATE POLICY "announcements_insert_policy" ON public.announcements
    FOR INSERT
    WITH CHECK (
        public.is_gym_staff_or_owner(gym_id)
        AND author_id = public.get_current_profile_id()
    );

DROP POLICY IF EXISTS "announcements_update_policy" ON public.announcements;
CREATE POLICY "announcements_update_policy" ON public.announcements
    FOR UPDATE
    USING (public.is_gym_owner(gym_id))
    WITH CHECK (public.is_gym_owner(gym_id));

DROP POLICY IF EXISTS "announcements_delete_policy" ON public.announcements;
CREATE POLICY "announcements_delete_policy" ON public.announcements
    FOR DELETE
    USING (public.is_gym_owner(gym_id));

-- ----------------------------------------------------------------------------
-- 8. Complaints Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "complaints_select_policy" ON public.complaints;
CREATE POLICY "complaints_select_policy" ON public.complaints
    FOR SELECT
    USING (
        public.is_gym_owner(gym_id)
        OR EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = complaints.member_id
              AND gm.profile_id = public.get_current_profile_id()
        )
    );

DROP POLICY IF EXISTS "complaints_insert_policy" ON public.complaints;
CREATE POLICY "complaints_insert_policy" ON public.complaints
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.gym_members gm
            WHERE gm.id = complaints.member_id
              AND gm.profile_id = public.get_current_profile_id()
              AND gm.gym_id = complaints.gym_id
              AND gm.status = 'active'
        )
    );

DROP POLICY IF EXISTS "complaints_update_policy" ON public.complaints;
CREATE POLICY "complaints_update_policy" ON public.complaints
    FOR UPDATE
    USING (public.is_gym_owner(gym_id))
    WITH CHECK (public.is_gym_owner(gym_id));

-- ----------------------------------------------------------------------------
-- 9. Staff Chat Messages Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_chat_messages_select_policy" ON public.staff_chat_messages;
CREATE POLICY "staff_chat_messages_select_policy" ON public.staff_chat_messages
    FOR SELECT
    USING (public.is_gym_staff_or_owner(gym_id));

DROP POLICY IF EXISTS "staff_chat_messages_insert_policy" ON public.staff_chat_messages;
CREATE POLICY "staff_chat_messages_insert_policy" ON public.staff_chat_messages
    FOR INSERT
    WITH CHECK (
        public.is_gym_staff_or_owner(gym_id)
        AND sender_id = public.get_current_profile_id()
    );

-- ============================================================================
-- SECTION 5: SUPABASE STORAGE SETUP INSTRUCTIONS
-- ============================================================================
/*
===============================================================================
SUPABASE STORAGE BUCKETS SETUP INSTRUCTIONS:

To complete the setup, manually create the following storage buckets in your
Supabase Dashboard (Storage -> Buckets -> New bucket) or run the SQL below:

1. 'profile-photos'
   - Purpose: User avatar and profile picture uploads
   - Public: Yes (Public bucket)
   - Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
   - File size limit: 5MB

2. 'gym-logos'
   - Purpose: Gym logos and branding images
   - Public: Yes (Public bucket)
   - Allowed MIME types: image/jpeg, image/png, image/webp, image/svg+xml
   - File size limit: 5MB

-------------------------------------------------------------------------------
Optional SQL to create and configure buckets via Supabase Storage schema:
-------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('profile-photos', 'profile-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('gym-logos', 'gym-logos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS Policies for profile-photos:
CREATE POLICY "Public Read Access on profile-photos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'profile-photos');

CREATE POLICY "Authenticated Users Upload profile-photos"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'profile-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Users Update Own profile-photos"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage RLS Policies for gym-logos:
CREATE POLICY "Public Read Access on gym-logos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'gym-logos');

CREATE POLICY "Authenticated Users Upload gym-logos"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'gym-logos' AND auth.role() = 'authenticated');
===============================================================================
*/
