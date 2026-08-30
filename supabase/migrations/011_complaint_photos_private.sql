-- ============================================================================
-- Migration: 011_complaint_photos_private.sql [APPLIED via Supabase MCP]
-- Description: Make complaint attachments private (supersedes 008's trade-off).
-- ============================================================================
--
-- 008 created complaint-photos as public-read for consistency with profile
-- photos, and flagged the trade-off: a leaked URL was viewable by anyone.
-- Complaint photos are member-submitted evidence, so they now live in a
-- private bucket and are viewed through short-lived signed URLs
-- (lib/storage.ts createSignedImageUrl, used by app/(owner)/complaints/[id].tsx).
--
-- complaints.photo_url now stores the OBJECT PATH ('<clerk_id>/<ts>.jpg')
-- rather than a URL, because a private object has no stable public URL. The
-- storage read policy joins on that path, so it must be the path, not a URL.
-- ============================================================================

-- Convert rows written while the bucket was public.
UPDATE public.complaints
SET photo_url = split_part(photo_url, '/complaint-photos/', 2)
WHERE photo_url LIKE '%/complaint-photos/%';

UPDATE storage.buckets
SET public = false
WHERE id = 'complaint-photos';

DROP POLICY IF EXISTS "complaint_photos_select" ON storage.objects;
CREATE POLICY "complaint_photos_select" ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'complaint-photos'
        AND (
            -- The member who uploaded it (first path segment is their clerk id).
            (storage.foldername(name))[1] = public.get_clerk_id()
            -- Or the owner of the gym the complaint belongs to. Staff are
            -- excluded deliberately: complaints_select_policy is already
            -- owner-only, so staff can't read the complaint either.
            OR EXISTS (
                SELECT 1
                FROM public.complaints c
                WHERE c.photo_url = storage.objects.name
                  AND public.is_gym_owner(c.gym_id)
            )
        )
    );
