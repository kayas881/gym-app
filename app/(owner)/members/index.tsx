import React, { useState, useMemo } from 'react';
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../lib/theme';
import MemberListItem from '../../../components/MemberListItem';
import { useMembers } from '../../../hooks/useMembers';
import Input from '../../../components/ui/Input';

type FilterTab = 'all' | 'active' | 'pending' | 'expired';

interface TabItem {
  key: FilterTab;
  label: string;
}

const TABS: TabItem[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'expired', label: 'Expired' },
];

export default function OwnerMembersListScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch all members for counting pending badges, or use specific filter
  const {
    members,
    loading,
    refresh,
  } = useMembers({
    status: activeTab === 'all' ? undefined : activeTab,
    search: searchQuery,
  });

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
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Gym Members
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.pendingBadgeButton,
            {
              backgroundColor: pendingCount > 0 ? (isDark ? 'rgba(255, 179, 0, 0.18)' : 'rgba(245, 127, 23, 0.12)') : colors.surface,
              borderColor: pendingCount > 0 ? colors.warning : colors.border,
            },
          ]}
          onPress={() => router.push('/(owner)/members/pending')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="time-outline"
            size={18}
            color={pendingCount > 0 ? colors.warning : colors.textSecondary}
          />
          {pendingCount > 0 && (
            <View style={[styles.badgeNumber, { backgroundColor: colors.warning }]}>
              <Text style={styles.badgeNumberText}>{pendingCount}</Text>
            </View>
          )}
        </TouchableOpacity>
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
              subtitle={item.profile?.phone || item.profile?.email || undefined}
              onPress={() => router.push(`/(owner)/members/${item.id}`)}
            />
          )}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refresh}
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
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
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
    paddingBottom: 90,
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
