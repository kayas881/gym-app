-- ============================================================================
-- Migration: 004_storage_buckets.sql
-- Description: Storage buckets + policies for profile photos and gym logos.
-- ============================================================================
--
-- PROBLEM
--   Nothing in the app ever uploaded a file. complete-profile.tsx and
--   (member)/profile.tsx wrote the ImagePicker result URI straight into
--   profiles.photo_url — a LOCAL device path such as
--     file:///data/user/0/com.kayas.mygymapp/cache/ImagePicker/abc.jpeg
--   That renders only while that cache file survives on that one device, so
--   photos vanished when Android cleared the cache, and an owner could never
--   see a member's photo at all (different device, meaningless path).
--
-- NOTE ON auth.uid()
--   The bucket policy sketch in 001's comment block used auth.uid(). That does
--   NOT work here: this project authenticates through Clerk third-party auth,
--   whose JWT `sub` is a Clerk id like 'user_3IbD07...', not a UUID, so
--   auth.uid() is null. These policies use public.get_clerk_id() instead —
--   the same helper the table policies rely on.
--
-- LAYOUT
--   Files are stored as '<clerk_id>/<filename>', so the first path segment
--   identifies the owner and write access can be checked against it.
--
-- VISIBILITY
--   Both buckets are public-read: gym staff and owners need to render member
--   avatars, and a public URL keeps that a plain <Image src>. Nothing secret
--   belongs in them. Writes stay restricted to the owning user.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('profile-photos', 'profile-photos', true, 5242880,
     ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('gym-logos', 'gym-logos', true, 5242880,
     ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- profile-photos policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profile_photos_select" ON storage.objects;
CREATE POLICY "profile_photos_select" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS "profile_photos_insert" ON storage.objects;
CREATE POLICY "profile_photos_insert" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'profile-photos'
        AND public.get_clerk_id() IS NOT NULL
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );

DROP POLICY IF EXISTS "profile_photos_update" ON storage.objects;
CREATE POLICY "profile_photos_update" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    )
    WITH CHECK (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );

DROP POLICY IF EXISTS "profile_photos_delete" ON storage.objects;
CREATE POLICY "profile_photos_delete" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'profile-photos'
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );

-- ----------------------------------------------------------------------------
-- gym-logos policies (bucket created now; upload UI is not built yet)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "gym_logos_select" ON storage.objects;
CREATE POLICY "gym_logos_select" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'gym-logos');

DROP POLICY IF EXISTS "gym_logos_insert" ON storage.objects;
CREATE POLICY "gym_logos_insert" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'gym-logos'
        AND public.get_clerk_id() IS NOT NULL
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );

DROP POLICY IF EXISTS "gym_logos_update" ON storage.objects;
CREATE POLICY "gym_logos_update" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'gym-logos'
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    )
    WITH CHECK (
        bucket_id = 'gym-logos'
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );
