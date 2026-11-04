import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { useWorkoutRoutines } from '../../../hooks/useWorkoutRoutines';
import { isDuplicateExerciseName, searchLibrary } from '../../../lib/exercise-library';
import { createCustomExercise } from '../../../lib/workout-routines';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';

export default function ExerciseLibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const data = useWorkoutRoutines();
  const [query, setQuery] = useState('');
  const [customName, setCustomName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const hits = useMemo(() => searchLibrary(query, data.library), [query, data.library]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 36 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.back, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Exercise library</Text>
      </View>

      <Input label="Search" value={query} onChangeText={setQuery} placeholder="Name, muscle, equipment" />
      {hits.map((item) => (
        <Card key={item.key} padding={14} style={styles.card}>
          <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {item.primary}
            {item.secondary.length ? ` + ${item.secondary.join(', ')}` : ''}
            {' · '}
            {item.category}
            {' · '}
            {item.equipment}
            {item.custom ? ' · custom' : ''}
          </Text>
          <Text style={[styles.help, { color: colors.textTertiary }]}>{item.instructions}</Text>
        </Card>
      ))}

      <Text style={[styles.section, { color: colors.text }]}>Add a custom exercise</Text>
      <Input label="Name" value={customName} onChangeText={setCustomName} placeholder="Landmine press" />
      {message ? <Text style={[styles.help, { color: colors.textSecondary }]}>{message}</Text> : null}
      <Button
        title="Save custom exercise"
        onPress={() => {
          if (!data.profileId || !customName.trim()) return;
          if (isDuplicateExerciseName(customName, data.library)) {
            setMessage('That name is already in the library.');
            return;
          }
          void createCustomExercise(data.supabase, data.profileId, {
            name: customName,
            primary: 'unclassified',
            secondary: [],
            category: 'compound',
            equipment: 'other',
            instructions: '',
          })
            .then(() => {
              setCustomName('');
              setMessage('Saved. It will show in search.');
              void data.refresh();
            })
            .catch(() => setMessage('Could not save that exercise.'));
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: { fontSize: 24, fontWeight: '800' },
  card: { marginBottom: 4 },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 4 },
  help: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 10 },
});
