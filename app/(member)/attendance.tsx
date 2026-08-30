import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useCheckIns } from '../../hooks/useCheckIns';
import { formatDate, formatDateTime, timeAgo } from '../../utils/date';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const { currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    checkIns,
    loading,
    refresh,
  } = useCheckIns(currentMembership?.id);

  const [refreshing, setRefreshing] = useState(false);
  const [currentMonthDate, setCurrentMonthDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Set of check-in dates (YYYY-MM-DD)
  const checkInDatesSet = useMemo(() => {
    const set = new Set<string>();
    checkIns.forEach((c) => {
      set.add(c.checked_in_at.split('T')[0]);
    });
    return set;
  }, [checkIns]);

  // Map check-ins by date string for quick access
  const checkInsByDate = useMemo(() => {
    const map = new Map<string, typeof checkIns>();
    checkIns.forEach((c) => {
      const dStr = c.checked_in_at.split('T')[0];
      const existing = map.get(dStr) || [];
      existing.push(c);
      map.set(dStr, existing);
    });
    return map;
  }, [checkIns]);

  // Calendar calculations
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  const monthName = currentMonthDate.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: Array<{
      dayNumber: number | null;
      dateStr: string | null;
      isCheckedIn: boolean;
      isToday: boolean;
    }> = [];

    // Empty padding cells before 1st of month
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({
        dayNumber: null,
        dateStr: null,
        isCheckedIn: false,
        isToday: false,
      });
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // Actual month days
    for (let day = 1; day <= daysInMonth; day++) {
      const monthStr = String(month + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      const fullDateStr = `${year}-${monthStr}-${dayStr}`;

      days.push({
        dayNumber: day,
        dateStr: fullDateStr,
        isCheckedIn: checkInDatesSet.has(fullDateStr),
        isToday: fullDateStr === todayStr,
      });
    }

    return days;
  }, [year, month, checkInDatesSet]);

  // Month check-in count
  const monthCheckInCount = useMemo(() => {
    return checkIns.filter((c) => {
      const d = new Date(c.checked_in_at);
      return d.getFullYear() === year && d.getMonth() === month;
    }).length;
  }, [checkIns, year, month]);

  // Navigate months
  const handlePrevMonth = () => {
    setCurrentMonthDate(new Date(year, month - 1, 1));
    setSelectedDateStr(null);
  };

  const handleNextMonth = () => {
    setCurrentMonthDate(new Date(year, month + 1, 1));
    setSelectedDateStr(null);
  };

  // Filtered check-in list: either for selected date or all recent in this month
  const displayedCheckIns = useMemo(() => {
    if (selectedDateStr) {
      return checkInsByDate.get(selectedDateStr) || [];
    }
    return checkIns.filter((c) => {
      const d = new Date(c.checked_in_at);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [selectedDateStr, checkInsByDate, checkIns, year, month]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
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
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Attendance History</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Track your workout consistency & gym check-ins
          </Text>
        </View>

        {/* Calendar Card */}
        <Card style={styles.calendarCard} padding={16}>
          {/* Month Navigation */}
          <View style={styles.monthHeader}>
            <TouchableOpacity
              onPress={handlePrevMonth}
              style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={18} color={colors.text} />
            </TouchableOpacity>

            <Text style={[styles.monthTitle, { color: colors.text }]}>
              {monthName}
            </Text>

            <TouchableOpacity
              onPress={handleNextMonth}
              style={[styles.navButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Days of Week Header */}
          <View style={styles.daysOfWeekRow}>
            {DAYS_OF_WEEK.map((d) => (
              <View key={d} style={styles.dayOfWeekCell}>
                <Text style={[styles.dayOfWeekText, { color: colors.textTertiary }]}>
                  {d}
                </Text>
              </View>
            ))}
          </View>

          {/* Calendar Grid */}
          <View style={styles.grid}>
            {calendarDays.map((cell, index) => {
              if (cell.dayNumber === null) {
                return <View key={`empty-${index}`} style={styles.cell} />;
              }

              const isSelected = selectedDateStr === cell.dateStr;

              return (
                <TouchableOpacity
                  key={cell.dateStr}
                  style={[
                    styles.cell,
                    cell.isToday && {
                      borderColor: colors.primary,
                      borderWidth: 1.5,
                    },
                    isSelected && {
                      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
                    },
                  ]}
                  onPress={() => {
                    if (cell.dateStr) {
                      setSelectedDateStr(
                        selectedDateStr === cell.dateStr ? null : cell.dateStr
                      );
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: cell.isToday ? colors.primary : colors.text },
                      isSelected && { fontWeight: '800' },
                    ]}
                  >
                    {cell.dayNumber}
                  </Text>

                  {cell.isCheckedIn && (
                    <View
                      style={[
                        styles.dotIndicator,
                        { backgroundColor: colors.primary },
                      ]}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Calendar Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                Checked In
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSquare, { borderColor: colors.primary }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                Today
              </Text>
            </View>
          </View>
        </Card>

        {/* Monthly Summary Stat */}
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <View style={[styles.summaryIconWrap, { backgroundColor: colors.primaryMuted }]}>
            <Ionicons name="checkmark-done" size={24} color={colors.primary} />
          </View>
          <View style={styles.summaryTextWrap}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>
              {monthCheckInCount} Check-ins in {currentMonthDate.toLocaleDateString('en-IN', { month: 'short' })}
            </Text>
            <Text style={[styles.summarySubtitle, { color: colors.textSecondary }]}>
              {monthCheckInCount >= 20
                ? '🌟 Outstanding dedication!'
                : monthCheckInCount >= 12
                ? '💪 Great progress this month!'
                : 'Keep pushing and stay consistent!'}
            </Text>
          </View>
        </View>

        {/* Recent Check-Ins List Header */}
        <View style={styles.listHeaderRow}>
          <Text style={[styles.listTitle, { color: colors.text }]}>
            {selectedDateStr ? `Check-ins on ${formatDate(selectedDateStr)}` : 'Recent Check-in Times'}
          </Text>
          {selectedDateStr && (
            <TouchableOpacity onPress={() => setSelectedDateStr(null)}>
              <Text style={[styles.clearFilterText, { color: colors.primary }]}>
                Show All Month
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Check-ins List */}
        {loading && !refreshing ? (
          <View style={styles.loadingWrapper}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : displayedCheckIns.length === 0 ? (
          <Card style={styles.emptyCard} padding={24}>
            <Ionicons name="calendar-outline" size={36} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No check-ins found
            </Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              {selectedDateStr
                ? `No recorded check-ins on ${formatDate(selectedDateStr)}.`
                : `No check-ins recorded for ${monthName}.`}
            </Text>
          </Card>
        ) : (
          displayedCheckIns.map((item) => {
            const checkInDate = new Date(item.checked_in_at);
            const timeString = checkInDate.toLocaleTimeString('en-IN', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });

            return (
              <Card
                key={item.id}
                style={styles.checkInItemCard}
                padding={14}
              >
                <View style={styles.checkInRow}>
                  <View style={[styles.checkInBadgeIcon, { backgroundColor: colors.primaryMuted }]}>
                    <Ionicons name="fitness-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.checkInDetails}>
                    <Text style={[styles.checkInDayName, { color: colors.text }]}>
                      {formatDate(item.checked_in_at)}
                    </Text>
                    <Text style={[styles.checkInRelative, { color: colors.textSecondary }]}>
                      {timeAgo(item.checked_in_at)}
                    </Text>
                  </View>
                  <Badge
                    text={timeString}
                    variant="default"
                    size="md"
                    icon={<Ionicons name="time-outline" size={14} color={colors.textSecondary} />}
                  />
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  calendarCard: {
    marginBottom: 16,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  daysOfWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150, 150, 150, 0.1)',
    paddingBottom: 8,
  },
  dayOfWeekCell: {
    flex: 1,
    alignItems: 'center',
  },
  dayOfWeekText: {
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginVertical: 2,
    position: 'relative',
  },
  dayText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dotIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    position: 'absolute',
    bottom: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150, 150, 150, 0.1)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 1.5,
  },
  legendText: {
    fontSize: 12,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  summaryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  summaryTextWrap: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  summarySubtitle: {
    fontSize: 13,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  clearFilterText: {
    fontSize: 13,
    fontWeight: '600',
  },
  loadingWrapper: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
  },
  checkInItemCard: {
    marginBottom: 10,
  },
  checkInRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkInBadgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkInDetails: {
    flex: 1,
  },
  checkInDayName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  checkInRelative: {
    fontSize: 12,
  },
});
