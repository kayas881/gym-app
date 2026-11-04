import type { SupabaseClient } from '@supabase/supabase-js';
import { exerciseLibraryKey, type LibraryExercise } from './exercise-library';
import {
  type PlanSnapshot,
  type PlannedExercise,
  parsePlanSnapshot,
} from './workout-plan';

export type RoutineExercise = PlannedExercise & { id: string };
export type RoutineDay = {
  id: string;
  label: string;
  sortOrder: number;
  exercises: RoutineExercise[];
};
export type WorkoutRoutine = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  days: RoutineDay[];
};
export type WeekSlot = {
  weekday: number;
  routineId: string | null;
  dayId: string | null;
};

function mapExercise(row: Record<string, unknown>): RoutineExercise {
  return {
    id: String(row.id),
    key: String(row.exercise_key),
    name: String(row.exercise_name),
    targetSets: Number(row.target_sets) || 3,
    repsMin: row.target_reps_min === null || row.target_reps_min === undefined ? null : Number(row.target_reps_min),
    repsMax: row.target_reps_max === null || row.target_reps_max === undefined ? null : Number(row.target_reps_max),
    weightKg: row.target_weight_kg === null || row.target_weight_kg === undefined ? null : Number(row.target_weight_kg),
    rir: row.target_rir === null || row.target_rir === undefined ? null : Number(row.target_rir),
    restSeconds: Number(row.rest_seconds) || 120,
    notes: typeof row.notes === 'string' ? row.notes : '',
  };
}

export async function fetchRoutines(supabase: SupabaseClient): Promise<WorkoutRoutine[]> {
  const { data, error } = await supabase
    .from('workout_routines')
    .select(`
      id, name, description, updated_at,
      workout_routine_days (
        id, label, sort_order,
        workout_routine_exercises (
          id, sort_order, exercise_key, exercise_name,
          target_sets, target_reps_min, target_reps_max,
          target_weight_kg, target_rir, rest_seconds, notes
        )
      )
    `)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const days = ((row.workout_routine_days ?? []) as Array<Record<string, unknown>>)
      .map((day) => {
        const exercises = ((day.workout_routine_exercises ?? []) as Array<Record<string, unknown>>)
          .slice()
          .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
          .map(mapExercise);
        return {
          id: String(day.id),
          label: String(day.label),
          sortOrder: Number(day.sort_order) || 0,
          exercises,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: String(row.id),
      name: String(row.name),
      description: typeof row.description === 'string' ? row.description : '',
      updatedAt: String(row.updated_at),
      days,
    };
  });
}

export async function fetchWeekSlots(supabase: SupabaseClient): Promise<WeekSlot[]> {
  const { data, error } = await supabase
    .from('workout_week_slots')
    .select('weekday, routine_id, day_id');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    weekday: Number(row.weekday),
    routineId: (row.routine_id as string | null) ?? null,
    dayId: (row.day_id as string | null) ?? null,
  }));
}

export async function fetchCustomExercises(
  supabase: SupabaseClient,
): Promise<LibraryExercise[]> {
  const { data, error } = await supabase
    .from('workout_custom_exercises')
    .select('exercise_key, name, primary_muscle, secondary_muscles, category, equipment, instructions');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    key: String(row.exercise_key),
    name: String(row.name),
    primary: String(row.primary_muscle || 'unclassified'),
    secondary: Array.isArray(row.secondary_muscles) ? row.secondary_muscles.map(String) : [],
    category: (row.category as LibraryExercise['category']) || 'compound',
    equipment: (row.equipment as LibraryExercise['equipment']) || 'other',
    instructions: typeof row.instructions === 'string' ? row.instructions : '',
    custom: true,
  }));
}

