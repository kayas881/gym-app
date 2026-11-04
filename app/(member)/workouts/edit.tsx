import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../../constants/keyboard';
import { useWorkoutRoutines } from '../../../hooks/useWorkoutRoutines';
import { recommendedRestSec } from '../../../lib/rest-period';
import {
  formatExerciseTarget,
  moveItem,
  type PlannedExercise,
} from '../../../lib/workout-plan';
import {
  addRoutineDay,
  addRoutineExercise,
  deleteRoutineDay,
  deleteRoutineExercise,
  renameRoutineDay,
  reorderRoutineDays,
  reorderRoutineExercises,
  updateRoutineExercise,
  updateRoutineMeta,
} from '../../../lib/workout-routines';
import type { LibraryExercise } from '../../../lib/exercise-library';
import type { RoutineDay, RoutineExercise, WorkoutRoutine } from '../../../lib/workout-routines';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
import ExercisePicker from '../../../components/ExercisePicker';

export default function EditRoutineScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const routineId = Array.isArray(params.id) ? params.id[0] : params.id;
  const data = useWorkoutRoutines();
  const routine = data.routines.find((item) => item.id === routineId) ?? null;
  const [name, setName] = useState(routine?.name ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [selectedDayId, setSelectedDayId] = useState<string | null>(routine?.days[0]?.id ?? null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const routineRef = useRef<WorkoutRoutine | null>(routine);
  const selectedRef = useRef<string | null>(selectedDayId);
  const persistQueue = useRef(Promise.resolve());
  routineRef.current = routine;
  selectedRef.current = selectedDayId;

  useEffect(() => {
    if (routine) {
      setName(routine.name);
      setDescription(routine.description);
    }
  }, [routine?.id, routine?.name, routine?.description]);

  useEffect(() => {
    if (!routine) return;
    if (selectedDayId?.startsWith('temp-')) return;
    if (!selectedDayId || !routine.days.some((day) => day.id === selectedDayId)) {
      setSelectedDayId(routine.days[0]?.id ?? null);
    }
  }, [routine, selectedDayId]);

  const selectedDay = useMemo(
    () => routine?.days.find((day) => day.id === selectedDayId) ?? routine?.days[0] ?? null,
    [routine, selectedDayId],
  );
  const addedKeys = useMemo(
    () => new Set((selectedDay?.exercises ?? []).map((item) => item.key)),
    [selectedDay],
  );

  if (!routine || !selectedDay) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 20 }]}>
        <Text style={{ color: colors.textSecondary, padding: 16 }}>
          {data.loading ? 'Loading routine…' : 'Routine not found.'}
        </Text>
      </View>
    );
  }

  const patch = (updater: (current: WorkoutRoutine) => WorkoutRoutine) => {
    data.patchRoutines((list) =>
      list.map((item) => (item.id === routine.id ? updater(item) : item)),
    );
  };

  const enqueue = (work: () => Promise<void>) => {
    persistQueue.current = persistQueue.current
      .then(work)
      .catch(() => {
        void data.refresh({ silent: true });
      });
  };

  const saveMeta = () => {
    void updateRoutineMeta(data.supabase, routine.id, { name, description });
  };

  const finish = () => {
    saveMeta();
    router.back();
  };

  const addFromLibrary = (item: LibraryExercise) => {
    const dayId = selectedRef.current ?? selectedDay.id;
    if (addedKeys.has(item.key)) return;
    const planned: PlannedExercise = {
      key: item.key,
      name: item.name,
      targetSets: 3,
      repsMin: 8,
      repsMax: 12,
      weightKg: null,
      rir: null,
      restSeconds: recommendedRestSec(item.name),
      notes: '',
    };
    const tempId = `temp-ex-${Date.now()}-${item.key}`;
    const sortOrder = selectedDay.exercises.length;
    patch((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.id === dayId
          ? { ...day, exercises: [...day.exercises, { ...planned, id: tempId }] }
          : day,
      ),
    }));
    enqueue(async () => {
      const latest = routineRef.current;
      const day = latest?.days.find((row) => row.id === dayId || row.exercises.some((ex) => ex.id === tempId));
      if (!day || day.id.startsWith('temp-')) {
        throw new Error('day_not_ready');
      }
      const realId = await addRoutineExercise(
        data.supabase,
        day.id,
        planned,
        sortOrder,
      );
      patch((current) => ({
        ...current,
        days: current.days.map((row) =>
          row.id === day.id
            ? {
                ...row,
                exercises: row.exercises.map((ex) => (ex.id === tempId ? { ...ex, id: realId } : ex)),
              }
            : row,
        ),
      }));
    });
  };

  const moveExercise = (from: number, to: number) => {
    const dayId = selectedDay.id;
    const ids = moveItem(selectedDay.exercises.map((item) => item.id), from, to);
    patch((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.id === dayId ? { ...day, exercises: moveItem(day.exercises, from, to) } : day,
      ),
    }));
    enqueue(() => reorderRoutineExercises(data.supabase, ids));
  };

  const removeExercise = (exerciseId: string) => {
    const dayId = selectedDay.id;
    patch((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.id === dayId
          ? { ...day, exercises: day.exercises.filter((item) => item.id !== exerciseId) }
          : day,
      ),
    }));
    if (!exerciseId.startsWith('temp-')) {
      enqueue(() => deleteRoutineExercise(data.supabase, exerciseId));
    }
  };

  const saveExercise = (exercise: RoutineExercise) => {
    patch((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.id === selectedDay.id
          ? {
              ...day,
              exercises: day.exercises.map((item) => (item.id === exercise.id ? exercise : item)),
            }
          : day,
      ),
    }));
    if (!exercise.id.startsWith('temp-')) {
      enqueue(() => updateRoutineExercise(data.supabase, exercise.id, exercise));
    }
  };

  const addDay = () => {
    const tempId = `temp-day-${Date.now()}`;
    const label = `Day ${routine.days.length + 1}`;
    const sortOrder = routine.days.length;
    const nextDay: RoutineDay = { id: tempId, label, sortOrder, exercises: [] };
    patch((current) => ({ ...current, days: [...current.days, nextDay] }));
    setSelectedDayId(tempId);
    selectedRef.current = tempId;
    setPickerOpen(true);
    setCopyOpen(false);
    enqueue(async () => {
      const realId = await addRoutineDay(data.supabase, routine.id, label, sortOrder);
      patch((current) => ({
        ...current,
        days: current.days.map((day) => (day.id === tempId ? { ...day, id: realId } : day)),
      }));
      if (selectedRef.current === tempId) {
        selectedRef.current = realId;
        setSelectedDayId(realId);
      }
    });
  };

  const removeDay = (dayId: string) => {
    if (routine.days.length <= 1) return;
    const remaining = routine.days.filter((day) => day.id !== dayId);
    patch((current) => ({ ...current, days: current.days.filter((day) => day.id !== dayId) }));
    const nextId = remaining[0]?.id ?? null;
    setSelectedDayId(nextId);
    selectedRef.current = nextId;
    if (!dayId.startsWith('temp-')) {
      enqueue(() => deleteRoutineDay(data.supabase, dayId));
    }
  };

  const moveDay = (from: number, to: number) => {
    const ids = moveItem(routine.days.map((item) => item.id), from, to);
    patch((current) => ({ ...current, days: moveItem(current.days, from, to) }));
    enqueue(() => reorderRoutineDays(data.supabase, ids));
  };

  const copyFrom = (source: RoutineDay) => {
    const destId = selectedDay.id;
    const already = new Set(selectedDay.exercises.map((item) => item.key));
    const incoming = source.exercises.filter((item) => !already.has(item.key));
    if (incoming.length === 0) {
      setCopyOpen(false);
      return;
    }
    const temps = incoming.map((item, index) => ({
      ...item,
      id: `temp-copy-${Date.now()}-${index}-${item.key}`,
    }));
    patch((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.id === destId ? { ...day, exercises: [...day.exercises, ...temps] } : day,
      ),
    }));
    setCopyOpen(false);
    enqueue(async () => {
      const latest = routineRef.current;
      const dest = latest?.days.find((day) => day.id === destId);
      if (!dest || dest.id.startsWith('temp-')) throw new Error('day_not_ready');
      for (const [index, exercise] of incoming.entries()) {
        const realId = await addRoutineExercise(
          data.supabase,
          dest.id,
          exercise,
          dest.exercises.length - incoming.length + index,
        );
        const tempId = temps[index]?.id;
        patch((current) => ({
          ...current,
          days: current.days.map((day) =>
            day.id === dest.id
              ? {
                  ...day,
                  exercises: day.exercises.map((row) => (row.id === tempId ? { ...row, id: realId } : row)),
                }
              : day,
          ),
        }));
      }
    });
  };

  const dayIndex = routine.days.findIndex((day) => day.id === selectedDay.id);
  const otherDays = routine.days.filter((day) => day.id !== selectedDay.id);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 36 },
        ]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={finish}
            style={[styles.back, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Edit routine</Text>
          <Button title="Done" size="sm" onPress={finish} />
        </View>

        <Input label="Name" value={name} onChangeText={setName} onBlur={saveMeta} />
        <Input label="Description" value={description} onChangeText={setDescription} onBlur={saveMeta} />

        <Text style={[styles.section, { color: colors.text }]}>Training days</Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          Each day is one workout in this routine. Exercises you add go on the selected day.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayChips}
          keyboardShouldPersistTaps="handled"
        >
          {routine.days.map((day) => {
            const selected = day.id === selectedDay.id;
            return (
              <TouchableOpacity
                key={day.id}
                onPress={() => {
                  setSelectedDayId(day.id);
                  selectedRef.current = day.id;
                  setPickerOpen(false);
                  setCopyOpen(false);
                  setExpandedId(null);
                }}
                style={[
                  styles.dayChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.surfaceElevated,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.dayChipText, { color: selected ? '#11170B' : colors.text }]}>
                  {day.label}
                </Text>
                <Text style={[styles.dayChipMeta, { color: selected ? '#11170B' : colors.textTertiary }]}>
                  {day.exercises.length} lift{day.exercises.length === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={addDay}
            style={[styles.dayChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={[styles.dayChipText, { color: colors.text }]}>+ Day</Text>
          </TouchableOpacity>
        </ScrollView>

        <Card padding={14} style={styles.dayCard}>
          <DayLabelField
            label={selectedDay.label}
            onSave={(text) => {
              if (!text.trim() || text === selectedDay.label) return;
              const dayId = selectedDay.id;
              patch((current) => ({
                ...current,
                days: current.days.map((day) => (day.id === dayId ? { ...day, label: text } : day)),
              }));
              if (!dayId.startsWith('temp-')) {
                enqueue(() => renameRoutineDay(data.supabase, dayId, text));
              }
            }}
          />
          <View style={styles.row}>
            <Button
              title="Up"
              size="sm"
              variant="ghost"
              disabled={dayIndex <= 0}
              onPress={() => moveDay(dayIndex, dayIndex - 1)}
            />
            <Button
              title="Down"
              size="sm"
              variant="ghost"
              disabled={dayIndex === routine.days.length - 1}
              onPress={() => moveDay(dayIndex, dayIndex + 1)}
            />
            {routine.days.length > 1 ? (
              <Button title="Remove day" size="sm" variant="ghost" onPress={() => removeDay(selectedDay.id)} />
            ) : null}
          </View>

          {selectedDay.exercises.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              No exercises on this day yet.
            </Text>
          ) : null}

          {selectedDay.exercises.map((exercise, index) => {
            const open = expandedId === exercise.id;
            return (
              <View key={exercise.id} style={[styles.exRow, { borderColor: colors.border }]}>
                <TouchableOpacity onPress={() => setExpandedId(open ? null : exercise.id)}>
                  <Text style={[styles.exName, { color: colors.text }]}>{exercise.name}</Text>
                  <Text style={[styles.exMeta, { color: colors.textSecondary }]}>
                    {formatExerciseTarget(exercise)}
                  </Text>
                  <Text style={[styles.exToggle, { color: colors.textTertiary }]}>
                    {open ? 'Hide targets' : 'Edit targets'}
                  </Text>
                </TouchableOpacity>
                <View style={styles.row}>
                  <Button
                    title="Up"
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    onPress={() => moveExercise(index, index - 1)}
                  />
                  <Button
                    title="Down"
                    size="sm"
                    variant="ghost"
                    disabled={index === selectedDay.exercises.length - 1}
                    onPress={() => moveExercise(index, index + 1)}
                  />
                  <Button title="Remove" size="sm" variant="ghost" onPress={() => removeExercise(exercise.id)} />
                </View>
                {open ? <ExerciseTargetFields exercise={exercise} onSave={saveExercise} /> : null}
              </View>
            );
          })}

          <Button
            title={pickerOpen ? 'Hide exercise list' : 'Add exercise'}
            variant="secondary"
            onPress={() => {
              setPickerOpen((value) => !value);
              setCopyOpen(false);
            }}
          />
          {pickerOpen ? (
            <ExercisePicker library={data.library} addedKeys={addedKeys} onPick={addFromLibrary} />
          ) : null}

          {otherDays.length > 0 ? (
            <>
              <Button
                title={copyOpen ? 'Hide copy options' : 'Copy exercises from another day'}
                variant="ghost"
                onPress={() => {
                  setCopyOpen((value) => !value);
                  setPickerOpen(false);
                }}
              />
              {copyOpen ? (
                <>
                  <Text style={[styles.hint, { color: colors.textTertiary }]}>
                    Copies lifts onto {selectedDay.label}. Already-added lifts are skipped.
                  </Text>
                  {otherDays.map((day) => (
                    <Button
                      key={day.id}
                      title={`Copy from ${day.label} (${day.exercises.length})`}
                      variant="secondary"
                      size="sm"
                      onPress={() => copyFrom(day)}
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DayLabelField({ label, onSave }: { label: string; onSave: (value: string) => void }) {
  const [value, setValue] = React.useState(label);
  React.useEffect(() => {
    setValue(label);
  }, [label]);
  return <Input label="Day name" value={value} onChangeText={setValue} onBlur={() => onSave(value)} />;
}

function ExerciseTargetFields({
  exercise,
  onSave,
}: {
  exercise: PlannedExercise & { id: string };
  onSave: (next: PlannedExercise & { id: string }) => void;
}) {
  const [sets, setSets] = React.useState(String(exercise.targetSets));
  const [repsMin, setRepsMin] = React.useState(exercise.repsMin === null ? '' : String(exercise.repsMin));
  const [repsMax, setRepsMax] = React.useState(exercise.repsMax === null ? '' : String(exercise.repsMax));
  const [weight, setWeight] = React.useState(exercise.weightKg === null ? '' : String(exercise.weightKg));
  const [rir, setRir] = React.useState(exercise.rir === null ? '' : String(exercise.rir));
  const [rest, setRest] = React.useState(String(exercise.restSeconds));
  const [notes, setNotes] = React.useState(exercise.notes);

  React.useEffect(() => {
    setSets(String(exercise.targetSets));
    setRepsMin(exercise.repsMin === null ? '' : String(exercise.repsMin));
    setRepsMax(exercise.repsMax === null ? '' : String(exercise.repsMax));
    setWeight(exercise.weightKg === null ? '' : String(exercise.weightKg));
    setRir(exercise.rir === null ? '' : String(exercise.rir));
    setRest(String(exercise.restSeconds));
    setNotes(exercise.notes);
  }, [exercise.id, exercise.targetSets, exercise.repsMin, exercise.repsMax, exercise.weightKg, exercise.rir, exercise.restSeconds, exercise.notes]);

  const save = () => {
    const parsedSets = Number(sets);
    const parsedRest = Number(rest);
    onSave({
      ...exercise,
      targetSets: Number.isInteger(parsedSets) && parsedSets >= 1 ? parsedSets : exercise.targetSets,
      repsMin: repsMin.trim() ? Number(repsMin) : null,
      repsMax: repsMax.trim() ? Number(repsMax) : null,
      weightKg: weight.trim() ? Number(weight) : null,
      rir: rir.trim() ? Number(rir) : null,
      restSeconds: Number.isInteger(parsedRest) && parsedRest >= 15 ? parsedRest : exercise.restSeconds,
      notes,
    });
  };

  return (
    <>
      <Input label="Sets" value={sets} onChangeText={setSets} onBlur={save} keyboardType="number-pad" />
      <Input label="Reps min" value={repsMin} onChangeText={setRepsMin} onBlur={save} keyboardType="number-pad" />
      <Input label="Reps max" value={repsMax} onChangeText={setRepsMax} onBlur={save} keyboardType="number-pad" />
      <Input label="Weight kg" value={weight} onChangeText={setWeight} onBlur={save} keyboardType="decimal-pad" />
      <Input label="RIR" value={rir} onChangeText={setRir} onBlur={save} keyboardType="number-pad" />
      <Input label="Rest seconds" value={rest} onChangeText={setRest} onBlur={save} keyboardType="number-pad" />
      <Input label="Notes" value={notes} onChangeText={setNotes} onBlur={save} />
    </>
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
  title: { fontSize: 24, fontWeight: '800', flex: 1 },
  dayCard: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  exRow: { borderTopWidth: 1, paddingTop: 10, marginTop: 6, gap: 6 },
  exName: { fontSize: 16, fontWeight: '700' },
  exMeta: { fontSize: 12, marginTop: 2 },
  exToggle: { fontSize: 11, marginTop: 4 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  hint: { fontSize: 12, lineHeight: 17 },
  dayChips: { gap: 8, paddingVertical: 2 },
  dayChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
  },
  dayChipText: { fontSize: 14, fontWeight: '700' },
  dayChipMeta: { fontSize: 11, marginTop: 2 },
});
