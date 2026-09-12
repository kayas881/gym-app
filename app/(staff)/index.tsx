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
  const { colors } = useTheme();

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
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 104 },
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
            {/* Shift header */}
            <View style={styles.greetingRow}>
              <View style={styles.greetingTextWrap}>
                <Text style={[styles.dateEyebrow, { color: colors.textSecondary }]}>
                  {todayFormatted.toUpperCase()}
                </Text>
                <Text style={[styles.greetingTitle, { color: colors.text }]}>
                  {gymName}
                </Text>
                <Text style={[styles.gymNameText, { color: colors.textSecondary }]}>
                  Front desk · {staffName}
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

            {/* One attendance board is faster to scan than four repeated stat tiles. */}
            <Card style={styles.attendanceBoard} padding={0}>
              <View style={styles.attendanceBoardTop}>
                <View>
                  <Text style={[styles.boardEyebrow, { color: colors.primary }]}>
                    TODAY'S FLOOR
                  </Text>
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalValue, { color: colors.text }]}>
                      {attendanceList.length}
                    </Text>
                    <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
                      {attendanceList.length === 1 ? 'member check-in' : 'member check-ins'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.livePill, { backgroundColor: colors.primaryMuted }]}>
                  <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.liveText, { color: colors.primary }]}>LIVE</Text>
                </View>
              </View>

              <View style={[styles.slotStrip, { borderTopColor: colors.divider }]}>
                {([
                  ['Morning', slotCounts.morning, slotLabel('morning')],
                  ['Afternoon', slotCounts.afternoon, slotLabel('afternoon')],
                  ['Evening', slotCounts.evening, slotLabel('evening')],
                ] as const).map(([label, count, hours], index) => (
                  <View
                    key={label}
                    style={[
                      styles.slotCell,
                      index > 0 && { borderLeftColor: colors.divider, borderLeftWidth: 1 },
                    ]}
                  >
                    <Text style={[styles.slotCount, { color: colors.text }]}>{count}</Text>
                    <Text style={[styles.slotName, { color: colors.textSecondary }]}>{label}</Text>
                    <Text style={[styles.slotHours, { color: colors.textTertiary }]}>{hours}</Text>
                  </View>
                ))}
              </View>

              {/* This gym closes at 22:00 but the slots stop at 21:00, so a
                  late check-in belongs to none of them. Without this row the
                  three slot cards can read 0/0/0 while Total Today says 1, and
                  staff have no way to tell that from a broken screen. */}
              {slotCounts.outside > 0 ? (
                <View
                  style={[
                    styles.outsideSlotRow,
                    { backgroundColor: colors.surfaceElevated, borderTopColor: colors.divider },
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
            </Card>

            <View style={styles.toolsHeading}>
              <Text style={[styles.toolsEyebrow, { color: colors.primary }]}>FRONT DESK</Text>
              <Text style={[styles.toolsTitle, { color: colors.text }]}>Tools for the shift</Text>
            </View>

            <Card style={styles.deskToolsCard} padding={0}>
              {([
                ['01', 'Display check-in code', 'Members scan it from their app', '/(staff)/qr-code'],
                ['02', 'Invite a member', 'Share the gym joining code', '/(staff)/invite'],
                ['03', 'Member directory', 'Look up status and details', '/(staff)/members'],
                ['04', 'Post an update', 'Notify members or the team', '/(staff)/announcements'],
                ['05', 'Team chat', 'Coordinate with the owner', '/(staff)/staff-chat'],
              ] as const).map(([number, title, subtitle, route], index) => (
                <TouchableOpacity
                  key={number}
                  style={[
                    styles.deskToolRow,
                    index > 0 && { borderTopColor: colors.divider, borderTopWidth: 1 },
                  ]}
                  onPress={() => router.push(route)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.deskToolNumber,
                      { color: index < 2 ? colors.primary : colors.textTertiary },
                    ]}
                  >
                    {number}
                  </Text>
                  <View style={styles.deskToolCopy}>
                    <Text style={[styles.deskToolTitle, { color: colors.text }]}>{title}</Text>
                    <Text style={[styles.deskToolSubtitle, { color: colors.textSecondary }]}>
                      {subtitle}
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </Card>

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
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  dateEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 5,
  },
  gymNameText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },
  chatHeaderButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceBoard: {
    marginBottom: 26,
  },
  attendanceBoardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 15,
  },
  boardEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  totalValue: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  slotStrip: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  slotCell: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  slotCount: { fontSize: 21, fontWeight: '800' },
  slotName: { fontSize: 11, fontWeight: '700', marginTop: 1 },
  slotHours: { fontSize: 9, marginTop: 2 },
  toolsHeading: { marginBottom: 11 },
  toolsEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    marginBottom: 3,
  },
  toolsTitle: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  deskToolsCard: { marginBottom: 26 },
  deskToolRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  deskToolNumber: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    width: 38,
  },
  deskToolCopy: { flex: 1, marginRight: 10 },
  deskToolTitle: { fontSize: 15, fontWeight: '700' },
  deskToolSubtitle: { fontSize: 12, marginTop: 2 },
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
