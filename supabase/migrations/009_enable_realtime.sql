-- ============================================================================
-- Migration: 009_enable_realtime.sql  [ALREADY APPLIED via Supabase MCP]
-- Description: Phase 4 item 3/6 — realtime was never actually switched on.
-- ============================================================================
--
-- useAnnouncements and useStaffChat both subscribe to postgres_changes, but the
-- supabase_realtime publication contained NO tables, so Postgres never emitted
-- the events. The subscriptions connected successfully and then sat silent.
--
-- Symptoms: a sent chat message vanished for the sender (sendMessage relied on
-- the realtime echo to refresh the list), and the recipient got no live update
-- at all — both messages only appeared after a fresh fetch on re-login.
--
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the old row; otherwise
-- Postgres publishes only the primary key for those, which isn't enough for
-- read-receipt (read_by) updates to be usable by subscribers.
--
-- NOTE: publishing the table is only half of it. Realtime still applies RLS,
-- and the Realtime WebSocket does NOT go through the Clerk-token fetch wrapper
-- in lib/supabase.ts. lib/auth.tsx therefore calls supabase.realtime.setAuth()
-- on a timer — without it the socket is anon and every row is filtered out.
-- ============================================================================

ALTER TABLE public.staff_chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.announcements REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'staff_chat_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_chat_messages;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'announcements'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
    END IF;
END
$$;
