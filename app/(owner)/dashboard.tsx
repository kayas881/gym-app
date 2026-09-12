import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import DuesBanner from '../../components/DuesBanner';
import PeakHoursChart from '../../components/PeakHoursChart';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { formatDate, formatDateTime, timeAgo, today, daysFromToday, localDayRange } from '../../utils/date';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { useComplaints } from '../../hooks/useComplaints';

interface DashboardStats {
  activeMembers: number;
  pendingApprovals: number;
  pendingRenewals: number;
  revenueThisMonth: number;
  expiringSoon: number;
}

interface RecentCheckIn {
  id: string;
  checked_in_at: string;
  member: {
    id: string;
    profile: {
      full_name: string;
      photo_url: string | null;
    };
  };
}

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const { profile, gymId, currentMembership, supabase } = useAppAuth();
  const { colors } = useTheme();

  const [stats, setStats] = useState<DashboardStats>({
    activeMembers: 0,
    pendingApprovals: 0,
    pendingRenewals: 0,
    revenueThisMonth: 0,
    expiringSoon: 0,
  });
  const [todayAttendanceCount, setTodayAttendanceCount] = useState(0);
  const [recentAttendance, setRecentAttendance] = useState<RecentCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Announcement Modal State
  const [announcementModalVisible, setAnnouncementModalVisible] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [targetAudience, setTargetAudience] = useState<
    'everyone' | 'active' | 'morning' | 'afternoon' | 'evening' | 'staff'
  >('everyone');
  const [isSubmittingAnnouncement, setIsSubmittingAnnouncement] = useState(false);

  // Complaints Modal State
  const [complaintsModalVisible, setComplaintsModalVisible] = useState(false);
  const { complaints, counts: complaintCounts, updateComplaintStatus, refresh: refreshComplaints } = useComplaints();
  const { createAnnouncement } = useAnnouncements();

  const fetchDashboardData = useCallback(async () => {
    if (!gymId) return;

    try {
      // Expire lapsed memberships first, otherwise "Active Members" counts
      // members whose subscriptions ended months ago. Best-effort.
      const { error: expireError } = await supabase.rpc('expire_stale_memberships', {
        target_gym_id: gymId,
      });
      if (expireError) {
        console.warn('[Dashboard] expire_stale_memberships failed:', expireError.message);
      }

      // 1. Fetch gym member counts
      // role='member' matters: the owner and every staff member also have a
      // gym_members row, so without it a gym with 2 real members reported 4.
      const { count: activeCount, error: activeError } = await supabase
        .from('gym_members')
        .select('*', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .eq('status', 'active');

      if (activeError) console.error('[Dashboard] Active count error:', activeError);

      const { count: pendingCount, error: pendingError } = await supabase
        .from('gym_members')
        .select('*', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('status', 'pending');

      if (pendingError) console.error('[Dashboard] Pending count error:', pendingError);

      // Open renewal requests. Until this existed the ONLY in-app signal was
      // a banner inside the member's own profile screen, so the owner had to
      // already know who had asked in order to find out that they had asked.
      const { count: renewalCount, error: renewalError } = await supabase
        .from('renewal_requests')
        .select('*', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('status', 'pending');

      if (renewalError) console.error('[Dashboard] Renewal count error:', renewalError);

      // Get all member IDs for this gym to query subscriptions
      const { data: memberRows, error: memberRowsError } = await supabase
        .from('gym_members')
        .select('id')
        .eq('gym_id', gymId);

      if (memberRowsError) console.error('[Dashboard] Member IDs error:', memberRowsError);

      const memberIds = (memberRows || []).map((m: { id: string }) => m.id);

      let revenueThisMonth = 0;
      let expiringSoonCount = 0;

      if (memberIds.length > 0) {
        // 2. Calculate revenue this month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { data: subData, error: subError } = await supabase
          .from('subscriptions')
          .select('amount_paid, created_at')
          .in('gym_member_id', memberIds)
          .gte('created_at', startOfMonth);

        if (subError) {
          console.error('[Dashboard] Subscriptions revenue error:', subError);
        } else if (subData) {
          revenueThisMonth = subData.reduce(
            (sum: number, item: { amount_paid: number }) => sum + (Number(item.amount_paid) || 0),
            0
          );
        }

        // 3. Count subscriptions expiring within 7 days
        // Local calendar day, not UTC: toISOString() reports yesterday
        // between 00:00 and 05:29 IST.
        const todayStr = today();
        const next7DaysStr = daysFromToday(7);

        // Counted per MEMBER, over their latest end date — not per subscription.
        // Since migration 024 an early renewal leaves two 'active' rows, so a
        // member paid up to March still has a row ending 30 Nov. A row-level
        // count would have put them in "Expiring in 7 days" on 23 Nov and told
        // the owner to chase somebody who had already paid.
        const { data: activeSubRows, error: expError } = await supabase
          .from('subscriptions')
          .select('gym_member_id, end_date')
          .in('gym_member_id', memberIds)
          .eq('status', 'active');

        if (expError) {
          console.error('[Dashboard] Expiring count error:', expError);
        } else {
          const latestEndByMember = new Map<string, string>();
          for (const row of (activeSubRows || []) as {
            gym_member_id: string;
            end_date: string;
          }[]) {
            const current = latestEndByMember.get(row.gym_member_id);
            if (!current || row.end_date > current) {
              latestEndByMember.set(row.gym_member_id, row.end_date);
            }
          }

          expiringSoonCount = [...latestEndByMember.values()].filter(
            (end) => end >= todayStr && end <= next7DaysStr
          ).length;
        }
      }

      setStats({
        activeMembers: activeCount || 0,
        pendingApprovals: pendingCount || 0,
        pendingRenewals: renewalCount || 0,
        revenueThisMonth,
        expiringSoon: expiringSoonCount,
      });

      // 4. Today's attendance
      const { start: dayStart, end: dayEnd } = localDayRange();
      const { data: attendanceData, error: attError, count: attCount } = await supabase
        .from('check_ins')
        .select(
          `
          id,
          checked_in_at,
          member:gym_members (
            id,
            profile:profiles (
              full_name,
              photo_url
            )
          )
        `,
          { count: 'exact' }
        )
        .eq('gym_id', gymId)
        .gte('checked_in_at', dayStart)
        .lte('checked_in_at', dayEnd)
        .order('checked_in_at', { ascending: false })
        .limit(4);

      if (attError) {
        console.error('[Dashboard] Attendance error:', attError);
      } else {
        setTodayAttendanceCount(attCount || 0);
        setRecentAttendance((attendanceData as unknown as RecentCheckIn[]) || []);
      }
    } catch (err) {
      console.error('[Dashboard] Unexpected error fetching dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // The dashboard is a mounted tab, so it kept showing stale counts after the
  // owner acted elsewhere — most visibly the renewal-request banner, which
  // would still be up after the payment that cleared the request.
  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [fetchDashboardData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
    refreshComplaints();
  };

  const handlePostAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementBody.trim()) {
      Alert.alert('Required Fields', 'Please enter both title and message.');
      return;
    }

    setIsSubmittingAnnouncement(true);
    try {
      await createAnnouncement({
        title: announcementTitle.trim(),
        body: announcementBody.trim(),
        targetAudience,
      });
      Alert.alert('Success', 'Announcement posted successfully.');
      setAnnouncementTitle('');
      setAnnouncementBody('');
      setTargetAudience('everyone');
      setAnnouncementModalVisible(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to post announcement.');
    } finally {
      setIsSubmittingAnnouncement(false);
    }
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const gymName = currentMembership?.gym?.name || 'My Gym';
  const ownerName = profile?.full_name?.split(' ')[0] || 'Owner';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* A working header, not a marketing greeting: gym context and the
            date are visible before the owner starts scanning numbers. */}
        <View style={styles.header}>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.dateText, { color: colors.textSecondary }]}>
              {todayFormatted.toUpperCase()}
            </Text>
            <Text style={[styles.greetingText, { color: colors.text }]}>
              {gymName}
            </Text>
            <Text style={[styles.gymSubTitle, { color: colors.textSecondary }]}>
              Owner workspace · {ownerName}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.settingsButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
            onPress={() => router.push('/(owner)/settings')}
            activeOpacity={0.7}
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {loading && !refreshing ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>
              Loading dashboard metrics...
            </Text>
          </View>
        ) : (
          <>
            {/* Revenue is the lead number because it tells the owner how the
                business is moving. Supporting operational counts sit together
                below instead of competing as four equally loud cards. */}
            <TouchableOpacity
              style={[
                styles.revenueHero,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => router.push('/(owner)/payments')}
              activeOpacity={0.88}
            >
              <View style={styles.revenueHeroTop}>
                <Text style={[styles.revenueEyebrow, { color: colors.primary }]}>REVENUE · THIS MONTH</Text>
              </View>
              <Text style={[styles.revenueValue, { color: colors.text }]}>
                ₹{stats.revenueThisMonth.toLocaleString('en-IN')}
              </Text>
              <View style={styles.revenueFooter}>
                <Text style={[styles.revenueCaption, { color: colors.textSecondary }]}>Payments collected</Text>
                <View style={styles.revenueLinkRow}>
                  <Text style={[styles.revenueLink, { color: colors.primary }]}>Open payments</Text>
                  <Ionicons name="arrow-forward" size={15} color={colors.primary} />
                </View>
              </View>
            </TouchableOpacity>

            {/* Renewal requests need their own row rather than a number in the
                Pending card: they are the one thing on this screen that costs
                the owner money to ignore. */}
            {stats.pendingRenewals > 0 ? (
              <TouchableOpacity
                onPress={() => router.push('/(owner)/members/pending')}
                activeOpacity={0.8}
                style={[
                  styles.renewalAlert,
                  { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
                ]}
              >
                <View style={[styles.renewalAlertIcon, { backgroundColor: colors.primary }]}>
                  <Ionicons name="refresh" size={20} color="#000000" />
                </View>
                <View style={styles.renewalAlertText}>
                  <Text style={[styles.renewalAlertTitle, { color: colors.text }]}>
                    {stats.pendingRenewals}{' '}
                    {stats.pendingRenewals === 1 ? 'renewal request' : 'renewal requests'}
                  </Text>
                  <Text style={[styles.renewalAlertBody, { color: colors.textSecondary }]}>
                    {stats.pendingRenewals === 1 ? 'A member wants' : 'Members want'} to renew —
                    tap to review and take payment
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
              </TouchableOpacity>
            ) : null}

            {/* The Revenue card above reports money COLLECTED. Nothing else on
                this screen can say money is still owed, so a part payment was
                recorded and then effectively disappeared -- the owner saw
                "Revenue 2,300" and had no way to reach the 200 outstanding. */}
            <DuesBanner />

            <View style={[styles.metricsPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.metricItem}
                onPress={() => router.push('/(owner)/members?status=active')}
                activeOpacity={0.7}
              >
                <Text style={[styles.metricValue, { color: colors.text }]}>{stats.activeMembers}</Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>ACTIVE{`\n`}MEMBERS</Text>
              </TouchableOpacity>
              <View style={[styles.metricDivider, { backgroundColor: colors.divider }]} />
              <TouchableOpacity
                style={styles.metricItem}
                onPress={() => router.push('/(owner)/members/pending')}
                activeOpacity={0.7}
              >
                <Text style={[styles.metricValue, { color: stats.pendingApprovals ? colors.warning : colors.text }]}>
                  {stats.pendingApprovals}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>PENDING{`\n`}APPROVALS</Text>
              </TouchableOpacity>
              <View style={[styles.metricDivider, { backgroundColor: colors.divider }]} />
              <TouchableOpacity
                style={styles.metricItem}
                onPress={() => router.push('/(owner)/members?status=expiring')}
                activeOpacity={0.7}
              >
                <Text style={[styles.metricValue, { color: stats.expiringSoon ? colors.error : colors.text }]}>
                  {stats.expiringSoon}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>EXPIRING{`\n`}IN 7 DAYS</Text>
              </TouchableOpacity>
            </View>

            {/* The two desk tasks get prominent targets; lower-frequency
                configuration lives in a quieter, scannable tools list. */}
            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={[styles.sectionEyebrow, { color: colors.primary }]}>FRONT DESK</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Run the gym</Text>
              </View>
            </View>

            <View
              style={[
                styles.quickActionsContainer,
                { borderTopColor: colors.border, borderBottomColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.primaryAction}
                onPress={() => router.push('/(owner)/members/add')}
                activeOpacity={0.84}
              >
                <Text style={[styles.actionNumber, { color: colors.primary }]}>01</Text>
                <View style={styles.primaryActionCopy}>
                  <Text style={[styles.primaryActionTitle, { color: colors.text }]}>Add member</Text>
                  <Text style={[styles.primaryActionSubtitle, { color: colors.textSecondary }]}>Create a member record</Text>
                </View>
                <Ionicons name="arrow-forward" size={20} color={colors.primary} />
              </TouchableOpacity>

              <View style={[styles.actionDivider, { backgroundColor: colors.divider }]} />

              <TouchableOpacity
                style={styles.primaryAction}
                // The record-payment screen has its own member picker, so this
                // can go directly to collection without an intermediate list.
                onPress={() => router.push('/(owner)/payments/record')}
                activeOpacity={0.84}
              >
                <Text style={[styles.actionNumber, { color: colors.textTertiary }]}>02</Text>
                <View style={styles.primaryActionCopy}>
                  <Text style={[styles.primaryActionTitle, { color: colors.text }]}>Record payment</Text>
                  <Text style={[styles.primaryActionSubtitle, { color: colors.textSecondary }]}>Collect or renew a plan</Text>
                </View>
                <Ionicons name="arrow-forward" size={19} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.toolsPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.toolRow}
                onPress={() => router.push('/(owner)/announcements')}
                activeOpacity={0.7}
              >
                <View style={[styles.toolMarker, { backgroundColor: colors.info }]} />
                <View style={styles.toolCopy}>
                  <Text style={[styles.toolTitle, { color: colors.text }]}>Announcements</Text>
                  <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]}>Create and review gym updates</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <View style={[styles.toolDivider, { backgroundColor: colors.divider }]} />

              <TouchableOpacity
                style={styles.toolRow}
                onPress={() => router.push('/(owner)/complaints')}
                activeOpacity={0.7}
              >
                <View style={[styles.toolMarker, { backgroundColor: colors.warning }]} />
                <View style={styles.toolCopy}>
                  <Text style={[styles.toolTitle, { color: colors.text }]}>Member issues</Text>
                  <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]}>Read and resolve complaints</Text>
                </View>
                {complaintCounts.new > 0 ? (
                  <View style={[styles.countBadge, { backgroundColor: colors.error }]}>
                    <Text style={styles.countBadgeText}>{complaintCounts.new}</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
              <View style={[styles.toolDivider, { backgroundColor: colors.divider }]} />

              <TouchableOpacity
                style={styles.toolRow}
                onPress={() => router.push('/(owner)/plans')}
                activeOpacity={0.7}
              >
                <View style={[styles.toolMarker, { backgroundColor: colors.primary }]} />
                <View style={styles.toolCopy}>
                  <Text style={[styles.toolTitle, { color: colors.text }]}>Plans & pricing</Text>
                  <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]}>Manage what members can buy</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* Peak Hours (Phase 3 item 7) */}
            <PeakHoursChart />

            {/* Today's Attendance Section */}
            <View style={styles.attendanceSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.titleWithBadge}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Today's Attendance
                  </Text>
                  <Badge
                    text={`${todayAttendanceCount} Check-ins`}
                    variant="info"
                    size="sm"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/(owner)/attendance')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.viewAllText, { color: colors.primary }]}>
                    View All →
                  </Text>
                </TouchableOpacity>
              </View>

              <Card style={styles.attendanceCard} padding={12}>
                {recentAttendance.length === 0 ? (
                  <View style={styles.emptyAttendance}>
                    <Ionicons name="finger-print-outline" size={36} color={colors.textTertiary} />
                    <Text style={[styles.emptyAttendanceText, { color: colors.textSecondary }]}>
                      No check-ins recorded yet today.
                    </Text>
                  </View>
                ) : (
                  recentAttendance.map((item, index) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.attendanceRow,
                        index < recentAttendance.length - 1 && {
                          borderBottomWidth: 1,
                          borderBottomColor: colors.divider,
                        },
                      ]}
                      onPress={() => router.push(`/(owner)/members/${item.member?.id}`)}
                      activeOpacity={0.7}
                    >
                      <Avatar
                        uri={item.member?.profile?.photo_url}
                        name={item.member?.profile?.full_name || 'Member'}
                        size={38}
                      />
                      <View style={styles.attendanceInfo}>
                        <Text style={[styles.attendanceName, { color: colors.text }]} numberOfLines={1}>
                          {item.member?.profile?.full_name || 'Unknown Member'}
                        </Text>
                        <Text style={[styles.attendanceTime, { color: colors.textSecondary }]}>
                          {timeAgo(item.checked_in_at)}
                        </Text>
                      </View>
                      <Badge
                        text={new Date(item.checked_in_at).toLocaleTimeString('en-IN', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })}
                        variant="default"
                        size="sm"
                      />
                    </TouchableOpacity>
                  ))
                )}
              </Card>
            </View>
          </>
        )}
      </ScrollView>

      {/* Post Announcement Modal */}
      <Modal
        visible={announcementModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setAnnouncementModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Post Announcement
              </Text>
              <TouchableOpacity
                onPress={() => setAnnouncementModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Input
                label="Title"
                placeholder="e.g. Gym Timing Update for Holiday"
                value={announcementTitle}
                onChangeText={setAnnouncementTitle}
              />

              <Input
                label="Message"
                placeholder="Write your announcement details here..."
                value={announcementBody}
                onChangeText={setAnnouncementBody}
                multiline
                numberOfLines={4}
              />

              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Target Audience
              </Text>
              <View style={styles.audienceChipContainer}>
                {(['everyone', 'active', 'morning', 'afternoon', 'evening', 'staff'] as const).map((aud) => {
                  const isSelected = targetAudience === aud;
                  return (
                    <TouchableOpacity
                      key={aud}
                      style={[
                        styles.audienceChip,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setTargetAudience(aud)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.audienceChipText,
                          { color: isSelected ? '#000000' : colors.textSecondary },
                        ]}
                      >
                        {aud.charAt(0).toUpperCase() + aud.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.modalButtonRow}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setAnnouncementModalVisible(false)}
                  style={styles.modalButton}
                />
                <Button
                  title="Post Announcement"
                  variant="primary"
                  loading={isSubmittingAnnouncement}
                  onPress={handlePostAnnouncement}
                  style={styles.modalButton}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Complaints Modal */}
      <Modal
        visible={complaintsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setComplaintsModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContentLarge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={styles.titleWithBadge}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Member Complaints
                </Text>
                {complaints.length > 0 && (
                  <Badge text={`${complaints.length} Total`} variant="warning" size="sm" />
                )}
              </View>
              <TouchableOpacity
                onPress={() => setComplaintsModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {complaints.length === 0 ? (
                <View style={styles.emptyComplaintsContainer}>
                  <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
                  <Text style={[styles.emptyComplaintsTitle, { color: colors.text }]}>
                    No Complaints!
                  </Text>
                  <Text style={[styles.emptyComplaintsSub, { color: colors.textSecondary }]}>
                    There are currently no reported issues from gym members.
                  </Text>
                </View>
              ) : (
                complaints.map((c) => {
                  const statusVariant =
                    c.status === 'resolved'
                      ? 'success'
                      : c.status === 'acknowledged'
                      ? 'info'
                      : 'error';

                  return (
                    <TouchableOpacity
                      key={c.id}
                      activeOpacity={0.8}
                      // The full detail screen is the only place the attached
                      // photo and the reply box are rendered; this modal is a
                      // summary, so it has to lead there.
                      onPress={() => {
                        setComplaintsModalVisible(false);
                        router.push(`/(owner)/complaints/${c.id}`);
                      }}
                      style={[
                        styles.complaintCard,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.complaintTopRow}>
                        <View style={styles.complaintUserRow}>
                          <Avatar
                            uri={c.member?.profile?.photo_url}
                            name={c.member?.profile?.full_name || 'Member'}
                            size={32}
                          />
                          <View style={styles.complaintUserInfo}>
                            <Text style={[styles.complaintUserName, { color: colors.text }]}>
                              {c.member?.profile?.full_name || 'Anonymous'}
                            </Text>
                            <Text style={[styles.complaintDate, { color: colors.textTertiary }]}>
                              {formatDateTime(c.created_at)}
                            </Text>
                          </View>
                        </View>
                        <Badge text={c.status.toUpperCase()} variant={statusVariant} size="sm" />
                      </View>

                      <Text style={[styles.complaintSubject, { color: colors.text }]}>
                        {c.subject}
                      </Text>
                      <Text style={[styles.complaintBody, { color: colors.textSecondary }]}>
                        {c.body}
                      </Text>

                      {c.owner_response ? (
                        <View
                          style={[
                            styles.responseContainer,
                            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                          ]}
                        >
                          <Text style={[styles.responseLabel, { color: colors.primary }]}>
                            Your Response:
                          </Text>
                          <Text style={[styles.responseText, { color: colors.text }]}>
                            {c.owner_response}
                          </Text>
                        </View>
                      ) : null}

                      {c.status !== 'resolved' && (
                        <View style={styles.complaintActionRow}>
                          {c.status === 'new' && (
                            <Button
                              title="Acknowledge"
                              variant="outline"
                              size="sm"
                              onPress={async () => {
                                try {
                                  await updateComplaintStatus(c.id, 'acknowledged');
                                } catch (e: any) {
                                  Alert.alert('Error', e.message);
                                }
                              }}
                              style={styles.actionBtnHalf}
                            />
                          )}
                          {/* Resolving is the last thing the member hears about
                              the issue, so it has to carry a reply. This used to
                              resolve in place with no response, which left every
                              resolved complaint blank on the member's side. The
                              reply box lives on the detail screen and requires
                              text before it will save. */}
                          <Button
                            title="Resolve & Reply"
                            variant="primary"
                            size="sm"
                            onPress={() => {
                              setComplaintsModalVisible(false);
                              router.push(`/(owner)/complaints/${c.id}`);
                            }}
                            style={styles.actionBtnHalf}
                          />
                        </View>
                      )}

                      <View style={styles.complaintOpenRow}>
                        {c.photo_url ? (
                          <View style={styles.complaintPhotoHint}>
                            <Ionicons name="image-outline" size={14} color={colors.textTertiary} />
                            <Text style={[styles.complaintOpenText, { color: colors.textTertiary }]}>
                              Photo attached
                            </Text>
                          </View>
                        ) : (
                          <View />
                        )}
                        <View style={styles.complaintPhotoHint}>
                          <Text style={[styles.complaintOpenText, { color: colors.primary }]}>
                            View details
                          </Text>
                          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}

              {complaints.length > 0 && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setComplaintsModalVisible(false);
                    router.push('/(owner)/complaints');
                  }}
                  style={[styles.viewAllComplaints, { borderColor: colors.border }]}
                >
                  <Text style={[styles.complaintOpenText, { color: colors.primary }]}>
                    View all complaints
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  renewalAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  renewalAlertIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renewalAlertText: { flex: 1 },
  renewalAlertTitle: { fontSize: 15, fontWeight: '700' },
  renewalAlertBody: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  viewAllComplaints: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
    borderTopWidth: 1,
  },
  complaintOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  complaintPhotoHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  complaintOpenText: {
    fontSize: 12,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 52,
    paddingBottom: 118,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  headerTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  greetingText: {
    fontSize: 29,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 3,
  },
  gymSubTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  dateText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.25,
  },
  settingsButton: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLabel: {
    marginTop: 12,
    fontSize: 14,
  },
  revenueHero: {
    minHeight: 132,
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
  },
  revenueHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  revenueEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.35,
  },
  revenueValue: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '900',
    letterSpacing: -1.5,
    marginTop: 7,
  },
  revenueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  revenueCaption: { fontSize: 12, fontWeight: '600' },
  revenueLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  revenueLink: { fontSize: 12, fontWeight: '800' },
  metricsPanel: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 16,
    marginBottom: 28,
  },
  metricItem: {
    flex: 1,
    paddingHorizontal: 10,
  },
  metricValue: {
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  metricLabel: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.65,
  },
  metricDivider: { width: 1 },
  statsSection: {
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCardHalf: {
    flex: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.55,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  quickActionsContainer: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  primaryAction: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionNumber: {
    width: 38,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  actionDivider: { height: 1, marginLeft: 38 },
  primaryActionCopy: { flex: 1 },
  primaryActionTitle: { fontSize: 16, fontWeight: '800' },
  primaryActionSubtitle: { fontSize: 11, fontWeight: '500', marginTop: 3 },
  toolsPanel: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 13,
    marginBottom: 28,
    overflow: 'hidden',
  },
  toolRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolMarker: { width: 6, height: 6, borderRadius: 3 },
  toolCopy: { flex: 1, marginLeft: 13 },
  toolTitle: { fontSize: 14, fontWeight: '700' },
  toolSubtitle: { fontSize: 11, marginTop: 2 },
  toolDivider: { height: 1, marginLeft: 19 },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  quickActionButton: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    // Tightened from 12/10 with a 40px icon: that left ~98dp for the label,
    // too narrow for "Announcement" (~110dp at 13px), so it broke mid-word.
    paddingHorizontal: 10,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  quickActionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabelContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  miniBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  miniBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  attendanceSection: {
    marginBottom: 10,
  },
  attendanceCard: {
    borderRadius: 16,
  },
  emptyAttendance: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyAttendanceText: {
    fontSize: 14,
    fontWeight: '500',
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  attendanceInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  attendanceName: {
    fontSize: 15,
    fontWeight: '600',
  },
  attendanceTime: {
    fontSize: 12,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 20,
    maxHeight: '85%',
  },
  modalContentLarge: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  audienceChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  audienceChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  audienceChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  modalButton: {
    flex: 1,
  },
  emptyComplaintsContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyComplaintsTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyComplaintsSub: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  complaintCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  complaintTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  complaintUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  complaintUserInfo: {
    flex: 1,
  },
  complaintUserName: {
    fontSize: 14,
    fontWeight: '600',
  },
  complaintDate: {
    fontSize: 11,
  },
  complaintSubject: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  complaintBody: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  responseContainer: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 8,
  },
  responseLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  responseText: {
    fontSize: 13,
  },
  complaintActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  actionBtnHalf: {
    flex: 1,
  },
});
