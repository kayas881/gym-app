/**
 * Node tests for transcribe-workout-audio.
 * Run: node --experimental-strip-types --test supabase/functions/transcribe-workout-audio/handler_test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleTranscribeWorkoutAudio } from "./handler.ts";
import { extractTranscript } from "../_shared/transcribe.ts";

const passAuth = async () => ({ userId: "user_test" });

function audioRequest(
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://example.test/transcribe-workout-audio", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-session",
      "Content-Type": "audio/mp4",
      ...headers,
    },
    body: bytes,
  });
}

test("missing authorization is 401", async () => {
  const res = await handleTranscribeWorkoutAudio(
    new Request("https://example.test/transcribe-workout-audio", {
      method: "POST",
      headers: { "Content-Type": "audio/mp4" },
      body: new Uint8Array([1, 2, 3]),
    }),
    { env: () => undefined, fetch },
  );
  assert.equal(res.status, 401);
});

test("missing MODEL_API_KEY is 503", async () => {
  const res = await handleTranscribeWorkoutAudio(
    audioRequest(new Uint8Array([1, 2, 3])),
    { env: () => undefined, fetch, authenticate: passAuth },
  );
  assert.equal(res.status, 503);
});

test("empty body is 400", async () => {
  const res = await handleTranscribeWorkoutAudio(
    audioRequest(new Uint8Array()),
    {
      env: (name) => (name === "MODEL_API_KEY" ? "sk-meta-test" : undefined),
      fetch,
      authenticate: passAuth,
    },
  );
  assert.equal(res.status, 400);
});

test("valid audio returns the transcript and never leaks the key", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  let forwardedAuth = "";
  const res = await handleTranscribeWorkoutAudio(
    audioRequest(new Uint8Array([1, 2, 3, 4])),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      fetch: async (_input, init) => {
        forwardedAuth = String(
          init && typeof init === "object" && "headers" in init
            ? (init.headers as Record<string, string>).Authorization ??
              (init.headers as Headers).get?.("Authorization")
            : "",
        );
        return new Response(JSON.stringify({ transcript: "bench press 40 kilos" }), {
          status: 200,
        });
      },
    },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.transcript, "bench press 40 kilos");
  const text = JSON.stringify(body);
  assert.equal(text.includes(modelKey), false);
  assert.equal(forwardedAuth.includes(modelKey), true);
});

test("JSON audioBase64 is accepted", async () => {
  const res = await handleTranscribeWorkoutAudio(
    new Request("https://example.test/transcribe-workout-audio", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
        contentType: "audio/wav",
      }),
    }),
    {
      env: (name) => (name === "MODEL_API_KEY" ? "sk-meta-test" : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(JSON.stringify({ transcript: "squat eighty" }), { status: 200 }),
    },
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).transcript, "squat eighty");
});

test("upstream 400 is a 422 and does not leak the model body", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleTranscribeWorkoutAudio(
    audioRequest(new Uint8Array([1, 2, 3])),
    {
      env: (name) => (name === "MODEL_API_KEY" ? modelKey : undefined),
      authenticate: passAuth,
      fetch: async () =>
        new Response(`not a supported WAV file ${modelKey}`, { status: 400 }),
    },
  );
  assert.equal(res.status, 422);
  const text = await res.text();
  assert.equal(text.includes(modelKey), false);
});

test("empty transcript is 422", async () => {
  const res = await handleTranscribeWorkoutAudio(
    audioRequest(new Uint8Array([1, 2, 3])),
    {
      env: (name) => (name === "MODEL_API_KEY" ? "sk-meta-test" : undefined),
      authenticate: passAuth,
      fetch: async () => new Response(JSON.stringify({ transcript: "   " }), { status: 200 }),
    },
  );
  assert.equal(res.status, 422);
});

test("upstream 429 does not leak the model body", async () => {
  const modelKey = "sk-meta-live-should-never-appear";
  const res = await handleTranscribeWorkoutAudio(
    audioRequest(new Uint8Array([1, 2, 3])),
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
});

test("extractTranscript reads nested envelopes", () => {
  assert.equal(extractTranscript({ transcript: " squat 80 " }), "squat 80");
  assert.equal(extractTranscript({ result: { transcript: "deadlift" } }), "deadlift");
});

test("function source never writes workout records or logs secrets", () => {
  for (const rel of [
    "supabase/functions/transcribe-workout-audio/index.ts",
    "supabase/functions/transcribe-workout-audio/handler.ts",
    "supabase/functions/_shared/transcribe.ts",
  ]) {
    const src = readFileSync(rel, "utf8");
    assert.equal(src.includes("workout_sets"), false, rel);
    assert.equal(src.includes("console.log"), false, rel);
  }
});
