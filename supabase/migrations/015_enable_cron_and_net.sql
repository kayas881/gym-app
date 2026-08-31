-- ============================================================================
-- Migration: 015_enable_cron_and_net.sql [APPLIED via Supabase MCP]
-- Description: Extensions needed for scheduled notifications.
-- ============================================================================
--   pg_cron: the scheduler
--   pg_net:  async HTTP from inside Postgres, used to reach Expo's push API
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
