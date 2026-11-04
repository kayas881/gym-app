import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import {
  type SessionSummary,
  formatDurationMs,
  formatE1rm,
  formatKg,
  formatVolume,
  prKindLabel,
  trendLabel,
} from '../lib/workout-progress';
import { formatDate } from '../utils/date';
import Badge from './ui/Badge';
import Card from './ui/Card';

function trendVariant(trend: SessionSummary['volumeTrend']): 'success' | 'error' | 'default' | 'warning' {
  if (trend === 'improved') return 'success';
  if (trend === 'declined') return 'error';
  if (trend === 'unchanged') return 'default';
  return 'warning';
}

type Props = {
  summary: SessionSummary;
  compact?: boolean;
  onPress?: () => void;
};

export default function SessionSummaryCard({ summary, compact = false, onPress }: Props) {
  const { colors } = useTheme();

  return (
    <Card padding={16} style={styles.card} onPress={onPress}>
      <View style={styles.topRow}>
        <View style={styles.topCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>SESSION SUMMARY</Text>
          <Text style={[styles.date, { color: colors.text }]}>{formatDate(summary.startedOn)}</Text>
        </View>
        <Badge text={trendLabel(summary.volumeTrend)} variant={trendVariant(summary.volumeTrend)} size="sm" />
      </View>

      <Text style={[styles.headline, { color: colors.textSecondary }]}>
        {summary.setCount} sets · {summary.exerciseCount} exercises
        {summary.volume !== null ? ` · ${formatVolume(summary.volume)}` : ''}
        {summary.durationMs !== null ? ` · ${formatDurationMs(summary.durationMs)}` : ''}
      </Text>

      {summary.prs.length > 0 ? (
        <Text style={[styles.prLine, { color: colors.primary }]}>
          {summary.prs.length === 1
            ? `New ${prKindLabel(summary.prs[0].kind)} · ${summary.prs[0].exercise}`
            : `${summary.prs.length} personal records this session`}
        </Text>
      ) : summary.baselines.length > 0 ? (
        <Text style={[styles.prLine, { color: colors.textSecondary }]}>Baselines established</Text>
      ) : null}

      {!compact ? (
        <>
          {summary.facts.map((fact) => (
            <Text key={fact} style={[styles.fact, { color: colors.textSecondary }]}>
              {fact}
            </Text>
          ))}

          {summary.exercises.map((line) => (
            <View key={line.key} style={[styles.liftRow, { borderColor: colors.border }]}>
              <Text style={[styles.liftName, { color: colors.text }]}>{line.displayName}</Text>
              <Text style={[styles.liftMeta, { color: colors.textSecondary }]}>
                {[
                  `${line.setCount} sets`,
                  line.topWeightKg !== null ? `${formatKg(line.topWeightKg)} kg` : null,
                  line.topReps !== null ? `${line.topReps} reps` : null,
                  line.volume !== null ? formatVolume(line.volume) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}

          {summary.bestE1rm !== null ? (
            <Text style={[styles.e1rm, { color: colors.textTertiary }]}>
              Best estimated 1RM {formatE1rm(summary.bestE1rm)} kg
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  topCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  date: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  headline: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  prLine: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  fact: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  liftRow: { borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  liftName: { fontSize: 15, fontWeight: '700' },
  liftMeta: { fontSize: 12, marginTop: 3 },
  e1rm: { fontSize: 12, marginTop: 10 },
});
