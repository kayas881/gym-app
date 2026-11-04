import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import {
  REST_RECOMMENDATION_NOTE,
  formatRestClock,
  restCategoryLabel,
} from '../lib/rest-period';
import { formatKg } from '../lib/workout-progress';
import { useRestTimer } from '../hooks/useRestTimer';
import Button from './ui/Button';
import Card from './ui/Card';

export default function RestTimerCard() {
  const { colors } = useTheme();
  const rest = useRestTimer();
  const { snapshot } = rest;

  if (rest.pendingAmbiguous) {
    return (
      <Card padding={16} style={styles.card}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>REST TIMER</Text>
        <Text style={[styles.prompt, { color: colors.text }]}>{rest.pendingAmbiguous}</Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Say the command again, or dismiss and log a set.
        </Text>
        <Button title="Dismiss" variant="secondary" onPress={rest.dismissAmbiguous} />
      </Card>
    );
  }

  if (snapshot.status === 'idle') {
    return rest.reply ? (
      <Card padding={14} style={styles.card}>
        <Text style={[styles.reply, { color: colors.textSecondary }]}>{rest.reply}</Text>
      </Card>
    ) : null;
  }

  const lastSet = [
    snapshot.weightKg !== null ? `${formatKg(snapshot.weightKg)} kg` : null,
    snapshot.reps !== null ? `${snapshot.reps} reps` : null,
  ]
    .filter(Boolean)
    .join(' × ');

  return (
    <Card padding={16} style={styles.card}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>
        {snapshot.status === 'done' ? 'REST COMPLETE' : 'REST'}
      </Text>
      <Text style={[styles.exercise, { color: colors.text }]} numberOfLines={1}>
        {snapshot.exercise}
      </Text>
      {lastSet ? (
        <Text style={[styles.lastSet, { color: colors.textSecondary }]}>{lastSet}</Text>
      ) : null}

      <Text
        style={[
          styles.clock,
          { color: snapshot.status === 'done' ? colors.primary : colors.text },
        ]}
      >
        {snapshot.status === 'done' ? '0:00' : rest.clock}
      </Text>

      <View style={[styles.track, { backgroundColor: colors.surfaceElevated }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.min(100, Math.max(0, rest.progress * 100))}%`,
              backgroundColor: snapshot.status === 'done' ? colors.success : colors.primary,
            },
          ]}
        />
      </View>

      <Text style={[styles.note, { color: colors.textTertiary }]}>
        Suggested {formatRestClock(snapshot.recommendedSec * 1000)} · {restCategoryLabel(snapshot.category)}
      </Text>
      <Text style={[styles.note, { color: colors.textTertiary }]}>{REST_RECOMMENDATION_NOTE}</Text>

      {rest.reply ? (
        <Text style={[styles.reply, { color: colors.textSecondary }]}>{rest.reply}</Text>
      ) : null}

      {snapshot.status === 'done' ? (
        <View style={styles.row}>
          <Button title="+30s" variant="secondary" onPress={() => rest.addSeconds(30)} />
          <Button title="Done" onPress={rest.dismiss} />
        </View>
      ) : (
        <>
          <View style={styles.row}>
            {snapshot.status === 'paused' ? (
              <Button title="Resume" onPress={rest.resume} />
            ) : (
              <Button title="Pause" variant="secondary" onPress={rest.pause} />
            )}
            <Button title="Skip" variant="ghost" onPress={rest.skip} />
          </View>
          <View style={styles.row}>
            <Button title="+30s" variant="secondary" onPress={() => rest.addSeconds(30)} />
            <Button title="+1 min" variant="secondary" onPress={() => rest.addSeconds(60)} />
            <Button title="Reset" variant="ghost" onPress={rest.reset} />
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 16, gap: 8 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  exercise: { fontSize: 18, fontWeight: '800' },
  lastSet: { fontSize: 13 },
  clock: { fontSize: 52, fontWeight: '800', letterSpacing: -1.5, marginTop: 4 },
  track: { height: 8, borderRadius: 99, overflow: 'hidden', marginTop: 4 },
  fill: { height: 8, borderRadius: 99 },
  note: { fontSize: 11, lineHeight: 16 },
  prompt: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  reply: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
