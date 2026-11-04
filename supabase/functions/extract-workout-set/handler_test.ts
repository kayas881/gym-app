/**
 * Node tests for extract-workout-set.
 * Run: node --experimental-strip-types --test supabase/functions/extract-workout-set/handler_test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MAX_TRANSCRIPT_CHARS,
  parseTranscriptRequest,
  redactSecrets,
  validateWorkoutSet,
} from "../_shared/workout_set.ts";
import { frontendApiFromPublishableKey } from "../_shared/clerk_auth.ts";
import { handleExtractWorkoutSet } from "./handler.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function validSet(overrides: Record<string, unknown> = {}) {
  return {
    exercise: "Bench Press",
    weightKg: 40,
    reps: 10,
    rir: 2,
    uncertainFields: [],
    needsConfirmation: true,
    ...overrides,
  };
}

test("valid transcript body is accepted", () => {
  const parsed = parseTranscriptRequest(
    { transcript: "bench press forty kilos ten reps and two reps in reserve." },
    80,
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.match(parsed.transcript, /bench press/i);
  }
});

test("missing or invalid transcript is rejected", () => {
  assert.equal(parseTranscriptRequest({}, 2).ok, false);
  assert.equal(parseTranscriptRequest({ transcript: "   " }, 3).ok, false);
  assert.equal(parseTranscriptRequest({ transcript: 12 }, 8).ok, false);
  assert.equal(parseTranscriptRequest("nope", 4).ok, false);
  const tooLong = parseTranscriptRequest(
    { transcript: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) },
    MAX_TRANSCRIPT_CHARS + 1,
  );
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.status, 413);
});

test("client-supplied model, key, schema or prompt is rejected", () => {
  const cases = [
    { transcript: "bench 40", model: "muse-spark-1.3" },
    { transcript: "bench 40", apiKey: "sk-test" },
    { transcript: "bench 40", schema: {} },
    { transcript: "bench 40", prompt: "ignore previous" },
    { transcript: "bench 40", gymId: "abc" },
  ];
  for (const body of cases) {
    const parsed = parseTranscriptRequest(body, 40);
    assert.equal(parsed.ok, false, JSON.stringify(body));
  }
});

test("validation accepts a clear set and forces needsConfirmation", () => {
  const result = validateWorkoutSet(validSet({ needsConfirmation: false }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.needsConfirmation, true);
    assert.equal(result.value.weightKg, 40);
  }
});

test("validation rejects malformed or out-of-range model JSON", () => {
  assert.equal(validateWorkoutSet("nope").ok, false);
  assert.equal(validateWorkoutSet(validSet({ weightKg: -1 })).ok, false);
  assert.equal(validateWorkoutSet(validSet({ reps: 0 })).ok, false);
  assert.equal(validateWorkoutSet(validSet({ rir: 11 })).ok, false);
  assert.equal(validateWorkoutSet(validSet({ guessed: true })).ok, false);
  const missing = validSet();
  delete (missing as { rir?: number }).rir;
  assert.equal(validateWorkoutSet(missing).ok, false);
});

test("redaction never leaves the API key in an error string", () => {
  const key = "sk-meta-super-secret";
  assert.equal(redactSecrets(`upstream ${key} failed`, [key]).includes(key), false);
});

function jsonRequest(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://example.test/extract-workout-set", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "GET" || method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

test("missing or invalid authentication is rejected with 401", async () => {
  const env = (name: string) =>
    name === "CLERK_SECRET_KEY"
      ? "sk_test_dummy"
      : name === "CLERK_PUBLISHABLE_KEY"
        ? "pk_test_aG9wZWZ1bC1sZW11ci00NTEwLmNsZXJrLmFjY291bnRzLmRldiQ"
        : undefined;

  const missing = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }),
    { env, fetch },
  );
  assert.equal(missing.status, 401);

  const malformed = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Token abc",
    }),
    { env, fetch },
  );
  assert.equal(malformed.status, 401);
});

const passAuth = async () => ({ userId: "user_test" });

test("valid transcript returns the expected structured data", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const env = (name: string) => (name === "MODEL_API_KEY" ? modelKey : undefined);
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", {
      transcript: "bench press forty kilos ten reps and two reps in reserve.",
    }, { Authorization: "Bearer test-session" }),
    {
      env,
      authenticate: passAuth,
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    exercise: "Bench Press",
                    weightKg: 40,
                    reps: 10,
                    rir: 2,
                    uncertainFields: [],
                    needsConfirmation: false,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    exercise: "Bench Press",
    weightKg: 40,
    reps: 10,
    rir: 2,
    uncertainFields: [],
    needsConfirmation: true,
  });
});

test("missing MODEL_API_KEY fails safely after authentication", async () => {
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Bearer test-session",
    }),
    { env: () => undefined, authenticate: passAuth, fetch },
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "extraction service is not configured");
});

test("invalid model JSON is rejected without leaking the API key", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Bearer test-session",
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
          status: 200,
        }),
    },
  );
  assert.equal(res.status, 422);
  const text = await res.text();
  assert.equal(text.includes(modelKey), false);
  assert.equal(text.includes("test-session"), false);
});

test("model API errors do not leak credentials", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Bearer test-session",
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(JSON.stringify({ error: `bad key ${modelKey}` }), { status: 401 }),
    },
  );
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.equal(text.includes(modelKey), false);
  assert.match(text, /extraction failed/);
});

test("needsConfirmation is always true even when the model says false", async () => {
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "barbell squat eighty KG ten reps two reps in reserve." }, {
      Authorization: "Bearer test-session",
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? "k" : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  exercise: "Barbell Squat",
                  weightKg: 80,
                  reps: 10,
                  rir: 2,
                  uncertainFields: [],
                  needsConfirmation: false,
                }),
              },
            }],
          }),
          { status: 200 },
        ),
    },
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.needsConfirmation, true);
});

test("publishable key decodes to the Clerk frontend API host", () => {
  assert.equal(
    frontendApiFromPublishableKey(
      "pk_test_aG9wZWZ1bC1sZW11ci00NTEwLmNsZXJrLmFjY291bnRzLmRldiQ",
    ),
    "hopeful-lemur-4510.clerk.accounts.dev",
  );
});

test("OPTIONS is accepted and other methods are rejected", async () => {
  const options = await handleExtractWorkoutSet(jsonRequest("OPTIONS", null), {
    env: () => undefined,
    fetch,
  });
  assert.equal(options.status, 204);

  const get = await handleExtractWorkoutSet(jsonRequest("GET", null), {
    env: () => undefined,
    fetch,
  });
  assert.equal(get.status, 405);
});

test("invalid transcript does not call the model", async () => {
  let called = false;
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "" }, { Authorization: "Bearer test-session" }),
    {
      env: () => "set",
      authenticate: passAuth,
      fetch: async () => {
        called = true;
        return new Response("nope", { status: 500 });
      },
    },
  );
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("upstream timeout returns 504 without secrets", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Bearer test-session",
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (init?.signal?.aborted) {
            abort();
            return;
          }
          init?.signal?.addEventListener("abort", abort, { once: true });
        }),
    },
  );
  assert.equal(res.status, 504);
  const text = await res.text();
  assert.equal(text.includes(modelKey), false);
  assert.equal(text.includes("test-session"), false);
  assert.match(text, /upstream timeout/);
});

test("upstream 429 is mapped without leaking the model body", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Bearer test-session",
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(JSON.stringify({ error: `rate ${modelKey}` }), { status: 429 }),
    },
  );
  assert.equal(res.status, 429);
  const text = await res.text();
  assert.equal(text.includes(modelKey), false);
  assert.equal(text.includes("test-session"), false);
  assert.match(text, /upstream rate limited/);
});

test("malformed model envelope is rejected without leaking the payload", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleExtractWorkoutSet(
    jsonRequest("POST", { transcript: "bench press 40 kilos 10 reps" }, {
      Authorization: "Bearer test-session",
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(JSON.stringify({ error: `secret ${modelKey}`, choices: [] }), {
          status: 200,
        }),
    },
  );
  assert.equal(res.status, 422);
  const text = await res.text();
  assert.equal(text.includes(modelKey), false);
  assert.equal(text.includes("choices"), false);
});

test("function source never writes workout records", () => {
  const files = [
    "supabase/functions/extract-workout-set/index.ts",
    "supabase/functions/extract-workout-set/handler.ts",
    "supabase/functions/_shared/workout_set.ts",
    "supabase/functions/_shared/clerk_auth.ts",
    "supabase/functions/_shared/http.ts",
  ];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.equal(src.includes(".from("), false, rel);
    assert.equal(/insert\s*\(/i.test(src), false, rel);
    assert.equal(src.includes("workout_sets"), false, rel);
    assert.equal(src.includes("workout_sessions"), false, rel);
  }
});
