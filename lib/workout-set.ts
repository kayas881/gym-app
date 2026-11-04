/**
 * Client-side extract-workout-set contract.
 * Field names and bounds must stay aligned with
 * supabase/functions/_shared/workout_set.ts.
 */

export const WEIGHT_KG_MIN = 0;
export const WEIGHT_KG_MAX = 500;
export const REPS_MIN = 1;
export const REPS_MAX = 100;
export const RIR_MIN = 0;
export const RIR_MAX = 10;

export const ALLOWED_FIELDS = ['exercise', 'weightKg', 'reps', 'rir'] as const;
export type UncertainField = (typeof ALLOWED_FIELDS)[number];

export type WorkoutSet = {
  exercise: string | null;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  uncertainFields: UncertainField[];
  needsConfirmation: boolean;
};

export type ConfirmedWorkoutSet = {
  id: string;
  exercise: string;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
};

export function isUncertainField(value: string): value is UncertainField {
  return (ALLOWED_FIELDS as readonly string[]).includes(value);
}

export function parseExtractedWorkoutSet(body: unknown): WorkoutSet {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('malformed_extract_response');
  }
  const record = body as Record<string, unknown>;
  for (const key of ['exercise', 'weightKg', 'reps', 'rir', 'uncertainFields', 'needsConfirmation']) {
    if (!(key in record)) {
      throw new Error('malformed_extract_response');
    }
  }

  const exercise =
    record.exercise === null
      ? null
      : typeof record.exercise === 'string'
        ? record.exercise.trim() || null
        : null;

  const weightKg =
    record.weightKg === null
      ? null
      : typeof record.weightKg === 'number' && Number.isFinite(record.weightKg)
        ? record.weightKg
        : null;

  const reps =
    record.reps === null
      ? null
      : typeof record.reps === 'number' && Number.isInteger(record.reps)
        ? record.reps
        : null;

  const rir =
    record.rir === null
      ? null
      : typeof record.rir === 'number' && Number.isInteger(record.rir)
        ? record.rir
        : null;

  const uncertainFields: UncertainField[] = [];
  if (Array.isArray(record.uncertainFields)) {
    for (const item of record.uncertainFields) {
      if (typeof item === 'string' && isUncertainField(item) && !uncertainFields.includes(item)) {
        uncertainFields.push(item);
      }
    }
  }

  return {
    exercise,
    weightKg,
    reps,
    rir,
    uncertainFields,
    // Server also forces this. Never skip the confirm UI.
    needsConfirmation: true,
  };
}

export type DraftFields = {
  exercise: string;
  weightKg: string;
  reps: string;
  rir: string;
};

export type DraftErrors = Partial<Record<UncertainField, string>>;

export function fieldsFromWorkoutSet(set: WorkoutSet): DraftFields {
  return {
    exercise: set.exercise ?? '',
    weightKg: set.weightKg === null ? '' : String(set.weightKg),
    reps: set.reps === null ? '' : String(set.reps),
    rir: set.rir === null ? '' : String(set.rir),
  };
}

export function validateDraftFields(fields: DraftFields): {
  ok: true;
  value: Omit<ConfirmedWorkoutSet, 'id'>;
} | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const exercise = fields.exercise.trim();
  if (!exercise) {
    errors.exercise = 'Enter the exercise name.';
  }

  let weightKg: number | null = null;
  const weightRaw = fields.weightKg.trim();
  if (weightRaw) {
    const parsed = Number(weightRaw);
    if (!Number.isFinite(parsed) || parsed < WEIGHT_KG_MIN || parsed > WEIGHT_KG_MAX) {
      errors.weightKg = `Weight must be ${WEIGHT_KG_MIN}–${WEIGHT_KG_MAX} kg.`;
    } else {
      weightKg = parsed;
    }
  }

  let reps: number | null = null;
  const repsRaw = fields.reps.trim();
  if (repsRaw) {
    const parsed = Number(repsRaw);
    if (!Number.isInteger(parsed) || parsed < REPS_MIN || parsed > REPS_MAX) {
      errors.reps = `Reps must be ${REPS_MIN}–${REPS_MAX}.`;
    } else {
      reps = parsed;
    }
  }

  let rir: number | null = null;
  const rirRaw = fields.rir.trim();
  if (rirRaw) {
    const parsed = Number(rirRaw);
    if (!Number.isInteger(parsed) || parsed < RIR_MIN || parsed > RIR_MAX) {
      errors.rir = `RIR must be ${RIR_MIN}–${RIR_MAX}.`;
    } else {
      rir = parsed;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { exercise, weightKg, reps, rir } };
}
