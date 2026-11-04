import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAppAuth } from '../lib/auth';
import { useToday } from './useToday';
import {
  type ExerciseProgress,
  type HistorySession,
  type OverallWorkoutStats,
  type SessionSummary,
  type WeeklyInsights,
  computeAllExerciseProgress,
  computeAllSessionSummaries,
  computeExerciseProgress,
  computeOverallStats,
  computeSessionSummary,
  computeWeeklyInsights,
  fetchMemberWorkoutHistory,
} from '../lib/workout-progress';

let cached: { profileId: string; sessions: HistorySession[] } | null = null;
let inFlight: Promise<HistorySession[]> | null = null;

export function useWorkoutProgress() {
  const { supabase, profile } = useAppAuth();
  const todayKey = useToday();
  const [sessions, setSessions] = useState<HistorySession[]>(() =>
    profile?.id && cached?.profileId === profile.id ? cached.sessions : [],
  );
  const [loading, setLoading] = useState(!(profile?.id && cached?.profileId === profile.id));
  const [error, setError] = useState<string | null>(null);
  const loadGen = useRef(0);

  const refresh = useCallback(async () => {
    if (!profile?.id) {
      setSessions([]);
      setLoading(false);
      setError(null);
      return;
    }

    const gen = loadGen.current + 1;
    loadGen.current = gen;
    if (!(cached?.profileId === profile.id && cached.sessions.length > 0)) {
      setLoading(true);
    }
    setError(null);
    try {
      if (!inFlight) {
        inFlight = fetchMemberWorkoutHistory(supabase).finally(() => {
          inFlight = null;
        });
      }
      const rows = await inFlight;
      if (gen !== loadGen.current) return;
      cached = { profileId: profile.id, sessions: rows };
      setSessions(rows);
    } catch {
      if (gen !== loadGen.current) return;
      setError('Could not load your progress.');
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
      }
    }
  }, [profile?.id, supabase]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const stats: OverallWorkoutStats = useMemo(
    () => computeOverallStats(sessions),
    [sessions],
  );
  const exercises: ExerciseProgress[] = useMemo(
    () => computeAllExerciseProgress(sessions),
    [sessions],
  );

  const getExercise = useCallback(
    (key: string) => computeExerciseProgress(sessions, key),
    [sessions],
  );

  const summaries: SessionSummary[] = useMemo(
    () => computeAllSessionSummaries(sessions),
    [sessions],
  );

  const getSummary = useCallback(
    (sessionId: string) => {
      const match = sessions.find((session) => session.id === sessionId);
      return match ? computeSessionSummary(match, sessions) : null;
    },
    [sessions],
  );

  const weekly: WeeklyInsights = useMemo(
    () => computeWeeklyInsights(sessions, todayKey),
    [sessions, todayKey],
  );

  return {
    sessions,
    stats,
    exercises,
    summaries,
    weekly,
    loading,
    error,
    refresh,
    getExercise,
    getSummary,
  };
}
