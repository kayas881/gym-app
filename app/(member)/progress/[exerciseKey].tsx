import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { useWorkoutProgress } from '../../../hooks/useWorkoutProgress';
import {
  type RecordMark,
  type Trend,
  formatE1rm,
  formatKg,
  formatVolume,
  trendLabel,
} from '../../../lib/workout-progress';
import { formatDate } from '../../../utils/date';
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import ProgressLineChart from '../../../components/ProgressLineChart';

function badgeFor(trend: Trend): 'success' | 'error' | 'default' | 'warning' {
  if (trend === 'improved') return 'success';
  if (trend === 'declined') return 'error';
  if (trend === 'unchanged') return 'default';
  return 'warning';
}

function deltaText(current: number | null, previous: number | null, format: (value: number) => string, unit: string): string {
  if (current === null || previous === null) return 'Not enough data to compare';
  const delta = current - previous;
  if (Math.abs(delta) < 0.05) return `Unchanged at ${format(current)} ${unit}`.trim();
  const sign = delta > 0 ? '+' : '';
  return `${sign}${format(delta)} ${unit} vs last time`.replace('  ', ' ');
}

function RecordBlock({
  title,
  record,
  format,
  unit,
}: {
  title: string;
  record: RecordMark | null;
  format: (value: number) => string;
  unit: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.recordBlock, { borderColor: colors.border }]}>
      <Text style={[styles.recordTitle, { color: colors.textTertiary }]}>{title}</Text>
      <Text style={[styles.recordValue, { color: colors.text }]}>
        {record ? `${format(record.value)}${unit ? ` ${unit}` : ''}` : '—'}
      </Text>
      <Text style={[styles.recordDate, { color: colors.textSecondary }]}>
        {record ? formatDate(record.startedOn) : 'No qualifying set'}
      </Text>
    </View>
  );
}

