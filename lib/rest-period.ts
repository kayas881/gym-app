/**
 * Rest-period recommendations, timer math and voice intents.
 *
 * Durations are gym-floor defaults, not medical advice. Unknown lifts fall
 * back to the member's own default rather than inventing a category.
 *
 * Timer remaining is always derived from wall-clock timestamps so a JS
 * interval cannot drift the countdown.
 */
export const REST_HEAVY_COMPOUND_SEC = 180;
export const REST_MODERATE_COMPOUND_SEC = 120;
export const REST_ISOLATION_SEC = 90;
export const REST_CORE_SEC = 60;
export const REST_DEFAULT_SEC = 120;

export type RestCategory = 'heavy_compound' | 'moderate_compound' | 'isolation' | 'core' | 'default';

export type RestIntent =
  | { type: 'skip' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'add'; seconds: number }
  | { type: 'query_remaining' };

export type RestParse =
  | { status: 'command'; intent: RestIntent }
  | { status: 'ambiguous'; prompt: string }
  | { status: 'not_rest' };

export type RestTimerSnapshot = {
  status: 'idle' | 'running' | 'paused' | 'done';
  sourceSetId: string | null;
  exercise: string;
  weightKg: number | null;
  reps: number | null;
  category: RestCategory;
  recommendedSec: number;
  durationSec: number;
  startedAt: number | null;
  endsAt: number | null;
  pausedRemainingMs: number | null;
};

export const REST_RECOMMENDATION_NOTE =
  'Suggested rest — a gym-floor starting point, not a medical recommendation.';

const HEAVY = [
  'deadlift',
  'romanian deadlift',
  'bench press',
  'back squat',
  'front squat',
  'hack squat',
  'squat',
  'overhead press',
  'military press',
  'barbell row',
  'hip thrust',
];

const MODERATE = [
  'incline bench',
  'decline bench',
  'chest press',
  'bulgarian split squat',
  'split squat',
  'lunge',
  'leg press',
  'pull up',
  'pullup',
  'chin up',
  'chinup',
  'lat pulldown',
  'lat pull down',
  'seated row',
  'cable row',
  'dumbbell row',
  't bar row',
  'push up',
  'pushup',
  'dip',
];

const CORE = [
  'plank',
  'crunch',
  'sit up',
  'situp',
  'hanging leg raise',
  'leg raise',
  'russian twist',
  'ab wheel',
  'cable crunch',
];

const ISOLATION = [
  'pec deck',
  'cable fly',
  'chest fly',
  'dumbbell fly',
  'lateral raise',
  'side raise',
  'front raise',
  'rear delt',
  'face pull',
  'shrug',
  'preacher curl',
  'hammer curl',
  'bicep curl',
  'biceps curl',
  'barbell curl',
  'concentration curl',
  'tricep pushdown',
  'triceps pushdown',
  'rope pushdown',
  'skull crusher',
  'triceps extension',
  'tricep extension',
  'overhead extension',
  'leg curl',
  'leg extension',
  'calf raise',
];

function exerciseKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const CATEGORY_PHRASES: Array<{ phrase: string; category: RestCategory }> = [
  ...CORE.map((phrase) => ({ phrase, category: 'core' as const })),
  ...HEAVY.map((phrase) => ({ phrase, category: 'heavy_compound' as const })),
  ...MODERATE.map((phrase) => ({ phrase, category: 'moderate_compound' as const })),
  ...ISOLATION.map((phrase) => ({ phrase, category: 'isolation' as const })),
].sort((a, b) => b.phrase.length - a.phrase.length);

export function restCategoryForExercise(name: string): RestCategory {
  const key = exerciseKey(name);
  if (!key) return 'default';
  for (const row of CATEGORY_PHRASES) {
    if (key === row.phrase || key.includes(row.phrase)) {
      return row.category;
    }
  }
  return 'default';
}

export function recommendedRestSec(name: string, fallback = REST_DEFAULT_SEC): number {
  const category = restCategoryForExercise(name);
  if (category === 'heavy_compound') return REST_HEAVY_COMPOUND_SEC;
  if (category === 'moderate_compound') return REST_MODERATE_COMPOUND_SEC;
  if (category === 'isolation') return REST_ISOLATION_SEC;
  if (category === 'core') return REST_CORE_SEC;
  return fallback;
}

