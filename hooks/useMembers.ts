import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';
import { today, daysFromToday } from '../utils/date';

interface MemberWithProfile {
  id: string;
  gym_id: string;
  role: 'owner' | 'staff' | 'member';
  status: 'pending' | 'active' | 'expired' | 'rejected' | 'removed';
  preferred_time_slot: string | null;
  auto_time_slot: string | null;
  joined_at: string;
  /**
   * end_date of this member's active subscription, or null if they have none
   * (a member approved without payment legitimately has none).
   */
  active_end_date: string | null;
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
  /**
   * 'expiring' and 'unpaid' are NOT gym_members.status values — those members
   * are still 'active'. Both are derived:
   *   'expiring' — active subscription ends within `expiringWithinDays`
   *   'unpaid'   — active member with NO subscription at all. This happens via
   *                the supported "approve without payment" flow; without a way
   *                to see them they are indistinguishable from paying members
   *                in the Active tab and could train free indefinitely.
   */
  status?:
    | 'pending'
    | 'active'
    | 'expired'
    | 'rejected'
    | 'removed'
    | 'all'
    | 'expiring'
    | 'unpaid';
  search?: string;
  expiringWithinDays?: number;
  /**
   * Restrict by role. The owner and every staff member also have a gym_members
   * row, so screens about paying customers need role: 'member' to avoid
   * offering the owner a payment against themselves.
   */
  role?: 'member' | 'staff' | 'owner';
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

      if (options.role) {
        query = query.eq('role', options.role);
      }

      // Filter by status. 'expiring' narrows to active members and is then
      // refined below by the subscription end date.
      if (options.status && options.status !== 'all') {
        query = query.eq(
          'status',
          options.status === 'expiring' || options.status === 'unpaid'
            ? 'active'
            : options.status
        );
      } else {
        // 'all' and no-filter both mean "the current roster", not "every row
        // ever". A removed member is a former member, so without this they
        // reappear in the All tab, in the payment-recording picker and in
        // every count that reads this hook — which is the whole point of
        // removing them. They stay reachable via the explicit 'removed'
        // filter.
        query = query.neq('status', 'removed');
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        setError(queryError.message);
        return;
      }

      // Coverage comes from an RPC rather than an embedded
      // `subscriptions ( end_date, status )` select, because
      // subscriptions_select_policy only admits the row's own member or the gym
      // OWNER. Staff got an empty array with no error, so every member showed as
      // "No plan recorded" and paying members were listed under "No Plan" --
      // exactly backwards for the screen a front-desk staffer relies on.
      // gym_member_coverage (migration 027) is SECURITY DEFINER, admits staff as
      // well as the owner, and deliberately returns dates only: no amount_paid,
      // no receipt_number.
      //
      // coverage_end is max(end_date) over ACTIVE rows. A member who renews
      // early holds two active subscriptions, and access ends at the later one.
      const coverage = new Map<string, string | null>();
      const { data: coverageRows, error: coverageError } = await supabase.rpc(
        'gym_member_coverage',
        { target_gym_id: gymId }
      );
      if (coverageError) {
        // Surface it: silently treating everyone as unpaid is what the old bug
        // did, and it is worse than showing nothing.
        console.warn('[useMembers] gym_member_coverage failed:', coverageError.message);
        setError(coverageError.message);
        return;
      }
      for (const row of (coverageRows as { member_id: string; coverage_end: string | null }[]) ?? []) {
        coverage.set(row.member_id, row.coverage_end);
      }

      const withEndDate = ((data as any[]) ?? []).map((row) => ({
        ...row,
        active_end_date: coverage.get(row.id) ?? null,
      }));

      let filtered = withEndDate as unknown as MemberWithProfile[];

      if (options.status === 'unpaid') {
        // Restrict to members: this filter is about customers training for
        // free. Staff can legitimately hold a membership of their own (one does),
        // and the owner has no plan at all, so neither belongs here.
        filtered = filtered.filter(
          (m) => m.role === 'member' && !m.active_end_date
        );
      }

      if (options.status === 'expiring') {
        const from = today();
        const to = daysFromToday(options.expiringWithinDays ?? 7);
        filtered = filtered.filter(
          (m) =>
            !!m.active_end_date &&
            m.active_end_date >= from &&
            m.active_end_date <= to
        );
      }

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
  }, [
    gymId,
    supabase,
    options.status,
    options.search,
    options.role,
    options.expiringWithinDays,
  ]);

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
