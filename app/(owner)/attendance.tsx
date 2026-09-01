import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useCheckIns } from '../../hooks/useCheckIns';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import { formatDateTime, timeAgo } from '../../utils/date';

interface AttendanceRecord {
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

export default function OwnerTodayAttendanceScreen() {
  const router = useRouter();
  const { gymId } = useAppAuth();
  const { colors, isDark } = useTheme();
  const { fetchTodayAttendance } = useCheckIns();

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadAttendance = useCallback(async () => {
    if (!gymId) return;

    try {
      const data = await fetchTodayAttendance();
      setRecords((data as unknown as AttendanceRecord[]) || []);
    } catch (err) {
      console.error('[TodayAttendance] Error loading attendance:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gymId, fetchTodayAttendance]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAttendance();
  };

  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) =>
      r.member?.profile?.full_name?.toLowerCase().includes(q)
    );
  }, [records, searchQuery]);

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconCircle,
            { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.08)' },
          ]}
        >
          <Ionicons name="finger-print-outline" size={56} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {searchQuery ? 'No Matching Check-ins' : 'No Check-ins Yet Today'}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {searchQuery
            ? `No members with name matching "${searchQuery}" checked in today.`
            : 'As members scan QR or check in upon arrival at the gym, their timestamps will appear here in real time.'}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Today's Attendance
          </Text>
          <Text style={[styles.headerDate, { color: colors.textSecondary }]}>
            {todayFormatted}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Badge
            text={`${records.length} ${records.length === 1 ? 'Check-in' : 'Check-ins'}`}
            variant="success"
            size="md"
          />
          <TouchableOpacity
            onPress={() => router.push('/(owner)/qr-code')}
            activeOpacity={0.8}
            accessibilityLabel="Show check-in QR code"
            style={[
              styles.qrButton,
              { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
            ]}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Input */}
      {records.length > 0 && (
        <View style={styles.searchSection}>
          <Input
            placeholder="Search checked-in members..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            leftIcon={<Ionicons name="search-outline" size={20} color={colors.textTertiary} />}
            rightIcon={
              searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : undefined
            }
            style={styles.searchInputWrapper}
          />
        </View>
      )}

      {/* Check-ins List */}
      {loading && records.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading attendance records...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => {
            const checkInTime = new Date(item.checked_in_at).toLocaleTimeString('en-IN', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });

            return (
              <Card
                style={styles.recordCard}
                padding={14}
                onPress={() => item.member?.id && router.push(`/(owner)/members/${item.member.id}`)}
              >
                <View style={styles.recordRow}>
                  <Avatar
                    uri={item.member?.profile?.photo_url}
                    name={item.member?.profile?.full_name || 'Member'}
                    size={46}
                  />

                  <View style={styles.recordInfo}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                        {item.member?.profile?.full_name || 'Gym Member'}
                      </Text>
                      {item.member?.role && item.member.role !== 'member' && (
                        <Badge
                          text={item.member.role.toUpperCase()}
                          variant={item.member.role === 'staff' ? 'info' : 'warning'}
                          size="sm"
                        />
                      )}
                    </View>

                    <Text style={[styles.relativeTime, { color: colors.textTertiary }]}>
                      {timeAgo(item.checked_in_at)} • {formatDateTime(item.checked_in_at)}
                    </Text>
                  </View>

                  <View style={[styles.timeBadge, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                    <Ionicons name="time-outline" size={14} color={colors.primary} />
                    <Text style={[styles.timeText, { color: colors.text }]}>
                      {checkInTime}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qrButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitleGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerDate: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  searchSection: {
    paddingHorizontal: 16,
    marginBottom: -4,
  },
  searchInputWrapper: {
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
    gap: 12,
  },
  emptyIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  recordCard: {
    borderRadius: 14,
    marginBottom: 10,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  relativeTime: {
    fontSize: 11,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
