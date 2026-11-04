import React, { useEffect, useMemo, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import {
  type DraftErrors,
  type DraftFields,
  type UncertainField,
  type WorkoutSet,
  fieldsFromWorkoutSet,
} from '../lib/workout-set';
import Button from './ui/Button';
import Card from './ui/Card';
import Input from './ui/Input';

type Props = {
  draft: WorkoutSet;
  transcript: string | null;
  saving: boolean;
  onConfirm: (fields: DraftFields) => Promise<{ ok: true } | { ok: false; errors?: DraftErrors }>;
  onCancel: () => void;
};

const FIELD_LABEL: Record<UncertainField, string> = {
  exercise: 'Exercise',
  weightKg: 'Weight (kg)',
  reps: 'Reps',
  rir: 'RIR',
};

export default function WorkoutSetConfirmCard({
  draft,
  transcript,
  saving,
  onConfirm,
  onCancel,
}: Props) {
  const { colors } = useTheme();
  const [fields, setFields] = useState<DraftFields>(() => fieldsFromWorkoutSet(draft));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [touched, setTouched] = useState<Partial<Record<UncertainField, boolean>>>({});

  useEffect(() => {
    setFields(fieldsFromWorkoutSet(draft));
    setErrors({});
    setTouched({});
  }, [draft]);

  const uncertain = useMemo(() => new Set(draft.uncertainFields), [draft.uncertainFields]);

  const hintFor = (field: UncertainField): string | undefined => {
    if (errors[field]) return errors[field];
    if (uncertain.has(field) && !touched[field]) return 'Check this — it was unclear from speech.';
    return undefined;
  };

  const update = (field: UncertainField, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const submit = async () => {
    const result = await onConfirm(fields);
    if (!result.ok && result.errors) {
      setErrors(result.errors);
    }
  };

  return (
    <Card padding={18} style={styles.card}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>CONFIRM THIS SET</Text>
      <Text style={[styles.title, { color: colors.text }]}>Check the numbers before they stay</Text>
      {transcript ? (
        <Text style={[styles.transcript, { color: colors.textSecondary }]}>
          Heard: “{transcript}”
        </Text>
      ) : null}

      <Input
        label={FIELD_LABEL.exercise}
        value={fields.exercise}
        onChangeText={(text) => update('exercise', text)}
        autoCapitalize="words"
        error={hintFor('exercise')}
        placeholder="Bench press"
      />
      <Input
        label={FIELD_LABEL.weightKg}
        value={fields.weightKg}
        onChangeText={(text) => update('weightKg', text)}
        keyboardType="decimal-pad"
        error={hintFor('weightKg')}
        placeholder="40"
      />
      <Input
        label={FIELD_LABEL.reps}
        value={fields.reps}
        onChangeText={(text) => update('reps', text)}
        keyboardType="number-pad"
        error={hintFor('reps')}
        placeholder="10"
      />
      <Input
        label={FIELD_LABEL.rir}
        value={fields.rir}
        onChangeText={(text) => update('rir', text)}
        keyboardType="number-pad"
        error={hintFor('rir')}
        placeholder="2"
      />

      <Button
        title="Save set"
        onPress={() => {
          void submit();
        }}
        loading={saving}
        disabled={saving}
        fullWidth
        style={styles.save}
      />
      <Button
        title="Discard"
        onPress={onCancel}
        variant="ghost"
        disabled={saving}
        fullWidth
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 20 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, marginBottom: 8 },
  transcript: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  save: { marginTop: 4, marginBottom: 8 },
});