export function restCategoryLabel(category: RestCategory): string {
  if (category === 'heavy_compound') return 'Heavy compound';
  if (category === 'moderate_compound') return 'Moderate compound';
  if (category === 'isolation') return 'Isolation';
  if (category === 'core') return 'Core';
  return 'Your default';
}

export function remainingMs(snapshot: RestTimerSnapshot, now: number): number {
  if (snapshot.status === 'paused') {
    return Math.max(0, snapshot.pausedRemainingMs ?? 0);
  }
  if (snapshot.status === 'running' && snapshot.endsAt !== null) {
    return Math.max(0, snapshot.endsAt - now);
  }
  return 0;
}

export function formatRestClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function idleRestSnapshot(): RestTimerSnapshot {
  return {
    status: 'idle',
    sourceSetId: null,
    exercise: '',
    weightKg: null,
    reps: null,
    category: 'default',
    recommendedSec: REST_DEFAULT_SEC,
    durationSec: REST_DEFAULT_SEC,
    startedAt: null,
    endsAt: null,
    pausedRemainingMs: null,
  };
}

export function startRestSnapshot(
  current: RestTimerSnapshot,
  input: {
    sourceSetId: string;
    exercise: string;
    weightKg: number | null;
    reps: number | null;
    durationSec: number;
    recommendedSec: number;
    category: RestCategory;
  },
  now: number,
): RestTimerSnapshot {
  // A retry of the same confirmed set must not spawn a second countdown.
  if (
    current.sourceSetId === input.sourceSetId &&
    (current.status === 'running' || current.status === 'paused')
  ) {
    return current;
  }
  const durationSec = Math.max(15, Math.round(input.durationSec));
  return {
    status: 'running',
    sourceSetId: input.sourceSetId,
    exercise: input.exercise,
    weightKg: input.weightKg,
    reps: input.reps,
    category: input.category,
    recommendedSec: input.recommendedSec,
    durationSec,
    startedAt: now,
    endsAt: now + durationSec * 1000,
    pausedRemainingMs: null,
  };
}

export function pauseRestSnapshot(current: RestTimerSnapshot, now: number): RestTimerSnapshot {
  if (current.status !== 'running') return current;
  return {
    ...current,
    status: 'paused',
    pausedRemainingMs: remainingMs(current, now),
    endsAt: null,
  };
}

export function resumeRestSnapshot(current: RestTimerSnapshot, now: number): RestTimerSnapshot {
  if (current.status !== 'paused') return current;
  const left = Math.max(0, current.pausedRemainingMs ?? 0);
  if (left <= 0) {
    return { ...current, status: 'done', pausedRemainingMs: 0, endsAt: now };
  }
  return {
    ...current,
    status: 'running',
    startedAt: now,
    endsAt: now + left,
    pausedRemainingMs: null,
  };
}

export function addRestSeconds(
  current: RestTimerSnapshot,
  seconds: number,
  now: number,
): RestTimerSnapshot {
  if (current.status !== 'running' && current.status !== 'paused' && current.status !== 'done') {
    return current;
  }
  const extra = Math.round(seconds) * 1000;
  if (current.status === 'paused') {
    return {
      ...current,
      durationSec: current.durationSec + seconds,
      pausedRemainingMs: Math.max(0, (current.pausedRemainingMs ?? 0) + extra),
    };
  }
  const baseEnds = current.status === 'done' ? now : (current.endsAt ?? now);
  return {
    ...current,
    status: 'running',
    durationSec: current.durationSec + seconds,
    endsAt: baseEnds + extra,
    pausedRemainingMs: null,
  };
}

export function skipRestSnapshot(current: RestTimerSnapshot, now: number): RestTimerSnapshot {
  if (current.status === 'idle') return current;
  return {
    ...current,
    status: 'done',
    endsAt: now,
    pausedRemainingMs: 0,
  };
}

export function resetRestSnapshot(current: RestTimerSnapshot, now: number): RestTimerSnapshot {
  if (current.status === 'idle') return current;
  return {
    ...current,
    status: 'running',
    startedAt: now,
    endsAt: now + current.durationSec * 1000,
    pausedRemainingMs: null,
  };
}

