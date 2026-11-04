/**
 * transcribe-workout-audio request handler.
 *
 * Accepts a short PTT clip, calls Muse Voice Transcribe, returns { transcript }.
 * Never writes a workout row. MODEL_API_KEY stays on the function.
 */

import { AuthError, requireClerkUser, type EnvReader } from "../_shared/clerk_auth.ts";
import { errorResponse, jsonResponse, optionsResponse } from "../_shared/http.ts";
import {
  MAX_AUDIO_BYTES,
  META_TRANSCRIBE_TIMEOUT_MS,
  META_TRANSCRIBE_URL,
  buildMetaTranscribeMultipart,
  buildTranscribeRequest,
  encodingFromContentType,
  extractTranscript,
  filenameForEncoding,
  mimeForEncoding,
} from "../_shared/transcribe.ts";

export type HandlerDeps = {
  env: EnvReader;
  fetch: typeof fetch;
  authenticate?: (req: Request, env: EnvReader) => Promise<{ userId: string }>;
  timeoutMs?: number;
};

function contentLengthOf(req: Request): number | null {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function readAudio(req: Request): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; status: number; error: string }
> {
  const declared = contentLengthOf(req);
  if (declared !== null && declared > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, error: "request body is too large" };
  }

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength === 0) {
    return { ok: false, status: 400, error: "audio is required" };
  }
  if (raw.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, error: "request body is too large" };
  }

  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return { ok: false, status: 400, error: "malformed JSON" };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "JSON body must be an object" };
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.audioBase64 !== "string" || record.audioBase64.length === 0) {
      return { ok: false, status: 400, error: "audioBase64 is required" };
    }
    try {
      const binary = atob(record.audioBase64);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      if (bytes.byteLength === 0) {
        return { ok: false, status: 400, error: "audio is required" };
      }
      if (bytes.byteLength > MAX_AUDIO_BYTES) {
        return { ok: false, status: 413, error: "request body is too large" };
      }
      const declaredType =
        typeof record.contentType === "string" ? record.contentType : "audio/wav";
      return { ok: true, bytes, contentType: declaredType };
    } catch {
      return { ok: false, status: 400, error: "audioBase64 is not valid" };
    }
  }

  if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
    return { ok: true, bytes: raw, contentType: contentType || "application/octet-stream" };
  }

  if (contentType.startsWith("multipart/form-data")) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!match) {
      return { ok: false, status: 400, error: "multipart boundary is missing" };
    }
    const extracted = extractMultipartAudio(raw, (match[1] ?? match[2]).trim());
    if (!extracted) {
      return { ok: false, status: 400, error: "audio part is required" };
    }
    return extracted;
  }

  return { ok: false, status: 400, error: "send audio/* or multipart audio" };
}

function extractMultipartAudio(
  raw: Uint8Array,
  boundary: string,
): { ok: true; bytes: Uint8Array; contentType: string } | null {
  const text = new TextDecoder("latin1").decode(raw);
  const delim = `--${boundary}`;
  const parts = text.split(delim);
  for (const part of parts) {
    if (!/name="audio"/i.test(part) && !/filename=/i.test(part)) continue;
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt < 0) continue;
    const headers = part.slice(0, splitAt);
    let body = part.slice(splitAt + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    if (body === "--" || body.startsWith("--")) continue;
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const bytes = Uint8Array.from(body, (ch) => ch.charCodeAt(0));
    if (bytes.byteLength === 0) continue;
    return {
      ok: true,
      bytes,
      contentType: typeMatch?.[1]?.trim() || "application/octet-stream",
    };
  }
  return null;
}

export async function handleTranscribeWorkoutAudio(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse(405);

  try {
    const authenticate = deps.authenticate ?? requireClerkUser;
    await authenticate(req, deps.env);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.status);
    return errorResponse(401);
  }

  const audio = await readAudio(req);
  if (!audio.ok) return errorResponse(audio.status, audio.error);

  const modelKey = deps.env("MODEL_API_KEY")?.trim();
  if (!modelKey) return errorResponse(503);

  const encoding = encodingFromContentType(audio.contentType);
  const multipart = buildMetaTranscribeMultipart(
    buildTranscribeRequest(encoding),
    audio.bytes,
    filenameForEncoding(encoding),
    mimeForEncoding(encoding),
  );
  const sessionId = `gymnos-ptt-${crypto.randomUUID()}`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? META_TRANSCRIBE_TIMEOUT_MS,
  );
  let upstream: Response;
  try {
    upstream = await deps.fetch(`${META_TRANSCRIBE_URL}?sessionId=${sessionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${modelKey}`,
        Accept: "application/json",
        "Content-Type": multipart.contentType,
      },
      body: multipart.body,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return errorResponse(aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status === 429) return errorResponse(429);
  if (upstream.status === 400) {
    await upstream.text().catch(() => "");
    return errorResponse(422, "audio was not a usable WAV clip");
  }
  if (!upstream.ok) {
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
    const transcript = extractTranscript(modelBody);
    if (!transcript) {
      return errorResponse(422, "transcript was empty");
    }
    return jsonResponse({ transcript }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "malformed_model_response") {
      return errorResponse(422, "model output was malformed");
    }
    return errorResponse(502);
  }
}
