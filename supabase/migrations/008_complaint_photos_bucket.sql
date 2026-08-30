-- ============================================================================
-- Migration: 008_complaint_photos_bucket.sql  [ALREADY APPLIED via Supabase MCP]
-- Description: Phase 4 — storage bucket for complaint attachments.
-- ============================================================================
--
-- app/(member)/complaints/create.tsx wrote the raw ImagePicker file:// URI
-- into complaints.photo_url — the same never-uploaded bug profile photos had.
-- An owner opening the complaint saw an unreachable local path from another
-- device.
--
-- Public-read, matching profile-photos, because the owner screen renders it
-- with a plain <Image source={{uri}}>. Paths are '<clerk_id>/<timestamp>.jpg'
-- so they aren't enumerable without the database, but a leaked URL is
-- viewable. If complaint attachments must be strictly private, make this
-- bucket private and fetch signed URLs at the single render site
-- (app/(owner)/complaints/[id].tsx).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('complaint-photos', 'complaint-photos', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "complaint_photos_select" ON storage.objects;
CREATE POLICY "complaint_photos_select" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'complaint-photos');

DROP POLICY IF EXISTS "complaint_photos_insert" ON storage.objects;
CREATE POLICY "complaint_photos_insert" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'complaint-photos'
        AND public.get_clerk_id() IS NOT NULL
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );

DROP POLICY IF EXISTS "complaint_photos_delete" ON storage.objects;
CREATE POLICY "complaint_photos_delete" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'complaint-photos'
        AND (storage.foldername(name))[1] = public.get_clerk_id()
    );
