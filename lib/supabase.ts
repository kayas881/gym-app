import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../constants/config';

/**
 * Creates a Supabase client that uses Clerk's native integration.
 *
 * As of April 2025, Clerk's JWT template approach is deprecated.
 * Instead, we use the native third-party auth integration:
 * - Configure Clerk as a third-party provider in Supabase Dashboard
 *   (Authentication > Sign In/Up > Third Party Auth > Clerk)
 * - Clerk JWTs automatically include the `role: "authenticated"` claim
 * - RLS policies use `auth.jwt()->> 'sub'` to get the Clerk user ID
 *
 * @param getToken - Function that returns the Clerk session token
 * @returns A Supabase client authenticated with the Clerk session
 */
export function createClerkSupabaseClient(
  getToken: () => Promise<string | null>
): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      // Clerk tokens expire in ~60s, so the Authorization header must be
      // fetched fresh on every request via a custom fetch, not computed
      // once when the client is created.
      fetch: async (input, init = {}) => {
        const token = await getToken();
        const headers = new Headers(init.headers);
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/**
 * A basic Supabase client without auth — used only for public/anon operations.
 * For any authenticated operation, always use createClerkSupabaseClient.
 */
export const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