export async function createRoutine(
  supabase: SupabaseClient,
  profileId: string,
  name: string,
  description = '',
): Promise<{ id: string; dayId: string }> {
  const { data, error } = await supabase
    .from('workout_routines')
    .insert({ profile_id: profileId, name: name.trim(), description })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('create_failed');
  const { data: day, error: dayError } = await supabase
    .from('workout_routine_days')
    .insert({ routine_id: data.id, sort_order: 0, label: 'Day 1' })
    .select('id')
    .single();
  if (dayError || !day) throw dayError ?? new Error('day_failed');
  return { id: String(data.id), dayId: String(day.id) };
}

export async function updateRoutineMeta(
  supabase: SupabaseClient,
  routineId: string,
  patch: { name?: string; description?: string },
): Promise<void> {
  const { error } = await supabase.from('workout_routines').update(patch).eq('id', routineId);
  if (error) throw error;
}

export async function deleteRoutine(supabase: SupabaseClient, routineId: string): Promise<void> {
  const { error } = await supabase.from('workout_routines').delete().eq('id', routineId);
  if (error) throw error;
}

export async function addRoutineDay(
  supabase: SupabaseClient,
  routineId: string,
  label: string,
  sortOrder: number,
): Promise<string> {
  const { data, error } = await supabase
    .from('workout_routine_days')
    .insert({ routine_id: routineId, label: label.trim() || `Day ${sortOrder + 1}`, sort_order: sortOrder })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('day_failed');
  return String(data.id);
}

export async function renameRoutineDay(
  supabase: SupabaseClient,
  dayId: string,
  label: string,
): Promise<void> {
  const { error } = await supabase
    .from('workout_routine_days')
    .update({ label: label.trim() })
    .eq('id', dayId);
  if (error) throw error;
}

export async function deleteRoutineDay(supabase: SupabaseClient, dayId: string): Promise<void> {
  const { error } = await supabase.from('workout_routine_days').delete().eq('id', dayId);
  if (error) throw error;
}

export async function reorderRoutineDays(
  supabase: SupabaseClient,
  orderedIds: string[],
): Promise<void> {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await supabase
      .from('workout_routine_days')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
    if (error) throw error;
  }
}

export async function addRoutineExercise(
  supabase: SupabaseClient,
  dayId: string,
  exercise: PlannedExercise,
  sortOrder: number,
): Promise<string> {
  const { data, error } = await supabase.from('workout_routine_exercises').insert({
    day_id: dayId,
    sort_order: sortOrder,
    exercise_key: exercise.key,
    exercise_name: exercise.name,
    target_sets: exercise.targetSets,
    target_reps_min: exercise.repsMin,
    target_reps_max: exercise.repsMax,
    target_weight_kg: exercise.weightKg,
    target_rir: exercise.rir,
    rest_seconds: exercise.restSeconds,
    notes: exercise.notes,
  }).select('id').single();
  if (error || !data) throw error ?? new Error('exercise_failed');
  return String(data.id);
}

export async function updateRoutineExercise(
  supabase: SupabaseClient,
  exerciseId: string,
  exercise: PlannedExercise,
): Promise<void> {
  const { error } = await supabase
    .from('workout_routine_exercises')
    .update({
      exercise_key: exercise.key,
      exercise_name: exercise.name,
      target_sets: exercise.targetSets,
      target_reps_min: exercise.repsMin,
      target_reps_max: exercise.repsMax,
      target_weight_kg: exercise.weightKg,
      target_rir: exercise.rir,
      rest_seconds: exercise.restSeconds,
      notes: exercise.notes,
    })
    .eq('id', exerciseId);
  if (error) throw error;
}

export async function deleteRoutineExercise(
  supabase: SupabaseClient,
  exerciseId: string,
): Promise<void> {
  const { error } = await supabase.from('workout_routine_exercises').delete().eq('id', exerciseId);
  if (error) throw error;
}

export async function reorderRoutineExercises(
  supabase: SupabaseClient,
  orderedIds: string[],
): Promise<void> {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await supabase
      .from('workout_routine_exercises')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
    if (error) throw error;
  }
}

