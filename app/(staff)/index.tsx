import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useCheckIns } from '../../hooks/useCheckIns';
import { formatDate, timeAgo } from '../../utils/date';
import { TIME_SLOTS } from '../../constants/config';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import StatCard from '../../components/StatCard';

interface StaffAttendanceItem {
  id: string;
  checked_in_at: string;
  member: {
    id: string;
    role: string;
    profile: {
      full_name: string;
      photo_url: string | null;
    };
  };
}

export default function StaffHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, gymId, currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const { fetchTodayAttendance } = useCheckIns();

  const [attendanceList, setAttendanceList] = useState<StaffAttendanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchTodayAttendance();
      setAttendanceList((data as unknown as StaffAttendanceItem[]) || []);
    } catch (err) {
      console.error('[StaffHome] Error fetching today attendance:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchTodayAttendance]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Slot breakdowns for today, using the same boundaries as the database.
  const slotCounts = useMemo(() => {
    let morning = 0;
    let afternoon = 0;
    let evening = 0;
    let outside = 0;

    attendanceList.forEach((item) => {
      const hour = new Date(item.checked_in_at).getHours();
      if (hour >= TIME_SLOTS.morning.start && hour < TIME_SLOTS.morning.end) morning++;
      else if (hour >= TIME_SLOTS.afternoon.start && hour < TIME_SLOTS.afternoon.end) afternoon++;
      else if (hour >= TIME_SLOTS.evening.start && hour < TIME_SLOTS.evening.end) evening++;
      else outside++;
    });

    return { morning, afternoon, evening, outside };
  }, [attendanceList]);

  /** "5 AM – 11 AM" from the constant, so a label can't drift from its count. */
  const slotLabel = (slot: keyof typeof TIME_SLOTS) => {
    const to12 = (h: number) => {
      const suffix = h < 12 || h === 24 ? 'AM' : 'PM';
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      return `${hour12} ${suffix}`;
    };
    return `${to12(TIME_SLOTS[slot].start)} – ${to12(TIME_SLOTS[slot].end)}`;
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const staffName = profile?.full_name?.split(' ')[0] || 'Staff';
  const gymName = currentMembership?.gym?.name || 'My Gym';

  const renderAttendanceItem = ({ item }: { item: StaffAttendanceItem }) => {
    const timeFormatted = new Date(item.checked_in_at).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return (
      <Card style={styles.attendanceCard} padding={14}>
        <View style={styles.attendanceRow}>
          <Avatar
            uri={item.member?.profile?.photo_url}
            name={item.member?.profile?.full_name || 'Member'}
            size={44}
          />
          <View style={styles.memberInfo}>
            <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
              {item.member?.profile?.full_name || 'Anonymous Member'}
            </Text>
            <Text style={[styles.checkInTimeAgo, { color: colors.textSecondary }]}>
              {timeAgo(item.checked_in_at)}
            </Text>
          </View>

          <Badge
            text={timeFormatted}
            variant="default"
            size="md"
            icon={<Ionicons name="time-outline" size={14} color={colors.textSecondary} />}
          />
        </View>
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={attendanceList}
        keyExtractor={(item) => item.id}
        renderItem={renderAttendanceItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Greeting Header */}
            <View style={styles.greetingRow}>
              <View style={styles.greetingTextWrap}>
                <Text style={[styles.greetingTitle, { color: colors.text }]}>
                  Staff Portal 👋
                </Text>
                <Text style={[styles.gymNameText, { color: colors.primary }]}>
                  {gymName}
                </Text>
                <Text style={[styles.dateText, { color: colors.textSecondary }]}>
                  {todayFormatted}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => router.push('/(staff)/staff-chat')}
                style={[
                  styles.chatHeaderButton,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
                activeOpacity={0.7}
              >
                <Ionicons name="chatbubbles-outline" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Quick Stats Grid */}
            <View style={styles.statsSection}>
              <View style={styles.statsRow}>
                <StatCard
                  title="Total Today"
                  value={attendanceList.length}
                  subtitle="Member check-ins"
                  icon="people-outline"
                  color={colors.primary}
                  style={styles.statHalf}
                />
                <StatCard
                  title="Morning Slot"
                  value={slotCounts.morning}
                  subtitle={slotLabel('morning')}
                  icon="sunny-outline"
                  color={colors.warning}
                  style={styles.statHalf}
                />
              </View>

              <View style={styles.statsRow}>
                <StatCard
                  title="Afternoon Slot"
                  value={slotCounts.afternoon}
                  subtitle={slotLabel('afternoon')}
                  icon="partly-sunny-outline"
                  color={colors.info}
                  style={styles.statHalf}
                />
                <StatCard
                  title="Evening Slot"
                  value={slotCounts.evening}
                  subtitle={slotLabel('evening')}
                  icon="moon-outline"
                  color={colors.statusActive}
                  style={styles.statHalf}
                />
              </View>

              {/* This gym closes at 22:00 but the slots stop at 21:00, so a
                  late check-in belongs to none of them. Without this row the
                  three slot cards can read 0/0/0 while Total Today says 1, and
                  staff have no way to tell that from a broken screen. */}
              {slotCounts.outside > 0 ? (
                <View
                  style={[
                    styles.outsideSlotRow,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                >
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.outsideSlotText, { color: colors.textSecondary }]}>
                    {slotCounts.outside}{' '}
                    {slotCounts.outside === 1 ? 'check-in' : 'check-ins'} outside the
                    morning/afternoon/evening windows
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Quick Actions for Staff */}
            <View style={styles.quickNavRow}>
              <TouchableOpacity
                style={[
                  styles.quickNavBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => router.push('/(staff)/qr-code')}
                activeOpacity={0.7}
              >
                <Ionicons name="qr-code" size={20} color={colors.success} />
                <Text style={[styles.quickNavText, { color: colors.text }]}>Check-In Code</Text>
              </TouchableOpacity>

              {/* Staff are the ones at the desk when the owner is not, so they
                  need to be able to hand out the join code themselves. */}
              <TouchableOpacity
                style={[
                  styles.quickNavBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => router.push('/(staff)/invite')}
                activeOpacity={0.7}
              >
                <Ionicons name="person-add" size={20} color={colors.warning} />
                <Text style={[styles.quickNavText, { color: colors.text }]}>Invite Members</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.quickNavBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => router.push('/(staff)/members')}
                activeOpacity={0.7}
              >
                <Ionicons name="people" size={20} color={colors.primary} />
                <Text style={[styles.quickNavText, { color: colors.text }]}>View Members</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.quickNavBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => router.push('/(staff)/announcements')}
                activeOpacity={0.7}
              >
                <Ionicons name="megaphone" size={20} color={colors.info} />
                <Text style={[styles.quickNavText, { color: colors.text }]}>Announcements</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.quickNavBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => router.push('/(staff)/staff-chat')}
                activeOpacity={0.7}
              >
                <Ionicons name="chatbubbles" size={20} color={colors.warning} />
                <Text style={[styles.quickNavText, { color: colors.text }]}>Team Chat</Text>
              </TouchableOpacity>
            </View>

            {/* Attendance List Title */}
            <View style={styles.listTitleRow}>
              <View style={styles.titleBadgeGroup}>
                <Text style={[styles.listSectionTitle, { color: colors.text }]}>
                  Today's Check-ins
                </Text>
                <Badge
                  text={`${attendanceList.length} total`}
                  variant="info"
                  size="sm"
                />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading && !refreshing ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary, marginTop: 12 }]}>
                Loading today's attendance...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="finger-print-outline" size={48} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No check-ins yet today
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Members will show up here as they scan their check-in QR codes.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outsideSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  outsideSlotText: { flex: 1, fontSize: 12, lineHeight: 17 },
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 12,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  greetingTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  greetingTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  gymNameText: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  dateText: {
    fontSize: 13,
    marginTop: 4,
  },
  chatHeaderButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsSection: {
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statHalf: {
    flex: 1,
  },
  quickNavRow: {
    flexDirection: 'row',
    // Wraps to a 2x2 grid. Four of these side by side on a phone squeezed the
    // labels hard enough to break "Announcements" across lines mid-word.
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  quickNavBtn: {
    // ~half the row minus the gap, so two fit per line.
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickNavText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  attendanceCard: {
    marginBottom: 10,
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 10,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  checkInTimeAgo: {
    fontSize: 12,
  },
  centerContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
