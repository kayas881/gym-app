import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../lib/theme';
import { useComplaints } from '../../../hooks/useComplaints';
import Card from '../../../components/ui/Card';
import Avatar from '../../../components/ui/Avatar';
import Badge, { BadgeVariant } from '../../../components/ui/Badge';
import { timestampLabel } from '../../../utils/date';

type FilterTab = 'all' | 'new' | 'acknowledged' | 'resolved';

interface TabItem {
  key: FilterTab;
  label: string;
}

const TABS: TabItem[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'resolved', label: 'Resolved' },
];

export default function OwnerComplaintsListScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { complaints, loading, counts, refresh } = useComplaints();

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Filter complaints based on active tab
  const filteredComplaints = useMemo(() => {
    if (activeTab === 'all') return complaints;
    return complaints.filter((c) => c.status === activeTab);
  }, [complaints, activeTab]);

  const getStatusBadgeConfig = (
    status: 'new' | 'acknowledged' | 'resolved'
  ): { label: string; variant: BadgeVariant } => {
    switch (status) {
      case 'new':
        return { label: 'New', variant: 'error' };
      case 'acknowledged':
        return { label: 'Acknowledged', variant: 'warning' };
      case 'resolved':
        return { label: 'Resolved', variant: 'success' };
    }
  };

  const getTabCount = (tab: FilterTab): number => {
    switch (tab) {
      case 'new':
        return counts.new;
      case 'acknowledged':
        return counts.acknowledged;
      case 'resolved':
        return counts.resolved;
      case 'all':
      default:
        return counts.total;
    }
  };

  const renderComplaintItem = ({ item }: { item: (typeof complaints)[0] }) => {
    const { label: statusLabel, variant: statusVariant } = getStatusBadgeConfig(item.status);
    const memberName = item.member?.profile?.full_name || 'Gym Member';
    const photoUrl = item.member?.profile?.photo_url;
    const hasImage = !!item.photo_url;
    const hasResponse = !!item.owner_response;

    return (
      <Card
        style={styles.complaintCard}
        padding={16}
        onPress={() => router.push(`/(owner)/complaints/${item.id}`)}
      >
        {/* Top Member Header */}
        <View style={styles.cardHeader}>
          <View style={styles.memberRow}>
            <Avatar uri={photoUrl} name={memberName} size={38} />
            <View style={styles.memberTextGroup}>
              <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                {memberName}
              </Text>
              <Text style={[styles.timeText, { color: colors.textTertiary }]}>
                {timestampLabel(item.created_at)}
              </Text>
            </View>
          </View>

          <Badge text={statusLabel} variant={statusVariant} size="sm" />
        </View>

        {/* Subject */}
        <Text style={[styles.subjectText, { color: colors.text }]} numberOfLines={1}>
          {item.subject}
        </Text>

        {/* Body Preview */}
        <Text style={[styles.bodyText, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.body}
        </Text>

        {/* Card Footer Features */}
        <View style={[styles.cardFooter, { borderTopColor: colors.divider }]}>
          <View style={styles.indicatorsRow}>
            {hasImage && (
              <View style={[styles.featureTag, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="image-outline" size={13} color={colors.info} />
                <Text style={[styles.featureTagText, { color: colors.info }]}>Photo Attached</Text>
              </View>
            )}

            {hasResponse && (
              <View style={[styles.featureTag, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.primary} />
                <Text style={[styles.featureTagText, { color: colors.primary }]}>Responded</Text>
              </View>
            )}
          </View>

          <View style={styles.viewDetailLink}>
            <Text style={[styles.viewDetailText, { color: colors.primary }]}>
              View Details
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </View>
        </View>
      </Card>
    );
  };

  const renderEmptyState = () => {
    if (loading) return null;

    let emptyMessage = 'No complaints filed yet.';
    if (activeTab === 'new') {
      emptyMessage = 'No new complaints awaiting review.';
    } else if (activeTab === 'acknowledged') {
      emptyMessage = 'No complaints currently under review.';
    } else if (activeTab === 'resolved') {
      emptyMessage = 'No resolved complaints found.';
    }

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconWrap,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' },
          ]}
        >
          <Ionicons
            name={activeTab === 'resolved' ? 'checkmark-circle-outline' : 'chatbubble-ellipses-outline'}
            size={48}
            color={colors.textTertiary}
          />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {activeTab === 'all' ? 'All Clear!' : `No ${activeTab} complaints`}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {emptyMessage}
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
            Member Complaints
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Review issues, inquiries, and grievances
          </Text>
        </View>

        {counts.new > 0 && (
          <View style={[styles.newBadgeAlert, { backgroundColor: colors.error }]}>
            <Text style={styles.newBadgeAlertText}>{counts.new} New</Text>
          </View>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
        >
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.key;
            const count = getTabCount(tab.key);

            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.tabChipText,
                    {
                      color: isSelected ? '#000000' : colors.textSecondary,
                      fontWeight: isSelected ? '700' : '500',
                    },
                  ]}
                >
                  {tab.label}
                </Text>

                {count > 0 && (
                  <View
                    style={[
                      styles.tabCounter,
                      {
                        backgroundColor: isSelected
                          ? '#000000'
                          : tab.key === 'new'
                          ? colors.error
                          : colors.surfaceElevated,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabCounterText,
                        {
                          color: isSelected
                            ? colors.primary
                            : tab.key === 'new'
                            ? '#FFFFFF'
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main List */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading complaints...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredComplaints}
          keyExtractor={(item) => item.id}
          renderItem={renderComplaintItem}
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
  newBadgeAlert: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  newBadgeAlertText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  tabsWrapper: {
    marginBottom: 10,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  tabChipText: {
    fontSize: 13,
  },
  tabCounter: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 10,
  },
  tabCounterText: {
    fontSize: 11,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  complaintCard: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  memberTextGroup: {
    marginLeft: 10,
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
  },
  timeText: {
    fontSize: 11,
    marginTop: 2,
  },
  subjectText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
  },
  indicatorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  featureTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  featureTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  viewDetailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewDetailText: {
    fontSize: 12,
    fontWeight: '700',
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
});
