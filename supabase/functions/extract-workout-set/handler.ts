/**
 * extract-workout-set request handler.
 *
 * This module never opens a Supabase client and never writes a row. It
 * extracts a proposed workout set and returns it for the client to confirm.
 */

import { AuthError, requireClerkUser, type EnvReader } from "../_shared/clerk_auth.ts";
import { errorResponse, jsonResponse, optionsResponse } from "../_shared/http.ts";
import {
  MAX_BODY_BYTES,
  META_CHAT_COMPLETIONS_URL,
  META_TIMEOUT_MS,
  buildMetaRequestBody,
  extractMessageContent,
  parseModelJson,
  parseTranscriptRequest,
  validateWorkoutSet,
} from "../_shared/workout_set.ts";

export type HandlerDeps = {
  env: EnvReader;
  fetch: typeof fetch;
  /**
   * Optional override for tests. Production uses requireClerkUser, which
   * verifies the Clerk session JWT against Clerk's JWKS.
   */
  authenticate?: (req: Request, env: EnvReader) => Promise<{ userId: string }>;
  timeoutMs?: number;
};

function contentLengthOf(req: Request): number | null {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function handleExtractWorkoutSet(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }
  if (req.method !== "POST") {
    return errorResponse(405);
  }

  try {
    const authenticate = deps.authenticate ?? requireClerkUser;
    await authenticate(req, deps.env);
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.status);
    }
    return errorResponse(401);
  }

  const declaredLength = contentLengthOf(req);
  if (declaredLength !== null && declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "request body is too large");
  }

  let parsedBody: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return errorResponse(413, "request body is too large");
    }
    parsedBody = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    return errorResponse(400, "malformed JSON");
  }

  const transcript = parseTranscriptRequest(parsedBody, declaredLength);
  if (!transcript.ok) {
    return errorResponse(transcript.status, transcript.error);
  }

  const modelKey = deps.env("MODEL_API_KEY")?.trim();
  if (!modelKey) {
    return errorResponse(503);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? META_TIMEOUT_MS,
  );
  let upstream: Response;
  try {
    upstream = await deps.fetch(META_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${modelKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildMetaRequestBody(transcript.transcript)),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return errorResponse(aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status === 429) {
    return errorResponse(429);
  }
  if (!upstream.ok) {
    // Read the body so it is not logged; discard it.
    await upstream.text().catch(() => "");
    return errorResponse(502);
  }

  let modelBody: unknown;
  try {
    modelBody = JSON.parse(await upstream.text());
  } catch {
    return errorResponse(502);
  }

  try {
    const content = extractMessageContent(modelBody);
    const extracted = parseModelJson(content);
    const validated = validateWorkoutSet(extracted);
    if (!validated.ok) {
      return errorResponse(422, "model output failed validation");
    }
    return jsonResponse(validated.value, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "extraction failed";
    if (message === "malformed_model_response") {
      return errorResponse(422, "model output was malformed");
    }
    return errorResponse(502);
  }
}
