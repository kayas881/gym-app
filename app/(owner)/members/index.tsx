import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import MemberListItem from '../../../components/MemberListItem';
import { useMembers } from '../../../hooks/useMembers';
import { daysRemaining, formatDate } from '../../../utils/date';
import Input from '../../../components/ui/Input';

type FilterTab = 'all' | 'active' | 'expiring' | 'unpaid' | 'pending' | 'expired' | 'removed';

interface TabItem {
  key: FilterTab;
  label: string;
}

const TABS: TabItem[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  // Derived, not a gym_members.status: active members whose subscription ends
  // within 7 days. This is the "who do I need to chase" list.
  { key: 'expiring', label: 'Expiring' },
  // Active members with no subscription at all — approved without payment.
  // Without this they look identical to paying members in the Active tab.
  { key: 'unpaid', label: 'No Plan' },
  { key: 'pending', label: 'Pending' },
  { key: 'expired', label: 'Expired' },
  // Former members. Excluded from every other tab (see useMembers), so this is
  // the only place they can be found and restored.
  { key: 'removed', label: 'Removed' },
];

export default function OwnerMembersListScreen() {
  const router = useRouter();
  const { gymId, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  // Honour ?status= from the dashboard cards.
  //
  // This tab screen stays mounted, so its filter previously persisted from the
  // last visit and a card tap landed you on whatever was already selected —
  // which read as the filter being "stuck". Keying off the param makes the
  // entry point deterministic while manual changes still stick within a visit.
  const params = useLocalSearchParams<{ status?: string }>();
  const initialTab: FilterTab = TABS.some((t: TabItem) => t.key === params.status)
    ? (params.status as FilterTab)
    : 'all';

  const [activeTab, setActiveTab] = useState<FilterTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');

  // A card tap re-navigates to the same mounted screen, so re-apply the param
  // when it changes rather than relying on initial state.
  useEffect(() => {
    if (params.status && TABS.some((t: TabItem) => t.key === params.status)) {
      setActiveTab(params.status as FilterTab);
    }
  }, [params.status]);

  // Fetch all members for counting pending badges, or use specific filter
  const {
    members,
    loading,
    refresh,
  } = useMembers({
    status: activeTab === 'all' ? undefined : activeTab,
    search: searchQuery,
  });

  // One query for the whole gym rather than a join on every row: the owner
  // needs to spot a renewal while scrolling, and the set is tiny.
  const [renewalMemberIds, setRenewalMemberIds] = useState<Set<string>>(new Set());

  const fetchRenewalFlags = useCallback(async () => {
    if (!gymId) return;
    try {
      const { data, error } = await supabase
        .from('renewal_requests')
        .select('gym_member_id')
        .eq('gym_id', gymId)
        .eq('status', 'pending');

      if (error) {
        console.warn('[Members] Renewal flags:', error.message);
        return;
      }
      setRenewalMemberIds(
        new Set((data ?? []).map((r: { gym_member_id: string }) => r.gym_member_id))
      );
    } catch (err) {
      console.warn('[Members] Renewal flags error:', err);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchRenewalFlags();
  }, [fetchRenewalFlags]);

  // This tab screen stays mounted, so without this the RENEWAL chips would
  // still be showing after the owner took the payment.
  useFocusEffect(
    useCallback(() => {
      fetchRenewalFlags();
    }, [fetchRenewalFlags])
  );

  // Query pending members count separately to show on header/badge
  const { members: allMembersForBadges } = useMembers({ status: 'all' });
  const pendingCount = useMemo(() => {
    return allMembersForBadges.filter((m) => m.status === 'pending').length;
  }, [allMembersForBadges]);

  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconCircle,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)' },
          ]}
        >
          <Ionicons
            name={searchQuery ? 'search-outline' : 'people-outline'}
            size={48}
            color={colors.textTertiary}
          />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {searchQuery ? 'No members found' : `No ${activeTab !== 'all' ? activeTab : ''} members`}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {searchQuery
            ? `No members match "${searchQuery}". Try a different search term.`
            : activeTab === 'pending'
            ? 'There are currently no membership applications awaiting review.'
            : 'Members who join your gym will appear here.'}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Members
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </Text>
        </View>

        {/* Most members never download the app. Without a way to add them by
            hand they did not exist in the system at all, so the owner ran the
            app and a notebook side by side. */}
        <TouchableOpacity
          style={[styles.addMemberButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(owner)/members/add')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#11170B" />
          <Text style={styles.addMemberText}>Add</Text>
        </TouchableOpacity>

        {pendingCount > 0 ? (
          <TouchableOpacity
            style={[
              styles.pendingBadgeButton,
              {
                backgroundColor: isDark ? 'rgba(255, 193, 77, 0.14)' : 'rgba(245, 127, 23, 0.10)',
                borderColor: colors.warning,
              },
            ]}
            onPress={() => router.push('/(owner)/members/pending')}
            activeOpacity={0.7}
          >
            <Ionicons name="time-outline" size={17} color={colors.warning} />
            <View style={[styles.badgeNumber, { backgroundColor: colors.warning }]}>
              <Text style={styles.badgeNumberText}>{pendingCount}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <Input
          placeholder="Search by name, email, or phone..."
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

      {/* Filter Tabs Chips */}
      <View style={styles.tabsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
        >
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.key;
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
                {tab.key === 'pending' && pendingCount > 0 && (
                  <View
                    style={[
                      styles.tabCounter,
                      {
                        backgroundColor: isSelected ? '#000000' : colors.warning,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabCounterText,
                        { color: isSelected ? colors.primary : '#FFFFFF' },
                      ]}
                    >
                      {pendingCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Members FlatList */}
      {loading && members.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading members...
          </Text>
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberListItem
              name={item.profile?.full_name || 'Member'}
              photoUrl={item.profile?.photo_url}
              status={item.status}
              role={item.role}
              hasAppLogin={!!item.profile?.clerk_id}
              subtitle={
                // In the Expiring view the useful fact is WHEN, not the phone
                // number — a list of names you must tap through isn't actionable.
                activeTab === 'expiring' && item.active_end_date
                  ? `Expires in ${daysRemaining(item.active_end_date)} day(s) · ${formatDate(item.active_end_date)}`
                  : activeTab === 'unpaid'
                    ? 'No plan recorded — never paid'
                    : // Flag unpaid members in EVERY list, not just the No Plan
                      // tab. A filter only helps an owner who thinks to look;
                      // this surfaces it while they're scrolling normally.
                      item.status === 'active' &&
                        item.role === 'member' &&
                        !item.active_end_date
                      ? 'No plan recorded'
                      : item.profile?.phone || item.profile?.email || undefined
              }
              hasRenewalRequest={renewalMemberIds.has(item.id)}
              onPress={() => router.push(`/(owner)/members/${item.id}`)}
            />
          )}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => {
                refresh();
                fetchRenewalFlags();
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Floating Action Button for Pending Approvals if any exist */}
      {pendingCount > 0 && activeTab !== 'pending' && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.warning }]}
          onPress={() => router.push('/(owner)/members/pending')}
          activeOpacity={0.85}
        >
          <Ionicons name="person-add" size={20} color="#000000" />
          <Text style={styles.fabText}>
            {pendingCount} Pending {pendingCount === 1 ? 'Approval' : 'Approvals'}
          </Text>
        </TouchableOpacity>
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
  headerTitleGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  addMemberButton: {
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  addMemberText: {
    color: '#11170B',
    fontSize: 13,
    fontWeight: '800',
  },
  pendingBadgeButton: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badgeNumber: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 10,
  },
  badgeNumberText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
  searchSection: {
    paddingHorizontal: 16,
    marginBottom: -4,
  },
  searchInputWrapper: {
    marginBottom: 10,
  },
  tabsWrapper: {
    marginBottom: 8,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
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
    paddingVertical: 1,
    borderRadius: 10,
  },
  tabCounterText: {
    fontSize: 11,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 116,
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
    paddingTop: 60,
    gap: 12,
  },
  emptyIconCircle: {
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
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  fabText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
});
