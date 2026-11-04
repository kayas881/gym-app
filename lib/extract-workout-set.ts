import {
  EdgeFunctionError,
  callEdgeFunction,
  messageForStatus,
  readJsonObject,
  requireSessionToken,
} from './edge-function';
import { parseExtractedWorkoutSet, type WorkoutSet } from './workout-set';

export async function extractWorkoutSet(
  transcript: string,
  getToken: () => Promise<string | null>,
): Promise<WorkoutSet> {
  const token = await requireSessionToken(getToken);
  const res = await callEdgeFunction('extract-workout-set', {
    token,
    contentType: 'application/json',
    body: JSON.stringify({ transcript }),
  });
  const payload = await readJsonObject(res);
  if (!res.ok) {
    throw new EdgeFunctionError(messageForStatus(res.status), res.status);
  }
  try {
    return parseExtractedWorkoutSet(payload);
  } catch {
    throw new EdgeFunctionError(messageForStatus(422), 422);
  }
}
