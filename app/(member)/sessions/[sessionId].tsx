import React from 'react';
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
import { useToday } from '../../../hooks/useToday';
import { useWorkoutProgress } from '../../../hooks/useWorkoutProgress';
import {
  formatAverageReps,
  formatDurationMs,
  formatE1rm,
  formatKg,
  formatVolume,
  prKindLabel,
  trendLabel,
} from '../../../lib/workout-progress';
import { formatDate } from '../../../utils/date';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import MuscleDistribution from '../../../components/MuscleDistribution';
import { useAppAuth } from '../../../lib/auth';
import { comparePlanToSets, type PlanSnapshot } from '../../../lib/workout-plan';
import { fetchSessionPlan } from '../../../lib/workout-routines';

export default function SessionSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const todayKey = useToday();
  const params = useLocalSearchParams<{ sessionId: string | string[] }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const { getSummary, sessions, loading, error, refresh } = useWorkoutProgress();
  const { supabase } = useAppAuth();
  const summary = sessionId ? getSummary(sessionId) : null;
  const completedToday = summary?.startedOn === todayKey;
  const [plan, setPlan] = React.useState<PlanSnapshot | null>(null);
  React.useEffect(() => {
    if (!sessionId) return;
    void fetchSessionPlan(supabase, sessionId).then(setPlan).catch(() => setPlan(null));
  }, [sessionId, supabase]);
  const sessionSets = sessions.find((item) => item.id === sessionId)?.sets ?? [];
  const planVs = plan
    ? comparePlanToSets(
        plan,
        sessionSets.map((item) => ({
          exercise: item.exercise,
          weightKg: item.weightKg,
          reps: item.reps,
        })),
      )
    : null;

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
          onPress={() => router.back()}
          style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            {completedToday ? 'WORKOUT COMPLETED' : 'SESSION SUMMARY'}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {summary ? formatDate(summary.startedOn) : 'Workout summary'}
          </Text>
        </View>
      </View>

      {loading && !summary ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}

      {error ? (
        <Card padding={16} style={styles.block}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void refresh()} />
        </Card>
      ) : null}

      {summary ? (
        <>
          {planVs ? (
            <Card padding={16} style={styles.item}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 0 }]}>
                Planned vs completed
              </Text>
              <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                {planVs.completedExercises}/{planVs.plannedExercises} exercises ·{' '}
                {planVs.completedSets}/{planVs.plannedSets} sets
                {planVs.skippedExercises ? ` · ${planVs.skippedExercises} skipped` : ''}
              </Text>
              {planVs.lines.map((line) => (
                <Text key={line.key} style={[styles.itemMeta, { color: colors.textSecondary }]}>
                  {line.name}: {line.completedSets}/{line.plannedSets}
                  {line.skipped ? ' · skipped' : ''}
                </Text>
              ))}
            </Card>
          ) : null}
          <View style={styles.statGrid}>
            <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {summary.volume === null ? '—' : formatVolume(summary.volume)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Volume</Text>
            </View>
            <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>{summary.exerciseCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Exercises</Text>
            </View>
            <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>{summary.setCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Sets</Text>
            </View>
            <View style={[styles.statTile, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {summary.durationMs === null ? '—' : formatDurationMs(summary.durationMs)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Duration</Text>
            </View>
          </View>

          <Text style={[styles.metaLine, { color: colors.textSecondary }]}>
            {summary.averageReps === null
              ? 'Average reps unavailable'
              : `${formatAverageReps(summary.averageReps)} reps / set`}
            {summary.prs.length > 0 ? ` · ${summary.prs.length} personal records` : ''}
            {summary.prs.length === 0 && summary.baselines.length > 0 ? ' · baselines established' : ''}
          </Text>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Personal records</Text>
          {summary.prs.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {summary.baselines.length > 0
                ? 'No records broken. Baselines from this session are listed below.'
                : 'No new records this session.'}
            </Text>
          ) : (
            summary.prs.map((pr) => (
              <Card key={`${pr.kind}-${pr.exercise}`} padding={14} style={styles.item}>
                <Text style={[styles.prKind, { color: colors.primary }]}>{prKindLabel(pr.kind)}</Text>
                <Text style={[styles.itemTitle, { color: colors.text }]}>{pr.exercise}</Text>
                <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                  {pr.kind === 'most_reps'
                    ? `${pr.value} reps`
                    : pr.kind === 'session_volume'
                      ? formatVolume(pr.value)
                      : `${formatKg(pr.value)} kg`}
                </Text>
              </Card>
            ))
          )}

          {summary.baselines.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Baselines established</Text>
              {summary.baselines.map((mark) => (
                <Card key={`base-${mark.kind}-${mark.exercise}`} padding={14} style={styles.item}>
                  <Text style={[styles.prKind, { color: colors.textTertiary }]}>{prKindLabel(mark.kind)}</Text>
                  <Text style={[styles.itemTitle, { color: colors.text }]}>{mark.exercise}</Text>
                  <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                    {mark.kind === 'most_reps'
                      ? `${mark.value} reps`
                      : mark.kind === 'session_volume'
                        ? formatVolume(mark.value)
                        : `${formatKg(mark.value)} kg`}
                  </Text>
                </Card>
              ))}
            </>
          ) : null}

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Exercises</Text>
          {summary.exercises.map((line) => (
            <Card key={line.key} padding={14} style={styles.item}>
              <View style={styles.itemHeader}>
                <Text style={[styles.itemTitle, { color: colors.text }]}>{line.displayName}</Text>
                {line.performance !== 'insufficient' ? (
                  <Badge
                    text={trendLabel(line.performance)}
                    size="sm"
                    variant={
                      line.performance === 'improved'
                        ? 'success'
                        : line.performance === 'declined'
                          ? 'error'
                          : 'default'
                    }
                  />
                ) : null}
              </View>
              <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                {[
                  `${line.setCount} sets`,
                  line.totalReps !== null ? `${line.totalReps} reps` : null,
                  line.volume !== null ? formatVolume(line.volume) : null,
                  line.topWeightKg !== null ? `heaviest ${formatKg(line.topWeightKg)} kg` : null,
                  line.bestE1rm !== null ? `e1RM ${formatE1rm(line.bestE1rm)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Card>
          ))}

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Muscle groups</Text>
          <Card padding={16} style={styles.item}>
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              Volume is counted on the primary muscle only.
            </Text>
            <MuscleDistribution muscles={summary.muscles} />
          </Card>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Performance</Text>
          <Card padding={16} style={styles.item}>
            {summary.highlights.highestVolumeExercise ? (
              <Text style={[styles.highlight, { color: colors.text }]}>
                Highest volume: {summary.highlights.highestVolumeExercise}
              </Text>
            ) : null}
            <Text style={[styles.highlight, { color: colors.success }]}>
              Improved: {summary.highlights.improved.join(', ') || 'none'}
            </Text>
            <Text style={[styles.highlight, { color: colors.error }]}>
              Declined: {summary.highlights.declined.join(', ') || 'none'}
            </Text>
            <Text style={[styles.highlight, { color: colors.textSecondary }]}>
              Unchanged: {summary.highlights.unchanged.join(', ') || 'none'}
            </Text>
          </Card>
        </>
      ) : !loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No saved sets in this session.
        </Text>
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
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  spinner: { marginVertical: 24 },
  block: { marginBottom: 16, gap: 12 },
  errorText: { fontSize: 14, fontWeight: '600' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  statTile: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  metaLine: { fontSize: 13, marginBottom: 18 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10, marginTop: 8 },
  item: { marginBottom: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  itemTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  itemMeta: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  prKind: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  hint: { fontSize: 11, marginBottom: 12 },
  highlight: { fontSize: 13, lineHeight: 20 },
  empty: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
});
