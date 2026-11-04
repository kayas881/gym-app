import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
} from 'expo-audio';
import { useAppAuth } from '../lib/auth';
import { EdgeFunctionError } from '../lib/edge-function';
import { extractWorkoutSet } from '../lib/extract-workout-set';
import { transcribeWorkoutAudio } from '../lib/transcribe-workout-audio';
import { concatInt16, encodeWavPcm16, pcmDurationMs } from '../lib/wav';
import {
  type DraftFields,
  type WorkoutSet,
  validateDraftFields,
} from '../lib/workout-set';
import {
  type SessionWorkoutSet,
  buildLocalSet,
  dropPendingSet,
  fetchTodaySessionSets,
  getPendingSets,
  mergeSessionSets,
  newClientId,
  persistConfirmedSet,
  rememberPendingSet,
  replacePendingSets,
} from '../lib/workout-session';
import { useToday } from './useToday';
import { handleRestIntent, isRestTimerActive, setAmbiguousRestPrompt, startRestAfterSet } from './useRestTimer';
import { parseRestCommand } from '../lib/rest-period';

export const MAX_RECORD_SECONDS = 12;
const TARGET_SAMPLE_RATE = 16000;

export type WorkoutPhase =
  | 'idle'
  | 'recording'
  | 'working'
  | 'confirming'
  | 'error';

