import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../constants/config';

export class EdgeFunctionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function functionUrl(name: string): string {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

export function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Your session expired. Sign in again and retry.';
    case 413:
      return 'That clip or transcript was too long. Try a shorter take.';
    case 422:
      return 'Could not read a set from that. Try speaking the exercise, weight and reps again.';
    case 429:
      return 'Too many requests. Wait a moment and try again.';
    case 503:
      return 'The logging service is not configured yet.';
    case 504:
      return 'The logging service timed out. Try again.';
    default:
      return status >= 500
        ? 'Could not reach the logging service. Try again.'
        : 'Could not log that set. Try again.';
  }
}

export async function requireSessionToken(
  getToken: () => Promise<string | null>,
): Promise<string> {
  const token = await getToken();
  if (!token) {
    throw new EdgeFunctionError(messageForStatus(401), 401);
  }
  return token;
}

export async function callEdgeFunction(
  name: string,
  init: {
    token: string;
    body?: BodyInit;
    contentType?: string;
  },
): Promise<Response> {
  const headers = new Headers({
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${init.token}`,
    Accept: 'application/json',
  });
  if (init.contentType) {
    headers.set('Content-Type', init.contentType);
  }
  try {
    return await fetch(functionUrl(name), {
      method: 'POST',
      headers,
      body: init.body,
    });
  } catch {
    throw new EdgeFunctionError(
      'Check your connection and try again.',
      0,
    );
  }
}

export async function readJsonObject(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new EdgeFunctionError(messageForStatus(res.status || 502), res.status || 502);
  }
}
