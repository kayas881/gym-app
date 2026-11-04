/**
 * Persistent workout sessions / sets.
 *
 * The confirm card still decides whether a set exists at all. This module
 * writes only after that tap, and keeps the phone copy when the network
 * fails so a confirmed set is never silently dropped.
 *
 * client_id is minted on the phone and UNIQUE on the server, so a retry
 * of the same confirm cannot create a second row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmedWorkoutSet } from './workout-set';

export type SetSyncStatus = 'pending' | 'synced' | 'error';

export type SessionWorkoutSet = ConfirmedWorkoutSet & {
  sessionId: string | null;
  createdAt: string;
  syncStatus: SetSyncStatus;
};

export type WorkoutSetWrite = Omit<ConfirmedWorkoutSet, 'id'>;

export type RemoteSessionSets = {
  sessionId: string | null;
  startedOn: string | null;
  sets: SessionWorkoutSet[];
};

export type PersistResult =
  | { ok: true; sessionId: string; serverId: string }
  | { ok: false; message: string; retryable: boolean };

type WorkoutSetRow = {
  id: string;
  session_id: string;
  client_id: string;
  exercise: string;
  weight_kg: number | string | null;
  reps: number | null;
  rir: number | null;
  created_at: string;
};

const UNIQUE_VIOLATION = '23505';

const pendingByKey = new Map<string, SessionWorkoutSet[]>();

export function pendingCacheKey(profileId: string, startedOn: string): string {
  return `${profileId}:${startedOn}`;
}

export function getPendingSets(profileId: string, startedOn: string): SessionWorkoutSet[] {
  return [...(pendingByKey.get(pendingCacheKey(profileId, startedOn)) ?? [])];
}

export function rememberPendingSet(
  profileId: string,
  startedOn: string,
  set: SessionWorkoutSet,
): void {
  const key = pendingCacheKey(profileId, startedOn);
  const next = (pendingByKey.get(key) ?? []).filter((item) => item.id !== set.id);
  if (set.syncStatus !== 'synced') {
    next.unshift(set);
  }
  pendingByKey.set(key, next);
}

export function dropPendingSet(profileId: string, startedOn: string, clientId: string): void {
  const key = pendingCacheKey(profileId, startedOn);
  const current = pendingByKey.get(key);
  if (!current) return;
  pendingByKey.set(key, current.filter((item) => item.id !== clientId));
}

export function replacePendingSets(
  profileId: string,
  startedOn: string,
  sets: SessionWorkoutSet[],
): void {
  pendingByKey.set(
    pendingCacheKey(profileId, startedOn),
    sets.filter((item) => item.syncStatus !== 'synced'),
  );
}

export function resetPendingSetsForTests(): void {
  pendingByKey.clear();
}

export function groupSetsByExercise(sets: SessionWorkoutSet[]): Array<{
  key: string;
  name: string;
  sets: SessionWorkoutSet[];
}> {
  const groups = new Map<string, SessionWorkoutSet[]>();
  const order: string[] = [];
  for (const set of sets) {
    const key = set.exercise.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key) continue;
    const list = groups.get(key);
    if (list) {
      list.push(set);
    } else {
      groups.set(key, [set]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const list = groups.get(key) ?? [];
    return { key, name: list[0]?.exercise ?? key, sets: list };
  });
}

export function newClientId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

export function mergeSessionSets(
  remote: SessionWorkoutSet[],
  local: SessionWorkoutSet[],
): SessionWorkoutSet[] {
  const byId = new Map<string, SessionWorkoutSet>();
  for (const row of remote) {
    byId.set(row.id, { ...row, syncStatus: 'synced' });
  }
  for (const row of local) {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function parseEnsureSessionResult(data: unknown): PersistResult | { ok: true; sessionId: string } {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, message: 'Could not open today\'s session.', retryable: true };
  }
  const record = data as Record<string, unknown>;
  if (record.ok === true && typeof record.session_id === 'string' && record.session_id) {
    return { ok: true, sessionId: record.session_id };
  }
  const message =
    typeof record.message === 'string' && record.message
      ? record.message
      : 'Could not open today\'s session.';
  return { ok: false, message, retryable: record.reason !== 'not_authenticated' };
}

function asNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapRemoteSet(row: WorkoutSetRow): SessionWorkoutSet {
  return {
    id: row.client_id,
    exercise: row.exercise,
    weightKg: asNumber(row.weight_kg),
    reps: row.reps,
    rir: row.rir,
    sessionId: row.session_id,
    createdAt: row.created_at,
    syncStatus: 'synced',
  };
}

export function buildLocalSet(
  clientId: string,
  value: WorkoutSetWrite,
  createdAt: string = new Date().toISOString(),
): SessionWorkoutSet {
  return {
    id: clientId,
    exercise: value.exercise,
    weightKg: value.weightKg,
    reps: value.reps,
    rir: value.rir,
    sessionId: null,
    createdAt,
    syncStatus: 'pending',
  };
}

export async function fetchTodaySessionSets(
  supabase: SupabaseClient,
  startedOn: string,
): Promise<RemoteSessionSets> {
  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .select('id, started_on')
    .eq('started_on', startedOn)
    .maybeSingle();

  if (sessionError) {
    throw sessionError;
  }
  if (!session) {
    return { sessionId: null, startedOn, sets: [] };
  }

  const { data: rows, error: setsError } = await supabase
    .from('workout_sets')
    .select('id, session_id, client_id, exercise, weight_kg, reps, rir, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false });

  if (setsError) {
    throw setsError;
  }

  return {
    sessionId: session.id as string,
    startedOn: session.started_on as string,
    sets: (rows ?? []).map((row) => mapRemoteSet(row as WorkoutSetRow)),
  };
}

export async function persistConfirmedSet(
  supabase: SupabaseClient,
  input: WorkoutSetWrite & { clientId: string },
): Promise<PersistResult> {
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'ensure_today_workout_session',
  );
  if (rpcError) {
    return {
      ok: false,
      message: 'Could not reach your account. The set is still on this phone.',
      retryable: true,
    };
  }

  const ensured = parseEnsureSessionResult(rpcData);
  if (!ensured.ok) {
    return ensured;
  }

  const payload = {
    session_id: ensured.sessionId,
    client_id: input.clientId,
    exercise: input.exercise,
    weight_kg: input.weightKg,
    reps: input.reps,
    rir: input.rir,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('workout_sets')
    .insert(payload)
    .select('id, session_id')
    .single();

  if (!insertError && inserted) {
    return {
      ok: true,
      sessionId: inserted.session_id as string,
      serverId: inserted.id as string,
    };
  }

  if (isUniqueViolation(insertError)) {
    const { data: existing, error: existingError } = await supabase
      .from('workout_sets')
      .select('id, session_id')
      .eq('client_id', input.clientId)
      .maybeSingle();

    if (!existingError && existing) {
      return {
        ok: true,
        sessionId: existing.session_id as string,
        serverId: existing.id as string,
      };
    }
  }

  return {
    ok: false,
    message: 'Could not save this set to your account. It is still on this phone.',
    retryable: true,
  };
}

export async function updateWorkoutSet(
  supabase: SupabaseClient,
  clientId: string,
  patch: WorkoutSetWrite,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('workout_sets')
    .update({
      exercise: patch.exercise,
      weight_kg: patch.weightKg,
      reps: patch.reps,
      rir: patch.rir,
    })
    .eq('client_id', clientId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, message: 'Could not update that set.' };
  }
  if (!data) {
    return { ok: false, message: 'That set is not on the server yet.' };
  }
  return { ok: true };
}

export async function deleteWorkoutSet(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('workout_sets')
    .delete()
    .eq('client_id', clientId)
    .select('id');

  if (error) {
    return { ok: false, message: 'Could not delete that set.' };
  }
  // RLS hides other people's rows, so a blocked DELETE looks exactly like
  // "already gone": success, 0 rows. The boolean tells the caller which it was.
  return { ok: true, deleted: Boolean(data && data.length > 0) };
}
