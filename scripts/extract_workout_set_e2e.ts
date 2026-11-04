#!/usr/bin/env node
/**
 * Live extract-workout-set check against the Gymnos Supabase project.
 *
 * Sends requests only to this project's function URL. Never prints
 * CLERK_SESSION_TOKEN, CLERK_SECRET_KEY, or MODEL_API_KEY.
 *
 * Unauthenticated probes always run. The authenticated Meta extraction
 * runs only when CLERK_SESSION_TOKEN is set in this shell or .env.
 *
 *   node --experimental-strip-types scripts/extract_workout_set_e2e.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLERK_PUBLISHABLE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from "../constants/config.ts";

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/extract-workout-set`;
const TRANSCRIPT = "bench press forty kilos ten reps and two reps in reserve.";
const SENSITIVE_ENV = ["CLERK_SESSION_TOKEN", "CLERK_SECRET_KEY", "MODEL_API_KEY"] as const;

function loadDotEnv(): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function containsSensitive(text: string): boolean {
  for (const name of SENSITIVE_ENV) {
    const value = process.env[name]?.trim();
    if (value && text.includes(value)) return true;
  }
  if (text.toLowerCase().includes("bearer ")) return true;
  return false;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function call(
  method: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; text: string }> {
  const headers = new Headers({
    apikey: SUPABASE_ANON_KEY,
  });
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const res = await fetch(FUNCTION_URL, { method, headers, body });
  const text = await res.text();
  if (containsSensitive(text)) {
    fail("FAIL: response contained a secret or bearer token.");
  }
  return { status: res.status, text };
}

loadDotEnv();

if (process.env.CLERK_PUBLISHABLE_KEY?.trim() &&
  process.env.CLERK_PUBLISHABLE_KEY.trim() !== CLERK_PUBLISHABLE_KEY) {
  fail("Refusing to run: CLERK_PUBLISHABLE_KEY is not the gym-app development key.");
}

console.log(`target: ${FUNCTION_URL}`);

const options = await call("OPTIONS");
if (options.status !== 204) {
  fail(`FAIL: OPTIONS returned ${options.status}, expected 204.`);
}
console.log("OPTIONS: 204");

const get = await call("GET");
if (get.status !== 405) {
  fail(`FAIL: GET returned ${get.status}, expected 405.`);
}
console.log("GET: 405");

const missingAuth = await call("POST", { body: { transcript: TRANSCRIPT } });
if (missingAuth.status !== 401) {
  fail(`FAIL: POST without Authorization returned ${missingAuth.status}, expected 401.`);
}
console.log("POST missing Authorization: 401");

const badToken = await call("POST", {
  token: "not-a-jwt",
  body: { transcript: TRANSCRIPT },
});
if (badToken.status === 503) {
  fail(
    "FAIL: function returned 503 for a bad token. Hosted CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY are not available to extract-workout-set.",
  );
}
if (badToken.status !== 401) {
  fail(`FAIL: POST with a bad token returned ${badToken.status}, expected 401.`);
}
console.log("POST bad token: 401");

const session = process.env.CLERK_SESSION_TOKEN?.trim();
if (!session) {
  console.log(
    "AUTHENTICATED EXTRACT SKIPPED: set a fresh gym-app development CLERK_SESSION_TOKEN in this shell. It expires in about 60 seconds.",
  );
  process.exit(0);
}

const live = await call("POST", {
  token: session,
  body: { transcript: TRANSCRIPT },
});
console.log(`POST session token: ${live.status}`);

if (live.status !== 200) {
  fail(`FAIL: authenticated extract returned ${live.status}.`);
}

let parsed: unknown;
try {
  parsed = JSON.parse(live.text);
} catch {
  fail("FAIL: authenticated extract did not return JSON.");
}

const record = parsed as Record<string, unknown>;
const extra = Object.keys(record).filter(
  (key) =>
    !["exercise", "weightKg", "reps", "rir", "uncertainFields", "needsConfirmation"].includes(key),
);
if (extra.length > 0) {
  fail("FAIL: response had unexpected fields.");
}
if (record.needsConfirmation !== true) {
  fail("FAIL: needsConfirmation was not true.");
}
if (!("exercise" in record) || !("weightKg" in record) || !("reps" in record) || !("rir" in record)) {
  fail("FAIL: response was missing required fields.");
}

console.log("OK: authenticated extract returned the workout-set contract.");
console.log(`needsConfirmation: ${record.needsConfirmation}`);
console.log(`uncertainFields: ${JSON.stringify(record.uncertainFields)}`);
process.exit(0);
