import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useAnnouncements } from '../../../hooks/useAnnouncements';
import { timestampLabel } from '../../../utils/date';
import Avatar from '../../../components/ui/Avatar';
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';

export default function StaffAnnouncementsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    announcements,
    loading,
    refresh,
    deleteAnnouncement,
  } = useAnnouncements();

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleDelete = (announcementId: string) => {
    Alert.alert(
      'Delete Announcement',
      'Are you sure you want to remove this announcement?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAnnouncement(announcementId);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete announcement');
            }
          },
        },
      ]
    );
  };

  const renderAnnouncementItem = ({ item }: { item: (typeof announcements)[0] }) => {
    // Compare ids, not names: two staff sharing a full name would otherwise
    // each see a delete button on the other's posts (the RLS delete policy is
    // owner-only, so it would fail anyway — a dead affordance).
    const isAuthor = !!profile?.id && item.author_id === profile.id;
    const targetBadgeText =
      item.target_audience === 'everyone'
        ? 'Everyone'
        : item.target_audience.charAt(0).toUpperCase() + item.target_audience.slice(1);

    return (
      <Card style={styles.card} padding={16}>
        {/* Top Header */}
        <View style={styles.cardHeader}>
          <View style={styles.authorRow}>
            <Avatar
              uri={item.author?.photo_url}
              name={item.author?.full_name || 'Staff'}
              size={38}
            />
            <View style={styles.authorInfo}>
              <Text style={[styles.authorName, { color: colors.text }]}>
                {item.author?.full_name || 'Staff Member'}
              </Text>
              <Text style={[styles.timeText, { color: colors.textTertiary }]}>
                {timestampLabel(item.created_at)}
              </Text>
            </View>
          </View>

          <View style={styles.topRightGroup}>
            <Badge
              text={targetBadgeText}
              variant="default"
              size="sm"
            />
            {isAuthor && (
              <TouchableOpacity
                onPress={() => handleDelete(item.id)}
                style={styles.deleteButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            )}
          </View>
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
        data={announcements}
        keyExtractor={(item) => item.id}
        renderItem={renderAnnouncementItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 90 },
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
            <View style={styles.headerRow}>
              <View style={styles.headerTextGroup}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  Announcements
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  Post updates, schedule changes, and alerts for members
                </Text>
              </View>
            </View>
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
                <Ionicons name="megaphone-outline" size={48} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No announcements yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Tap the button below to publish the first announcement to your gym members.
              </Text>
            </View>
          )
        }
      />

      {/* Floating Action Button */}
      <View style={[styles.fabContainer, { bottom: insets.bottom + 20 }]}>
        <Button
          title="New Announcement"
          onPress={() => router.push('/(staff)/announcements/create')}
          variant="primary"
          size="lg"
          icon={<Ionicons name="add-circle-outline" size={22} color="#000000" />}
          style={styles.fabButton}
        />
      </View>
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
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTextGroup: {
    flex: 1,
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
  topRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteButton: {
    padding: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
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
  fabContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  fabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
});
