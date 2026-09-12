import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useMembers } from '../../hooks/useMembers';
import { daysRemaining, formatDate, today } from '../../utils/date';
import MemberListItem from '../../components/MemberListItem';
import Input from '../../components/ui/Input';
import Avatar from '../../components/ui/Avatar';
import StatusBadge from '../../components/ui/StatusBadge';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

type FilterStatus = 'all' | 'active' | 'expiring' | 'unpaid' | 'expired' | 'pending';

/** Drives both the Expiring filter and the "Expires in N days" subtitle. */
const EXPIRING_WITHIN_DAYS = 7;

// "No unpaid members in this gym" read as broken English, and for the derived
// filters the status word is not a thing a member can be.
const EMPTY_COPY: Record<FilterStatus, string> = {
  all: 'No members in this gym yet.',
  active: 'No active members right now.',
  expiring: `No memberships expiring in the next ${EXPIRING_WITHIN_DAYS} days.`,
  unpaid: 'Everyone has a plan recorded — nobody is training unpaid.',
  expired: 'No expired memberships.',
  pending: 'No join requests waiting for approval.',
};

export default function StaffMembersScreen() {
  const insets = useSafeAreaInsets();
  const { currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('all');
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const {
    members,
    loading,
    refresh,
  } = useMembers({
    status: selectedStatus,
    search: searchQuery,
    expiringWithinDays: EXPIRING_WITHIN_DAYS,
  });

  /**
   * What the row says under the name. Coverage is now trustworthy for staff
   * (migration 027); before that every member read "No plan recorded".
   *
   * Dates are compared as YYYY-MM-DD strings against the LOCAL today(), not via
   * Date arithmetic: active_end_date is a DATE column, and daysRemaining()
   * clamps anything past to 0, so it cannot tell "expires today" from "expired
   * last month".
   */
  const memberSubtitle = (item: (typeof members)[0]): string => {
    if (item.active_end_date) {
      const t = today();
      if (item.active_end_date < t) return `Expired ${formatDate(item.active_end_date)}`;
      if (item.active_end_date === t) return 'Expires today';
      const left = daysRemaining(item.active_end_date);
      if (left <= EXPIRING_WITHIN_DAYS) {
        return `Expires in ${left} day${left === 1 ? '' : 's'}`;
      }
      return `Paid to ${formatDate(item.active_end_date)}`;
    }
    // Only a plain member with no coverage is a billing problem worth flagging.
    // The owner has no plan by design, so show contact details instead.
    if (item.role === 'member') return 'No plan recorded';
    return item.profile?.phone || item.profile?.email || 'No contact';
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const filterTabs: Array<{ label: string; value: FilterStatus }> = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    // Also derived: useMembers has supported 'expiring' all along but no screen
    // ever exposed it. It only became meaningful for staff once migration 027
    // made coverage dates visible to them -- before that active_end_date was
    // always null here, so this filter would have returned nobody.
    { label: 'Expiring', value: 'expiring' },
    // Derived, not a gym_members.status — active members with no subscription.
    { label: 'No Plan', value: 'unpaid' },
    { label: 'Expired', value: 'expired' },
    { label: 'Pending', value: 'pending' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header & Search */}
      <View
        style={[
          styles.headerSection,
          { paddingTop: Math.max(insets.top + 12, 44) },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>Gym Members</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Directory and member status overview
        </Text>

        {/* Search Bar */}
        <Input
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          leftIcon={<Ionicons name="search" size={18} color={colors.textSecondary} />}
          rightIcon={
            searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : undefined
          }
          style={styles.searchInput}
        />

        {/* Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
        >
          {filterTabs.map((tab) => {
            const isSelected = selectedStatus === tab.value;
            return (
              <TouchableOpacity
                key={tab.value}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedStatus(tab.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: isSelected ? '#000000' : colors.textSecondary },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Members FlatList */}
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MemberListItem
            name={item.profile?.full_name || 'Member'}
            photoUrl={item.profile?.photo_url}
            status={item.status}
            role={item.role}
            subtitle={memberSubtitle(item)}
            onPress={() => setSelectedMember(item)}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 106 },
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
        ListEmptyComponent={
          loading && !refreshing ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary, marginTop: 12 }]}>
                Loading members...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="people-outline" size={48} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No members found
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                {searchQuery
                  ? `No members matching "${searchQuery}".`
                  : EMPTY_COPY[selectedStatus]}
              </Text>
            </View>
          )
        }
      />

      {/* Member Info Modal (Read-only Staff View) */}
      <Modal
        visible={!!selectedMember}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedMember(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Member Details
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedMember(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedMember && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Profile Card Header */}
                <View style={styles.memberModalHeader}>
                  <Avatar
                    uri={selectedMember.profile?.photo_url}
                    name={selectedMember.profile?.full_name || 'Member'}
                    size={68}
                  />
                  <Text style={[styles.memberModalName, { color: colors.text }]}>
                    {selectedMember.profile?.full_name || 'Member'}
                  </Text>
                  <View style={styles.badgeRow}>
                    <StatusBadge status={selectedMember.status} />
                    <Badge
                      text={selectedMember.role.toUpperCase()}
                      variant="default"
                      size="sm"
                    />
                  </View>
                </View>

                {/* Details List */}
                <View style={styles.detailsContainer}>
                  <View style={styles.detailRow}>
                    <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Email</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedMember.profile?.email || 'N/A'}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Phone</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedMember.profile?.phone || 'N/A'}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Ionicons name="flame-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Goal</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedMember.profile?.fitness_goal
                        ? selectedMember.profile.fitness_goal.replace(/_/g, ' ')
                        : 'General Fitness'}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Slot</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedMember.preferred_time_slot ||
                        selectedMember.auto_time_slot ||
                        'Not set'}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Joined</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {formatDate(selectedMember.joined_at)}
                    </Text>
                  </View>
                </View>

                {/* Close Button */}
                <Button
                  title="Close"
                  onPress={() => setSelectedMember(null)}
                  variant="primary"
                  size="md"
                  fullWidth
                  style={styles.modalCloseBtn}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 14,
  },
  searchInput: {
    marginBottom: 10,
  },
  filterScroll: {
    flexDirection: 'row',
  },
  filterScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingTop: 8,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  memberModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  memberModalName: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailsContainer: {
    borderRadius: 14,
    gap: 12,
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 13,
    width: 60,
    marginLeft: 10,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  modalCloseBtn: {
    marginBottom: 10,
  },
});
