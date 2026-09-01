import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import {
  DAY_KEYS,
  DAY_LABELS,
  DayHours,
  DayKey,
  OperatingHours,
  defaultOperatingHours,
  formatTime,
  isValidTime,
  parseOperatingHours,
  serializeOperatingHours,
  summarizeOperatingHours,
  todayKey,
} from '../../utils/operating-hours';

/**
 * Per-day opening hours.
 *
 * Split out of Settings rather than crammed into it: seven rows of two time
 * fields plus a toggle is the largest thing on the screen, and Settings was
 * already long enough that the Sign Out button sat below the fold.
 */
export default function GymHoursScreen() {
  const router = useRouter();
  const { gymId, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [hours, setHours] = useState<OperatingHours>(defaultOperatingHours());
  const [note, setNote] = useState('');
  const [legacySummary, setLegacySummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Serialized snapshot of the saved week. Comparing the objects directly
  // would always report a change, since updateDay rebuilds them.
  const [baseline, setBaseline] = useState<string | null>(null);

  const fetchHours = useCallback(async () => {
    if (!gymId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('gyms')
        .select('operating_hours')
        .eq('id', gymId)
        .single();

      if (error) {
        console.error('[GymHours] Fetch error:', error);
        return;
      }

      const parsed = parseOperatingHours(data?.operating_hours);
      if (parsed.hours) {
        setHours(parsed.hours);
        setNote(parsed.hours.note ?? '');
        setBaseline(JSON.stringify({ days: parsed.hours.days, note: parsed.hours.note ?? '' }));
      }
      // A gym still holding the old free-text value keeps its defaults until
      // the owner saves. Reading "6:00 AM - 10:00 PM" as "open every day"
      // would be inventing a fact about their business.
      setLegacySummary(parsed.legacySummary);
    } catch (err) {
      console.error('[GymHours] Unexpected error:', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchHours();
  }, [fetchHours]);

  const updateDay = (key: DayKey, patch: Partial<DayHours>) => {
    setHours((prev) => ({
      ...prev,
      days: { ...prev.days, [key]: { ...prev.days[key], ...patch } },
    }));
  };

  /** Copies Monday across the week — the common case for a gym. */
  const applyMondayToAll = () => {
    const monday = hours.days.mon;
    Alert.alert(
      'Copy Monday to every day?',
      'Every other day will use Monday’s hours. You can still change individual days afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: () => {
            setHours((prev) => {
              const days = { ...prev.days };
              for (const key of DAY_KEYS) days[key] = { ...monday };
              return { ...prev, days };
            });
          },
        },
      ]
    );
  };

  const invalidDays = useMemo(
    () =>
      DAY_KEYS.filter((key) => {
        const day = hours.days[key];
        return !day.closed && (!isValidTime(day.open) || !isValidTime(day.close));
      }),
    [hours]
  );

  // A gym that has never set hours (baseline null) counts as changed, so the
  // owner can save the defaults rather than being stuck with no save button.
  const hasChanges = useMemo(() => {
    if (baseline === null) return true;
    return JSON.stringify({ days: hours.days, note: note.trim() }) !== baseline;
  }, [hours, note, baseline]);

  const preview = useMemo(
    () => summarizeOperatingHours({ ...hours, note: note.trim() || undefined }),
    [hours, note]
  );

  const handleSave = async () => {
    if (!gymId) return;

    if (invalidDays.length > 0) {
      Alert.alert(
        'Check the times',
        `Use 24-hour HH:MM (for example 06:00 or 21:30) for: ${invalidDays
          .map((k) => DAY_LABELS[k])
          .join(', ')}.`
      );
      return;
    }

    const allClosed = DAY_KEYS.every((key) => hours.days[key].closed);
    if (allClosed) {
      Alert.alert(
        'Every day is closed',
        'Members will be told the gym is never open. Set at least one open day.'
      );
      return;
    }

    setSaving(true);
    try {
      const payload = serializeOperatingHours({
        ...hours,
        note: note.trim() || undefined,
      });

      const { error } = await supabase
        .from('gyms')
        .update({ operating_hours: payload, updated_at: new Date().toISOString() })
        .eq('id', gymId);

      if (error) throw error;

      setLegacySummary(null);
      setBaseline(JSON.stringify({ days: hours.days, note: note.trim() }));
      Alert.alert('Hours Saved', 'Members will see the updated opening hours.');
      router.back();
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not save opening hours.');
    } finally {
      setSaving(false);
    }
  };

  const currentDay = todayKey();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Opening Hours</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {legacySummary ? (
            <View
              style={[
                styles.legacyNotice,
                { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
              ]}
            >
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
              <View style={styles.legacyText}>
                <Text style={[styles.legacyTitle, { color: colors.primary }]}>
                  Your old hours were free text
                </Text>
                <Text style={[styles.legacyBody, { color: colors.textSecondary }]}>
                  {'“'}{legacySummary}{'”'} — set the real days below and save to replace it.
                </Text>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={applyMondayToAll}
            activeOpacity={0.7}
            style={[
              styles.copyRow,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
          >
            <Ionicons name="copy-outline" size={18} color={colors.primary} />
            <Text style={[styles.copyText, { color: colors.primary }]}>
              Copy Monday to every day
            </Text>
          </TouchableOpacity>

          {DAY_KEYS.map((key) => {
            const day = hours.days[key];
            const isToday = key === currentDay;
            const openInvalid = !day.closed && !isValidTime(day.open);
            const closeInvalid = !day.closed && !isValidTime(day.close);

            return (
              <Card
                key={key}
                padding={14}
                style={[
                  styles.dayCard,
                  isToday && { borderColor: colors.primary, borderWidth: 1 },
                ]}
              >
                <View style={styles.dayHeader}>
                  <View style={styles.dayLabelGroup}>
                    <Text style={[styles.dayLabel, { color: colors.text }]}>
                      {DAY_LABELS[key]}
                    </Text>
                    {isToday ? (
                      <Text style={[styles.todayTag, { color: colors.primary }]}>TODAY</Text>
                    ) : null}
                  </View>

                  <View style={styles.switchGroup}>
                    <Text
                      style={[
                        styles.switchLabel,
                        { color: day.closed ? colors.error : colors.textSecondary },
                      ]}
                    >
                      {day.closed ? 'Closed' : 'Open'}
                    </Text>
                    <Switch
                      value={!day.closed}
                      onValueChange={(open) => updateDay(key, { closed: !open })}
                      trackColor={{ false: colors.border, true: colors.primaryMuted }}
                      thumbColor={day.closed ? colors.textTertiary : colors.primary}
                    />
                  </View>
                </View>

                {day.closed ? null : (
                  <View style={styles.timesRow}>
                    <View style={styles.timeField}>
                      <Input
                        label="Opens"
                        placeholder="06:00"
                        value={day.open}
                        onChangeText={(value) => updateDay(key, { open: value.trim() })}
                        keyboardType="numbers-and-punctuation"
                        error={openInvalid ? 'Use HH:MM' : undefined}
                      />
                    </View>
                    <View style={styles.timeField}>
                      <Input
                        label="Closes"
                        placeholder="22:00"
                        value={day.close}
                        onChangeText={(value) => updateDay(key, { close: value.trim() })}
                        keyboardType="numbers-and-punctuation"
                        error={closeInvalid ? 'Use HH:MM' : undefined}
                      />
                    </View>
                  </View>
                )}

                {!day.closed && isValidTime(day.open) && isValidTime(day.close) ? (
                  <Text style={[styles.dayPreview, { color: colors.textTertiary }]}>
                    {formatTime(day.open)} – {formatTime(day.close)}
                    {day.close <= day.open ? '  (overnight, closes next morning)' : ''}
                  </Text>
                ) : null}
              </Card>
            );
          })}

          <Card padding={14} style={styles.noteCard}>
            <Input
              label="Note (optional)"
              placeholder="e.g. Closed on public holidays"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
            />
          </Card>

          <View
            style={[
              styles.previewBox,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>
              MEMBERS WILL SEE
            </Text>
            <Text style={[styles.previewValue, { color: colors.text }]}>
              {preview || 'Not set'}
            </Text>
          </View>

          {hasChanges ? (
            <Button
              title="Save Opening Hours"
              variant="primary"
              loading={saving}
              onPress={handleSave}
              fullWidth
              icon={<Ionicons name="save-outline" size={18} color="#000000" />}
              style={{ marginTop: 16 }}
            />
          ) : (
            <Text style={[styles.savedNote, { color: colors.textTertiary }]}>
              Saved. Change a day to enable saving again.
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },
  legacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  legacyText: { flex: 1 },
  legacyTitle: { fontSize: 14, fontWeight: '700' },
  legacyBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },
  copyText: { fontSize: 14, fontWeight: '600' },
  dayCard: { borderRadius: 14, marginBottom: 10 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayLabel: { fontSize: 15, fontWeight: '700' },
  todayTag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  switchGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { fontSize: 12, fontWeight: '600' },
  timesRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  timeField: { flex: 1 },
  dayPreview: { fontSize: 11, marginTop: -6 },
  noteCard: { borderRadius: 14, marginTop: 4 },
  previewBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 6,
  },
  previewLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  previewValue: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  savedNote: { fontSize: 12, textAlign: 'center', marginTop: 18 },
});
