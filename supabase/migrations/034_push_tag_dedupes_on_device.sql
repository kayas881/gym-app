-- ============================================================================
-- Migration: 034_push_tag_dedupes_on_device.sql
-- Date: 2026-09-01
-- Description: Give every push an Android `tag` so one logical event can never
--              occupy two notification slots, and make the announcement push
--              idempotent.
-- ============================================================================
--
-- CONTEXT. A single announcement was still arriving as two notifications on the
-- member's device AFTER migration 033 removed the duplicate push token. That
-- report was chased with hard evidence rather than guesswork:
--
--   * announcements: exactly one row inserted ("close", 07:19:12.578).
--   * net._http_response: exactly one HTTP request for it (id 14, 07:19:12.592),
--     whose body contained exactly ONE message (one "status" in the reply).
--   * only one push trigger exists on announcements (trg_announcement_notify).
--   * cron has just the 03:30 expiry and Monday 04:00 summary jobs.
--   * notified_at was for an Edge Function that was never written
--     (supabase/functions is empty) -- no second server path.
--   * Expo's getReceipts for that message: {"status": "ok"} -- accepted and
--     delivered once.
--
-- So the server sent one and Expo delivered one; the device rendered it twice.
-- That is out of reach from SQL, but it is exactly what Android's `tag` is for.
-- From the Expo push API docs: "An identifier for replacing notifications
-- already displayed on the device. If the device is already showing a
-- notification with the same tag, the new notification replaces it."
--
-- Note `collapseId` is NOT the right field here -- on Android it only coalesces
-- messages in transit; the docs point at `tag` for replacing something already
-- on screen.
--
-- The tag is derived from the data payload rather than passed by each caller, so
-- all six notification types get it without touching their call sites:
--
--   announcement       -> announcement:<id>       distinct posts still stack
--   complaint_update   -> complaint_update:<id>   one slot per complaint
--   renewal_request    -> renewal_request:<id>    one slot per request
--   membership_expiring-> membership_expiring     a new reminder REPLACES the
--                                                 old, instead of a week of
--                                                 identical reminders stacking
--   weekly_summary     -> weekly_summary          this week replaces last week
--
-- Tags are per-device, so a constant tag never collides between two members.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_push_to_profiles(
    p_profile_ids UUID[],
    p_title TEXT,
    p_body TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_messages JSONB;
    v_count    INT;
    v_tag      TEXT;
BEGIN
    IF p_profile_ids IS NULL OR array_length(p_profile_ids, 1) IS NULL THEN
        RETURN 0;
    END IF;

    -- Identity of the thing being announced, not of this delivery attempt.
    v_tag := nullif(
        concat_ws(':',
            p_data ->> 'type',
            coalesce(
                p_data ->> 'announcement_id',
                p_data ->> 'complaint_id',
                p_data ->> 'request_id'
            )
        ),
        ''
    );

    SELECT jsonb_agg(
               jsonb_strip_nulls(
                   jsonb_build_object(
                       'to', pt.token,
                       'sound', 'default',
                       'title', p_title,
                       'body', p_body,
                       'data', p_data,
                       'channelId', 'default',
                       -- Dropped by jsonb_strip_nulls when there is no type to
                       -- build a tag from.
                       'tag', v_tag
                   )
               )
           ),
           count(*)
      INTO v_messages, v_count
    FROM public.push_tokens pt
    WHERE pt.profile_id = ANY (p_profile_ids);

    IF v_count IS NULL OR v_count = 0 THEN
        RETURN 0;
    END IF;

    PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Accept', 'application/json'
                   ),
        body    := v_messages
    );

    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_push_to_profiles(UUID[], TEXT, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency for the announcement push.
-- ---------------------------------------------------------------------------
-- announcements.notified_at was added back in migration 013 for exactly this and
-- has never been written to. Stamping it means no second push can go out for the
-- same announcement, whichever path ever tries.
CREATE OR REPLACE FUNCTION public.notify_new_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids UUID[];
BEGIN
    IF NEW.notified_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT array_agg(r.profile_id) INTO v_ids
    FROM public.announcement_recipients(NEW.id) r;

    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
        RETURN NEW;
    END IF;

    BEGIN
        PERFORM public.send_push_to_profiles(
            v_ids,
            coalesce(nullif(trim(NEW.title), ''), 'New announcement'),
            left(coalesce(NEW.body, ''), 200),
            jsonb_build_object('type', 'announcement', 'announcement_id', NEW.id)
        );

        -- Only claim it was notified if the send was actually dispatched.
        UPDATE public.announcements
        SET notified_at = now()
        WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'announcement push failed for %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;
