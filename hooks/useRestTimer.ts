import { useCallback, useEffect, useState } from 'react';
import { AppState, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  type RestIntent,
  type RestTimerSnapshot,
  addRestSeconds,
  applyRestIntent,
  formatRestClock,
  idleRestSnapshot,
  pauseRestSnapshot,
  remainingMs,
  resetRestSnapshot,
  resumeRestSnapshot,
  setRestDuration,
  settleIfFinished,
  skipRestSnapshot,
  startRestSnapshot,
} from '../lib/rest-period';
import {
  type RestPrefs,
  DEFAULT_REST_PREFS,
  clearPersistedRestTimer,
  loadRestPrefs,
  persistRestTimer,
  readPersistedRestTimer,
  rememberExerciseRest,
  resolveRestPlan,
  saveRestPrefs,
} from '../lib/rest-prefs';

type Listener = () => void;

let snapshot = idleRestSnapshot();
let prefs: RestPrefs = { ...DEFAULT_REST_PREFS, perExercise: {} };
let reply: string | null = null;
let pendingAmbiguous: string | null = null;
let hydrated = false;
let notifId: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (snapshot.status === 'idle' || snapshot.status === 'done') {
    void clearPersistedRestTimer();
    return;
  }
  void persistRestTimer(JSON.stringify(snapshot));
}

async function cancelNotif() {
  if (!notifId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notifId);
  } catch {
    // Local alerts are optional.
  }
  notifId = null;
}

async function scheduleNotif(endsAt: number) {
  await cancelNotif();
  if (!prefs.audioAlert) return;
  const seconds = Math.max(1, Math.round((endsAt - Date.now()) / 1000));
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status !== 'granted') return;
    notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest is over',
        body: snapshot.exercise ? `Ready when you are · ${snapshot.exercise}` : 'Ready when you are.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
      },
    });
  } catch {
    notifId = null;
  }
}

function finishIfNeeded(now = Date.now()) {
  const next = settleIfFinished(snapshot, now);
  if (next === snapshot) return;
  const justFinished = snapshot.status === 'running' && next.status === 'done';
  snapshot = next;
  persist();
  void cancelNotif();
  if (justFinished && prefs.hapticAlert) {
    Vibration.vibrate(300);
  }
  emit();
}

function commit(next: RestTimerSnapshot) {
  snapshot = settleIfFinished(next, Date.now());
  persist();
  if (snapshot.status === 'running' && snapshot.endsAt) {
    void scheduleNotif(snapshot.endsAt);
  } else {
    void cancelNotif();
  }
  emit();
}

export async function hydrateRestTimer(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  prefs = await loadRestPrefs();
  const raw = await readPersistedRestTimer();
  if (!raw) {
    emit();
    return;
  }
  try {
    const parsed = JSON.parse(raw) as RestTimerSnapshot;
    snapshot = settleIfFinished(parsed, Date.now());
    if (snapshot.status === 'running' && snapshot.endsAt) {
      void scheduleNotif(snapshot.endsAt);
    }
    persist();
    emit();
  } catch {
    snapshot = idleRestSnapshot();
  }
}

export function startRestAfterSet(input: {
  sourceSetId: string;
  exercise: string;
  weightKg: number | null;
  reps: number | null;
}): void {
  if (!prefs.autoStart) return;
  const plan = resolveRestPlan(input.exercise, prefs);
  commit(
    startRestSnapshot(
      snapshot,
      {
        sourceSetId: input.sourceSetId,
        exercise: input.exercise,
        weightKg: input.weightKg,
        reps: input.reps,
        durationSec: plan.seconds,
        recommendedSec: plan.recommendedSec,
        category: plan.category,
      },
      Date.now(),
    ),
  );
}

export function isRestTimerActive(): boolean {
  finishIfNeeded();
  return snapshot.status === 'running' || snapshot.status === 'paused';
}

export function handleRestIntent(intent: RestIntent): string {
  finishIfNeeded();
  const result = applyRestIntent(snapshot, intent, Date.now());
  reply = result.reply;
  commit(result.next);
  return result.reply;
}

export function setAmbiguousRestPrompt(prompt: string | null) {
  pendingAmbiguous = prompt;
  emit();
}

void hydrateRestTimer();

export function useRestTimer() {
  const [, bump] = useState(0);
  const refresh = useCallback(() => bump((value) => value + 1), []);

  useEffect(() => {
    listeners.add(refresh);
    void hydrateRestTimer();
    const tick = setInterval(() => {
      finishIfNeeded();
      refresh();
    }, 250);
    const app = AppState.addEventListener('change', () => {
      finishIfNeeded();
      refresh();
    });
    return () => {
      listeners.delete(refresh);
      clearInterval(tick);
      app.remove();
    };
  }, [refresh]);

  const remaining = remainingMs(snapshot, Date.now());

  return {
    snapshot,
    prefs,
    remainingMs: remaining,
    clock: formatRestClock(remaining),
    progress: snapshot.durationSec > 0 ? 1 - remaining / (snapshot.durationSec * 1000) : 0,
    reply,
    pendingAmbiguous,
    pause: () => commit(pauseRestSnapshot(snapshot, Date.now())),
    resume: () => commit(resumeRestSnapshot(snapshot, Date.now())),
    skip: () => commit(skipRestSnapshot(snapshot, Date.now())),
    reset: () => commit(resetRestSnapshot(snapshot, Date.now())),
    addSeconds: (seconds: number) => {
      const next = addRestSeconds(snapshot, seconds, Date.now());
      commit(next);
      if (next.exercise) {
        void rememberExerciseRest(next.exercise, next.durationSec).then((saved) => {
          prefs = saved;
          emit();
        });
      }
    },
    setDuration: (seconds: number) => {
      const next = setRestDuration(snapshot, seconds, Date.now());
      commit(next);
      if (next.exercise) {
        void rememberExerciseRest(next.exercise, next.durationSec).then((saved) => {
          prefs = saved;
          emit();
        });
      }
    },
    dismiss: () => {
      snapshot = idleRestSnapshot();
      reply = null;
      persist();
      void cancelNotif();
      emit();
    },
    dismissReply: () => {
      reply = null;
      emit();
    },
    dismissAmbiguous: () => {
      pendingAmbiguous = null;
      emit();
    },
    updatePrefs: async (patch: Partial<RestPrefs>) => {
      prefs = { ...prefs, ...patch, perExercise: patch.perExercise ?? prefs.perExercise };
      await saveRestPrefs(prefs);
      emit();
    },
  };
}