export default function ExerciseProgressScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ exerciseKey: string | string[] }>();
  const rawKey = Array.isArray(params.exerciseKey) ? params.exerciseKey[0] : params.exerciseKey;
  const key = rawKey ? decodeURIComponent(rawKey) : '';
  const { getExercise, loading, error, refresh } = useWorkoutProgress();
  const exercise = useMemo(() => (key ? getExercise(key) : null), [getExercise, key]);

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  const weightPoints = (exercise?.sessions ?? [])
    .filter((session) => session.topWeightKg !== null)
    .map((session) => ({ date: session.startedOn, value: session.topWeightKg as number }));
  const e1rmPoints = (exercise?.sessions ?? [])
    .filter((session) => session.bestE1rm !== null)
    .map((session) => ({ date: session.startedOn, value: session.bestE1rm as number }));

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 36 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onBack}
          style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {exercise?.displayName || 'Exercise'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Compared with the last session of this lift
          </Text>
        </View>
      </View>

      {loading && !exercise ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}

      {error ? (
        <Card padding={16} style={styles.block}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void refresh()} />
        </Card>
      ) : null}

      {!loading && !exercise ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No saved sets for this exercise.
        </Text>
      ) : null}

      {exercise ? (
        <>
          <View style={styles.trendRow}>
            <Badge text={trendLabel(exercise.overallTrend)} variant={badgeFor(exercise.overallTrend)} />
          </View>

          <Card padding={16} style={styles.block}>
            <Text style={[styles.cardEyebrow, { color: colors.primary }]}>LATEST SESSION</Text>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {exercise.latest ? formatDate(exercise.latest.startedOn) : '—'}
            </Text>
            <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
              {[
                exercise.latest?.topWeightKg !== null && exercise.latest
                  ? `${formatKg(exercise.latest.topWeightKg)} kg`
                  : null,
                exercise.latest?.repsAtTopWeight !== null && exercise.latest
                  ? `${exercise.latest.repsAtTopWeight} reps`
                  : null,
                exercise.latest?.volume !== null && exercise.latest
                  ? formatVolume(exercise.latest.volume)
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Logged without weight or reps'}
            </Text>
            {exercise.previous ? (
              <Text style={[styles.prevLine, { color: colors.textTertiary }]}>
                Previous {formatDate(exercise.previous.startedOn)}
                {exercise.previous.topWeightKg !== null
                  ? ` · ${formatKg(exercise.previous.topWeightKg)} kg`
                  : ''}
                {exercise.previous.repsAtTopWeight !== null
                  ? ` × ${exercise.previous.repsAtTopWeight}`
                  : ''}
              </Text>
            ) : (
              <Text style={[styles.prevLine, { color: colors.textTertiary }]}>
                First saved session for this exercise
              </Text>
            )}
          </Card>

          <View style={styles.changeGrid}>
            <View style={[styles.changeTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.changeLabel, { color: colors.textTertiary }]}>Weight</Text>
              <Badge text={trendLabel(exercise.weightTrend)} variant={badgeFor(exercise.weightTrend)} size="sm" />
              <Text style={[styles.changeDetail, { color: colors.textSecondary }]}>
                {deltaText(exercise.latest?.topWeightKg ?? null, exercise.previous?.topWeightKg ?? null, formatKg, 'kg')}
              </Text>
            </View>
            <View style={[styles.changeTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.changeLabel, { color: colors.textTertiary }]}>Reps</Text>
              <Badge text={trendLabel(exercise.repsTrend)} variant={badgeFor(exercise.repsTrend)} size="sm" />
              <Text style={[styles.changeDetail, { color: colors.textSecondary }]}>
                {deltaText(
                  exercise.latest?.repsAtTopWeight ?? null,
                  exercise.previous?.repsAtTopWeight ?? null,
                  (value) => String(Math.round(value)),
                  '',
                )}
              </Text>
            </View>
            <View style={[styles.changeTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.changeLabel, { color: colors.textTertiary }]}>Est. 1RM</Text>
              <Badge text={trendLabel(exercise.e1rmTrend)} variant={badgeFor(exercise.e1rmTrend)} size="sm" />
              <Text style={[styles.changeDetail, { color: colors.textSecondary }]}>
                {deltaText(exercise.latest?.bestE1rm ?? null, exercise.previous?.bestE1rm ?? null, formatE1rm, 'kg')}
              </Text>
            </View>
            <View style={[styles.changeTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.changeLabel, { color: colors.textTertiary }]}>Volume</Text>
              <Badge text={trendLabel(exercise.volumeTrend)} variant={badgeFor(exercise.volumeTrend)} size="sm" />
              <Text style={[styles.changeDetail, { color: colors.textSecondary }]}>
                {deltaText(exercise.latest?.volume ?? null, exercise.previous?.volume ?? null, formatKg, 'kg·reps')}
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Personal records</Text>
          <View style={styles.recordGrid}>
            <RecordBlock title="Heaviest set" record={exercise.records.heaviestSet} format={formatKg} unit="kg" />
            <RecordBlock title="Most reps" record={exercise.records.mostReps} format={(value) => String(value)} unit="" />
            <RecordBlock title="Best e1RM" record={exercise.records.bestE1rm} format={formatE1rm} unit="kg" />
            <RecordBlock title="Best session volume" record={exercise.records.highestSessionVolume} format={formatKg} unit="kg·reps" />
          </View>

          <ProgressLineChart title="Heaviest set" points={weightPoints} suffix="kg" />
          <ProgressLineChart title="Estimated 1RM" points={e1rmPoints} suffix="kg" />

          <Text style={[styles.sectionTitle, { color: colors.text }]}>History</Text>
          {[...exercise.sessions].reverse().map((session) => (
            <Card key={session.sessionId} padding={14} style={styles.historyRow}>
              <Text style={[styles.historyDate, { color: colors.text }]}>{formatDate(session.startedOn)}</Text>
              <Text style={[styles.historyMeta, { color: colors.textSecondary }]}>
                {[
                  session.topWeightKg !== null ? `${formatKg(session.topWeightKg)} kg` : null,
                  session.repsAtTopWeight !== null ? `${session.repsAtTopWeight} reps` : null,
                  session.bestE1rm !== null ? `e1RM ${formatE1rm(session.bestE1rm)}` : null,
                  session.volume !== null ? formatVolume(session.volume) : null,
                  `${session.setCount} sets`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, marginTop: 2 },
  spinner: { marginVertical: 24 },
  block: { marginBottom: 14, gap: 10 },
  errorText: { fontSize: 14, fontWeight: '600' },
  empty: { fontSize: 13, lineHeight: 19 },
  trendRow: { marginBottom: 14 },
  cardEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  cardTitle: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  cardMeta: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  prevLine: { fontSize: 12, marginTop: 8 },
  changeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  changeTile: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  changeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  changeDetail: { fontSize: 12, lineHeight: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10, marginTop: 4 },
  recordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  recordBlock: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  recordTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  recordValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  recordDate: { fontSize: 11, marginTop: 4 },
  historyRow: { marginBottom: 10 },
  historyDate: { fontSize: 15, fontWeight: '700' },
  historyMeta: { fontSize: 13, marginTop: 4, lineHeight: 18 },
});
