import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../../constants/keyboard';
import { usePushToTalkWorkout } from '../../../hooks/usePushToTalkWorkout';
import { useWorkoutProgress } from '../../../hooks/useWorkoutProgress';
import { useWorkoutRoutines } from '../../../hooks/useWorkoutRoutines';
import WorkoutSetConfirmCard from '../../../components/WorkoutSetConfirmCard';
import RestTimerCard from '../../../components/RestTimerCard';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
import {
  addPlannedExercise,
  applyCoachingDecision,
  coachingDecisionFor,
  comparePlanToSets,
  priorSessionPerformance,
  sessionTargetFor,
  skipPlannedExercise,
  unskipPlannedExercise,
} from '../../../lib/workout-plan';
import { recommendedRestSec } from '../../../lib/rest-period';
import { formatKg } from '../../../lib/workout-progress';
import { findLibraryExercise, searchLibrary } from '../../../lib/exercise-library';
import { recommendNextSession } from '../../../lib/workout-coach';
import { finishPlannedSession, savePlanSnapshot } from '../../../lib/workout-routines';
import { validateDraftFields } from '../../../lib/workout-set';
import ExerciseCoachCard from '../../../components/ExerciseCoachCard';

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const workout = usePushToTalkWorkout();
  const progress = useWorkoutProgress();
  const plans = useWorkoutRoutines();
  const snapshot = plans.todayPlan?.snapshot ?? null;
  const [manual, setManual] = useState({ exercise: '', weightKg: '', reps: '', rir: '' });
  const [addQuery, setAddQuery] = useState('');
  const addHits = useMemo(() => searchLibrary(addQuery, plans.library).slice(0, 6), [addQuery, plans.library]);

  const comparison = snapshot
    ? comparePlanToSets(
        snapshot,
        workout.sets.map((item) => ({
          exercise: item.exercise,
          weightKg: item.weightKg,
          reps: item.reps,
        })),
      )
    : null;

  const persistPlan = (next: NonNullable<typeof snapshot>) => {
    if (!plans.todayPlan) return;
    void savePlanSnapshot(plans.supabase, plans.todayPlan.sessionId, next).then(() => plans.refresh());
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 36 },
        ]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.back, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>
              {snapshot ? snapshot.routineName : 'Workout'}
            </Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>
              {snapshot ? snapshot.dayLabel : 'Unscheduled session'}
            </Text>
          </View>
        </View>

        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          Tap the mic to start, tap again to stop. Targets stay put until you change them.
        </Text>

        <TouchableOpacity
          onPress={() => {
            if (workout.phase === 'recording') {
              void workout.stopRecording();
              return;
            }
            void workout.startRecording();
          }}
          disabled={workout.phase === 'working' || workout.saving}
          style={[
            styles.mic,
            { backgroundColor: workout.phase === 'recording' ? colors.error : colors.primary },
          ]}
        >
          <Ionicons name={workout.phase === 'recording' ? 'stop' : 'mic'} size={28} color="#111" />
        </TouchableOpacity>
        {workout.phase === 'recording' ? (
          <Button title="Discard" size="sm" variant="ghost" onPress={workout.cancelRecording} />
        ) : null}

        {workout.phase === 'confirming' && workout.draft ? (
          <WorkoutSetConfirmCard
            draft={workout.draft}
            transcript={workout.transcript}
            saving={workout.saving}
            onConfirm={workout.confirmDraft}
            onCancel={workout.cancelDraft}
          />
        ) : null}

        <RestTimerCard />

        {snapshot && comparison ? (
          <>
            <Text style={[styles.section, { color: colors.text }]}>Planned</Text>
            {snapshot.exercises.map((item) => {
              const line = comparison.lines.find((row) => row.key === item.key);
              const history = progress.getExercise(item.key);
              const prev = priorSessionPerformance(
                history?.latest ?? null,
                history?.previous ?? null,
                plans.todayPlan?.sessionId ?? null,
              );
              const skipped = snapshot.skippedKeys.includes(item.key);
              const decision = coachingDecisionFor(snapshot, item.key);
              const target = sessionTargetFor(item, decision);
              const coach = recommendNextSession({
                plan: item,
                history: progress.sessions,
                todaySessionId: plans.todayPlan?.sessionId ?? null,
                bestE1rm: history?.records.bestE1rm?.value ?? null,
                equipment: findLibraryExercise(item.name, plans.library)?.equipment ?? 'other',
              });
              return (
                <Card key={item.key} padding={14} style={styles.card}>
                  <Text style={[styles.exName, { color: skipped ? colors.textTertiary : colors.text }]}>
                    {item.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    Target {item.targetSets} × {target.repsMin ?? '—'}
                    {target.repsMax ? `–${target.repsMax}` : ''}
                    {target.weightKg !== null ? ` @ ${target.weightKg} kg` : ''}
                    {item.rir !== null ? ` RIR ${item.rir}` : ''}
                    {` · rest ${item.restSeconds}s`}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textTertiary }]}>
                    Done {line?.completedSets ?? 0}/{item.targetSets}
                    {prev?.topWeightKg !== null && prev
                      ? ` · last time ${formatKg(prev.topWeightKg)} kg`
                      : ' · no previous load'}
                  </Text>
                  {item.notes ? (
                    <Text style={[styles.meta, { color: colors.textTertiary }]}>{item.notes}</Text>
                  ) : null}
                  <ExerciseCoachCard
                    plan={item}
                    coach={coach}
                    decision={decision}
                    onAccept={() =>
                      persistPlan(
                        applyCoachingDecision(snapshot, {
                          key: item.key,
                          status: 'accepted',
                          weightKg: coach.suggestedWeightKg,
                          reps: coach.suggestedReps,
                        }),
                      )
                    }
                    onIgnore={() =>
                      persistPlan(
                        applyCoachingDecision(snapshot, {
                          key: item.key,
                          status: 'ignored',
                          weightKg: coach.suggestedWeightKg,
                          reps: coach.suggestedReps,
                        }),
                      )
                    }
                    onEdit={(weightKg, reps) =>
                      persistPlan(
                        applyCoachingDecision(snapshot, {
                          key: item.key,
                          status: 'edited',
                          weightKg,
                          reps,
                        }),
                      )
                    }
                  />
                  <Button
                    title={skipped ? 'Unskip' : 'Skip'}
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      persistPlan(
                        skipped ? unskipPlannedExercise(snapshot, item.key) : skipPlannedExercise(snapshot, item.key),
                      )
                    }
                  />
                </Card>
              );
            })}
          </>
        ) : (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            No plan attached. Log sets as usual.
          </Text>
        )}

        <Text style={[styles.section, { color: colors.text }]}>Manual set</Text>
        <Input label="Exercise" value={manual.exercise} onChangeText={(text) => setManual((prev) => ({ ...prev, exercise: text }))} />
        <Input label="Weight kg" value={manual.weightKg} onChangeText={(text) => setManual((prev) => ({ ...prev, weightKg: text }))} keyboardType="decimal-pad" />
        <Input label="Reps" value={manual.reps} onChangeText={(text) => setManual((prev) => ({ ...prev, reps: text }))} keyboardType="number-pad" />
        <Input label="RIR" value={manual.rir} onChangeText={(text) => setManual((prev) => ({ ...prev, rir: text }))} keyboardType="number-pad" />
        <Button
          title="Save set"
          onPress={() => {
            const checked = validateDraftFields(manual);
            if (!checked.ok) return;
            void workout.logManualSet({
              exercise: checked.value.exercise,
              weightKg: checked.value.weightKg === null ? '' : String(checked.value.weightKg),
              reps: checked.value.reps === null ? '' : String(checked.value.reps),
              rir: checked.value.rir === null ? '' : String(checked.value.rir),
            }).then((result) => {
              if (result.ok) {
                setManual({ exercise: '', weightKg: '', reps: '', rir: '' });
              }
            });
          }}
        />

        <Text style={[styles.section, { color: colors.text }]}>Add exercise</Text>
        <Input label="Search" value={addQuery} onChangeText={setAddQuery} />
        {snapshot
          ? addHits.map((item) => (
              <Button
                key={item.key}
                title={item.name}
                variant="ghost"
                onPress={() => {
                  persistPlan(
                    addPlannedExercise(snapshot, {
                      key: item.key,
                      name: item.name,
                      targetSets: 3,
                      repsMin: 8,
                      repsMax: 12,
                      weightKg: null,
                      rir: null,
                      restSeconds: recommendedRestSec(item.name),
                      notes: '',
                    }),
                  );
                  setAddQuery('');
                }}
              />
            ))
          : null}

        <Button
          title="Finish workout"
          onPress={() => {
            if (plans.todayPlan) {
              void finishPlannedSession(plans.supabase, plans.todayPlan.sessionId).then(() => {
                router.replace(`/(member)/sessions/${plans.todayPlan!.sessionId}`);
              });
            } else {
              router.push('/(member)/sessions');
            }
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  back: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13 },
  hint: { fontSize: 12, lineHeight: 17 },
  mic: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  section: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  card: { gap: 6 },
  exName: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 17 },
});
