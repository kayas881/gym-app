import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { useWorkoutProgress } from '../../../hooks/useWorkoutProgress';
import {
  type ExerciseProgress,
  type RecordMark,
  exerciseRecordBanner,
  exerciseRecordBannerLabel,
  formatE1rm,
  formatKg,
  formatVolume,
  trendLabel,
} from '../../../lib/workout-progress';
import { formatDate } from '../../../utils/date';
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import MuscleDistribution from '../../../components/MuscleDistribution';

function trendVariant(trend: ExerciseProgress['overallTrend']): 'success' | 'error' | 'default' | 'warning' {
  if (trend === 'improved') return 'success';
  if (trend === 'declined') return 'error';
  if (trend === 'unchanged') return 'default';
  return 'warning';
}

function RecordTile({
  label,
  record,
  format,
  unit,
}: {
  label: string;
  record: RecordMark | null;
  format: (value: number) => string;
  unit: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.recordTile, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}>
      <Text style={[styles.recordLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.recordValue, { color: colors.text }]}>
        {record ? `${format(record.value)} ${unit}` : '—'}
      </Text>
      <Text style={[styles.recordDate, { color: colors.textSecondary }]}>
        {record ? formatDate(record.startedOn) : 'No saved set yet'}
      </Text>
    </View>
  );
}

