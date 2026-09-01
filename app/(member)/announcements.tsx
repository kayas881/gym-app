import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { canViewAnnouncement } from '../../utils/announcement-audience';
import { timestampLabel } from '../../utils/date';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';

export default function MemberAnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    announcements,
    loading,
    refresh,
  } = useAnnouncements();

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Filter announcements matching target audience.
  // Shared with the home-screen preview so the rules can't drift apart.
  const filteredAnnouncements = useMemo(() => {
    const ctx = {
      membershipStatus: currentMembership?.status,
      role: currentMembership?.role,
      preferredTimeSlot: currentMembership?.preferred_time_slot,
      autoTimeSlot: currentMembership?.auto_time_slot,
      preferredGymTiming: profile?.preferred_gym_timing,
    };
    return announcements.filter((a) => canViewAnnouncement(a.target_audience, ctx));
  }, [announcements, profile?.preferred_gym_timing, currentMembership]);

  const renderAnnouncementItem = ({ item }: { item: (typeof announcements)[0] }) => {
    const targetBadgeText =
      item.target_audience === 'everyone'
        ? 'All Members'
        : item.target_audience.charAt(0).toUpperCase() + item.target_audience.slice(1);

    return (
      <Card style={styles.card} padding={18}>
        {/* Top Header */}
        <View style={styles.cardHeader}>
          <View style={styles.authorRow}>
            <Avatar
              uri={item.author?.photo_url}
              name={item.author?.full_name || 'Admin'}
              size={36}
            />
            <View style={styles.authorInfo}>
              <Text style={[styles.authorName, { color: colors.text }]}>
                {item.author?.full_name || 'Gym Admin'}
              </Text>
              <Text style={[styles.timeText, { color: colors.textTertiary }]}>
                {timestampLabel(item.created_at)}
              </Text>
            </View>
          </View>
          <Badge
            text={targetBadgeText}
            variant="default"
            size="sm"
          />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>
          {item.title}
        </Text>

        {/* Body */}
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {item.body}
        </Text>
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={filteredAnnouncements}
        keyExtractor={(item) => item.id}
        renderItem={renderAnnouncementItem}
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
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Announcements
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Updates, schedules, and important news from your gym
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading && !refreshing ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary, marginTop: 12 }]}>
                Loading announcements...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="notifications-off-outline" size={48} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No announcements yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Check back later for gym updates, schedules, and special notices.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  card: {
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  authorInfo: {
    marginLeft: 10,
    flex: 1,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 11,
    marginTop: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
    lineHeight: 22,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
  },
  centerContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
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
