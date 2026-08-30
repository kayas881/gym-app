import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';
import { today, localDateOf, localDayRange } from '../utils/date';

interface CheckIn {
  id: string;
  gym_member_id: string;
  gym_id: string;
  checked_in_at: string;
}

export function useCheckIns(gymMemberId?: string) {
  const supabase = useSupabase();
  const { gymId } = useAppAuth();
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [todayCheckIn, setTodayCheckIn] = useState<CheckIn | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCheckIns = useCallback(async () => {
    const targetMemberId = gymMemberId;
    if (!targetMemberId) {
      setCheckIns([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('check_ins')
        .select('*')
        .eq('gym_member_id', targetMemberId)
        .order('checked_in_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[useCheckIns]', error);
        return;
      }

      const checkInData = (data ?? []) as CheckIn[];
      setCheckIns(checkInData);

      // Check if there's a check-in today
      const todayStr = today();
      const todayEntry = checkInData.find(
        (c) => localDateOf(c.checked_in_at) === todayStr
      );
      setTodayCheckIn(todayEntry ?? null);
    } catch (err) {
      console.error('[useCheckIns]', err);
    } finally {
      setLoading(false);
    }
  }, [gymMemberId, supabase]);

  useEffect(() => {
    fetchCheckIns();
  }, [fetchCheckIns]);

  // Perform a check-in
  const checkIn = useCallback(
    async (memberId: string) => {
      if (!gymId) throw new Error('No gym selected');

      // Validate the member hasn't already checked in today
      const { start, end } = localDayRange();
      const { data: existing } = await supabase
        .from('check_ins')
        .select('id')
        .eq('gym_member_id', memberId)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error('Already checked in today');
      }

      const { data, error } = await supabase
        .from('check_ins')
        .insert({
          gym_member_id: memberId,
          gym_id: gymId,
        })
        .select()
        .single();

      if (error) throw error;

      await fetchCheckIns();
      return data as CheckIn;
    },
    [gymId, supabase, fetchCheckIns]
  );

  // Get today's attendance for the gym (owner/staff use)
  const fetchTodayAttendance = useCallback(async () => {
    if (!gymId) return [];

    const { start, end } = localDayRange();

    const { data, error } = await supabase
      .from('check_ins')
      .select(`
        id,
        checked_in_at,
        member:gym_members (
          id,
          role,
          profile:profiles (
            full_name,
            photo_url
          )
        )
      `)
      .eq('gym_id', gymId)
      .gte('checked_in_at', start)
      .lte('checked_in_at', end)
      .order('checked_in_at', { ascending: false });

    if (error) {
      console.error('[useCheckIns] fetchTodayAttendance:', error);
      return [];
    }

    return data ?? [];
  }, [gymId, supabase]);

  // Get check-in dates for calendar view (YYYY-MM-DD strings)
  const getCheckInDates = useCallback((): string[] => {
    return checkIns.map((c) => localDateOf(c.checked_in_at));
  }, [checkIns]);

  return {
    checkIns,
    todayCheckIn,
    hasCheckedInToday: !!todayCheckIn,
    loading,
    refresh: fetchCheckIns,
    checkIn,
    fetchTodayAttendance,
    getCheckInDates,
  };
}
