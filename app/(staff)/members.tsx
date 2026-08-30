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
import { formatDate } from '../../utils/date';
import MemberListItem from '../../components/MemberListItem';
import Input from '../../components/ui/Input';
import Avatar from '../../components/ui/Avatar';
import StatusBadge from '../../components/ui/StatusBadge';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

type FilterStatus = 'all' | 'active' | 'expired' | 'pending';

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
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const filterTabs: Array<{ label: string; value: FilterStatus }> = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
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
            subtitle={item.profile?.phone || item.profile?.email || 'No contact'}
            onPress={() => setSelectedMember(item)}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 32 },
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
                  : `No ${selectedStatus === 'all' ? '' : selectedStatus} members in this gym.`}
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
