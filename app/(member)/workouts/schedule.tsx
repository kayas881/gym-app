import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { useWorkoutRoutines } from '../../../hooks/useWorkoutRoutines';
import { WEEKDAYS } from '../../../lib/workout-plan';
import { clearWeekSlot, upsertWeekSlot } from '../../../lib/workout-routines';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

export default function WeeklyScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const data = useWorkoutRoutines();

  const assign = (weekday: number, routineId: string | null, dayId: string | null) => {
    if (!data.profileId) return;
    void upsertWeekSlot(data.supabase, data.profileId, weekday, routineId, dayId).then(() => data.refresh());
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 36 },
      ]}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.back, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Weekly schedule</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>Optional. You can still start any routine.</Text>
        </View>
      </View>

      {WEEKDAYS.map((day) => {
        const slot = data.slots.find((item) => item.weekday === day.iso);
        const routine = data.routines.find((item) => item.id === slot?.routineId);
        const assignedDay = routine?.days.find((item) => item.id === slot?.dayId) ?? routine?.days[0];
        return (
          <Card key={day.iso} padding={14} style={styles.card}>
            <Text style={[styles.day, { color: colors.text }]}>{day.label}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {!slot ? 'Unscheduled' : !slot.routineId ? 'Rest' : `${routine?.name ?? 'Routine'}${assignedDay ? ` · ${assignedDay.label}` : ''}`}
            </Text>
            <View style={styles.row}>
              <Button title="Rest" size="sm" variant="secondary" onPress={() => assign(day.iso, null, null)} />
              <Button title="Clear" size="sm" variant="ghost" onPress={() => {
                if (!data.profileId) return;
                void clearWeekSlot(data.supabase, data.profileId, day.iso).then(() => data.refresh());
              }} />
            </View>
            {data.routines.map((routineItem) =>
              routineItem.days.map((routineDay) => (
                <Button
                  key={`${routineItem.id}-${routineDay.id}`}
                  title={`${routineItem.name} · ${routineDay.label}`}
                  size="sm"
                  variant={slot?.dayId === routineDay.id ? 'primary' : 'ghost'}
                  onPress={() => assign(day.iso, routineItem.id, routineDay.id)}
                />
              )),
            )}
          </Card>
        );
      })}
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
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  card: { gap: 8 },
  day: { fontSize: 17, fontWeight: '800' },
  meta: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 8 },
});
