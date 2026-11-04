#!/usr/bin/env node
/**
 * Local Clerk session check for extract-workout-set.
 *
 * Verifies a short-lived gym-app development session token with the same
 * requireClerkUser path the Edge Function uses. The token is read from
 * the environment and is never printed. The session JWT is verified
 * locally after fetching this instance's JWKS; it is not sent to Meta,
 * Supabase, or any other product.
 *
 * Intended instance only: Clerk app "gym-app" development
 * (pk_test_… matching constants/config.ts). Race-OS, Kayan, and any
 * production instance are refused.
 *
 *   $env:CLERK_SECRET_KEY = '<sk_test_… gym-app development>'
 *   $env:CLERK_PUBLISHABLE_KEY = '<pk_test_… gym-app development>'
 *   $env:CLERK_SESSION_TOKEN = '<short-lived session JWT>'
 *   node --experimental-strip-types scripts/verify_clerk_session_local.ts
 */

import { CLERK_PUBLISHABLE_KEY as GYM_APP_DEV_PUBLISHABLE_KEY } from "../constants/config.ts";
import {
  requireClerkUser,
  frontendApiFromPublishableKey,
} from "../supabase/functions/_shared/clerk_auth.ts";

const GYM_APP_DEV_FRONTEND_API = "hopeful-lemur-4510.clerk.accounts.dev";

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function peekIssAndAzp(token: string): { iss: string | null; azp: string | null } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    fail("CLERK_SESSION_TOKEN is not a JWT.");
  }
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      iss?: unknown;
      azp?: unknown;
    };
    return {
      iss: typeof payload.iss === "string" ? payload.iss : null,
      azp: typeof payload.azp === "string" && payload.azp.length > 0 ? payload.azp : null,
    };
  } catch {
    fail("CLERK_SESSION_TOKEN payload could not be decoded.");
  }
}

const publishable = process.env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";

if (!present("CLERK_SECRET_KEY") || !present("CLERK_PUBLISHABLE_KEY") || !present("CLERK_SESSION_TOKEN")) {
  fail(
    "LIVE CLERK CHECK SKIPPED: set gym-app development CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, and CLERK_SESSION_TOKEN in this shell. None of those values are read from the repo or from MCP.",
  );
}

if (publishable !== GYM_APP_DEV_PUBLISHABLE_KEY) {
  fail("Refusing to run: CLERK_PUBLISHABLE_KEY is not the gym-app development key.");
}

let frontendApi: string;
try {
  frontendApi = frontendApiFromPublishableKey(publishable);
} catch {
  fail("CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key.");
}

if (frontendApi !== GYM_APP_DEV_FRONTEND_API) {
  fail("Refusing to run: publishable key is not the gym-app development Frontend API.");
}

const token = process.env.CLERK_SESSION_TOKEN!.trim();
const claims = peekIssAndAzp(token);
const expectedIssuer = `https://${GYM_APP_DEV_FRONTEND_API}`;
console.log(`iss: ${claims.iss ?? "(absent)"}`);
console.log(`iss_matches_gym_app_dev: ${claims.iss === expectedIssuer}`);
console.log(`azp_present: ${claims.azp !== null}`);
console.log(`azp: ${claims.azp ?? "(absent)"}`);
if (claims.azp === null) {
  console.log(
    "authorized_parties: leave CLERK_AUTHORIZED_PARTIES unset; Clerk skips azp when the allow-list is empty.",
  );
}

const req = new Request("https://local.test/extract-workout-set", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});

try {
  const result = await requireClerkUser(req, (name) => {
    if (name === "CLERK_AUTHORIZED_PARTIES") return undefined;
    return process.env[name];
  });
  if (!result.userId.startsWith("user_")) {
    fail("Verification returned an unexpected subject shape.");
  }
  console.log("OK: gym-app development session token verified locally. subject present.");
  process.exit(0);
} catch {
  console.error("FAIL: session token was rejected.");
  process.exit(1);
}