export default function MemberProgressScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { stats, exercises, summaries, weekly, loading, error, refresh } = useWorkoutProgress();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const headlineRecords = exercises
    .flatMap((item) => {
      const rows: { label: string; exercise: string; record: RecordMark }[] = [];
      if (item.records.heaviestSet) {
        rows.push({ label: 'Heaviest', exercise: item.displayName, record: item.records.heaviestSet });
      }
      if (item.records.bestE1rm) {
        rows.push({ label: 'Best e1RM', exercise: item.displayName, record: item.records.bestE1rm });
      }
      return rows;
    })
    .sort((a, b) => (a.record.startedOn < b.record.startedOn ? 1 : -1))
    .slice(0, 4);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 96 },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
      }
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: colors.text }]}>Progress</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Personal records from confirmed sets
      </Text>

      {loading && exercises.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}

      {error ? (
        <Card padding={16} style={styles.block}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void refresh()} />
        </Card>
      ) : null}

      <View style={styles.statGrid}>
        <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>{stats.sessionCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Sessions</Text>
        </View>
        <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>{stats.setCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Sets</Text>
        </View>
        <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>{stats.exerciseCount}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Exercises</Text>
        </View>
        <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {stats.totalVolume === null ? '—' : formatVolume(stats.totalVolume)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Volume</Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>This week</Text>
      <Card padding={16} style={styles.block}>
        <Text style={[styles.prMeta, { color: colors.textSecondary }]}>
          {weekly.sessionCount} sessions · {weekly.setCount} sets
          {weekly.volume !== null ? ` · ${formatVolume(weekly.volume)}` : ''}
        </Text>
        {weekly.previous ? (
          <Text style={[styles.prMeta, { color: colors.textTertiary }]}>
            vs last week: {trendLabel(weekly.volumeTrend).toLowerCase()} volume,{' '}
            {trendLabel(weekly.sessionTrend).toLowerCase()} sessions
          </Text>
        ) : (
          <Text style={[styles.prMeta, { color: colors.textTertiary }]}>
            Need another week before a comparison.
          </Text>
        )}
        <View style={styles.weekMuscles}>
          <MuscleDistribution muscles={weekly.muscles} />
        </View>
      </Card>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Personal records</Text>
      {headlineRecords.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Confirm a set with weight or reps and the record will show up here.
        </Text>
      ) : (
        headlineRecords.map((row) => (
          <Card key={`${row.label}-${row.record.clientId}`} padding={14} style={styles.prRow}>
            <Text style={[styles.prEyebrow, { color: colors.primary }]}>{row.label}</Text>
            <Text style={[styles.prName, { color: colors.text }]}>{row.exercise}</Text>
            <Text style={[styles.prMeta, { color: colors.textSecondary }]}>
              {row.label === 'Best e1RM' ? `${formatE1rm(row.record.value)} kg` : `${formatKg(row.record.value)} kg`}
              {' · '}
              {formatDate(row.record.startedOn)}
            </Text>
          </Card>
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Sessions</Text>
        {summaries.length > 0 ? (
          <Text
            style={[styles.seeAll, { color: colors.primary }]}
            onPress={() => router.push('/(member)/sessions')}
          >
            See all
          </Text>
        ) : null}
      </View>
      {summaries.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          A session summary appears after you confirm a set.
        </Text>
      ) : (
        summaries.slice(0, 3).map((summary) => (
          <Card
            key={summary.sessionId}
            padding={14}
            style={styles.prRow}
            onPress={() => router.push(`/(member)/sessions/${summary.sessionId}`)}
          >
            <Text style={[styles.prEyebrow, { color: colors.primary }]}>
              {formatDate(summary.startedOn)}
            </Text>
            <Text style={[styles.prMeta, { color: colors.textSecondary }]}>
              {summary.setCount} sets · {summary.exerciseCount} exercises
              {summary.volume !== null ? ` · ${formatVolume(summary.volume)}` : ''}
              {summary.prs.length > 0
                ? ` · ${summary.prs.length} PR`
                : summary.baselines.length > 0
                  ? ' · baselines'
                  : ''}
            </Text>
          </Card>
        ))
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Exercises</Text>
      {exercises.length === 0 && !loading ? (
        <Card padding={18} style={styles.block}>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No saved workouts yet. Log a set and it will land here after you confirm.
          </Text>
          <Button title="Log a set" onPress={() => router.push('/(member)/session')} />
        </Card>
      ) : (
        exercises.map((item) => {
          const banner = item.latest ? exerciseRecordBanner(item) : null;
          return (
          <Card
            key={item.key}
            padding={16}
            style={styles.exerciseCard}
            onPress={() => router.push(`/(member)/progress/${encodeURIComponent(item.key)}`)}
          >
            <View style={styles.exerciseHeader}>
              <Text style={[styles.exerciseName, { color: colors.text }]}>{item.displayName}</Text>
              <Badge text={trendLabel(item.overallTrend)} variant={trendVariant(item.overallTrend)} size="sm" />
            </View>
            <Text style={[styles.exerciseMeta, { color: colors.textSecondary }]}>
              {item.latest
                ? [
                    item.latest.topWeightKg !== null ? `${formatKg(item.latest.topWeightKg)} kg` : null,
                    item.latest.repsAtTopWeight !== null ? `${item.latest.repsAtTopWeight} reps` : null,
                    formatDate(item.latest.startedOn),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'No session yet'}
            </Text>
            {banner ? (
              <Text
                style={[
                  styles.freshPr,
                  {
                    color:
                      banner === 'new_pr'
                        ? colors.primary
                        : banner === 'baseline'
                          ? colors.textSecondary
                          : colors.textTertiary,
                  },
                ]}
              >
                {exerciseRecordBannerLabel(banner)}
              </Text>
            ) : null}
            <View style={styles.miniRecords}>
              <RecordTile label="Heaviest" record={item.records.heaviestSet} format={formatKg} unit="kg" />
              <RecordTile label="Most reps" record={item.records.mostReps} format={(value) => String(value)} unit="" />
            </View>
          </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 18 },
  spinner: { marginVertical: 20 },
  block: { marginBottom: 16, gap: 12 },
  errorText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  statTile: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '700', marginTop: 4, letterSpacing: 0.3 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10, marginTop: 6 },
  seeAll: { fontSize: 13, fontWeight: '700' },
  weekMuscles: { marginTop: 12 },
  empty: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
  prRow: { marginBottom: 10 },
  prEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  prName: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  prMeta: { fontSize: 13, marginTop: 4 },
  exerciseCard: { marginBottom: 12 },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  exerciseName: { fontSize: 17, fontWeight: '700', flex: 1 },
  exerciseMeta: { fontSize: 13, marginTop: 6 },
  freshPr: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  miniRecords: { flexDirection: 'row', gap: 8, marginTop: 12 },
  recordTile: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10 },
  recordLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  recordValue: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  recordDate: { fontSize: 11, marginTop: 4 },
});
