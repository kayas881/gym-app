/**
 * Pure workout-plan helpers. No network. Planned work is a snapshot so
 * deleting a routine cannot rewrite history.
 */
export const WEEKDAYS = [
  { iso: 1, label: 'Monday', short: 'Mon' },
  { iso: 2, label: 'Tuesday', short: 'Tue' },
  { iso: 3, label: 'Wednesday', short: 'Wed' },
  { iso: 4, label: 'Thursday', short: 'Thu' },
  { iso: 5, label: 'Friday', short: 'Fri' },
  { iso: 6, label: 'Saturday', short: 'Sat' },
  { iso: 7, label: 'Sunday', short: 'Sun' },
] as const;

export type PlannedExercise = {
  key: string;
  name: string;
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  weightKg: number | null;
  rir: number | null;
  restSeconds: number;
  notes: string;
};

export type CoachingDecisionStatus = 'accepted' | 'edited' | 'ignored';

export type CoachingDecision = {
  key: string;
  status: CoachingDecisionStatus;
  weightKg: number | null;
  reps: number | null;
};

export type PlanSnapshot = {
  routineId: string;
  routineName: string;
  dayId: string;
  dayLabel: string;
  exercises: PlannedExercise[];
  skippedKeys: string[];
  startedAt: string;
  // Session-only. Accept/edit/ignore never write the routine tables.
  coaching: CoachingDecision[];
};

export type LoggedSetLike = {
  exercise: string;
  weightKg: number | null;
  reps: number | null;
};

export type PlanVsActual = {
  plannedExercises: number;
  completedExercises: number;
  skippedExercises: number;
  plannedSets: number;
  completedSets: number;
  lines: Array<{
    key: string;
    name: string;
    plannedSets: number;
    completedSets: number;
    skipped: boolean;
  }>;
};

export function priorSessionPerformance<T extends { sessionId: string }>(
  latest: T | null,
  previous: T | null,
  todaySessionId: string | null,
): T | null {
  if (!latest) return null;
  if (!todaySessionId || latest.sessionId !== todaySessionId) return latest;
  return previous;
}

export function formatExerciseTarget(exercise: PlannedExercise): string {
  const reps =
    exercise.repsMin === null
      ? ''
      : ` × ${exercise.repsMin}${exercise.repsMax ? `–${exercise.repsMax}` : ''}`;
  const weight = exercise.weightKg === null ? '' : ` @ ${exercise.weightKg} kg`;
  return `${exercise.targetSets} sets${reps}${weight} · ${exercise.restSeconds}s rest`;
}

