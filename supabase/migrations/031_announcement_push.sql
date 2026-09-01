-- ============================================================================
-- Migration: 031_announcement_push.sql
-- Date: 2026-09-01
-- Description: Actually send a push when an announcement is posted.
-- ============================================================================
--
-- announcement_recipients() has existed since migration 014, resolving exactly
-- who a targeted announcement is for -- everyone / active / staff / a time slot
-- -- and excluding the author. Nothing ever called it. The only trigger on
-- announcements was trg_announcements_updated_at, so posting "gym closed this
-- morning" notified nobody: members found out when they next happened to open
-- the app, which for a closure notice is too late to be useful.
--
-- This is the same "built but never wired up" pattern that has come up
-- repeatedly in this project. The audience logic needed no changes at all.
--
-- Two deliberate choices:
--
-- 1. AFTER INSERT only, not UPDATE. Editing a typo in an announcement should
--    not re-notify everyone who already read it.
--
-- 2. The push is wrapped in its own exception block. send_push_to_profiles
--    reaches out through pg_net, and posting an announcement is the owner's
--    primary action -- it must not fail or roll back because a push could not
--    be delivered. (Worth noting notify_complaint_status_change from migration
--    017 does NOT have this guard, so a pg_net failure there would fail the
--    complaint status update. Left alone here rather than changed blind.)
--
-- The payload type is 'announcement', which lib/notification-routing.ts maps to
-- each role's own announcements screen.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_new_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids UUID[];
BEGIN
    SELECT array_agg(r.profile_id) INTO v_ids
    FROM public.announcement_recipients(NEW.id) r;

    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
        RETURN NEW;
    END IF;

    BEGIN
        PERFORM public.send_push_to_profiles(
            v_ids,
            coalesce(nullif(trim(NEW.title), ''), 'New announcement'),
            -- Push bodies get truncated by the OS anyway; keep the payload small.
            left(coalesce(NEW.body, ''), 200),
            jsonb_build_object('type', 'announcement', 'announcement_id', NEW.id)
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'announcement push failed for %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_announcement_notify ON public.announcements;
CREATE TRIGGER trg_announcement_notify
AFTER INSERT ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_announcement();
