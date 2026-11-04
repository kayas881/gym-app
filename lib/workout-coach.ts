/**
 * Deterministic next-session coaching.
 *
 * Reads planned targets plus confirmed history. Suggestions never write
 * PRs, never invent missing RIR, and never change a routine on their own.
 * The PR engine in workout-progress.ts stays the source of truth for e1RM.
 *
 * Value-imports of sibling lib files stay out so Node tests can load this
 * file the same way rest-period tests do.
 */
import type { LibraryEquipment } from './exercise-library';
import type { PlannedExercise } from './workout-plan';
import type { HistorySession, HistorySet, Trend } from './workout-progress';

function exerciseKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatKg(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatE1rm(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function compareMetric(current: number | null, previous: number | null, epsilon: number): Trend {
  if (current === null || previous === null) return 'insufficient';
  const delta = current - previous;
  if (Math.abs(delta) < epsilon) return 'unchanged';
  return delta > 0 ? 'improved' : 'declined';
}

function pickPriorPerformance<T extends { sessionId: string }>(
  latest: T | null,
  previous: T | null,
  todaySessionId: string | null,
): T | null {
  if (!latest) return null;
  if (!todaySessionId || latest.sessionId !== todaySessionId) return latest;
  return previous;
}

export const DEFAULT_WEIGHT_INCREMENTS_KG: Record<LibraryEquipment, number> = {
  barbell: 2.5,
  dumbbell: 2,
  cable: 2.5,
  machine: 5,
  bodyweight: 0,
  other: 2.5,
};

const WEIGHT_EPS = 0.05;

export type CoachAction = 'increase_weight' | 'increase_reps' | 'hold' | 'insufficient';

export type CoachInsight =
  | 'consistent_improvement'
  | 'weight_increased'
  | 'rep_progression'
  | 'performance_plateau'
  | 'performance_declined'
  | 'insufficient_history';

export type CompletedWorkSet = {
  weightKg: number;
  reps: number;
  rir: number | null;
};

export type LastPerformance = {
  sessionId: string;
  startedOn: string;
  setCount: number;
  workingWeightKg: number | null;
  reps: number | null;
  repsBySet: number[];
  rir: number | null;
  recordedRirCount: number;
  sets: CompletedWorkSet[];
  completeSetCount: number;
};

export type SessionCoach = {
  action: CoachAction;
  insight: CoachInsight;
  reason: string;
  last: LastPerformance | null;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  bestE1rm: number | null;
  trend: Trend;
  reliable: boolean;
  incrementKg: number;
};

export type CoachInput = {
  plan: PlannedExercise;
  history: HistorySession[];
  todaySessionId?: string | null;
  bestE1rm?: number | null;
  equipment?: LibraryEquipment | null;
  increments?: Partial<Record<LibraryEquipment, number>>;
};

export function weightIncrementKg(
  equipment: LibraryEquipment,
  overrides: Partial<Record<LibraryEquipment, number>> = {},
): number {
  const raw = overrides[equipment];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return DEFAULT_WEIGHT_INCREMENTS_KG[equipment];
}

function completeSets(sets: HistorySet[]): CompletedWorkSet[] {
  const out: CompletedWorkSet[] = [];
  for (const set of sets) {
    if (set.weightKg === null || set.reps === null) continue;
    if (!Number.isFinite(set.weightKg) || !Number.isFinite(set.reps) || set.reps < 1) continue;
    out.push({
      weightKg: set.weightKg,
      reps: set.reps,
      rir: typeof set.rir === 'number' && Number.isFinite(set.rir) ? set.rir : null,
    });
  }
  return out;
}

function workingWeightKg(sets: CompletedWorkSet[]): number | null {
  if (sets.length === 0) return null;
  return sets.reduce((best, set) => (set.weightKg > best ? set.weightKg : best), sets[0].weightKg);
}

function sameWeight(a: number, b: number): boolean {
  return Math.abs(a - b) < WEIGHT_EPS;
}

function setsAtWeight(sets: CompletedWorkSet[], weight: number): CompletedWorkSet[] {
  return sets.filter((set) => sameWeight(set.weightKg, weight));
}

function recordedRirValues(sets: CompletedWorkSet[]): number[] {
  return sets.flatMap((set) => (set.rir === null ? [] : [set.rir]));
}

function minRecordedRir(sets: CompletedWorkSet[]): number | null {
  const values = recordedRirValues(sets);
  if (values.length === 0) return null;
  return values.reduce((best, value) => (value < best ? value : best), values[0]);
}

function sessionsForExercise(
  history: HistorySession[],
  key: string,
  excludeSessionId: string | null,
): HistorySession[] {
  return history
    .filter((session) => session.id !== excludeSessionId)
    .filter((session) => session.sets.some((set) => exerciseKey(set.exercise) === key))
    .slice()
    .sort((a, b) => {
      if (a.startedOn !== b.startedOn) return a.startedOn < b.startedOn ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
}

function performanceOf(session: HistorySession, key: string): LastPerformance {
  const matching = session.sets.filter((set) => exerciseKey(set.exercise) === key);
  const sets = completeSets(matching);
  const working = workingWeightKg(sets);
  const atWorking = working === null ? [] : setsAtWeight(sets, working);
  const repsBySet = atWorking.map((set) => set.reps);
  return {
    sessionId: session.id,
    startedOn: session.startedOn,
    setCount: matching.length,
    workingWeightKg: working,
    reps: repsBySet.length > 0 ? Math.min(...repsBySet) : null,
    repsBySet,
    rir: minRecordedRir(atWorking.length > 0 ? atWorking : sets),
    recordedRirCount: recordedRirValues(atWorking.length > 0 ? atWorking : sets).length,
    sets,
    completeSetCount: sets.length,
  };
}

function addIncrement(weight: number, increment: number): number {
  if (increment <= 0) return weight;
  const next = weight + increment;
  const steps = Math.round(next / increment);
  return Math.round(steps * increment * 100) / 100;
}

function resolveIncrement(
  equipment: LibraryEquipment,
  lastWeight: number | null,
  overrides: Partial<Record<LibraryEquipment, number>>,
): number {
  const base = weightIncrementKg(equipment, overrides);
  // Weighted variants of bodyweight lifts (e.g. a 20 kg pull-up) can move
  // by the generic increment. Unweighted stays at 0 so we never invent load.
  if (equipment === 'bodyweight' && (lastWeight === null || lastWeight <= WEIGHT_EPS)) {
    return 0;
  }
  if (equipment === 'bodyweight') {
    return weightIncrementKg('other', overrides);
  }
  return base;
}

function classifyInsight(
  series: LastPerformance[],
): CoachInsight {
  if (series.length < 2) return 'insufficient_history';

  const last = series[series.length - 1];
  const previous = series[series.length - 2];
  const lastVsPrev = compareLoad(last, previous);

  const recent = series.slice(-3);
  if (recent.length >= 3) {
    const steps = [compareLoad(recent[1], recent[0]), compareLoad(recent[2], recent[1])];
    if (steps.every((step) => step === 'improved')) return 'consistent_improvement';
    if (steps.every((step) => step === 'unchanged') && lastVsPrev === 'unchanged') {
      return 'performance_plateau';
    }
  }

  if (lastVsPrev === 'declined') return 'performance_declined';
  if (lastVsPrev === 'unchanged' && series.length < 3) return 'insufficient_history';

  if (
    last.workingWeightKg !== null &&
    previous.workingWeightKg !== null &&
    last.workingWeightKg > previous.workingWeightKg + WEIGHT_EPS
  ) {
    return 'weight_increased';
  }
  if (
    last.workingWeightKg !== null &&
    previous.workingWeightKg !== null &&
    sameWeight(last.workingWeightKg, previous.workingWeightKg) &&
    last.reps !== null &&
    previous.reps !== null &&
    last.reps > previous.reps
  ) {
    return 'rep_progression';
  }
  if (lastVsPrev === 'improved') return 'rep_progression';
  return 'insufficient_history';
}

function compareLoad(current: LastPerformance, previous: LastPerformance): Trend {
  const weight = compareMetric(current.workingWeightKg, previous.workingWeightKg, WEIGHT_EPS);
  if (weight === 'improved' || weight === 'declined') return weight;
  return compareMetric(current.reps, previous.reps, 0.5);
}

function holdAt(
  last: LastPerformance | null,
  plan: PlannedExercise,
): { weight: number | null; reps: number | null } {
  return {
    weight: last?.workingWeightKg ?? plan.weightKg,
    reps: last?.reps ?? plan.repsMin ?? plan.repsMax,
  };
}

export function recommendNextSession(input: CoachInput): SessionCoach {
  const key = exerciseKey(input.plan.key || input.plan.name);
  const matching = sessionsForExercise(input.history, key, input.todaySessionId ?? null);
  const series = matching.map((session) => performanceOf(session, key));
  const latest = series.length > 0 ? series[series.length - 1] : null;
  const previous = series.length > 1 ? series[series.length - 2] : null;
  // priorSessionPerformance is the same helper the active screen uses so
  // today's in-progress sets cannot masquerade as "last time".
  const last =
    pickPriorPerformance(
      latest ? { sessionId: latest.sessionId, value: latest } : null,
      previous ? { sessionId: previous.sessionId, value: previous } : null,
      input.todaySessionId ?? null,
    )?.value ?? latest;

  const equipment = input.equipment ?? 'other';
  const incrementKg = resolveIncrement(equipment, last?.workingWeightKg ?? null, input.increments ?? {});
  const insight = classifyInsight(series);
  const trend: Trend = last && previous ? compareLoad(last, previous) : 'insufficient';
  const bestE1rm = typeof input.bestE1rm === 'number' && Number.isFinite(input.bestE1rm)
    ? input.bestE1rm
    : null;

  const repsMin = input.plan.repsMin;
  const repsMax = input.plan.repsMax ?? input.plan.repsMin;
  const targetSets = input.plan.targetSets;

  const base = {
    last,
    bestE1rm,
    trend,
    incrementKg,
    insight,
  };

  if (!last || last.completeSetCount === 0) {
    const held = holdAt(null, input.plan);
    return {
      ...base,
      action: 'insufficient',
      reason: 'Not enough confirmed history to change the target.',
      suggestedWeightKg: held.weight,
      suggestedReps: held.reps,
      reliable: false,
    };
  }

  const working = last.workingWeightKg;
  const atWorking = working === null ? [] : setsAtWeight(last.sets, working);
  const enoughSets = targetSets > 0 && atWorking.length >= targetSets;
  const held = holdAt(last, input.plan);

  if (!enoughSets || working === null) {
    return {
      ...base,
      action: 'hold',
      reason: 'Not enough confirmed sets to change the target.',
      suggestedWeightKg: held.weight,
      suggestedReps: held.reps,
      reliable: false,
    };
  }

  const workingSets = atWorking.slice(-targetSets);
  const minReps = Math.min(...workingSets.map((set) => set.reps));
  const allHitTop = repsMax !== null && workingSets.every((set) => set.reps >= repsMax);
  const allInRange =
    repsMin !== null &&
    workingSets.every((set) => set.reps >= repsMin) &&
    (repsMax === null || workingSets.some((set) => set.reps < repsMax));
  const anyShort = repsMin !== null && workingSets.some((set) => set.reps < repsMin);
  const rir = minRecordedRir(workingSets);
  const rirBlocksLoad = rir !== null && rir <= 1;

  if (anyShort) {
    return {
      ...base,
      action: 'hold',
      reason: 'Last session fell short of the target. Repeat the previous load.',
      suggestedWeightKg: working,
      suggestedReps: last.reps,
      reliable: true,
    };
  }

  if (repsMin === null && repsMax === null) {
    return {
      ...base,
      action: 'hold',
      reason: 'No rep range is set, so the previous load is repeated.',
      suggestedWeightKg: working,
      suggestedReps: last.reps,
      reliable: true,
    };
  }

  if (allHitTop && rirBlocksLoad) {
    return {
      ...base,
      action: 'hold',
      reason: 'RIR was 0–1, so the load stays the same.',
      suggestedWeightKg: working,
      suggestedReps: repsMax,
      reliable: true,
    };
  }

  if (allHitTop && incrementKg > 0) {
    return {
      ...base,
      action: 'increase_weight',
      reason: 'All prescribed sets reached the top of your target rep range.',
      suggestedWeightKg: addIncrement(working, incrementKg),
      suggestedReps: repsMin,
      reliable: true,
    };
  }

  if (allHitTop && incrementKg <= 0) {
    return {
      ...base,
      action: 'hold',
      reason: 'You are at the top of the rep range. Keep the same load next time.',
      suggestedWeightKg: working,
      suggestedReps: repsMax,
      reliable: true,
    };
  }

  if (allInRange || (repsMin !== null && minReps >= repsMin)) {
    const nextReps = repsMax === null ? minReps + 1 : Math.min(repsMax, minReps + 1);
    if (nextReps > minReps) {
      return {
        ...base,
        action: 'increase_reps',
        reason: 'Continue progressing within your target rep range.',
        suggestedWeightKg: working,
        suggestedReps: nextReps,
        reliable: true,
      };
    }
  }

  return {
    ...base,
    action: 'hold',
    reason: 'Repeat the previous target.',
    suggestedWeightKg: working,
    suggestedReps: last.reps,
    reliable: true,
  };
}

export function formatLastTime(last: LastPerformance | null): string {
  if (!last || last.workingWeightKg === null || last.repsBySet.length === 0) {
    return 'No previous confirmed sets';
  }
  const reps =
    last.repsBySet.length === 1 || last.repsBySet.every((value) => value === last.repsBySet[0])
      ? `${last.repsBySet[0]}`
      : last.repsBySet.join(', ');
  return `${formatKg(last.workingWeightKg)} kg × ${reps} reps`;
}

export function formatSuggested(weightKg: number | null, reps: number | null): string {
  if (weightKg === null && reps === null) return 'No change suggested';
  if (weightKg === null) return `${reps} reps`;
  if (reps === null) return `${formatKg(weightKg)} kg`;
  return `${formatKg(weightKg)} kg × ${reps} reps`;
}

export function formatLastRir(last: LastPerformance | null): string | null {
  if (!last || last.rir === null) return null;
  return `RIR ${last.rir}`;
}

export function insightLabel(insight: CoachInsight): string {
  if (insight === 'consistent_improvement') return 'Consistent improvement';
  if (insight === 'weight_increased') return 'Weight increased';
  if (insight === 'rep_progression') return 'Rep progression';
  if (insight === 'performance_plateau') return 'Performance plateau';
  if (insight === 'performance_declined') return 'Performance declined';
  return 'Insufficient history';
}

export function formatBestE1rm(value: number | null): string | null {
  if (value === null) return null;
  return `${formatE1rm(value)} kg`;
}

export function suggestionChangesTarget(
  plan: PlannedExercise,
  suggestedWeightKg: number | null,
  suggestedReps: number | null,
): boolean {
  const weightDiffers =
    suggestedWeightKg !== null &&
    (plan.weightKg === null || Math.abs(plan.weightKg - suggestedWeightKg) >= WEIGHT_EPS);
  const repsDiffer =
    suggestedReps !== null &&
    (plan.repsMin === null || plan.repsMin !== suggestedReps);
  return weightDiffers || repsDiffer;
}