export function weekdayFromIsoDate(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const sundayZero = date.getDay();
  return sundayZero === 0 ? 7 : sundayZero;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function buildPlanSnapshot(input: {
  routineId: string;
  routineName: string;
  dayId: string;
  dayLabel: string;
  exercises: PlannedExercise[];
  startedAt?: string;
}): PlanSnapshot {
  return {
    routineId: input.routineId,
    routineName: input.routineName,
    dayId: input.dayId,
    dayLabel: input.dayLabel,
    exercises: input.exercises.map((item) => ({ ...item })),
    skippedKeys: [],
    startedAt: input.startedAt ?? new Date().toISOString(),
    coaching: [],
  };
}

export function skipPlannedExercise(plan: PlanSnapshot, key: string): PlanSnapshot {
  if (plan.skippedKeys.includes(key)) return plan;
  return { ...plan, skippedKeys: [...plan.skippedKeys, key] };
}

export function unskipPlannedExercise(plan: PlanSnapshot, key: string): PlanSnapshot {
  return { ...plan, skippedKeys: plan.skippedKeys.filter((item) => item !== key) };
}

export function addPlannedExercise(plan: PlanSnapshot, exercise: PlannedExercise): PlanSnapshot {
  if (plan.exercises.some((item) => item.key === exercise.key)) return plan;
  return { ...plan, exercises: [...plan.exercises, exercise] };
}

export function comparePlanToSets(plan: PlanSnapshot, sets: LoggedSetLike[]): PlanVsActual {
  const completedByKey = new Map<string, number>();
  for (const set of sets) {
    const key = set.exercise.trim().replace(/\s+/g, ' ').toLowerCase();
    completedByKey.set(key, (completedByKey.get(key) ?? 0) + 1);
  }

  const lines = plan.exercises.map((item) => {
    const skipped = plan.skippedKeys.includes(item.key);
    return {
      key: item.key,
      name: item.name,
      plannedSets: item.targetSets,
      completedSets: completedByKey.get(item.key) ?? 0,
      skipped,
    };
  });

  const plannedExercises = plan.exercises.length;
  const skippedExercises = lines.filter((line) => line.skipped).length;
  const completedExercises = lines.filter((line) => !line.skipped && line.completedSets > 0).length;
  const plannedSets = plan.exercises.reduce((sum, item) => sum + item.targetSets, 0);
  const completedSets = sets.length;

  return {
    plannedExercises,
    completedExercises,
    skippedExercises,
    plannedSets,
    completedSets,
    lines,
  };
}

export function parsePlanSnapshot(raw: unknown): PlanSnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.routineId !== 'string' || typeof record.dayId !== 'string') return null;
  if (!Array.isArray(record.exercises)) return null;
  const exercises: PlannedExercise[] = [];
  for (const row of record.exercises) {
    if (row === null || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    if (typeof item.key !== 'string' || typeof item.name !== 'string') continue;
    exercises.push({
      key: item.key,
      name: item.name,
      targetSets: typeof item.targetSets === 'number' ? item.targetSets : 3,
      repsMin: typeof item.repsMin === 'number' ? item.repsMin : null,
      repsMax: typeof item.repsMax === 'number' ? item.repsMax : null,
      weightKg: typeof item.weightKg === 'number' ? item.weightKg : null,
      rir: typeof item.rir === 'number' ? item.rir : null,
      restSeconds: typeof item.restSeconds === 'number' ? item.restSeconds : 120,
      notes: typeof item.notes === 'string' ? item.notes : '',
    });
  }
  return {
    routineId: record.routineId,
    routineName: typeof record.routineName === 'string' ? record.routineName : 'Routine',
    dayId: record.dayId,
    dayLabel: typeof record.dayLabel === 'string' ? record.dayLabel : 'Day',
    exercises,
    skippedKeys: Array.isArray(record.skippedKeys)
      ? record.skippedKeys.filter((item): item is string => typeof item === 'string')
      : [],
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : new Date().toISOString(),
    coaching: parseCoachingDecisions(record.coaching),
  };
}

function parseCoachingDecisions(raw: unknown): CoachingDecision[] {
  if (!Array.isArray(raw)) return [];
  const out: CoachingDecision[] = [];
  for (const row of raw) {
    if (row === null || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    if (typeof item.key !== 'string') continue;
    if (item.status !== 'accepted' && item.status !== 'edited' && item.status !== 'ignored') continue;
    out.push({
      key: item.key,
      status: item.status,
      weightKg: typeof item.weightKg === 'number' ? item.weightKg : null,
      reps: typeof item.reps === 'number' ? item.reps : null,
    });
  }
  return out;
}

export function coachingDecisionFor(plan: PlanSnapshot, key: string): CoachingDecision | null {
  return (plan.coaching ?? []).find((item) => item.key === key) ?? null;
}

export function applyCoachingDecision(plan: PlanSnapshot, decision: CoachingDecision): PlanSnapshot {
  const current = plan.coaching ?? [];
  return {
    ...plan,
    coaching: [...current.filter((item) => item.key !== decision.key), decision],
  };
}

export function sessionTargetFor(
  exercise: PlannedExercise,
  decision: CoachingDecision | null,
): Pick<PlannedExercise, 'weightKg' | 'repsMin' | 'repsMax'> {
  if (!decision || decision.status === 'ignored') {
    return {
      weightKg: exercise.weightKg,
      repsMin: exercise.repsMin,
      repsMax: exercise.repsMax,
    };
  }
  return {
    weightKg: decision.weightKg,
    repsMin: decision.reps ?? exercise.repsMin,
    repsMax: decision.reps ?? exercise.repsMax,
  };
}
