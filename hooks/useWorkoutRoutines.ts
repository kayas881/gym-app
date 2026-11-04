import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAppAuth } from '../lib/auth';
import { useToday } from './useToday';
import { mergeLibrary, type LibraryExercise } from '../lib/exercise-library';
import { weekdayFromIsoDate, type PlanSnapshot } from '../lib/workout-plan';
import {
  type WeekSlot,
  type WorkoutRoutine,
  fetchCustomExercises,
  fetchRoutines,
  fetchTodayPlan,
  fetchWeekSlots,
} from '../lib/workout-routines';

export function useWorkoutRoutines() {
  const { supabase, profile } = useAppAuth();
  const todayKey = useToday();
  const [routines, setRoutines] = useState<WorkoutRoutine[]>([]);
  const [slots, setSlots] = useState<WeekSlot[]>([]);
  const [custom, setCustom] = useState<LibraryExercise[]>([]);
  const [todayPlan, setTodayPlan] = useState<{
    sessionId: string;
    snapshot: PlanSnapshot | null;
    finishedAt: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [nextRoutines, nextSlots, nextCustom, plan] = await Promise.all([
        fetchRoutines(supabase),
        fetchWeekSlots(supabase),
        fetchCustomExercises(supabase),
        fetchTodayPlan(supabase, todayKey),
      ]);
      setRoutines(nextRoutines);
      setSlots(nextSlots);
      setCustom(nextCustom);
      setTodayPlan(plan);
    } catch {
      setError('Could not load routines. They need the latest database update.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase, todayKey]);

  const patchRoutines = useCallback((updater: (current: WorkoutRoutine[]) => WorkoutRoutine[]) => {
    setRoutines((current) => updater(current));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const library = useMemo(() => mergeLibrary(custom), [custom]);
  const weekday = weekdayFromIsoDate(todayKey);
  const todaySlot = slots.find((slot) => slot.weekday === weekday) ?? null;
  const todayAssignment = useMemo(() => {
    if (!todaySlot?.routineId) {
      return { kind: todaySlot ? 'rest' : 'unscheduled' as const, routine: null, day: null };
    }
    const routine = routines.find((item) => item.id === todaySlot.routineId) ?? null;
    const day =
      (todaySlot.dayId
        ? routine?.days.find((item) => item.id === todaySlot.dayId)
        : routine?.days[0]) ?? null;
    return { kind: 'planned' as const, routine, day };
  }, [routines, todaySlot]);

  return {
    routines,
    slots,
    library,
    custom,
    todayPlan,
    todayAssignment,
    weekday,
    todayKey,
    loading,
    error,
    refresh,
    patchRoutines,
    profileId: profile?.id ?? null,
    supabase,
  };
}
