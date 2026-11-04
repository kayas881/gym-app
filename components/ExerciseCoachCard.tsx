import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import Button from './ui/Button';
import {
  type SessionCoach,
  formatBestE1rm,
  formatLastRir,
  formatLastTime,
  formatSuggested,
  insightLabel,
  suggestionChangesTarget,
} from '../lib/workout-coach';
import { trendLabel } from '../lib/workout-progress';
import type { CoachingDecision, PlannedExercise } from '../lib/workout-plan';

type Props = {
  plan: PlannedExercise;
  coach: SessionCoach;
  decision: CoachingDecision | null;
  onAccept: () => void;
  onIgnore: () => void;
  onEdit: (weightKg: number | null, reps: number | null) => void;
};

export default function ExerciseCoachCard({
  plan,
  coach,
  decision,
  onAccept,
  onIgnore,
  onEdit,
}: Props) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(
    coach.suggestedWeightKg === null ? '' : String(coach.suggestedWeightKg),
  );
  const [reps, setReps] = useState(coach.suggestedReps === null ? '' : String(coach.suggestedReps));

  const lastRir = formatLastRir(coach.last);
  const best = formatBestE1rm(coach.bestE1rm);
  const canAct = !decision && (coach.reliable || suggestionChangesTarget(plan, coach.suggestedWeightKg, coach.suggestedReps));

  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.line, { color: colors.textSecondary }]}>
        Last time: {formatLastTime(coach.last)}
        {lastRir ? ` · ${lastRir}` : ''}
      </Text>
      {coach.last ? (
        <Text style={[styles.line, { color: colors.textTertiary }]}>
          {coach.last.completeSetCount} confirmed set{coach.last.completeSetCount === 1 ? '' : 's'}
          {coach.last.workingWeightKg !== null ? ` · previous ${coach.last.workingWeightKg} kg` : ''}
        </Text>
      ) : null}
      <Text style={[styles.line, { color: colors.textSecondary }]}>
        Suggested: {formatSuggested(coach.suggestedWeightKg, coach.suggestedReps)}
      </Text>
      <Text style={[styles.line, { color: colors.textTertiary }]}>
        Reason: {coach.reason}
      </Text>
      <Text style={[styles.line, { color: colors.textTertiary }]}>
        {insightLabel(coach.insight)}
        {coach.trend !== 'insufficient' ? ` · ${trendLabel(coach.trend)}` : ''}
        {best ? ` · best e1RM ${best}` : ''}
      </Text>

      {decision ? (
        <Text style={[styles.status, { color: colors.textSecondary }]}>
          {decision.status === 'ignored'
            ? 'Suggestion ignored'
            : `Using ${formatSuggested(decision.weightKg, decision.reps)}`}
        </Text>
      ) : null}

      {editing ? (
        <View style={styles.editRow}>
          <TextInput
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            placeholder="kg"
            placeholderTextColor={colors.textTertiary}
            style={[styles.field, { color: colors.text, borderColor: colors.border }]}
          />
          <TextInput
            value={reps}
            onChangeText={setReps}
            keyboardType="number-pad"
            placeholder="reps"
            placeholderTextColor={colors.textTertiary}
            style={[styles.field, { color: colors.text, borderColor: colors.border }]}
          />
          <Button
            title="Save"
            size="sm"
            onPress={() => {
              const nextWeight = weight.trim() === '' ? null : Number(weight);
              const nextReps = reps.trim() === '' ? null : Number(reps);
              if (nextWeight !== null && (!Number.isFinite(nextWeight) || nextWeight < 0)) return;
              if (nextReps !== null && (!Number.isFinite(nextReps) || nextReps < 1)) return;
              onEdit(nextWeight, nextReps === null ? null : Math.round(nextReps));
              setEditing(false);
            }}
          />
          <Button title="Cancel" size="sm" variant="ghost" onPress={() => setEditing(false)} />
        </View>
      ) : canAct ? (
        <View style={styles.actions}>
          <Button title="Accept" size="sm" onPress={onAccept} />
          <Button
            title="Edit"
            size="sm"
            variant="secondary"
            onPress={() => {
              setWeight(coach.suggestedWeightKg === null ? '' : String(coach.suggestedWeightKg));
              setReps(coach.suggestedReps === null ? '' : String(coach.suggestedReps));
              setEditing(true);
            }}
          />
          <Button title="Ignore" size="sm" variant="ghost" onPress={onIgnore} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 3,
    marginTop: 4,
  },
  line: { fontSize: 12, lineHeight: 16 },
  status: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  editRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  field: {
    minWidth: 72,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
});
