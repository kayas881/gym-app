/**
 * Deterministic personal records and progressive-overload stats.
 *
 * Numbers come only from saved workout_sets. Missing weight or reps
 * drop that set from the metric that needs them; they never become 0.
 * RIR is ignored here: the Epley estimate is weight × (1 + reps / 30).
 *
 * Exercise identity is a trimmed, case-folded name so "Bench press"
 * and "bench  press" are the same lift, while "Incline bench press"
 * stays a different exercise.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const EPLEY_REP_DIVISOR = 30;
const WEIGHT_EPSILON = 0.05;
const E1RM_EPSILON = 0.05;

export type Trend = 'improved' | 'declined' | 'unchanged' | 'insufficient';

export type HistorySet = {
  clientId: string;
  sessionId: string;
  startedOn: string;
  exercise: string;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  createdAt: string;
};

export type HistorySession = {
  id: string;
  startedOn: string;
  createdAt: string;
  sets: HistorySet[];
};

export type RecordMark = {
  value: number;
  clientId: string;
  sessionId: string;
  startedOn: string;
  createdAt: string;
  exercise: string;
};

export type ExerciseRecords = {
  key: string;
  displayName: string;
  heaviestSet: RecordMark | null;
  mostReps: RecordMark | null;
  bestE1rm: RecordMark | null;
  highestSessionVolume: RecordMark | null;
};

export type SessionPerformance = {
  sessionId: string;
  startedOn: string;
  setCount: number;
  topWeightKg: number | null;
  repsAtTopWeight: number | null;
  topReps: number | null;
  volume: number | null;
  bestE1rm: number | null;
};

export type ExerciseProgress = {
  key: string;
  displayName: string;
  records: ExerciseRecords;
  sessions: SessionPerformance[];
  latest: SessionPerformance | null;
  previous: SessionPerformance | null;
  weightTrend: Trend;
  repsTrend: Trend;
  e1rmTrend: Trend;
  volumeTrend: Trend;
  overallTrend: Trend;
};

export type OverallWorkoutStats = {
  sessionCount: number;
  setCount: number;
  exerciseCount: number;
  totalVolume: number | null;
  lastWorkoutOn: string | null;
};

function asNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function exerciseKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function epley1RM(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg < 0 || reps < 1) return null;
  return weightKg * (1 + reps / EPLEY_REP_DIVISOR);
}

export function setVolume(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || reps < 1) return null;
  return weightKg * reps;
}

export function compareMetric(
  current: number | null,
  previous: number | null,
  epsilon: number,
): Trend {
  if (current === null || previous === null) return 'insufficient';
  const delta = current - previous;
  if (Math.abs(delta) < epsilon) return 'unchanged';
  return delta > 0 ? 'improved' : 'declined';
}

function earlierMark(a: RecordMark, b: RecordMark): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.clientId < b.clientId;
}

function takeHigher(
  current: RecordMark | null,
  candidate: RecordMark,
): RecordMark {
  if (!current) return candidate;
  if (candidate.value > current.value) return candidate;
  if (candidate.value < current.value) return current;
  return earlierMark(candidate, current) ? candidate : current;
}

function sessionSort(a: { startedOn: string; createdAt?: string; sessionId?: string }, b: typeof a): number {
  if (a.startedOn !== b.startedOn) return a.startedOn < b.startedOn ? -1 : 1;
  const ac = a.createdAt ?? '';
  const bc = b.createdAt ?? '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  const aid = a.sessionId ?? '';
  const bid = b.sessionId ?? '';
  return aid < bid ? -1 : 1;
}

export function summarizeSession(session: HistorySession, sets: HistorySet[]): SessionPerformance {
  let topWeightKg: number | null = null;
  let repsAtTopWeight: number | null = null;
  let topReps: number | null = null;
  let volumeSum = 0;
  let volumeParts = 0;
  let bestE1rm: number | null = null;

  for (const set of sets) {
    if (set.reps !== null && (topReps === null || set.reps > topReps)) {
      topReps = set.reps;
    }
    if (set.weightKg !== null) {
      const betterWeight =
        topWeightKg === null ||
        set.weightKg > topWeightKg ||
        (set.weightKg === topWeightKg &&
          set.reps !== null &&
          (repsAtTopWeight === null || set.reps > repsAtTopWeight));
      if (betterWeight) {
        topWeightKg = set.weightKg;
        repsAtTopWeight = set.reps;
      }
    }
    const vol = setVolume(set.weightKg, set.reps);
    if (vol !== null) {
      volumeSum += vol;
      volumeParts += 1;
    }
    if (set.weightKg !== null && set.reps !== null) {
      const estimate = epley1RM(set.weightKg, set.reps);
      if (estimate !== null && (bestE1rm === null || estimate > bestE1rm)) {
        bestE1rm = estimate;
      }
    }
  }

  return {
    sessionId: session.id,
    startedOn: session.startedOn,
    setCount: sets.length,
    topWeightKg,
    repsAtTopWeight,
    topReps,
    volume: volumeParts > 0 ? volumeSum : null,
    bestE1rm,
  };
}

function displayNameFor(sets: HistorySet[]): string {
  const newest = [...sets].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.clientId < b.clientId ? 1 : -1;
  })[0];
  return newest?.exercise.trim().replace(/\s+/g, ' ') ?? '';
}

export function computeExerciseRecords(sets: HistorySet[]): ExerciseRecords {
  const key = sets.length > 0 ? exerciseKey(sets[0].exercise) : '';
  let heaviestSet: RecordMark | null = null;
  let mostReps: RecordMark | null = null;
  let bestE1rm: RecordMark | null = null;
  const volumeBySession = new Map<string, { sum: number; parts: number; startedOn: string; createdAt: string; exercise: string; clientId: string }>();

  for (const set of sets) {
    const base = {
      clientId: set.clientId,
      sessionId: set.sessionId,
      startedOn: set.startedOn,
      createdAt: set.createdAt,
      exercise: set.exercise,
    };
    if (set.weightKg !== null) {
      heaviestSet = takeHigher(heaviestSet, { ...base, value: set.weightKg });
    }
    if (set.reps !== null) {
      mostReps = takeHigher(mostReps, { ...base, value: set.reps });
    }
    if (set.weightKg !== null && set.reps !== null) {
      const estimate = epley1RM(set.weightKg, set.reps);
      if (estimate !== null) {
        bestE1rm = takeHigher(bestE1rm, { ...base, value: estimate });
      }
    }
    const vol = setVolume(set.weightKg, set.reps);
    if (vol !== null) {
      const bucket = volumeBySession.get(set.sessionId);
      if (bucket) {
        bucket.sum += vol;
        bucket.parts += 1;
        if (set.createdAt < bucket.createdAt) {
          bucket.createdAt = set.createdAt;
          bucket.clientId = set.clientId;
        }
      } else {
        volumeBySession.set(set.sessionId, {
          sum: vol,
          parts: 1,
          startedOn: set.startedOn,
          createdAt: set.createdAt,
          exercise: set.exercise,
          clientId: set.clientId,
        });
      }
    }
  }

  let highestSessionVolume: RecordMark | null = null;
  for (const [sessionId, bucket] of volumeBySession) {
    if (bucket.parts === 0) continue;
    highestSessionVolume = takeHigher(highestSessionVolume, {
      value: bucket.sum,
      clientId: bucket.clientId,
      sessionId,
      startedOn: bucket.startedOn,
      createdAt: bucket.createdAt,
      exercise: bucket.exercise,
    });
  }

  return {
    key,
    displayName: displayNameFor(sets),
    heaviestSet,
    mostReps,
    bestE1rm,
    highestSessionVolume,
  };
}

export function computeExerciseProgress(
  sessions: HistorySession[],
  key: string,
): ExerciseProgress | null {
  const matching: { session: HistorySession; sets: HistorySet[] }[] = [];
  for (const session of sessions) {
    const sets = session.sets.filter((set) => exerciseKey(set.exercise) === key);
    if (sets.length > 0) {
      matching.push({ session, sets });
    }
  }
  if (matching.length === 0) return null;

  matching.sort((a, b) => sessionSort(a.session, b.session));
  const allSets = matching.flatMap((row) => row.sets);
  const records = computeExerciseRecords(allSets);
  const performances = matching.map((row) => summarizeSession(row.session, row.sets));
  const latest = performances[performances.length - 1] ?? null;
  const previous = performances.length > 1 ? performances[performances.length - 2] : null;

  const weightTrend = compareMetric(latest?.topWeightKg ?? null, previous?.topWeightKg ?? null, WEIGHT_EPSILON);
  const repsTrend = compareMetric(latest?.repsAtTopWeight ?? null, previous?.repsAtTopWeight ?? null, 0.5);
  const e1rmTrend = compareMetric(latest?.bestE1rm ?? null, previous?.bestE1rm ?? null, E1RM_EPSILON);
  const volumeTrend = compareMetric(latest?.volume ?? null, previous?.volume ?? null, WEIGHT_EPSILON);

  // Prefer e1RM: it is the one number that already mixes load and reps.
  // Volume next, then top weight. Never invent a trend from a missing side.
  const overallTrend =
    e1rmTrend !== 'insufficient'
      ? e1rmTrend
      : volumeTrend !== 'insufficient'
        ? volumeTrend
        : weightTrend;

  return {
    key,
    displayName: records.displayName,
    records,
    sessions: performances,
    latest,
    previous,
    weightTrend,
    repsTrend,
    e1rmTrend,
    volumeTrend,
    overallTrend,
  };
}

export function computeAllExerciseProgress(sessions: HistorySession[]): ExerciseProgress[] {
  const keys = new Set<string>();
  for (const session of sessions) {
    for (const set of session.sets) {
      const key = exerciseKey(set.exercise);
      if (key) keys.add(key);
    }
  }
  const rows: ExerciseProgress[] = [];
  for (const key of keys) {
    const row = computeExerciseProgress(sessions, key);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => {
    const ad = a.latest?.startedOn ?? '';
    const bd = b.latest?.startedOn ?? '';
    if (ad !== bd) return ad < bd ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function computeOverallStats(sessions: HistorySession[]): OverallWorkoutStats {
  const withSets = sessions.filter((session) => session.sets.length > 0);
  let setCount = 0;
  let volumeSum = 0;
  let volumeParts = 0;
  const exercises = new Set<string>();
  let lastWorkoutOn: string | null = null;

  for (const session of withSets) {
    if (!lastWorkoutOn || session.startedOn > lastWorkoutOn) {
      lastWorkoutOn = session.startedOn;
    }
    for (const set of session.sets) {
      setCount += 1;
      const key = exerciseKey(set.exercise);
      if (key) exercises.add(key);
      const vol = setVolume(set.weightKg, set.reps);
      if (vol !== null) {
        volumeSum += vol;
        volumeParts += 1;
      }
    }
  }

  return {
    sessionCount: withSets.length,
    setCount,
    exerciseCount: exercises.size,
    totalVolume: volumeParts > 0 ? volumeSum : null,
    lastWorkoutOn,
  };
}

export function recordIsFromSession(record: RecordMark | null, sessionId: string | null): boolean {
  return Boolean(record && sessionId && record.sessionId === sessionId);
}

export function formatKg(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatVolume(value: number): string {
  return `${formatKg(value)} kg·reps`;
}

export function formatE1rm(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function trendLabel(trend: Trend): string {
  if (trend === 'improved') return 'Improved';
  if (trend === 'declined') return 'Declined';
  if (trend === 'unchanged') return 'Unchanged';
  return 'Need another session';
}

export type SessionPrKind = 'heaviest' | 'most_reps' | 'best_e1rm' | 'session_volume';

export type SessionPrHit = {
  kind: SessionPrKind;
  exercise: string;
  value: number;
};

export type SessionExerciseLine = {
  key: string;
  displayName: string;
  setCount: number;
  totalReps: number | null;
  volume: number | null;
  topWeightKg: number | null;
  topReps: number | null;
  bestE1rm: number | null;
  performance: Trend;
};

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'unclassified';

export type MuscleShare = {
  group: MuscleGroup;
  setCount: number;
  volume: number | null;
  primarySetCount: number;
  secondarySetCount: number;
};

export type SessionHighlights = {
  improved: string[];
  declined: string[];
  unchanged: string[];
  highestVolumeExercise: string | null;
};

export type SessionSummary = {
  sessionId: string;
  startedOn: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  setCount: number;
  exerciseCount: number;
  volume: number | null;
  averageReps: number | null;
  bestE1rm: number | null;
  topWeightKg: number | null;
  prs: SessionPrHit[];
  baselines: SessionPrHit[];
  previous: {
    sessionId: string;
    startedOn: string;
    volume: number | null;
    setCount: number;
  } | null;
  volumeTrend: Trend;
  setCountTrend: Trend;
  exercises: SessionExerciseLine[];
  muscles: MuscleShare[];
  highlights: SessionHighlights;
  facts: string[];
};

export type WeeklyInsights = {
  weekStart: string;
  weekEnd: string;
  sessionCount: number;
  setCount: number;
  volume: number | null;
  muscles: MuscleShare[];
  previous: {
    weekStart: string;
    sessionCount: number;
    setCount: number;
    volume: number | null;
  } | null;
  sessionTrend: Trend;
  setTrend: Trend;
  volumeTrend: Trend;
};

const PR_LABEL: Record<SessionPrKind, string> = {
  heaviest: 'heaviest set',
  most_reps: 'most reps',
  best_e1rm: 'best e1RM',
  session_volume: 'best session volume',
};

function previousSession(target: HistorySession, all: HistorySession[]): HistorySession | null {
  const earlier = all
    .filter((session) => session.sets.length > 0 && session.id !== target.id && session.startedOn < target.startedOn)
    .sort((a, b) => (a.startedOn < b.startedOn ? 1 : -1));
  return earlier[0] ?? null;
}

function exerciseLines(sets: HistorySet[]): SessionExerciseLine[] {
  const groups = new Map<string, HistorySet[]>();
  for (const set of sets) {
    const key = exerciseKey(set.exercise);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(set);
    groups.set(key, list);
  }
  const lines: SessionExerciseLine[] = [];
  for (const [key, group] of groups) {
    let volumeSum = 0;
    let volumeParts = 0;
    let topWeightKg: number | null = null;
    let topReps: number | null = null;
    let repsSum = 0;
    let repsParts = 0;
    let bestE1rm: number | null = null;
    for (const set of group) {
      const vol = setVolume(set.weightKg, set.reps);
      if (vol !== null) {
        volumeSum += vol;
        volumeParts += 1;
      }
      if (set.weightKg !== null && (topWeightKg === null || set.weightKg > topWeightKg)) {
        topWeightKg = set.weightKg;
      }
      if (set.reps !== null) {
        repsSum += set.reps;
        repsParts += 1;
        if (topReps === null || set.reps > topReps) {
          topReps = set.reps;
        }
      }
      if (set.weightKg !== null && set.reps !== null) {
        const estimate = epley1RM(set.weightKg, set.reps);
        if (estimate !== null && (bestE1rm === null || estimate > bestE1rm)) {
          bestE1rm = estimate;
        }
      }
    }
    const newest = [...group].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    lines.push({
      key,
      displayName: newest?.exercise.trim().replace(/\s+/g, ' ') ?? key,
      setCount: group.length,
      totalReps: repsParts > 0 ? repsSum : null,
      volume: volumeParts > 0 ? volumeSum : null,
      topWeightKg,
      topReps,
      bestE1rm,
      performance: 'insufficient',
    });
  }
  return lines.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function priorBest(
  sessions: SessionPerformance[],
  sessionId: string,
): { weight: number | null; reps: number | null; e1rm: number | null; volume: number | null } {
  const index = sessions.findIndex((row) => row.sessionId === sessionId);
  const prior = index === -1 ? [] : sessions.slice(0, index);
  const maxOf = (pick: (row: SessionPerformance) => number | null): number | null => {
    let best: number | null = null;
    for (const row of prior) {
      const value = pick(row);
      if (value !== null && (best === null || value > best)) {
        best = value;
      }
    }
    return best;
  };
  return {
    weight: maxOf((row) => row.topWeightKg),
    reps: maxOf((row) => row.topReps),
    e1rm: maxOf((row) => row.bestE1rm),
    volume: maxOf((row) => row.volume),
  };
}

function classifyCategory(
  current: number | null,
  previous: number | null,
): 'baseline' | 'broken' | null {
  if (current === null) return null;
  if (previous === null) return 'baseline';
  if (current > previous) return 'broken';
  return null;
}

export function classifyRecordsForSession(
  progress: ExerciseProgress,
  sessionId: string,
): { broken: SessionPrHit[]; baselines: SessionPrHit[] } {
  const current = progress.sessions.find((row) => row.sessionId === sessionId);
  const prior = priorBest(progress.sessions, sessionId);
  const broken: SessionPrHit[] = [];
  const baselines: SessionPrHit[] = [];
  if (!current) return { broken, baselines };

  const push = (kind: SessionPrKind, value: number | null, previous: number | null) => {
    const status = classifyCategory(value, previous);
    if (status === null || value === null) return;
    const hit = { kind, exercise: progress.displayName, value };
    if (status === 'broken') broken.push(hit);
    else baselines.push(hit);
  };

  push('heaviest', current.topWeightKg, prior.weight);
  push('most_reps', current.topReps, prior.reps);
  push('best_e1rm', current.bestE1rm, prior.e1rm);
  push('session_volume', current.volume, prior.volume);
  return { broken, baselines };
}

export type ExerciseRecordBanner = 'baseline' | 'new_pr' | 'no_pr';

export function exerciseRecordBanner(progress: ExerciseProgress): ExerciseRecordBanner {
  if (!progress.latest) return 'no_pr';
  if (progress.sessions.length === 1) return 'baseline';
  const { broken } = classifyRecordsForSession(progress, progress.latest.sessionId);
  return broken.length > 0 ? 'new_pr' : 'no_pr';
}

export function exerciseRecordBannerLabel(banner: ExerciseRecordBanner): string {
  if (banner === 'baseline') return 'Baseline established';
  if (banner === 'new_pr') return 'New personal record';
  return 'No new records this session';
}

function recordsForSession(
  sessionId: string,
  all: HistorySession[],
): { broken: SessionPrHit[]; baselines: SessionPrHit[] } {
  const broken: SessionPrHit[] = [];
  const baselines: SessionPrHit[] = [];
  for (const row of computeAllExerciseProgress(all)) {
    const classified = classifyRecordsForSession(row, sessionId);
    broken.push(...classified.broken);
    baselines.push(...classified.baselines);
  }
  return { broken, baselines };
}

function formatRecordAmount(pr: SessionPrHit): string {
  if (pr.kind === 'most_reps') return String(pr.value);
  if (pr.kind === 'session_volume') return formatVolume(pr.value);
  return `${formatKg(pr.value)} kg`;
}

function buildFacts(summary: Omit<SessionSummary, 'facts'>): string[] {
  const facts: string[] = [];
  const setWord = summary.setCount === 1 ? 'set' : 'sets';
  const liftWord = summary.exerciseCount === 1 ? 'exercise' : 'exercises';
  facts.push(`${summary.setCount} ${setWord} across ${summary.exerciseCount} ${liftWord}`);

  if (summary.volume !== null) {
    facts.push(`${formatVolume(summary.volume)} total volume`);
  }
  if (summary.bestE1rm !== null) {
    facts.push(`Best estimated 1RM ${formatE1rm(summary.bestE1rm)} kg`);
  }

  if (summary.previous && summary.volume !== null && summary.previous.volume !== null) {
    if (summary.volumeTrend === 'improved') {
      facts.push(`Volume up from ${formatVolume(summary.previous.volume)} last session`);
    } else if (summary.volumeTrend === 'declined') {
      facts.push(`Volume down from ${formatVolume(summary.previous.volume)} last session`);
    } else if (summary.volumeTrend === 'unchanged') {
      facts.push(`Volume matched last session`);
    }
  }

  for (const pr of summary.prs) {
    facts.push(`New ${PR_LABEL[pr.kind]}: ${pr.exercise} ${formatRecordAmount(pr)}`);
  }
  for (const mark of summary.baselines) {
    facts.push(`Baseline ${PR_LABEL[mark.kind]}: ${mark.exercise} ${formatRecordAmount(mark)}`);
  }

  return facts;
}

export const MUSCLE_GROUPS: Exclude<MuscleGroup, 'unclassified'>[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'core',
];

type MuscleMap = { primary: Exclude<MuscleGroup, 'unclassified'>; secondary: Exclude<MuscleGroup, 'unclassified'>[] };

// Longest phrase wins. Only common, unambiguous gym names. Anything else
// stays unclassified rather than guessing.
const MUSCLE_PHRASES: Array<{ phrase: string; map: MuscleMap }> = ([
  { phrase: 'incline bench', map: { primary: 'chest', secondary: ['triceps', 'shoulders'] } },
  { phrase: 'decline bench', map: { primary: 'chest', secondary: ['triceps'] } },
  { phrase: 'close grip bench', map: { primary: 'triceps', secondary: ['chest'] } },
  { phrase: 'bench press', map: { primary: 'chest', secondary: ['triceps', 'shoulders'] } },
  { phrase: 'chest press', map: { primary: 'chest', secondary: ['triceps', 'shoulders'] } },
  { phrase: 'pec deck', map: { primary: 'chest', secondary: [] } },
  { phrase: 'pec dec', map: { primary: 'chest', secondary: [] } },
  { phrase: 'cable fly', map: { primary: 'chest', secondary: [] } },
  { phrase: 'chest fly', map: { primary: 'chest', secondary: [] } },
  { phrase: 'dumbbell fly', map: { primary: 'chest', secondary: [] } },
  { phrase: 'push up', map: { primary: 'chest', secondary: ['triceps', 'shoulders'] } },
  { phrase: 'pushup', map: { primary: 'chest', secondary: ['triceps', 'shoulders'] } },
  { phrase: 'lat pulldown', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'lat pull down', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'pull up', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'pullup', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'chin up', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'chinup', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'seated row', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'cable row', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'barbell row', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'dumbbell row', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 't bar row', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'bent over row', map: { primary: 'back', secondary: ['biceps'] } },
  { phrase: 'face pull', map: { primary: 'shoulders', secondary: ['back'] } },
  { phrase: 'romanian deadlift', map: { primary: 'hamstrings', secondary: ['glutes', 'back'] } },
  { phrase: 'rdl', map: { primary: 'hamstrings', secondary: ['glutes'] } },
  { phrase: 'deadlift', map: { primary: 'back', secondary: ['hamstrings', 'glutes'] } },
  { phrase: 'hip thrust', map: { primary: 'glutes', secondary: ['hamstrings'] } },
  { phrase: 'glute bridge', map: { primary: 'glutes', secondary: ['hamstrings'] } },
  { phrase: 'leg curl', map: { primary: 'hamstrings', secondary: [] } },
  { phrase: 'leg extension', map: { primary: 'quadriceps', secondary: [] } },
  { phrase: 'leg press', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'front squat', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'hack squat', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'bulgarian split squat', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'split squat', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'back squat', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'squat', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'lunge', map: { primary: 'quadriceps', secondary: ['glutes'] } },
  { phrase: 'calf raise', map: { primary: 'calves', secondary: [] } },
  { phrase: 'overhead press', map: { primary: 'shoulders', secondary: ['triceps'] } },
  { phrase: 'shoulder press', map: { primary: 'shoulders', secondary: ['triceps'] } },
  { phrase: 'military press', map: { primary: 'shoulders', secondary: ['triceps'] } },
  { phrase: 'arnold press', map: { primary: 'shoulders', secondary: ['triceps'] } },
  { phrase: 'lateral raise', map: { primary: 'shoulders', secondary: [] } },
  { phrase: 'side raise', map: { primary: 'shoulders', secondary: [] } },
  { phrase: 'front raise', map: { primary: 'shoulders', secondary: [] } },
  { phrase: 'rear delt', map: { primary: 'shoulders', secondary: [] } },
  { phrase: 'upright row', map: { primary: 'shoulders', secondary: ['back'] } },
  { phrase: 'shrug', map: { primary: 'back', secondary: ['shoulders'] } },
  { phrase: 'preacher curl', map: { primary: 'biceps', secondary: [] } },
  { phrase: 'hammer curl', map: { primary: 'biceps', secondary: [] } },
  { phrase: 'bicep curl', map: { primary: 'biceps', secondary: [] } },
  { phrase: 'biceps curl', map: { primary: 'biceps', secondary: [] } },
  { phrase: 'barbell curl', map: { primary: 'biceps', secondary: [] } },
  { phrase: 'concentration curl', map: { primary: 'biceps', secondary: [] } },
  { phrase: 'tricep pushdown', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'triceps pushdown', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'rope pushdown', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'skull crusher', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'triceps extension', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'tricep extension', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'overhead extension', map: { primary: 'triceps', secondary: [] } },
  { phrase: 'dip', map: { primary: 'triceps', secondary: ['chest'] } },
  { phrase: 'hanging leg raise', map: { primary: 'core', secondary: [] } },
  { phrase: 'leg raise', map: { primary: 'core', secondary: [] } },
  { phrase: 'russian twist', map: { primary: 'core', secondary: [] } },
  { phrase: 'ab wheel', map: { primary: 'core', secondary: [] } },
  { phrase: 'cable crunch', map: { primary: 'core', secondary: [] } },
  { phrase: 'crunch', map: { primary: 'core', secondary: [] } },
  { phrase: 'sit up', map: { primary: 'core', secondary: [] } },
  { phrase: 'situp', map: { primary: 'core', secondary: [] } },
  { phrase: 'plank', map: { primary: 'core', secondary: [] } },
] satisfies Array<{ phrase: string; map: MuscleMap }>).sort((a, b) => b.phrase.length - a.phrase.length);

export function classifyExercise(name: string): { primary: MuscleGroup; secondary: MuscleGroup[] } {
  const key = exerciseKey(name);
  if (!key) return { primary: 'unclassified', secondary: [] };
  for (const row of MUSCLE_PHRASES) {
    if (key === row.phrase || key.includes(row.phrase)) {
      return { primary: row.map.primary, secondary: row.map.secondary };
    }
  }
  return { primary: 'unclassified', secondary: [] };
}

export function muscleLabel(group: MuscleGroup): string {
  if (group === 'unclassified') return 'Unclassified';
  return group.charAt(0).toUpperCase() + group.slice(1);
}

function accumulateMuscles(sets: HistorySet[]): MuscleShare[] {
  const buckets = new Map<MuscleGroup, { setCount: number; volume: number; volumeParts: number; primarySetCount: number; secondarySetCount: number }>();
  const touch = (group: MuscleGroup) => {
    const current = buckets.get(group) ?? {
      setCount: 0,
      volume: 0,
      volumeParts: 0,
      primarySetCount: 0,
      secondarySetCount: 0,
    };
    buckets.set(group, current);
    return current;
  };

  for (const set of sets) {
    const mapped = classifyExercise(set.exercise);
    const primary = touch(mapped.primary);
    primary.setCount += 1;
    primary.primarySetCount += 1;
    // Volume is assigned once, to the primary group, so the bars sum to
    // session volume instead of counting the same set twice.
    const vol = setVolume(set.weightKg, set.reps);
    if (vol !== null) {
      primary.volume += vol;
      primary.volumeParts += 1;
    }
    for (const group of mapped.secondary) {
      if (group === mapped.primary) continue;
      const secondary = touch(group);
      secondary.setCount += 1;
      secondary.secondarySetCount += 1;
    }
  }

  return [...buckets.entries()]
    .map(([group, row]) => ({
      group,
      setCount: row.setCount,
      volume: row.volumeParts > 0 ? row.volume : null,
      primarySetCount: row.primarySetCount,
      secondarySetCount: row.secondarySetCount,
    }))
    .sort((a, b) => {
      const av = a.volume ?? -1;
      const bv = b.volume ?? -1;
      if (av !== bv) return bv - av;
      return b.setCount - a.setCount;
    });
}

function exercisePerformance(all: HistorySession[], key: string, sessionId: string): Trend {
  const progress = computeExerciseProgress(all, key);
  if (!progress) return 'insufficient';
  const index = progress.sessions.findIndex((row) => row.sessionId === sessionId);
  if (index <= 0) return 'insufficient';
  const current = progress.sessions[index];
  const previous = progress.sessions[index - 1];
  const e1rmTrend = compareMetric(current.bestE1rm, previous.bestE1rm, 0.05);
  const volumeTrend = compareMetric(current.volume, previous.volume, 0.05);
  const weightTrend = compareMetric(current.topWeightKg, previous.topWeightKg, 0.05);
  if (e1rmTrend !== 'insufficient') return e1rmTrend;
  if (volumeTrend !== 'insufficient') return volumeTrend;
  return weightTrend;
}

function sessionWindow(sets: HistorySet[]): { startedAt: string | null; endedAt: string | null; durationMs: number | null } {
  if (sets.length === 0) return { startedAt: null, endedAt: null, durationMs: null };
  const times = sets.map((set) => set.createdAt).sort();
  const startedAt = times[0] ?? null;
  const endedAt = times[times.length - 1] ?? null;
  if (!startedAt || !endedAt || sets.length < 2) {
    return { startedAt, endedAt, durationMs: null };
  }
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return { startedAt, endedAt, durationMs: durationMs >= 0 ? durationMs : null };
}

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return 'Under a minute';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function computeSessionSummary(
  target: HistorySession,
  all: HistorySession[],
): SessionSummary | null {
  if (target.sets.length === 0) return null;

  const totals = summarizeSession(target, target.sets);
  const lines = exerciseLines(target.sets).map((line) => ({
    ...line,
    performance: exercisePerformance(all, line.key, target.id),
  }));
  const previous = previousSession(target, all);
  const previousTotals = previous ? summarizeSession(previous, previous.sets) : null;
  const volumeTrend = compareMetric(totals.volume, previousTotals?.volume ?? null, 0.05);
  const setCountTrend = compareMetric(totals.setCount, previousTotals?.setCount ?? null, 0.5);
  const { broken: prs, baselines } = recordsForSession(target.id, all);
  const window = sessionWindow(target.sets);

  let repsSum = 0;
  let repsParts = 0;
  for (const set of target.sets) {
    if (set.reps !== null) {
      repsSum += set.reps;
      repsParts += 1;
    }
  }

  const improved = lines.filter((line) => line.performance === 'improved').map((line) => line.displayName);
  const declined = lines.filter((line) => line.performance === 'declined').map((line) => line.displayName);
  const unchanged = lines.filter((line) => line.performance === 'unchanged').map((line) => line.displayName);
  const volumeLines = lines.filter((line) => line.volume !== null);
  const highest = volumeLines.length
    ? volumeLines.reduce((best, line) => ((line.volume ?? 0) > (best.volume ?? 0) ? line : best))
    : null;

  const draft: Omit<SessionSummary, 'facts'> = {
    sessionId: target.id,
    startedOn: target.startedOn,
    startedAt: window.startedAt,
    endedAt: window.endedAt,
    durationMs: window.durationMs,
    setCount: totals.setCount,
    exerciseCount: lines.length,
    volume: totals.volume,
    averageReps: repsParts > 0 ? repsSum / repsParts : null,
    bestE1rm: totals.bestE1rm,
    topWeightKg: totals.topWeightKg,
    prs,
    baselines,
    previous: previous
      ? {
          sessionId: previous.id,
          startedOn: previous.startedOn,
          volume: previousTotals?.volume ?? null,
          setCount: previousTotals?.setCount ?? 0,
        }
      : null,
    volumeTrend,
    setCountTrend,
    exercises: lines,
    muscles: accumulateMuscles(target.sets),
    highlights: {
      improved,
      declined,
      unchanged,
      highestVolumeExercise: highest?.displayName ?? null,
    },
  };

  return { ...draft, facts: buildFacts(draft) };
}

export function computeAllSessionSummaries(sessions: HistorySession[]): SessionSummary[] {
  const withSets = sessions.filter((session) => session.sets.length > 0);
  const rows: SessionSummary[] = [];
  for (const session of withSets) {
    const summary = computeSessionSummary(session, sessions);
    if (summary) rows.push(summary);
  }
  return rows.sort((a, b) => (a.startedOn < b.startedOn ? 1 : -1));
}

export function historyFromSyncedSets(
  sessionId: string,
  startedOn: string,
  sets: Array<{
    id: string;
    sessionId: string | null;
    exercise: string;
    weightKg: number | null;
    reps: number | null;
    rir: number | null;
    createdAt: string;
    syncStatus: string;
  }>,
): HistorySession | null {
  const synced = sets.filter(
    (set) => set.syncStatus === 'synced' && (set.sessionId === sessionId || !set.sessionId),
  );
  if (synced.length === 0) return null;
  const historySets: HistorySet[] = synced.map((set) => ({
    clientId: set.id,
    sessionId: set.sessionId ?? sessionId,
    startedOn,
    exercise: set.exercise,
    weightKg: set.weightKg,
    reps: set.reps,
    rir: set.rir,
    createdAt: set.createdAt,
  }));
  return {
    id: sessionId,
    startedOn,
    createdAt: historySets[0]?.createdAt ?? `${startedOn}T00:00:00.000Z`,
    sets: historySets,
  };
}

export function mergeTodayIntoHistory(
  today: HistorySession | null,
  history: HistorySession[],
): HistorySession[] {
  if (!today) return history;
  return [today, ...history.filter((session) => session.id !== today.id)];
}

export function prKindLabel(kind: SessionPrKind): string {
  return PR_LABEL[kind];
}

function shiftIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function weekMonday(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return shiftIso(iso, delta);
}

function sessionsInWeek(sessions: HistorySession[], weekStart: string): HistorySession[] {
  const weekEnd = shiftIso(weekStart, 6);
  return sessions.filter(
    (session) => session.sets.length > 0 && session.startedOn >= weekStart && session.startedOn <= weekEnd,
  );
}

export function computeWeeklyInsights(sessions: HistorySession[], todayIso: string): WeeklyInsights {
  const weekStart = weekMonday(todayIso);
  const weekEnd = shiftIso(weekStart, 6);
  const current = sessionsInWeek(sessions, weekStart);
  const previousStart = shiftIso(weekStart, -7);
  const previous = sessionsInWeek(sessions, previousStart);

  const tally = (rows: HistorySession[]) => {
    let setCount = 0;
    let volume = 0;
    let volumeParts = 0;
    const sets: HistorySet[] = [];
    for (const session of rows) {
      for (const set of session.sets) {
        setCount += 1;
        sets.push(set);
        const vol = setVolume(set.weightKg, set.reps);
        if (vol !== null) {
          volume += vol;
          volumeParts += 1;
        }
      }
    }
    return {
      sessionCount: rows.length,
      setCount,
      volume: volumeParts > 0 ? volume : null,
      muscles: accumulateMuscles(sets),
    };
  };

  const now = tally(current);
  const prior = previous.length > 0 ? tally(previous) : null;

  return {
    weekStart,
    weekEnd,
    sessionCount: now.sessionCount,
    setCount: now.setCount,
    volume: now.volume,
    muscles: now.muscles,
    previous: prior
      ? {
          weekStart: previousStart,
          sessionCount: prior.sessionCount,
          setCount: prior.setCount,
          volume: prior.volume,
        }
      : null,
    sessionTrend: compareMetric(now.sessionCount, prior?.sessionCount ?? null, 0.5),
    setTrend: compareMetric(now.setCount, prior?.setCount ?? null, 0.5),
    volumeTrend: compareMetric(now.volume, prior?.volume ?? null, 0.05),
  };
}

export function formatAverageReps(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export async function fetchMemberWorkoutHistory(
  supabase: SupabaseClient,
): Promise<HistorySession[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`
      id,
      started_on,
      created_at,
      workout_sets (
        client_id,
        exercise,
        weight_kg,
        reps,
        rir,
        created_at,
        session_id
      )
    `)
    .order('started_on', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const sessionId = String(row.id);
    const startedOn = String(row.started_on);
    const createdAt = String(row.created_at);
    const rawSets = (row.workout_sets ?? []) as Array<{
      client_id: string;
      exercise: string;
      weight_kg: number | string | null;
      reps: number | null;
      rir: number | null;
      created_at: string;
      session_id: string;
    }>;
    const sets: HistorySet[] = rawSets.map((set) => ({
      clientId: set.client_id,
      sessionId: set.session_id || sessionId,
      startedOn,
      exercise: set.exercise,
      weightKg: asNumber(set.weight_kg),
      reps: set.reps,
      rir: set.rir,
      createdAt: set.created_at,
    }));
    return { id: sessionId, startedOn, createdAt, sets };
  });
}
