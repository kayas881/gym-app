import {
  EdgeFunctionError,
  callEdgeFunction,
  messageForStatus,
  readJsonObject,
  requireSessionToken,
} from './edge-function';

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

export async function transcribeWorkoutAudio(
  audio: ArrayBuffer,
  contentType: string,
  getToken: () => Promise<string | null>,
): Promise<string> {
  const token = await requireSessionToken(getToken);
  const res = await callEdgeFunction('transcribe-workout-audio', {
    token,
    contentType: 'application/json',
    body: JSON.stringify({
      audioBase64: bytesToBase64(audio),
      contentType,
    }),
  });
  const payload = await readJsonObject(res);
  if (!res.ok) {
    throw new EdgeFunctionError(messageForStatus(res.status), res.status);
  }
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof (payload as { transcript?: unknown }).transcript !== 'string'
  ) {
    throw new EdgeFunctionError(messageForStatus(422), 422);
  }
  const transcript = (payload as { transcript: string }).transcript.trim();
  if (!transcript) {
    throw new EdgeFunctionError(messageForStatus(422), 422);
  }
  return transcript;
}