export async function duplicateRoutine(
  supabase: SupabaseClient,
  profileId: string,
  source: WorkoutRoutine,
): Promise<string> {
  const created = await createRoutine(supabase, profileId, `${source.name} copy`, source.description);
  if (source.days[0]) {
    await renameRoutineDay(supabase, created.dayId, source.days[0].label);
    for (const [index, exercise] of source.days[0].exercises.entries()) {
      await addRoutineExercise(supabase, created.dayId, exercise, index);
    }
  }
  for (const [index, day] of source.days.slice(1).entries()) {
    const dayId = await addRoutineDay(supabase, created.id, day.label, index + 1);
    for (const [exIndex, exercise] of day.exercises.entries()) {
      await addRoutineExercise(supabase, dayId, exercise, exIndex);
    }
  }
  return created.id;
}

export async function copyExercisesToDay(
  supabase: SupabaseClient,
  destDayId: string,
  exercises: PlannedExercise[],
  startOrder: number,
): Promise<void> {
  for (const [index, exercise] of exercises.entries()) {
    await addRoutineExercise(supabase, destDayId, exercise, startOrder + index);
  }
}

export async function upsertWeekSlot(
  supabase: SupabaseClient,
  profileId: string,
  weekday: number,
  routineId: string | null,
  dayId: string | null,
): Promise<void> {
  const { error } = await supabase.from('workout_week_slots').upsert({
    profile_id: profileId,
    weekday,
    routine_id: routineId,
    day_id: dayId,
  });
  if (error) throw error;
}

export async function clearWeekSlot(
  supabase: SupabaseClient,
  profileId: string,
  weekday: number,
): Promise<void> {
  const { error } = await supabase
    .from('workout_week_slots')
    .delete()
    .eq('profile_id', profileId)
    .eq('weekday', weekday);
  if (error) throw error;
}

export async function createCustomExercise(
  supabase: SupabaseClient,
  profileId: string,
  input: {
    name: string;
    primary: string;
    secondary: string[];
    category: LibraryExercise['category'];
    equipment: string;
    instructions: string;
  },
): Promise<void> {
  const key = exerciseLibraryKey(input.name);
  const { error } = await supabase.from('workout_custom_exercises').insert({
    profile_id: profileId,
    exercise_key: key,
    name: input.name.trim(),
    primary_muscle: input.primary,
    secondary_muscles: input.secondary,
    category: input.category,
    equipment: input.equipment,
    instructions: input.instructions,
  });
  if (error) throw error;
}

export async function attachPlanToToday(
  supabase: SupabaseClient,
  snapshot: PlanSnapshot,
): Promise<string> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('ensure_today_workout_session');
  if (rpcError) throw rpcError;
  const record = rpcData as { ok?: boolean; session_id?: string };
  if (!record?.ok || !record.session_id) {
    throw new Error('Could not open today\'s session.');
  }
  const { error } = await supabase
    .from('workout_sessions')
    .update({
      plan_routine_id: snapshot.routineId,
      plan_day_id: snapshot.dayId,
      plan_snapshot: snapshot,
      finished_at: null,
    })
    .eq('id', record.session_id);
  if (error) throw error;
  return record.session_id;
}

export async function savePlanSnapshot(
  supabase: SupabaseClient,
  sessionId: string,
  snapshot: PlanSnapshot,
): Promise<void> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ plan_snapshot: snapshot })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function finishPlannedSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ finished_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function fetchSessionPlan(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<PlanSnapshot | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('plan_snapshot')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return parsePlanSnapshot(data?.plan_snapshot);
}

export async function fetchTodayPlan(
  supabase: SupabaseClient,
  startedOn: string,
): Promise<{ sessionId: string; snapshot: PlanSnapshot | null; finishedAt: string | null } | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, plan_snapshot, finished_at')
    .eq('started_on', startedOn)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    sessionId: String(data.id),
    snapshot: parsePlanSnapshot(data.plan_snapshot),
    finishedAt: (data.finished_at as string | null) ?? null,
  };
}
