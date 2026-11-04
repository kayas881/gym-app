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
import { useWorkoutRoutines } from '../../../hooks/useWorkoutRoutines';
import { WEEKDAYS } from '../../../lib/workout-plan';
import {
  attachPlanToToday,
  createRoutine,
  deleteRoutine,
  duplicateRoutine,
} from '../../../lib/workout-routines';
import { buildPlanSnapshot } from '../../../lib/workout-plan';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

export default function WorkoutsHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const data = useWorkoutRoutines();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await data.refresh();
    setRefreshing(false);
  }, [data]);

  const startDay = async (routineId: string, dayId: string) => {
    const active = data.todayPlan;
    if (active?.snapshot && !active.finishedAt && active.snapshot.dayId === dayId) {
      router.push('/(member)/workouts/active');
      return;
    }
    const routine = data.routines.find((item) => item.id === routineId);
    const day = routine?.days.find((item) => item.id === dayId);
    if (!routine || !day) return;
    try {
      await attachPlanToToday(
        data.supabase,
        buildPlanSnapshot({
          routineId: routine.id,
          routineName: routine.name,
          dayId: day.id,
          dayLabel: day.label,
          exercises: day.exercises,
        }),
      );
      router.push('/(member)/workouts/active');
    } catch {
      data.refresh();
    }
  };

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
    >
      <Text style={[styles.title, { color: colors.text }]}>Workouts</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Plans you can start — or ignore and just log a set
      </Text>

      {data.loading && data.routines.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}
      {data.error ? <Text style={[styles.error, { color: colors.error }]}>{data.error}</Text> : null}

      <Card padding={16} style={styles.block}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>TODAY</Text>
        {data.todayPlan?.snapshot && !data.todayPlan.finishedAt ? (
          <>
            <Text style={[styles.body, { color: colors.text }]}>
              {data.todayPlan.snapshot.routineName} · {data.todayPlan.snapshot.dayLabel}
            </Text>
            <Button title="Continue workout" onPress={() => router.push('/(member)/workouts/active')} />
          </>
        ) : data.todayAssignment.kind === 'rest' ? (
          <Text style={[styles.body, { color: colors.text }]}>Scheduled rest day</Text>
        ) : data.todayAssignment.kind === 'unscheduled' ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Nothing scheduled. Start any routine or log a free session.
          </Text>
        ) : (
          <>
            <Text style={[styles.body, { color: colors.text }]}>
              {data.todayAssignment.routine?.name}
              {data.todayAssignment.day ? ` · ${data.todayAssignment.day.label}` : ''}
            </Text>
            {data.todayAssignment.routine && data.todayAssignment.day ? (
              <Button
                title="Start today's workout"
                onPress={() =>
                  void startDay(data.todayAssignment.routine!.id, data.todayAssignment.day!.id)
                }
              />
            ) : null}
          </>
        )}
        <Button title="Log a free set" variant="secondary" onPress={() => router.push('/(member)/session')} />
      </Card>

      <View style={styles.rowBtns}>
        <Button title="Schedule" variant="secondary" onPress={() => router.push('/(member)/workouts/schedule')} />
        <Button title="Library" variant="secondary" onPress={() => router.push('/(member)/workouts/library')} />
      </View>

      <Text style={[styles.section, { color: colors.text }]}>My routines</Text>
      <Button
        title="New routine"
        onPress={() => {
          if (!data.profileId) return;
          void createRoutine(data.supabase, data.profileId, 'New routine').then(({ id }) => {
            router.push(`/(member)/workouts/edit?id=${id}`);
          });
        }}
      />

      {data.routines.map((routine) => (
        <Card key={routine.id} padding={16} style={styles.block}>
          <Text style={[styles.routineName, { color: colors.text }]}>{routine.name}</Text>
          {routine.description ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>{routine.description}</Text>
          ) : null}
          <Text style={[styles.meta, { color: colors.textTertiary }]}>
            {routine.days.length} day{routine.days.length === 1 ? '' : 's'} ·{' '}
            {routine.days.reduce((sum, day) => sum + day.exercises.length, 0)} exercises
          </Text>
          {routine.days.map((day) => (
            <View key={day.id} style={styles.dayRow}>
              <Text style={[styles.dayLabel, { color: colors.textSecondary }]}>{day.label}</Text>
              <Button title="Start" size="sm" onPress={() => void startDay(routine.id, day.id)} />
            </View>
          ))}
          <View style={styles.rowBtns}>
            <Button title="Edit" variant="secondary" size="sm" onPress={() => router.push(`/(member)/workouts/edit?id=${routine.id}`)} />
            <Button
              title="Duplicate"
              variant="ghost"
              size="sm"
              onPress={() => {
                if (!data.profileId) return;
                void duplicateRoutine(data.supabase, data.profileId, routine).then(() => data.refresh());
              }}
            />
            <Button
              title="Delete"
              variant="ghost"
              size="sm"
              onPress={() => void deleteRoutine(data.supabase, routine.id).then(() => data.refresh())}
            />
          </View>
        </Card>
      ))}

      <Text style={[styles.hint, { color: colors.textTertiary }]}>
        {WEEKDAYS.find((day) => day.iso === data.weekday)?.label} in the gym week
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 10 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, marginBottom: 8 },
  spinner: { marginVertical: 20 },
  error: { fontSize: 14, fontWeight: '600' },
  block: { marginBottom: 8, gap: 10 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  body: { fontSize: 15, lineHeight: 20 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  routineName: { fontSize: 18, fontWeight: '800' },
  meta: { fontSize: 12 },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayLabel: { fontSize: 14, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { fontSize: 12, marginTop: 8 },
});
