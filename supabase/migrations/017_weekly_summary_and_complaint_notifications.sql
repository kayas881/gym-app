-- ============================================================================
-- Migration: 017_weekly_summary_and_complaint_notifications.sql
--            [APPLIED via Supabase MCP]
-- Description: Phase 5 items 5-6 — weekly owner summary, complaint updates.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_weekly_owner_summary()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r       RECORD;
    v_total INT := 0;
    v_sent  INT;
BEGIN
    FOR r IN
        SELECT g.id AS gym_id,
               g.name AS gym_name,
               (SELECT count(*) FROM public.gym_members m
                 WHERE m.gym_id = g.id AND m.status = 'active')      AS active_members,
               (SELECT count(*) FROM public.gym_members m
                 WHERE m.gym_id = g.id AND m.status = 'pending')     AS pending,
               (SELECT count(*) FROM public.check_ins c
                 WHERE c.gym_id = g.id
                   AND c.checked_in_at >= now() - interval '7 days') AS check_ins,
               (SELECT coalesce(sum(s.amount_paid), 0)
                  FROM public.subscriptions s
                  JOIN public.gym_members m ON m.id = s.gym_member_id
                 WHERE m.gym_id = g.id
                   AND s.created_at >= now() - interval '7 days')    AS revenue
        FROM public.gyms g
    LOOP
        SELECT public.send_push_to_profiles(
            (SELECT array_agg(gm.profile_id)
               FROM public.gym_members gm
              WHERE gm.gym_id = r.gym_id AND gm.role = 'owner'),
            'Weekly summary: ' || r.gym_name,
            format('%s active members, %s check-ins, %s collected. %s pending approval.',
                   r.active_members, r.check_ins, '₹' || r.revenue, r.pending),
            jsonb_build_object('type', 'weekly_summary', 'gym_id', r.gym_id)
        ) INTO v_sent;

        v_total := v_total + coalesce(v_sent, 0);
    END LOOP;

    RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_weekly_owner_summary() FROM PUBLIC, anon, authenticated;

-- Complaint status updates.
-- A trigger rather than client code, so the notification fires from whichever
-- surface changes the status (owner detail screen or the dashboard modal).
CREATE OR REPLACE FUNCTION public.notify_complaint_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_message    TEXT;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT gm.profile_id INTO v_profile_id
    FROM public.gym_members gm
    WHERE gm.id = NEW.member_id;

    IF v_profile_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_message := CASE NEW.status
        WHEN 'acknowledged' THEN 'The gym has seen your complaint and is looking into it.'
        -- When resolved with a reply, the owner's reply IS the notification.
        WHEN 'resolved'     THEN coalesce(
                                   nullif(NEW.owner_response, ''),
                                   'Your complaint has been marked resolved.')
        ELSE NULL
    END;

    IF v_message IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM public.send_push_to_profiles(
        ARRAY[v_profile_id],
        CASE NEW.status
            WHEN 'acknowledged' THEN 'Complaint acknowledged'
            ELSE 'Complaint resolved'
        END,
        v_message,
        jsonb_build_object('type', 'complaint_update', 'complaint_id', NEW.id)
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complaint_status_notify ON public.complaints;
CREATE TRIGGER trg_complaint_status_notify
AFTER UPDATE OF status ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.notify_complaint_status_change();
