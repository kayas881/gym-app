import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { useWorkoutProgress } from '../../../hooks/useWorkoutProgress';
import SessionSummaryCard from '../../../components/SessionSummaryCard';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

export default function SessionHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { summaries, loading, error, refresh } = useWorkoutProgress();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 36 },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
      }
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
          <Text style={[styles.title, { color: colors.text }]}>Sessions</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Automatic summaries from confirmed sets
          </Text>
        </View>
      </View>

      {loading && summaries.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}

      {error ? (
        <Card padding={16} style={styles.block}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void refresh()} />
        </Card>
      ) : null}

      {summaries.length === 0 && !loading ? (
        <Card padding={18}>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            Confirm a set and today’s session will get a summary.
          </Text>
          <Button title="Log a set" onPress={() => router.push('/(member)/session')} />
        </Card>
      ) : (
        summaries.map((summary) => (
          <SessionSummaryCard
            key={summary.sessionId}
            summary={summary}
            compact
            onPress={() => router.push(`/(member)/sessions/${summary.sessionId}`)}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
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
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, marginTop: 2 },
  spinner: { marginVertical: 24 },
  block: { marginBottom: 16, gap: 12 },
  errorText: { fontSize: 14, fontWeight: '600' },
  empty: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
});
