/**
 * Workout-set extraction contract shared with
 * scripts/meta_extraction_smoke_test.py. Keep the two in step: same field
 * names, same bounds, same prompt, same JSON schema sent to Muse Spark.
 */

export const META_CHAT_COMPLETIONS_URL = "https://api.meta.ai/v1/chat/completions";
export const META_MODEL_ID = "muse-spark-1.3";

export const WEIGHT_KG_MIN = 0;
export const WEIGHT_KG_MAX = 500;
export const REPS_MIN = 1;
export const REPS_MAX = 100;
export const RIR_MIN = 0;
export const RIR_MAX = 10;

export const ALLOWED_FIELDS = ["exercise", "weightKg", "reps", "rir"] as const;
export type UncertainField = (typeof ALLOWED_FIELDS)[number];

export const MAX_TRANSCRIPT_CHARS = 2000;
export const MAX_BODY_BYTES = 8192;
export const META_TIMEOUT_MS = 60_000;

export const FORBIDDEN_CLIENT_KEYS = [
  "apiKey",
  "api_key",
  "MODEL_API_KEY",
  "model",
  "schema",
  "prompt",
  "systemPrompt",
  "messages",
  "response_format",
] as const;

export type WorkoutSet = {
  exercise: string | null;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  uncertainFields: UncertainField[];
  needsConfirmation: boolean;
};

export type ValidationResult =
  | { ok: true; value: WorkoutSet }
  | { ok: false; errors: string[] };

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: "null" }] };
}

export const WORKOUT_SET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "exercise",
    "weightKg",
    "reps",
    "rir",
    "uncertainFields",
    "needsConfirmation",
  ],
  properties: {
    exercise: nullable({ type: "string" }),
    weightKg: nullable({ type: "number" }),
    reps: nullable({ type: "integer" }),
    rir: nullable({ type: "integer" }),
    uncertainFields: {
      type: "array",
      items: {
        type: "string",
        enum: [...ALLOWED_FIELDS],
      },
    },
    needsConfirmation: { type: "boolean" },
  },
} as const;

export const SYSTEM_PROMPT = `You extract one workout set from a speech-to-text transcript.

Return only the JSON object described by the provided schema. You cannot hear
the original audio. Use only the transcript text.

Rules:
- exercise: a known display name when the transcript clearly names it.
  Normalize: "bench press" -> "Bench Press"; "barbell squat" -> "Barbell Squat".
  If no exercise is named, return null. Never guess an exercise.
- weightKg: a number only when the transcript states kilograms
  (kilo, kilos, kilogram, kilograms, kg, KG). Convert spoken numbers
  ("forty" -> 40, "eighty" -> 80). Do not convert pounds or an unspecified
  unit into kilograms. Do not "correct" a stated number (43 stays 43, not 40).
- reps: the set's repetition count only. Do not use a reps-in-reserve number
  as the set reps.
- rir: reps in reserve only, when clearly stated (including "reps in reserve"
  or "RIR"). "razor" is not RIR.
- If a field is missing or ambiguous, set it to null and list it in
  uncertainFields. Never invent a missing exercise, weight, rep count, or RIR.
- Malformed wording such as "two reps two reps in razor" is ambiguous. Do not
  reconstruct omitted speech from context.
- uncertainFields may contain only: exercise, weightKg, reps, rir.
- needsConfirmation must always be true for this milestone, even when every
  field looks clear.
`;

export function buildMetaRequestBody(transcript: string): Record<string, unknown> {
  return {
    model: META_MODEL_ID,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Transcript:\n${transcript}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "WorkoutSet",
        schema: WORKOUT_SET_SCHEMA,
        strict: true,
      },
    },
  };
}

function isIntLike(value: unknown): boolean {
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return Number.isInteger(value);
  return false;
}

