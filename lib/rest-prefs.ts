import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  REST_DEFAULT_SEC,
  recommendedRestSec,
  restCategoryForExercise,
  type RestCategory,
} from './rest-period';

export type RestPrefs = {
  defaultSeconds: number;
  autoStart: boolean;
  audioAlert: boolean;
  hapticAlert: boolean;
  perExercise: Record<string, number>;
};

export const DEFAULT_REST_PREFS: RestPrefs = {
  defaultSeconds: REST_DEFAULT_SEC,
  autoStart: true,
  audioAlert: true,
  hapticAlert: true,
  perExercise: {},
};

const PREFS_KEY = 'gymnos.rest-prefs';
const TIMER_KEY = 'gymnos.rest-timer';

function storageAvailable(): boolean {
  return Platform.OS !== 'web';
}

export function normalizeRestPrefs(raw: unknown): RestPrefs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_REST_PREFS, perExercise: {} };
  }
  const record = raw as Record<string, unknown>;
  const defaultSeconds =
    typeof record.defaultSeconds === 'number' && record.defaultSeconds >= 15
      ? Math.round(record.defaultSeconds)
      : DEFAULT_REST_PREFS.defaultSeconds;
  const perExercise: Record<string, number> = {};
  if (record.perExercise && typeof record.perExercise === 'object' && !Array.isArray(record.perExercise)) {
    for (const [key, value] of Object.entries(record.perExercise as Record<string, unknown>)) {
      if (typeof value === 'number' && value >= 15) {
        perExercise[key] = Math.round(value);
      }
    }
  }
  return {
    defaultSeconds,
    autoStart: record.autoStart !== false,
    audioAlert: record.audioAlert !== false,
    hapticAlert: record.hapticAlert !== false,
    perExercise,
  };
}

export async function loadRestPrefs(): Promise<RestPrefs> {
  if (!storageAvailable()) return { ...DEFAULT_REST_PREFS, perExercise: {} };
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    return raw ? normalizeRestPrefs(JSON.parse(raw)) : { ...DEFAULT_REST_PREFS, perExercise: {} };
  } catch {
    return { ...DEFAULT_REST_PREFS, perExercise: {} };
  }
}

export async function saveRestPrefs(prefs: RestPrefs): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Settings stay in memory if the store is full or unavailable.
  }
}

export function restKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveRestPlan(
  exercise: string,
  prefs: RestPrefs,
): { seconds: number; recommendedSec: number; category: RestCategory; overridden: boolean } {
  const category = restCategoryForExercise(exercise);
  const recommendedSec = recommendedRestSec(exercise, prefs.defaultSeconds);
  const custom = prefs.perExercise[restKey(exercise)];
  if (typeof custom === 'number') {
    return { seconds: custom, recommendedSec, category, overridden: true };
  }
  return { seconds: recommendedSec, recommendedSec, category, overridden: false };
}

export async function rememberExerciseRest(exercise: string, seconds: number): Promise<RestPrefs> {
  const prefs = await loadRestPrefs();
  const next = {
    ...prefs,
    perExercise: { ...prefs.perExercise, [restKey(exercise)]: Math.max(15, Math.round(seconds)) },
  };
  await saveRestPrefs(next);
  return next;
}

export async function persistRestTimer(payload: string): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await SecureStore.setItemAsync(TIMER_KEY, payload);
  } catch {
    // Timer still runs in memory.
  }
}

export async function readPersistedRestTimer(): Promise<string | null> {
  if (!storageAvailable()) return null;
  try {
    return await SecureStore.getItemAsync(TIMER_KEY);
  } catch {
    return null;
  }
}

export async function clearPersistedRestTimer(): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await SecureStore.deleteItemAsync(TIMER_KEY);
  } catch {
    // ignore
  }
}
