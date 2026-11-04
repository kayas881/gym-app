import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../lib/theme';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../constants/keyboard';
import {
  MAX_RECORD_SECONDS,
  usePushToTalkWorkout,
} from '../../hooks/usePushToTalkWorkout';
import { useToday } from '../../hooks/useToday';
import { useWorkoutProgress } from '../../hooks/useWorkoutProgress';
import WorkoutSetConfirmCard from '../../components/WorkoutSetConfirmCard';
import RestTimerCard from '../../components/RestTimerCard';
import SessionSummaryCard from '../../components/SessionSummaryCard';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import {
  computeSessionSummary,
  historyFromSyncedSets,
  mergeTodayIntoHistory,
} from '../../lib/workout-progress';
import { groupSetsByExercise } from '../../lib/workout-session';

export default function MemberSessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const todayKey = useToday();
  const workout = usePushToTalkWorkout();
  const history = useWorkoutProgress();
  const syncedSessionId = workout.sets.find((item) => item.syncStatus === 'synced' && item.sessionId)?.sessionId;
  const liveSession = syncedSessionId
    ? historyFromSyncedSets(syncedSessionId, todayKey, workout.sets)
    : null;
  const todaySummary = liveSession
    ? computeSessionSummary(liveSession, mergeTodayIntoHistory(liveSession, history.sessions))
    : null;

  const seconds = Math.max(0, Math.round(workout.durationMillis / 1000));
  const micDisabled =
    workout.phase === 'working' || workout.phase === 'confirming' || workout.saving;

  const onMicPress = () => {
    if (workout.phase === 'recording') {
      void workout.stopRecording();
      return;
    }
    void workout.startRecording();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Log a set</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Speak the exercise, weight, reps and RIR
            </Text>
          </View>
        </View>

        <Card padding={20} style={styles.micCard}>
          <Text style={[styles.micHint, { color: colors.textSecondary }]}>
            {workout.phase === 'recording'
              ? `Listening… ${seconds}s / ${MAX_RECORD_SECONDS}s`
              : workout.phase === 'working'
                ? 'Reading that set…'
                : 'Tap the mic to start. Tap again to stop and review the set.'}
          </Text>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={workout.phase === 'recording' ? 'Stop recording' : 'Start recording'}
            onPress={onMicPress}
            disabled={micDisabled}
            activeOpacity={0.85}
            style={[
              styles.micButton,
              {
                backgroundColor:
                  workout.phase === 'recording' ? colors.error : colors.primary,
                opacity: micDisabled ? 0.5 : 1,
              },
            ]}
          >
            {workout.phase === 'working' ? (
              <ActivityIndicator color="#11170B" />
            ) : (
              <Ionicons
                name={workout.phase === 'recording' ? 'stop' : 'mic'}
                size={32}
                color={workout.phase === 'recording' ? '#FFFFFF' : '#11170B'}
              />
            )}
          </TouchableOpacity>
          {workout.phase === 'recording' ? (
            <Button
              title="Discard"
              variant="ghost"
              size="sm"
              onPress={workout.cancelRecording}
              style={styles.discard}
            />
          ) : null}
        </Card>

        {workout.phase === 'error' && workout.error ? (
          <Card padding={16} style={styles.errorCard}>
            <Text style={[styles.errorText, { color: colors.error }]}>{workout.error}</Text>
            <Button title="OK" variant="secondary" onPress={workout.dismissError} />
          </Card>
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

        <View style={styles.logHeader}>
          <Text style={[styles.logTitle, { color: colors.text }]}>This session</Text>
          <Text style={[styles.logMeta, { color: colors.textTertiary }]}>
            {workout.loadingSets
              ? 'Loading this session…'
              : workout.loadError
                ? workout.loadError
                : workout.persistError
                  ? workout.persistError
                  : workout.sets.some((item) => item.syncStatus !== 'synced')
                    ? 'Some sets are still only on this phone'
                    : workout.sets.length > 0
                      ? 'Saved to your account'
                      : 'Confirmed sets are saved to your account'}
          </Text>
        </View>

        {workout.loadError || workout.persistError ? (
          <Button
            title="Retry"
            variant="secondary"
            onPress={() => {
              if (workout.persistError) {
                void workout.retryUnsynced();
              } else {
                void workout.reloadSets();
              }
            }}
            style={styles.retryButton}
          />
        ) : null}

        {workout.loadingSets && workout.sets.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={styles.emptyLog} />
        ) : workout.sets.length === 0 ? (
          <Text style={[styles.emptyLog, { color: colors.textSecondary }]}>
            Confirmed sets will show up here.
          </Text>
        ) : (
          groupSetsByExercise(workout.sets).map((group) => (
            <Card key={group.key} padding={14} style={styles.setRow}>
              <View style={styles.groupHeader}>
                <Text style={[styles.setName, { color: colors.text }]}>{group.name}</Text>
                <Text style={[styles.groupCount, { color: colors.textTertiary }]}>
                  {group.sets.length} set{group.sets.length === 1 ? '' : 's'}
                </Text>
              </View>
              {group.sets.map((item) => (
                <View key={item.id} style={styles.groupLine}>
                  <Text style={[styles.setMeta, { color: colors.textSecondary }]}>
                    {[
                      item.weightKg !== null ? `${item.weightKg} kg` : null,
                      item.reps !== null ? `${item.reps} reps` : null,
                      item.rir !== null ? `RIR ${item.rir}` : null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ') || 'No numbers logged'}
                  </Text>
                  {item.syncStatus !== 'synced' ? (
                    <Text style={[styles.setSync, { color: colors.error }]}>
                      {item.syncStatus === 'pending' ? 'Saving…' : 'Not saved yet'}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Card>
          ))
        )}

        {todaySummary ? (
          <View style={styles.summaryWrap}>
            <SessionSummaryCard
              summary={todaySummary}
              compact
              onPress={() => router.push(`/(member)/sessions/${todaySummary.sessionId}`)}
            />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTextGroup: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  micCard: { alignItems: 'center', marginBottom: 16 },
  micHint: { fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  micButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: { marginBottom: 16, gap: 12 },
  errorText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  logHeader: { marginTop: 8, marginBottom: 10 },
  logTitle: { fontSize: 17, fontWeight: '700' },
  logMeta: { fontSize: 11, marginTop: 2 },
  emptyLog: { fontSize: 13, marginBottom: 24 },
  retryButton: { marginBottom: 12, alignSelf: 'flex-start' },
  discard: { marginTop: 12 },
  setRow: { marginBottom: 10, gap: 6 },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  groupCount: { fontSize: 12, fontWeight: '600' },
  groupLine: { gap: 2 },
  setName: { fontSize: 16, fontWeight: '700' },
  setMeta: { fontSize: 13, marginTop: 2 },
  setSync: { fontSize: 11, fontWeight: '600' },
  summaryWrap: { marginTop: 8 },
});