export function validateWorkoutSet(payload: unknown): ValidationResult {
  const errors: string[] = [];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: [`payload is ${payload === null ? "null" : typeof payload}, expected object`] };
  }

  const record = payload as Record<string, unknown>;
  const extra = Object.keys(record).filter(
    (key) => !(WORKOUT_SET_SCHEMA.required as readonly string[]).includes(key),
  );
  if (extra.length > 0) {
    errors.push(`extra properties not allowed: ${extra.sort().join(", ")}`);
  }

  const missing = WORKOUT_SET_SCHEMA.required.filter((key) => !(key in record));
  if (missing.length > 0) {
    return { ok: false, errors: [...errors, `missing required fields: ${missing.join(", ")}`] };
  }

  const exercise = record.exercise;
  if (exercise !== null && typeof exercise !== "string") {
    errors.push("exercise must be a string or null");
  } else if (typeof exercise === "string" && exercise.trim() === "") {
    errors.push("exercise must not be an empty string; use null");
  }

  let weightNorm: number | null = null;
  const weight = record.weightKg;
  if (weight === null) {
    weightNorm = null;
  } else if (typeof weight !== "number" || Number.isNaN(weight)) {
    errors.push("weightKg must be a number or null");
  } else {
    weightNorm = weight;
    if (weightNorm < WEIGHT_KG_MIN || weightNorm > WEIGHT_KG_MAX) {
      errors.push(
        `weightKg ${weightNorm} is outside the supported range [${WEIGHT_KG_MIN}, ${WEIGHT_KG_MAX}]`,
      );
    }
  }

  let repsNorm: number | null = null;
  if (record.reps === null) {
    repsNorm = null;
  } else if (!isIntLike(record.reps)) {
    errors.push("reps must be an integer or null");
  } else {
    repsNorm = record.reps as number;
    if (repsNorm < REPS_MIN || repsNorm > REPS_MAX) {
      errors.push(
        `reps ${repsNorm} is outside the supported range [${REPS_MIN}, ${REPS_MAX}]`,
      );
    }
  }

  let rirNorm: number | null = null;
  if (record.rir === null) {
    rirNorm = null;
  } else if (!isIntLike(record.rir)) {
    errors.push("rir must be an integer or null");
  } else {
    rirNorm = record.rir as number;
    if (rirNorm < RIR_MIN || rirNorm > RIR_MAX) {
      errors.push(
        `rir ${rirNorm} is outside the supported range [${RIR_MIN}, ${RIR_MAX}]`,
      );
    }
  }

  const uncertain = record.uncertainFields;
  const uncertainNorm: UncertainField[] = [];
  if (!Array.isArray(uncertain)) {
    errors.push("uncertainFields must be an array");
  } else {
    for (const item of uncertain) {
      if (!(ALLOWED_FIELDS as readonly string[]).includes(item as string)) {
        errors.push(`uncertainFields contains ${JSON.stringify(item)}`);
      } else if (!uncertainNorm.includes(item as UncertainField)) {
        uncertainNorm.push(item as UncertainField);
      }
    }
  }

  if (typeof record.needsConfirmation !== "boolean") {
    errors.push("needsConfirmation must be a boolean");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      exercise: typeof exercise === "string" ? exercise.trim() : null,
      weightKg: weightNorm,
      reps: repsNorm,
      rir: rirNorm,
      uncertainFields: uncertainNorm,
      // Server-side milestone rule: every proposed set still needs a look.
      needsConfirmation: true,
    },
  };
}

export type TranscriptParse =
  | { ok: true; transcript: string }
  | { ok: false; status: number; error: string };

export function parseTranscriptRequest(
  body: unknown,
  contentLength: number | null,
): TranscriptParse {
  if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "request body is too large" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "JSON body must be an object" };
  }

  const record = body as Record<string, unknown>;
  const forbidden = FORBIDDEN_CLIENT_KEYS.filter((key) => key in record);
  if (forbidden.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "request must contain only a transcript",
    };
  }

  if (!("transcript" in record)) {
    return { ok: false, status: 400, error: "transcript is required" };
  }
  if (typeof record.transcript !== "string") {
    return { ok: false, status: 400, error: "transcript must be a string" };
  }

  const transcript = record.transcript.trim();
  if (transcript.length === 0) {
    return { ok: false, status: 400, error: "transcript is required" };
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, status: 413, error: "transcript is too long" };
  }

  const extra = Object.keys(record).filter((key) => key !== "transcript");
  if (extra.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "request must contain only a transcript",
    };
  }

  return { ok: true, transcript };
}

export function extractMessageContent(body: unknown): string {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("malformed_model_response");
  }
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("malformed_model_response");
  }
  const first = choices[0];
  if (first === null || typeof first !== "object") {
    throw new Error("malformed_model_response");
  }
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") {
    throw new Error("malformed_model_response");
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  throw new Error("malformed_model_response");
}

export function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("malformed_model_response");
  }
}

export function publicErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "unauthorized";
    case 405:
      return "method not allowed";
    case 413:
      return "request body is too large";
    case 429:
      return "upstream rate limited";
    case 503:
      return "extraction service is not configured";
    case 504:
      return "upstream timeout";
    default:
      return status >= 500 ? "extraction failed" : "invalid request";
  }
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}
