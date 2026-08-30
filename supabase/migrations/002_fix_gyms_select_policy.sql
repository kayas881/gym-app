-- ============================================================================
-- Migration: 002_fix_gyms_select_policy.sql
-- Description: Fix two RLS blockers on public.gyms that made Phase 1 unusable.
-- ============================================================================
--
-- PROBLEM 1 — Owner cannot create a gym (error 42501 on insert)
--   setup-gym.tsx runs `.insert({...}).select().single()`, which PostgREST
--   issues as `INSERT ... RETURNING *`. PostgreSQL applies the *SELECT* policy
--   to the RETURNING clause. The old policy was:
--
--       USING (public.is_gym_member_or_owner(id))
--
--   ...which resolves entirely through subqueries. At RETURNING time the new
--   gym row is not visible to that STABLE, SECURITY DEFINER function's
--   snapshot, and the owner's gym_members link does not exist yet (it is
--   inserted in the *next* statement). So the owner could not read back the
--   row they had just successfully inserted. The INSERT passed; the RETURNING
--   is what raised "new row violates row-level security policy".
--
--   Compare public.profiles, which works precisely because its policy leads
--   with a direct column comparison (target_clerk_id = get_clerk_id()) that
--   evaluates against the in-flight row without a table lookup.
--
-- PROBLEM 2 — Prospective member cannot look up a gym to join it
--   The join flow reads `.from('gyms').select('id, name').eq('id', <code>)`.
--   is_gym_member_or_owner() is false for a user who is not a member yet, so
--   the lookup always returned zero rows and joining was impossible.
--
-- FIX
--   Lead with a direct column check so an owner can always read their own gym
--   (including at RETURNING time), and allow any *authenticated* user to read
--   gym rows so the join-by-id lookup works.
--
--   Trade-off on the authenticated-read clause: it lets any signed-in user
--   read the gyms table (id, name, address, logo, hours) rather than only
--   their own gyms. Gym name/address is effectively public business
--   information, and a joiner must already know the gym's UUID to act on it.
--   RLS cannot distinguish "looked up by exact id" from "enumerated the
--   table", so the stricter alternative is to drop this clause and expose the
--   lookup through a SECURITY DEFINER RPC instead. Writes stay locked down:
--   the INSERT and UPDATE policies below are unchanged and still owner-only.
-- ============================================================================

DROP POLICY IF EXISTS "gyms_select_policy" ON public.gyms;
CREATE POLICY "gyms_select_policy" ON public.gyms
    FOR SELECT
    USING (
        -- Direct column check: works against the row being returned by an
        -- INSERT ... RETURNING, before any gym_members link exists.
        owner_clerk_id = public.get_clerk_id()
        -- Members and staff of this gym.
        OR public.is_gym_member_or_owner(id)
        -- Any signed-in user, so join-by-gym-id can find the gym.
        OR public.get_clerk_id() IS NOT NULL
    );
