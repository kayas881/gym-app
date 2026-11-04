import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useSubscriptions } from '../../hooks/useSubscriptions';
import { useCheckIns } from '../../hooks/useCheckIns';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { canViewAnnouncement } from '../../utils/announcement-audience';
import { daysRemaining, formatDate, timeAgo, isExpired, today, localDateOf, daysFromToday } from '../../utils/date';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import { useToday } from '../../hooks/useToday';

export default function MemberHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    activeSubscription,
    upcomingSubscription,
    coverageEndDate,
    loading: subscriptionLoading,
    refresh: refreshSubscription,
  } = useSubscriptions(currentMembership?.id);

  const {
    checkIns,
    hasCheckedInToday,
    loading: checkInsLoading,
    refresh: refreshCheckIns,
  } = useCheckIns(currentMembership?.id);

  const {
    announcements,
    loading: announcementsLoading,
    refresh: refreshAnnouncements,
  } = useAnnouncements();

  const isScreenLoading =
    subscriptionLoading && checkInsLoading && announcementsLoading;
  const isRefreshing = false;

  // Pull to refresh handler
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refreshSubscription(),
      refreshCheckIns(),
      refreshAnnouncements(),
    ]);
    setRefreshing(false);
  }, [refreshSubscription, refreshCheckIns, refreshAnnouncements]);

  // Every memo below that reads the clock takes this as a dependency. Without
  // it they are keyed only on data that does not change at midnight, so the
  // numbers froze at whatever the first render produced -- and a tab screen
  // stays mounted for as long as the app is open.
  const todayKey = useToday();

  // Calculate days remaining & progress
  // Counts to the last covered day across every paid period, not to the end of
  // the current one. A member who renewed early is covered past
  // activeSubscription.end_date, and telling them "91 days left" when they
  // have paid through March would read as losing the renewal.
  const daysLeft = useMemo(() => {
    const end = coverageEndDate ?? activeSubscription?.end_date;
    if (!end) return 0;
    return daysRemaining(end);
  }, [coverageEndDate, activeSubscription?.end_date, todayKey]);

  const membershipExpired = useMemo(() => {
    // A member approved WITHOUT a payment is legitimately active with no
    // subscription at all — migration 003 deliberately never expires them.
    // Treating "no subscription" as expired showed them a permanent red
    // "Membership Expired" banner despite being in good standing.
    const end = coverageEndDate ?? activeSubscription?.end_date;
    if (!end) {
      return currentMembership?.status === 'expired';
    }
    // Coverage, not the current period: otherwise the day the first period
    // ends the member is told they have expired while their renewal is
    // already paid for and starting tomorrow.
    return isExpired(end) || currentMembership?.status === 'expired';
  }, [coverageEndDate, activeSubscription?.end_date, currentMembership?.status, todayKey]);

  // Active, but the owner hasn't recorded a plan yet. Distinct from expired:
  // there is nothing to count down, but nothing is wrong either.
  const awaitingFirstPlan = useMemo(
    () => !activeSubscription?.end_date && currentMembership?.status === 'active',
    [activeSubscription?.end_date, currentMembership?.status]
  );

  // Deliberately measured over the CURRENT period, matching the dates printed
  // directly above the bar. Measuring it over total coverage would show a bar
  // that disagrees with its own caption.
  const planProgressPercent = useMemo(() => {
    if (!activeSubscription?.start_date || !activeSubscription?.end_date) return 0;
    const start = new Date(activeSubscription.start_date).getTime();
    const end = new Date(activeSubscription.end_date).getTime();
    const now = new Date().getTime();

    if (now >= end) return 100;
    if (now <= start) return 0;

    const total = end - start;
    const elapsed = now - start;
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }, [activeSubscription?.start_date, activeSubscription?.end_date]);

  // Calculate total check-ins this month
  const thisMonthCheckIns = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    return checkIns.filter((c) => {
      const d = new Date(c.checked_in_at);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    }).length;
  }, [checkIns, todayKey]);

  // Calculate current streak in consecutive days
  const currentStreak = useMemo(() => {
    if (!checkIns || checkIns.length === 0) return 0;

    // Distinct check-in days, in LOCAL time.
    //
    // `checked_in_at.split('T')[0]` and `toISOString().split('T')[0]` both read
    // the UTC day: in IST a check-in before 05:30 local would be filed under the
    // previous date, silently breaking the streak around midnight. localDateOf()
    // and daysFromToday() do this correctly.
    const dateSet = new Set<string>();
    checkIns.forEach((c) => {
      dateSet.add(localDateOf(c.checked_in_at));
    });

    const todayStr = today();
    const yesterdayStr = daysFromToday(-1);

    // The streak is alive if they checked in today or yesterday.
    let cursor = new Date();
    if (!dateSet.has(todayStr)) {
      if (!dateSet.has(yesterdayStr)) {
        return 0; // Streak broken
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    let streak = 0;
    while (true) {
      const cursorStr = localDateOf(cursor.toISOString());
      if (dateSet.has(cursorStr)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }, [checkIns, todayKey]);

  // Announcements preview (filtered and limited to 2-3)
  const recentAnnouncements = useMemo(() => {
    const ctx = {
      membershipStatus: currentMembership?.status,
      role: currentMembership?.role,
      preferredTimeSlot: currentMembership?.preferred_time_slot,
      autoTimeSlot: currentMembership?.auto_time_slot,
      preferredGymTiming: profile?.preferred_gym_timing,
    };
    return announcements
      .filter((a) => canViewAnnouncement(a.target_audience, ctx))
      .slice(0, 2);
  }, [announcements, profile?.preferred_gym_timing, currentMembership]);

  const memberFirstName = profile?.full_name?.split(' ')[0] || 'Member';
  const gymName = currentMembership?.gym?.name || 'My Gym';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
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
      >
        {/* Header Greeting */}
        <View style={styles.header}>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.memberEyebrow, { color: colors.primary }]}>YOUR TRAINING</Text>
            <Text style={[styles.greetingText, { color: colors.text }]}>{memberFirstName}</Text>
            <TouchableOpacity
              onPress={() => router.push('/(member)/gym-info')}
              activeOpacity={0.7}
              style={styles.gymNameRow}
            >
              <Text style={[styles.gymSubTitle, { color: colors.primary }]}>
                {gymName}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(member)/profile')}
            activeOpacity={0.7}
            style={styles.avatarButton}
          >
            <Avatar
              uri={profile?.photo_url}
              name={profile?.full_name || 'Member'}
              size={44}
            />
          </TouchableOpacity>
        </View>

        {isScreenLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading membership data...
            </Text>
          </View>
        ) : (
          <>
            {/* Membership Status Card */}
            {membershipExpired ? (
              <View
                style={[
                  styles.expiredBanner,
                  {
                    backgroundColor: isDark ? 'rgba(255, 82, 82, 0.15)' : '#FFEBEE',
                    borderColor: colors.error,
                  },
                ]}
              >
                <View style={styles.expiredContent}>
                  <View style={styles.expiredIconWrap}>
                    <Ionicons name="alert-circle" size={28} color={colors.error} />
                  </View>
                  <View style={styles.expiredTextWrap}>
                    <Text style={[styles.expiredTitle, { color: colors.error }]}>
                      Your membership has expired
                    </Text>
                    <Text style={[styles.expiredSub, { color: colors.textSecondary }]}>
                      Renew your plan today to keep enjoying gym access.
                    </Text>
                  </View>
                </View>
                <Button
                  title="Renew Membership"
                  onPress={() => router.push('/(member)/renew')}
                  variant="danger"
                  size="md"
                  fullWidth
                  style={styles.renewButton}
                />
              </View>
            ) : (
              <Card style={styles.membershipCard} padding={18}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.planInfo}>
                    <Badge
                      text="ACTIVE MEMBERSHIP"
                      variant="success"
                      size="sm"
                      style={styles.activeBadge}
                    />
                    <Text style={[styles.planTitle, { color: colors.text }]}>
                      {activeSubscription?.plan?.name || 'Gym Membership'}
                    </Text>
                    <Text style={[styles.planDates, { color: colors.textSecondary }]}>
                      {formatDate(activeSubscription?.start_date || '')} –{' '}
                      {formatDate(activeSubscription?.end_date || '')}
                    </Text>

                    {/* Without this the card shows a period ending 30 Nov while
                        the counter says 182 days, and the two look like a
                        contradiction rather than "you already renewed". */}
                    {upcomingSubscription ? (
                      <View style={[styles.coverageNote, { backgroundColor: colors.primaryMuted }]}>
                        <Ionicons name="shield-checkmark-outline" size={14} color={colors.primary} />
                        <Text style={[styles.renewedLine, { color: colors.primary }]}>
                          Covered through {formatDate(upcomingSubscription.end_date)}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.coverageCount}>
                    {/* end_date is inclusive, so daysLeft is 0 on the final day
                        while the membership is still valid. "0 days left" reads
                        like it has already lapsed. */}
                    <Text style={[styles.countdownNumber, { color: colors.primary }]}>
                      {daysLeft === 0 ? 'Last' : daysLeft}
                    </Text>
                    <Text style={[styles.countdownLabel, { color: colors.textTertiary }]}>
                      {daysLeft === 0 ? 'day today' : daysLeft === 1 ? 'day left' : 'days left'}
                    </Text>
                  </View>
                </View>

                {/* Progress Bar */}
                <View style={styles.progressContainer}>
                  <View style={styles.progressLabelRow}>
                    <Text style={[styles.progressText, { color: colors.textSecondary }]}>
                      Plan Progress
                    </Text>
                    <Text style={[styles.progressPercent, { color: colors.text }]}>
                      {planProgressPercent}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressBarTrack,
                      { backgroundColor: colors.surfaceElevated },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${planProgressPercent}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                </View>

                {/*
                  Renew is reachable from here, not only from the expired
                  banner. Previously the ONLY link to /renew lived inside the
                  `membershipExpired` branch, so a member could not renew until
                  their membership had already lapsed — and a member approved
                  without a payment could never reach it at all.
                */}
                <TouchableOpacity
                  onPress={() => router.push('/(member)/renew')}
                  activeOpacity={0.8}
                  style={[
                    styles.renewInlineButton,
                    {
                      borderColor: daysLeft <= 7 ? colors.warning : colors.border,
                      backgroundColor:
                        daysLeft <= 7 ? colors.primaryMuted : colors.surface,
                    },
                  ]}
                >
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color={daysLeft <= 7 ? colors.warning : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.renewInlineText,
                      {
                        color: daysLeft <= 7 ? colors.warning : colors.text,
                      },
                    ]}
                  >
                    {awaitingFirstPlan
                      ? 'Choose a plan'
                      : daysLeft <= 7
                        ? 'Renew now'
                        : 'Renew or change plan'}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={daysLeft <= 7 ? colors.warning : colors.textTertiary}
                  />
                </TouchableOpacity>
              </Card>
            )}

            {/* Check In Action Button */}
            <View style={styles.actionSection}>
              {/* The check_ins insert policy requires gym_members.status =
                  'active' (001_initial_schema.sql), so offering the scanner to
                  a lapsed member sends them to the camera only to fail on RLS
                  with a permission error they cannot act on. Send them to
                  Renew instead. */}
              {membershipExpired ? (
                <Button
                  title="Renew to Check In"
                  onPress={() => router.push('/(member)/renew')}
                  variant="primary"
                  size="lg"
                  fullWidth
                  icon={<Ionicons name="refresh-outline" size={22} color="#000000" />}
                  style={styles.checkInButton}
                />
              ) : hasCheckedInToday ? (
                <View
                  style={[
                    styles.checkedInBanner,
                    {
                      backgroundColor: isDark ? 'rgba(0, 230, 118, 0.1)' : '#E8F8F0',
                      borderColor: colors.statusActive,
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={24} color={colors.statusActive} />
                  <Text style={[styles.checkedInText, { color: colors.statusActive }]}>
                    Checked in for today! Keep crushing your goals.
                  </Text>
                </View>
              ) : (
                <Button
                  title="Check In with QR"
                  onPress={() => router.push('/(member)/scan')}
                  variant="primary"
                  size="lg"
                  fullWidth
                  icon={<Ionicons name="qr-code-outline" size={22} color="#000000" />}
                  style={styles.checkInButton}
                />
              )}
              <Button
                title="Log a set"
                onPress={() => router.push('/(member)/session')}
                variant="secondary"
                size="lg"
                fullWidth
                icon={<Ionicons name="mic-outline" size={22} color={colors.text} />}
                style={styles.logSetButton}
              />
              <Button
                title="Today's workout"
                onPress={() => router.push('/(member)/workouts')}
                variant="ghost"
                size="lg"
                fullWidth
              />
            </View>

            {/* Training rhythm: one compact readout instead of two dashboard
                cards competing with the membership pass above. */}
            <TouchableOpacity
              style={[styles.rhythmPanel, { borderColor: colors.border }]}
              onPress={() => router.push('/(member)/attendance')}
              activeOpacity={0.78}
            >
              <View style={styles.rhythmHeading}>
                <Text style={[styles.rhythmEyebrow, { color: colors.primary }]}>TRAINING RHYTHM</Text>
                <Ionicons name="arrow-forward" size={17} color={colors.primary} />
              </View>
              <View style={styles.rhythmStats}>
                <View style={styles.rhythmItem}>
                  <Text style={[styles.rhythmValue, { color: colors.text }]}>{thisMonthCheckIns}</Text>
                  <Text style={[styles.rhythmLabel, { color: colors.textSecondary }]}>CHECK-INS THIS MONTH</Text>
                </View>
                <View style={[styles.rhythmDivider, { backgroundColor: colors.divider }]} />
                <View style={styles.rhythmItem}>
                  <Text style={[styles.rhythmValue, { color: colors.text }]}>{currentStreak}</Text>
                  <Text style={[styles.rhythmLabel, { color: colors.textSecondary }]}>DAY STREAK</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Useful records live in a quiet member-desk list instead of
                generic coloured icon tiles. */}
            <View style={[styles.memberDesk, { borderColor: colors.border }]}>
              {[
                { label: 'Workouts', detail: 'Routines and today\'s plan', route: '/(member)/workouts' as const },
                { label: 'Progress', detail: 'Records and overload', route: '/(member)/progress' as const },
                { label: 'My gym', detail: 'Hours and contact', route: '/(member)/gym-info' as const },
                { label: 'Payment history', detail: 'Plans and receipts', route: '/(member)/payments' as const },
                { label: 'Help & feedback', detail: 'Contact management', route: '/(member)/complaints' as const },
              ].map((item, index) => (
                <React.Fragment key={item.label}>
                  <TouchableOpacity
                    style={styles.memberDeskRow}
                    onPress={() => router.push(item.route)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.memberDeskIndex, { color: index === 0 ? colors.primary : colors.textTertiary }]}>
                      0{index + 1}
                    </Text>
                    <View style={styles.memberDeskCopy}>
                      <Text style={[styles.memberDeskTitle, { color: colors.text }]}>{item.label}</Text>
                      <Text style={[styles.memberDeskDetail, { color: colors.textSecondary }]}>{item.detail}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
                  </TouchableOpacity>
                  {index < 4 ? <View style={[styles.memberDeskDivider, { backgroundColor: colors.divider }]} /> : null}
                </React.Fragment>
              ))}
            </View>

            {/* Recent Announcements Preview */}
            <View style={styles.announcementsSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleGroup}>
                  <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    Gym Announcements
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/(member)/announcements')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.seeAllText, { color: colors.primary }]}>
                    See All →
                  </Text>
                </TouchableOpacity>
              </View>

              {recentAnnouncements.length === 0 ? (
                <Card style={styles.emptyAnnouncementsCard} padding={20}>
                  <Ionicons name="notifications-off-outline" size={32} color={colors.textTertiary} />
                  <Text style={[styles.emptyAnnouncementsText, { color: colors.textSecondary }]}>
                    No recent announcements from your gym.
                  </Text>
                </Card>
              ) : (
                recentAnnouncements.map((item) => (
                  <Card
                    key={item.id}
                    style={styles.announcementCard}
                    padding={16}
                    onPress={() => router.push('/(member)/announcements')}
                  >
                    <View style={styles.announcementTop}>
                      <Text style={[styles.announcementTitle, { color: colors.text }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[styles.announcementTime, { color: colors.textTertiary }]}>
                        {timeAgo(item.created_at)}
                      </Text>
                    </View>
                    <Text style={[styles.announcementBody, { color: colors.textSecondary }]} numberOfLines={2}>
                      {item.body}
                    </Text>
                    <View style={styles.announcementAuthorRow}>
                      <Ionicons name="person-circle-outline" size={16} color={colors.textTertiary} />
                      <Text style={[styles.announcementAuthor, { color: colors.textTertiary }]}>
                        {item.author?.full_name || 'Gym Admin'}
                      </Text>
                    </View>
                  </Card>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  memberEyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 2 },
  gymNameRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  gymSubTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  avatarButton: {
    padding: 2,
  },
  loadingContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  expiredBanner: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 18,
    marginBottom: 20,
  },
  expiredContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  expiredIconWrap: {
    marginRight: 12,
  },
  expiredTextWrap: {
    flex: 1,
  },
  expiredTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  expiredSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  renewedLine: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  coverageNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginTop: 9,
  },
  renewButton: {
    height: 44,
  },
  membershipCard: {
    marginBottom: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planInfo: {
    flex: 1,
    marginRight: 16,
  },
  activeBadge: {
    marginBottom: 6,
  },
  planTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  planDates: {
    fontSize: 13,
  },
  coverageCount: { minWidth: 70, alignItems: 'flex-end' },
  countdownNumber: {
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 33,
    letterSpacing: -1,
  },
  countdownLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  progressContainer: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150, 150, 150, 0.1)',
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '500',
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  renewInlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  renewInlineText: { flex: 1, fontSize: 14, fontWeight: '600' },
  actionSection: {
    marginBottom: 20,
  },
  checkInButton: {
    height: 54,
  },
  logSetButton: {
    height: 54,
    marginTop: 10,
  },
  checkedInBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  checkedInText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  rhythmPanel: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 15,
    marginBottom: 18,
  },
  rhythmHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rhythmEyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  rhythmStats: { flexDirection: 'row', alignItems: 'stretch' },
  rhythmItem: { flex: 1 },
  rhythmDivider: { width: 1, marginHorizontal: 18 },
  rhythmValue: { fontSize: 27, fontWeight: '900', letterSpacing: -0.8 },
  rhythmLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.55, marginTop: 3 },
  memberDesk: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    marginBottom: 24,
    overflow: 'hidden',
  },
  memberDeskRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center' },
  memberDeskIndex: { width: 32, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  memberDeskCopy: { flex: 1 },
  memberDeskTitle: { fontSize: 14, fontWeight: '700' },
  memberDeskDetail: { fontSize: 11, marginTop: 2 },
  memberDeskDivider: { height: 1, marginLeft: 32 },
  announcementsSection: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyAnnouncementsCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyAnnouncementsText: {
    fontSize: 13,
    textAlign: 'center',
  },
  announcementCard: {
    marginBottom: 10,
  },
  announcementTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  announcementTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  announcementTime: {
    fontSize: 12,
  },
  announcementBody: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  announcementAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  announcementAuthor: {
    fontSize: 12,
  },
});
