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
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';

export default function StaffAnnouncementsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAppAuth();
  const { colors } = useTheme();

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
        <View style={styles.cardHeader}>
          <Badge text={targetBadgeText} variant="default" size="sm" />
          <View style={styles.metaRow}>
            <Text style={[styles.timeText, { color: colors.textTertiary }]} numberOfLines={1}>
              {timestampLabel(item.created_at)} · {item.author?.full_name || 'Staff'}
            </Text>
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
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 106 },
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
                  Staff Updates
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  Notices sent to members and your gym team
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/(staff)/announcements/create')}
                style={[styles.createButton, { backgroundColor: colors.primary }]}
                accessibilityLabel="New announcement"
              >
                <Ionicons name="add" size={22} color="#11170B" />
              </TouchableOpacity>
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
    marginRight: 14,
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
  createButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  timeText: {
    fontSize: 11,
    flexShrink: 1,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 10,
    flexShrink: 1,
  },
  deleteButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    lineHeight: 23,
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
});
