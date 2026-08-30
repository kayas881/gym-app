import { useAppAuth } from '../lib/auth';

/**
 * Hook that provides the authenticated Supabase client.
 * The client automatically includes the Clerk JWT for RLS authorization.
 */
export function useSupabase() {
  const { supabase } = useAppAuth();
  return supabase;
}