export function usePushToTalkWorkout() {
  const { getToken } = useClerkAuth();
  const { supabase, profile } = useAppAuth();
  const todayKey = useToday();
  const pcmChunks = useRef<Uint8Array[]>([]);
  const pcmMeta = useRef({ sampleRate: TARGET_SAMPLE_RATE, channels: 1 });

  const { stream, isStreaming } = useAudioStream({
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => {
      pcmChunks.current.push(new Uint8Array(buffer.data));
      pcmMeta.current = {
        sampleRate: buffer.sampleRate || TARGET_SAMPLE_RATE,
        channels: buffer.channels || 1,
      };
    },
  });

  const [phase, setPhase] = useState<WorkoutPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkoutSet | null>(null);
  const [sets, setSets] = useState<SessionWorkoutSet[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingSets, setLoadingSets] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [durationMillis, setDurationMillis] = useState(0);

  const pipelineLock = useRef(false);
  const saveLock = useRef(false);
  const persistLock = useRef(false);
  const loadGen = useRef(0);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const phaseRef = useRef<WorkoutPhase>(phase);
  phaseRef.current = phase;
  const startedAtRef = useRef<number | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const fail = useCallback((message: string) => {
    pipelineLock.current = false;
    startedAtRef.current = null;
    clearStopTimer();
    setDraft(null);
    setPhase('error');
    setError(message);
  }, [clearStopTimer]);

  const processRecording = useCallback(async () => {
    if (pipelineLock.current) return;
    pipelineLock.current = true;
    phaseRef.current = 'working';
    setPhase('working');
    setError(null);
    clearStopTimer();

    try {
      if (stream.isStreaming) {
        stream.stop();
      }

      const pcm = concatInt16(pcmChunks.current);
      pcmChunks.current = [];
      const { sampleRate, channels } = pcmMeta.current;
      const recordedMs = Math.max(
        pcmDurationMs(pcm, sampleRate, channels),
        startedAtRef.current ? Date.now() - startedAtRef.current : 0,
      );
      startedAtRef.current = null;

      if (pcm.byteLength < 1600 || recordedMs < 400) {
        fail('That was too short. Tap the mic, say the set, then tap again to stop.');
        return;
      }

      const wav = encodeWavPcm16(pcm, sampleRate, channels);
      const spoken = await transcribeWorkoutAudio(
        wav,
        'audio/wav',
        () => getTokenRef.current(),
      );
      const rest = parseRestCommand(spoken);
      const timerActive = isRestTimerActive();
      if (rest.status === 'command') {
        const mentionsTimer = /\b(rest|timer)\b/i.test(spoken);
        if (timerActive || rest.intent.type === 'query_remaining' || mentionsTimer) {
          handleRestIntent(rest.intent);
          setTranscript(null);
          setPhase('idle');
          return;
        }
      }
      if (rest.status === 'ambiguous' && timerActive) {
        setAmbiguousRestPrompt(rest.prompt);
        setTranscript(null);
        setPhase('idle');
        return;
      }

      setTranscript(spoken);
      const extracted = await extractWorkoutSet(spoken, () => getTokenRef.current());
      setDraft(extracted);
      setPhase('confirming');
    } catch (err) {
      if (err instanceof EdgeFunctionError) {
        fail(err.message);
        return;
      }
      fail('Could not log that set. Try again.');
    } finally {
      pipelineLock.current = false;
    }
  }, [clearStopTimer, fail, stream]);

  const startRecording = useCallback(async () => {
    if (phase === 'recording' || phase === 'working' || phase === 'confirming') {
      return;
    }
    setError(null);
    setDraft(null);
    setTranscript(null);
    setDurationMillis(0);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        fail('Microphone access is needed to log a set by voice.');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      pcmChunks.current = [];
      startedAtRef.current = Date.now();
      phaseRef.current = 'recording';
      setPhase('recording');
      await stream.start();
      clearStopTimer();
      stopTimerRef.current = setTimeout(() => {
        void processRecording();
      }, MAX_RECORD_SECONDS * 1000);
    } catch {
      fail('Could not start the microphone. Try again.');
    }
  }, [clearStopTimer, fail, phase, processRecording, stream]);

  const stopRecording = useCallback(async () => {
    if (phase !== 'recording') return;
    await processRecording();
  }, [phase, processRecording]);

  const cancelRecording = useCallback(() => {
    if (phase !== 'recording') return;
    clearStopTimer();
    if (stream.isStreaming) {
      stream.stop();
    }
    pcmChunks.current = [];
    startedAtRef.current = null;
    setDurationMillis(0);
    setTranscript(null);
    setDraft(null);
    setError(null);
    setPhase('idle');
  }, [clearStopTimer, phase, stream]);

  const cancelDraft = useCallback(() => {
    if (saveLock.current) return;
    setDraft(null);
    setTranscript(null);
    setError(null);
    setPhase('idle');
  }, []);

  const applySet = useCallback((next: SessionWorkoutSet) => {
    setSets((prev) => {
      const without = prev.filter((item) => item.id !== next.id);
      return [next, ...without].sort((a, b) => {
        if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
    });
    if (profile?.id) {
      rememberPendingSet(profile.id, todayKey, next);
    }
  }, [profile?.id, todayKey]);

  const persistSet = useCallback(async (local: SessionWorkoutSet) => {
    const result = await persistConfirmedSet(supabase, {
      clientId: local.id,
      exercise: local.exercise,
      weightKg: local.weightKg,
      reps: local.reps,
      rir: local.rir,
    });
    if (result.ok) {
      const synced: SessionWorkoutSet = {
        ...local,
        sessionId: result.sessionId,
        syncStatus: 'synced',
      };
      applySet(synced);
      if (profile?.id) {
        dropPendingSet(profile.id, todayKey, local.id);
      }
      return result;
    }
    const failed: SessionWorkoutSet = { ...local, syncStatus: 'error' };
    applySet(failed);
    setPersistError(result.message);
    return result;
  }, [applySet, profile?.id, supabase, todayKey]);

  const loadSessionSets = useCallback(async () => {
    const profileId = profile?.id;
    if (!profileId) {
      setLoadingSets(false);
      return;
    }

    const gen = loadGen.current + 1;
    loadGen.current = gen;
    setLoadingSets(true);
    setLoadError(null);

    const local = getPendingSets(profileId, todayKey);
    try {
      const remote = await fetchTodaySessionSets(supabase, todayKey);
      if (gen !== loadGen.current) return;
      const merged = mergeSessionSets(remote.sets, local);
      setSets(merged);
      replacePendingSets(profileId, todayKey, merged);
      const unsynced = merged.filter((item) => item.syncStatus !== 'synced');
      setPersistError(unsynced.length > 0
        ? 'Some sets are still only on this phone.'
        : null);
    } catch {
      if (gen !== loadGen.current) return;
      setSets((prev) => mergeSessionSets(prev, local));
      setLoadError('Could not load this session. Showing what is on this phone.');
    } finally {
      if (gen === loadGen.current) {
        setLoadingSets(false);
      }
    }
  }, [profile?.id, supabase, todayKey]);

  useFocusEffect(
    useCallback(() => {
      void loadSessionSets();
    }, [loadSessionSets]),
  );

  const saveConfirmedFields = useCallback(async (fields: DraftFields) => {
    if (saveLock.current) return { ok: false as const };
    const checked = validateDraftFields(fields);
    if (!checked.ok) return checked;

    saveLock.current = true;
    setSaving(true);
    try {
      // Keep the set on the phone first. A failed insert must not drop a
      // set the member already confirmed.
      const local = buildLocalSet(newClientId(), checked.value);
      applySet(local);
      startRestAfterSet({
        sourceSetId: local.id,
        exercise: local.exercise,
        weightKg: local.weightKg,
        reps: local.reps,
      });
      setDraft(null);
      setTranscript(null);
      setPhase('idle');
      setPersistError(null);

      const result = await persistSet(local);
      if (!result.ok) {
        setPersistError(result.message);
      }
      return { ok: true as const };
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }, [applySet, persistSet]);

  const confirmDraft = useCallback(async (fields: DraftFields) => {
    if (!draft) return { ok: false as const };
    return saveConfirmedFields(fields);
  }, [draft, saveConfirmedFields]);

  const logManualSet = useCallback(async (fields: DraftFields) => {
    return saveConfirmedFields(fields);
  }, [saveConfirmedFields]);

  const retryUnsynced = useCallback(async () => {
    if (persistLock.current) return;
    persistLock.current = true;
    setPersistError(null);
    try {
      const pending = sets.filter((item) => item.syncStatus !== 'synced');
      for (const item of pending) {
        const result = await persistSet(item);
        if (!result.ok) {
          setPersistError(result.message);
          return;
        }
      }
    } finally {
      persistLock.current = false;
    }
  }, [persistSet, sets]);

  const dismissError = useCallback(() => {
    setError(null);
    setPhase('idle');
  }, []);

  useEffect(() => {
    if (phase !== 'recording' || !startedAtRef.current) return;
    const tick = () => {
      if (startedAtRef.current) {
        setDurationMillis(Date.now() - startedAtRef.current);
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase]);

  return {
    phase,
    error,
    transcript,
    draft,
    sets,
    saving,
    loadingSets,
    loadError,
    persistError,
    isRecording: isStreaming || phase === 'recording',
    durationMillis,
    startRecording,
    stopRecording,
    cancelRecording,
    cancelDraft,
    confirmDraft,
    logManualSet,
    retryUnsynced,
    reloadSets: loadSessionSets,
    dismissError,
  };
}
