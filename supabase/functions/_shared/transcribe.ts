/**
 * Meta Muse Voice Transcribe helpers for the workout PTT path.
 * Request shape matches scripts/meta_voice_smoke_test.py.
 */

export const META_TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe";
export const META_VOICE_MODEL_ID = "muse-voice-transcribe-1.0";
export const META_TRANSCRIBE_TIMEOUT_MS = 60_000;
export const MAX_AUDIO_BYTES = 1_500_000;

export const LANGUAGE_BIAS = ["English"];
export const KEYWORDS = [
  "bench press",
  "kilos",
  "kilograms",
  "reps",
  "sets",
  "reps in reserve",
  "RIR",
  "dumbbell",
  "barbell",
  "lat pulldown",
  "squat",
  "deadlift",
];

export type AudioEncoding = "WAV" | "MP4" | "MP3" | "OGG";

export function encodingFromContentType(contentType: string): AudioEncoding {
  const value = contentType.toLowerCase();
  if (value.includes("wav") || value.includes("wave") || value.includes("pcm")) {
    return "WAV";
  }
  if (value.includes("mpeg") || value.includes("mp3")) return "MP3";
  if (value.includes("ogg") || value.includes("opus")) return "OGG";
  return "MP4";
}

export function buildTranscribeRequest(encoding: AudioEncoding): Record<string, unknown> {
  return {
    model: META_VOICE_MODEL_ID,
    audioEncoding: encoding,
    mode: "PUSH_TO_TALK",
    languageBias: LANGUAGE_BIAS,
    keywords: KEYWORDS,
  };
}

export function buildMetaTranscribeMultipart(
  request: Record<string, unknown>,
  audio: Uint8Array,
  filename: string,
  audioType: string,
): { body: Uint8Array; contentType: string } {
  const boundary = `----gymnosTranscribe${crypto.randomUUID().replace(/-/g, "")}`;
  const requestJson = JSON.stringify(request);
  const encoder = new TextEncoder();
  const head1 = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${requestJson}\r\n`,
  );
  const head2 = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: ${audioType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head1.length + head2.length + audio.length + tail.length);
  body.set(head1, 0);
  body.set(head2, head1.length);
  body.set(audio, head1.length + head2.length);
  body.set(tail, head1.length + head2.length + audio.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function extractTranscript(body: unknown): string {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("malformed_model_response");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.transcript === "string") {
    return record.transcript.trim();
  }
  for (const key of ["result", "data", "output"]) {
    const nested = record[key];
    if (
      nested !== null &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      typeof (nested as Record<string, unknown>).transcript === "string"
    ) {
      return ((nested as Record<string, unknown>).transcript as string).trim();
    }
  }
  throw new Error("malformed_model_response");
}

export function filenameForEncoding(encoding: AudioEncoding): string {
  switch (encoding) {
    case "WAV":
      return "clip.wav";
    case "MP3":
      return "clip.mp3";
    case "OGG":
      return "clip.ogg";
    default:
      return "clip.m4a";
  }
}

export function mimeForEncoding(encoding: AudioEncoding): string {
  switch (encoding) {
    case "WAV":
      return "audio/wav";
    case "MP3":
      return "audio/mpeg";
    case "OGG":
      return "audio/ogg";
    default:
      return "audio/mp4";
  }
}
