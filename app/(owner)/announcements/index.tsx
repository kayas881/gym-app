import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useAnnouncements } from '../../../hooks/useAnnouncements';
import Card from '../../../components/ui/Card';
import Avatar from '../../../components/ui/Avatar';
import Badge, { BadgeVariant } from '../../../components/ui/Badge';
import { timestampLabel } from '../../../utils/date';

export default function OwnerAnnouncementsScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { announcements, loading, refresh, deleteAnnouncement } = useAnnouncements();

  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const confirmDelete = (announcementId: string, title: string) => {
    Alert.alert(
      'Delete Announcement',
      `Are you sure you want to delete "${title}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(announcementId);
              await deleteAnnouncement(announcementId);
            } catch (err: any) {
              console.error('[Announcements] Delete error:', err);
              Alert.alert('Error', err.message || 'Failed to delete announcement.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const getAudienceBadgeConfig = (audience: string): { label: string; variant: BadgeVariant } => {
    switch (audience?.toLowerCase()) {
      case 'active':
        return { label: 'Active Members', variant: 'success' };
      case 'morning':
        return { label: 'Morning (5-11 AM)', variant: 'info' };
      case 'afternoon':
        return { label: 'Afternoon (11 AM-4 PM)', variant: 'warning' };
      case 'evening':
        return { label: 'Evening (4-10 PM)', variant: 'info' };
      case 'staff':
        return { label: 'Staff Only', variant: 'error' };
      case 'everyone':
      default:
        return { label: 'Everyone', variant: 'default' };
    }
  };

  const renderAnnouncementItem = ({ item }: { item: (typeof announcements)[0] }) => {
    const { label: audienceLabel, variant: audienceVariant } = getAudienceBadgeConfig(
      item.target_audience
    );
    const isCurrentlyDeleting = deletingId === item.id;

    return (
      <Card
        style={styles.announcementCard}
        padding={16}
        onPress={() => {}}
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => confirmDelete(item.id, item.title)}
        >
          {/* Header Row */}
          <View style={styles.cardHeader}>
            <View style={styles.authorRow}>
              <Avatar
                uri={item.author?.photo_url}
                name={item.author?.full_name || 'Admin'}
                size={38}
              />
              <View style={styles.authorTextGroup}>
                <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>
                  {item.author?.full_name || 'Gym Admin'}
                </Text>
                <Text style={[styles.timeText, { color: colors.textTertiary }]}>
                  {timestampLabel(item.created_at)}
                </Text>
              </View>
            </View>

            {/* Delete button */}
            <TouchableOpacity
              style={[styles.deleteButton, { backgroundColor: colors.surfaceElevated }]}
              onPress={() => confirmDelete(item.id, item.title)}
              disabled={isCurrentlyDeleting}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isCurrentlyDeleting ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Ionicons name="trash-outline" size={16} color={colors.error} />
              )}
            </TouchableOpacity>
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {item.title}
          </Text>

          {/* Body */}
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {item.body}
          </Text>

          {/* Footer with Audience Badge */}
          <View style={styles.cardFooter}>
            <Badge
              text={audienceLabel}
              variant={audienceVariant}
              size="sm"
              icon={<Ionicons name="people" size={12} color={colors.textSecondary} />}
            />
          </View>
        </TouchableOpacity>
      </Card>
    );
  };

  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconWrap,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' },
          ]}
        >
          <Ionicons name="megaphone-outline" size={48} color={colors.textTertiary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No Announcements Yet
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Broadcast updates, holiday hours, schedule changes, or events directly to your gym members.
        </Text>
        <TouchableOpacity
          style={[styles.createFirstBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(owner)/announcements/create')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={20} color="#000000" />
          <Text style={styles.createFirstBtnText}>Create Announcement</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Screen Header */}
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
            Announcements
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {announcements.length} {announcements.length === 1 ? 'post' : 'posts'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.createHeaderBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(owner)/announcements/create')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#000000" />
          <Text style={styles.createHeaderBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {/* Main List */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading announcements...
          </Text>
        </View>
      ) : (
        <FlatList
          data={announcements}
          keyExtractor={(item) => item.id}
          renderItem={renderAnnouncementItem}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/*
        No floating action button here: the header already has "+ New" pointing
        at the same screen, and a centre-anchored FAB covered the list text
        while scrolling. One affordance is enough.
      */}
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
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  createHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  createHeaderBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    // Was 90 to clear a floating button that no longer exists.
    paddingBottom: 24,
  },
  announcementCard: {
    marginBottom: 12,
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
    marginRight: 8,
  },
  authorTextGroup: {
    marginLeft: 10,
    flex: 1,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
  },
  timeText: {
    fontSize: 11,
    marginTop: 2,
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150, 150, 150, 0.2)',
  },
  hintText: {
    fontSize: 11,
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
    paddingHorizontal: 28,
    paddingTop: 60,
    gap: 12,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  createFirstBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
  },
  createFirstBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 30,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
});
