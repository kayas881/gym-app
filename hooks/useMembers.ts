import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';

interface MemberWithProfile {
  id: string;
  gym_id: string;
  role: 'owner' | 'staff' | 'member';
  status: 'pending' | 'active' | 'expired' | 'rejected';
  preferred_time_slot: string | null;
  auto_time_slot: string | null;
  joined_at: string;
  profile: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    photo_url: string | null;
    fitness_goal: string | null;
  };
}

interface UseMembersOptions {
  status?: 'pending' | 'active' | 'expired' | 'rejected' | 'all';
  search?: string;
}

export function useMembers(options: UseMembersOptions = {}) {
  const supabase = useSupabase();
  const { gymId } = useAppAuth();
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!gymId) return;

    setLoading(true);
    setError(null);

    try {
      // Flip any lapsed memberships to 'expired' before reading, so the status
      // filters and badges reflect reality. Best-effort: if it fails we still
      // show the list rather than blocking on it.
      const { error: expireError } = await supabase.rpc('expire_stale_memberships', {
        target_gym_id: gymId,
      });
      if (expireError) {
        console.warn('[useMembers] expire_stale_memberships failed:', expireError.message);
      }

      let query = supabase
        .from('gym_members')
        .select(`
          id,
          gym_id,
          role,
          status,
          preferred_time_slot,
          auto_time_slot,
          joined_at,
          profile:profiles (
            id,
            full_name,
            email,
            phone,
            photo_url,
            fitness_goal
          )
        `)
        .eq('gym_id', gymId)
        .order('joined_at', { ascending: false });

      // Filter by status
      if (options.status && options.status !== 'all') {
        query = query.eq('status', options.status);
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        setError(queryError.message);
        return;
      }

      let filtered = (data as unknown as MemberWithProfile[]) ?? [];

      // Client-side search filter (name, email, phone)
      if (options.search) {
        const searchLower = options.search.toLowerCase();
        filtered = filtered.filter(
          (m) =>
            m.profile?.full_name?.toLowerCase().includes(searchLower) ||
            m.profile?.email?.toLowerCase().includes(searchLower) ||
            m.profile?.phone?.includes(searchLower)
        );
      }

      setMembers(filtered);
    } catch (err) {
      setError('Failed to fetch members');
      console.error('[useMembers]', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase, options.status, options.search]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Approve a pending member
  const approveMember = useCallback(
    async (memberId: string) => {
      const { error } = await supabase
        .from('gym_members')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', memberId);

      if (error) throw error;
      await fetchMembers();
    },
    [supabase, fetchMembers]
  );

  // Reject a pending member
  const rejectMember = useCallback(
    async (memberId: string) => {
      const { error } = await supabase
        .from('gym_members')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', memberId);

      if (error) throw error;
      await fetchMembers();
    },
    [supabase, fetchMembers]
  );

  // Update member role (e.g., promote to staff)
  const updateMemberRole = useCallback(
    async (memberId: string, role: 'staff' | 'member') => {
      const { error } = await supabase
        .from('gym_members')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', memberId);

      if (error) throw error;
      await fetchMembers();
    },
    [supabase, fetchMembers]
  );

  return {
    members,
    loading,
    error,
    refresh: fetchMembers,
    approveMember,
    rejectMember,
    updateMemberRole,
  };
}