export function setRestDuration(
  current: RestTimerSnapshot,
  durationSec: number,
  now: number,
): RestTimerSnapshot {
  if (current.status === 'idle') return current;
  const next = Math.max(15, Math.round(durationSec));
  const left = remainingMs(current, now);
  const used = Math.max(0, current.durationSec * 1000 - left);
  const remaining = Math.max(0, next * 1000 - used);
  if (current.status === 'paused') {
    return { ...current, durationSec: next, pausedRemainingMs: remaining };
  }
  return {
    ...current,
    status: remaining > 0 ? 'running' : 'done',
    durationSec: next,
    endsAt: now + remaining,
  };
}

export function settleIfFinished(current: RestTimerSnapshot, now: number): RestTimerSnapshot {
  if (current.status === 'running' && remainingMs(current, now) <= 0) {
    return { ...current, status: 'done', endsAt: now, pausedRemainingMs: 0 };
  }
  return current;
}

function normalizeVoice(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fortyfive: 45,
  sixty: 60,
};

function parseSpokenNumber(text: string): number | null {
  const digit = text.match(/\b(\d+)\b/);
  if (digit) return Number(digit[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

export function parseRestCommand(raw: string): RestParse {
  const text = normalizeVoice(raw);
  if (!text) return { status: 'not_rest' };

  const mentionsRest = /\b(rest|timer|break)\b/.test(text);
  const mentionsTime = /\b(second|seconds|sec|minute|minutes|min)\b/.test(text);

  if (/\b(how much|how long|time left|rest left|what.?s left)\b/.test(text)) {
    return { status: 'command', intent: { type: 'query_remaining' } };
  }
  if (/\b(skip|stop|end|cancel)\b/.test(text) && (mentionsRest || mentionsTime || text === 'skip')) {
    if (text === 'skip' || mentionsRest || /\bskip (it|this|the timer)\b/.test(text)) {
      return { status: 'command', intent: { type: 'skip' } };
    }
  }
  if (/\b(pause|hold)\b/.test(text) && (mentionsRest || text === 'pause' || text === 'pause timer')) {
    return { status: 'command', intent: { type: 'pause' } };
  }
  if (/\b(resume|continue|unpause)\b/.test(text)) {
    return { status: 'command', intent: { type: 'resume' } };
  }

  if (/\b(add|plus|another|extra)\b/.test(text) && (mentionsTime || mentionsRest)) {
    if (/\b(a |one )?minute\b/.test(text) && parseSpokenNumber(text) === null) {
      return { status: 'command', intent: { type: 'add', seconds: 60 } };
    }
    const amount = parseSpokenNumber(text);
    if (amount === null) {
      return { status: 'ambiguous', prompt: 'Add time to the rest timer?' };
    }
    const seconds = /\b(minute|minutes|min)\b/.test(text) ? amount * 60 : amount;
    return { status: 'command', intent: { type: 'add', seconds } };
  }

  if (mentionsRest && !/\b(\d+|kg|kilo|rep)\b/.test(text)) {
    return { status: 'ambiguous', prompt: 'Was that a rest-timer command?' };
  }

  return { status: 'not_rest' };
}

export function applyRestIntent(
  current: RestTimerSnapshot,
  intent: RestIntent,
  now: number,
): { next: RestTimerSnapshot; reply: string } {
  if (intent.type === 'skip') {
    return { next: skipRestSnapshot(current, now), reply: 'Rest skipped.' };
  }
  if (intent.type === 'pause') {
    return { next: pauseRestSnapshot(current, now), reply: 'Timer paused.' };
  }
  if (intent.type === 'resume') {
    return { next: resumeRestSnapshot(current, now), reply: 'Timer resumed.' };
  }
  if (intent.type === 'add') {
    return {
      next: addRestSeconds(current, intent.seconds, now),
      reply: `Added ${intent.seconds} seconds.`,
    };
  }
  const left = remainingMs(current, now);
  if (current.status === 'idle') {
    return { next: current, reply: 'No rest timer is running.' };
  }
  if (current.status === 'done' || left <= 0) {
    return { next: current, reply: 'Rest is already over.' };
  }
  return { next: current, reply: `${formatRestClock(left)} left.` };
}
