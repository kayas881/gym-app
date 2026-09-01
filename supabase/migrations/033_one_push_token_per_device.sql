-- ============================================================================
-- Migration: 033_one_push_token_per_device.sql
-- Date: 2026-09-01
-- Description: Stop one notification arriving twice on the same phone.
-- ============================================================================
--
-- THE BUG, as reported: one announcement posted by the owner produced TWO
-- identical notifications on the member's device. Tapping either one worked and
-- there was only ever one announcement row -- the announcement was fine, the
-- delivery was doubled.
--
-- Cause. registerPushToken() upserts with `onConflict: 'token'`, which is right
-- for its stated purpose (a phone handed to another user moves to the new
-- profile instead of leaving the old one subscribed). But an Expo push token is
-- not stable forever: it changes on reinstall, on cleared app data, and when the
-- underlying FCM token rotates. A new token therefore INSERTS a new row and the
-- superseded row for the same phone is left behind. send_push_to_profiles then
-- builds one message per token row:
--
--     WHERE pt.profile_id = ANY (p_profile_ids)
--
-- so every push went out once per stale token. Live data showed exactly this --
-- both the member and the owner had two android tokens each, one last seen
-- 2026-08-31 and one still refreshing on 2026-09-01.
--
-- Fix: keep one token per (profile_id, platform), enforced by a trigger rather
-- than in the client, so it holds no matter which client wrote the row and
-- applies on every re-registration (the app upserts on each launch).
--
-- TRADE-OFF, stated plainly: a single person signed in on two Android devices
-- will now receive pushes only on whichever they opened most recently, because
-- each launch prunes the other. That is deliberate -- duplicate notifications on
-- every device is the worse failure, and gym members have one phone. Supporting
-- two devices properly needs a stable per-install identifier stored alongside
-- the token, which is a bigger change than this.
--
-- The canonical long-term fix is different again: read Expo's push receipts and
-- delete any token that comes back DeviceNotRegistered. That is not possible
-- here yet because send_push_to_profiles fires net.http_post and never reads the
-- response.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.push_tokens_prune_superseded()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Any other token this profile holds for the same platform is a phone that
    -- has since re-registered under a new token.
    DELETE FROM public.push_tokens pt
    WHERE pt.profile_id = NEW.profile_id
      AND pt.platform IS NOT DISTINCT FROM NEW.platform
      AND pt.token <> NEW.token;

    -- AFTER trigger: return value is ignored. DELETE does not fire this trigger
    -- (it is INSERT OR UPDATE only), so there is no recursion.
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_tokens_prune ON public.push_tokens;

-- No column list on the UPDATE: a plain app launch re-upserts the same token and
-- only touches updated_at, and that still needs to clear a stale sibling.
CREATE TRIGGER trg_push_tokens_prune
AFTER INSERT OR UPDATE ON public.push_tokens
FOR EACH ROW
EXECUTE FUNCTION public.push_tokens_prune_superseded();

-- Clear the duplicates that already exist, keeping the most recently seen token
-- for each profile and platform.
DELETE FROM public.push_tokens pt
WHERE EXISTS (
    SELECT 1
    FROM public.push_tokens keep
    WHERE keep.profile_id = pt.profile_id
      AND keep.platform IS NOT DISTINCT FROM pt.platform
      AND (keep.updated_at, keep.token) > (pt.updated_at, pt.token)
);
