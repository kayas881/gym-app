-- ============================================================================
-- Migration: 028_authors_can_delete_own_announcements.sql
-- Date: 2026-09-01
-- Description: Let the author of an announcement delete it, not just the owner.
-- ============================================================================
--
-- THE BUG. app/(staff)/announcements/index.tsx renders a trash button when
-- `item.author_id === profile.id`, and announcements_insert_policy is
-- is_gym_staff_or_owner -- so staff can post. But announcements_delete_policy
-- was is_gym_owner(gym_id) only.
--
-- A blocked DELETE under RLS is not an error: PostgREST reports success having
-- matched zero rows. So a staff member tapped the trash icon, confirmed the
-- "Delete Announcement" dialog, got no error, and the post was still there
-- after the refetch. Verified as staff against the live row authored by staff
-- ("gym", 2026-08-30): 0 rows deleted, no error raised.
--
-- The existing code comment predicted this ("the RLS delete policy is
-- owner-only, so it would fail anyway - a dead affordance") but the button was
-- only guarded against two staff sharing a name, not against the role.
--
-- Granting the author the delete is the better half of the fix: whoever posted
-- an announcement should be able to retract it, which is what the UI already
-- offers. The owner keeps blanket delete over every post in their gym.
--
-- is_gym_staff_or_owner is re-checked on the author branch so that someone
-- demoted out of staff cannot still reach back and delete their old posts.
-- UPDATE stays owner-only: no staff screen offers editing.
-- ============================================================================

DROP POLICY IF EXISTS announcements_delete_policy ON public.announcements;

CREATE POLICY announcements_delete_policy ON public.announcements
    FOR DELETE
    USING (
        public.is_gym_owner(gym_id)
        OR (
            author_id = public.get_current_profile_id()
            AND public.is_gym_staff_or_owner(gym_id)
        )
    );
