import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useSubscriptions } from '../../../hooks/useSubscriptions';
import Avatar from '../../../components/ui/Avatar';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import StatusBadge from '../../../components/ui/StatusBadge';
import { useToday } from '../../../hooks/useToday';
import {
  daysRemaining,
  formatDate,
  formatDateTime,
  today,
  localDateOf,
  renewalStartDate,
  isValidDateString,
  parseIndianDate,
  toIndianDate,
} from '../../../utils/date';

interface MemberDetail {
  id: string;
  gym_id: string;
  role: 'owner' | 'staff' | 'member';
  status: 'pending' | 'active' | 'expired' | 'rejected' | 'removed';
  preferred_time_slot: string | null;
  auto_time_slot: string | null;
  joined_at: string;
  profile: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    photo_url: string | null;
    date_of_birth: string | null;
    gender: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    address: string | null;
    health_notes: string | null;
    fitness_goal: string | null;
  };
}

interface MembershipPlan {
  id: string;
  name: string;
  duration_months: number;
  price: number;
  is_active: boolean;
}

export default function MemberDetailScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const router = useRouter();
  const { supabase, gymId, isSignedIn } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Subscriptions hook
  const {
    subscriptions,
    activeSubscription,
    upcomingSubscription,
    coverageEndDate,
    loading: subsLoading,
    refresh: refreshSubs,
    createSubscription,
  } = useSubscriptions(id);

  // Record Payment Modal State
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<MembershipPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'online'>('cash');
  // startDate stays ISO YYYY-MM-DD: it is compared as a string against
  // coverageEndDate and passed to record_subscription_payment, both of which
  // rely on ISO ordering. startDateText is the day-first form shown in the box.
  const [startDate, setStartDate] = useState<string>(today());
  const [startDateText, setStartDateText] = useState<string>(toIndianDate(today()));

  const applyStartDate = (iso: string) => {
    setStartDate(iso);
    setStartDateText(toIndianDate(iso));
  };

  // Blank the ISO value while the typed text is incomplete, so the
  // isValidDateString guards still stop a bad submit.
  const onStartDateTextChange = (text: string) => {
    setStartDateText(text);
    setStartDate(parseIndianDate(text) ?? '');
  };
  const [savingPayment, setSavingPayment] = useState(false);

  // Recent check-ins for this member (Phase 2 item 5). This was deferred until
  // Phase 3 built check-in, because before that check_ins was always empty.
  const [checkIns, setCheckIns] = useState<{ id: string; checked_in_at: string }[]>([]);
  const [checkInsLoading, setCheckInsLoading] = useState(true);

  // Open renewal request, so the owner can see the member asked for a specific
  // plan before recording a payment. record_subscription_payment closes it.
  const [renewalRequest, setRenewalRequest] = useState<
    {
      id: string;
      plan_id: string;
      plan: { name: string; price: number; duration_months: number } | null;
    } | null
  >(null);

  // Distinguishes "no open request" from "not fetched yet". Without it the
  // auto-open below could fire between the plans arriving and the request
  // arriving, preselecting plans[0] — the 1-month bug this is meant to fix.
  const [renewalFetched, setRenewalFetched] = useState(false);

  const fetchRenewalRequest = useCallback(async () => {
    if (!id || !isSignedIn) return;
    try {
      const { data, error } = await supabase
        .from('renewal_requests')
        .select('id, plan_id, plan:membership_plans ( name, price, duration_months )')
        .eq('gym_member_id', id)
        .eq('status', 'pending')
        .maybeSingle();

      if (error) {
        console.warn('[MemberDetail] Renewal request fetch:', error.message);
        return;
      }

      setRenewalRequest((data as any) ?? null);
    } catch (err) {
      console.warn('[MemberDetail] Renewal request error:', err);
    } finally {
      setRenewalFetched(true);
    }
  }, [id, supabase, isSignedIn]);

  useEffect(() => {
    fetchRenewalRequest();
  }, [fetchRenewalRequest]);

  const fetchCheckIns = useCallback(async () => {
    if (!id || !isSignedIn) return;
    try {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, checked_in_at')
        .eq('gym_member_id', id)
        .order('checked_in_at', { ascending: false })
        .limit(30);

      if (error) {
        console.error('[MemberDetail] Check-ins fetch error:', error);
        return;
      }
      setCheckIns(data ?? []);
    } catch (err) {
      console.error('[MemberDetail] Unexpected check-ins error:', err);
    } finally {
      setCheckInsLoading(false);
    }
  }, [id, supabase, isSignedIn]);

  useEffect(() => {
    fetchCheckIns();
  }, [fetchCheckIns]);

  const fetchMemberDetail = useCallback(async () => {
    // Skip while signed out. This screen stays mounted during sign-out, and
    // querying without a session returns no rows, which surfaced a bogus
    // "Could not load member details" alert over the sign-in screen.
    if (!id || !isSignedIn) return;

    try {
      const { data, error } = await supabase
        .from('gym_members')
        .select(`
          id,
          gym_id,
          role,
          status,
          preferred_time_slot,
          auto_time_slot,
          joined_at,
          profile:profiles (
            id,
            full_name,
            email,
            phone,
            photo_url,
            date_of_birth,
            gender,
            emergency_contact_name,
            emergency_contact_phone,
            address,
            health_notes,
            fitness_goal
          )
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('[MemberDetail] Fetch error:', error);
        // The session can end mid-request; don't alert on the way out.
        if (isSignedIn) {
          Alert.alert('Error', 'Could not load member details.');
        }
        return;
      }

      setMember(data as unknown as MemberDetail);
    } catch (err) {
      console.error('[MemberDetail] Unexpected error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, supabase, isSignedIn]);

  const fetchPlans = useCallback(async () => {
    if (!gymId) return;
    try {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('*')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('duration_months', { ascending: true });

      if (error) {
        console.error('[MemberDetail] Plans fetch error:', error);
        return;
      }

      const plans = (data || []) as MembershipPlan[];
      setAvailablePlans(plans);
      if (plans.length > 0 && !selectedPlanId) {
        setSelectedPlanId(plans[0].id);
        setAmountPaid(plans[0].price.toString());
      }
    } catch (err) {
      console.error('[MemberDetail] Plans error:', err);
    }
  }, [gymId, supabase, selectedPlanId]);

  useEffect(() => {
    fetchMemberDetail();
    fetchPlans();
  }, [fetchMemberDetail, fetchPlans]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchMemberDetail();
    refreshSubs();
    fetchCheckIns();
    fetchRenewalRequest();
  };

  const handleApprove = () => {
    Alert.alert(
      'Approve Member',
      `Are you sure you want to approve ${member?.profile?.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase
                .from('gym_members')
                .update({ status: 'active', updated_at: new Date().toISOString() })
                .eq('id', id);

              if (error) throw error;
              Alert.alert('Success', 'Member approved successfully.');
              fetchMemberDetail();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to approve member.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleReject = () => {
    Alert.alert(
      'Reject Member',
      `Are you sure you want to reject ${member?.profile?.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase
                .from('gym_members')
                .update({ status: 'rejected', updated_at: new Date().toISOString() })
                .eq('id', id);

              if (error) throw error;
              Alert.alert('Member Rejected', 'The membership request has been rejected.');
              router.back();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to reject member.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleRoleToggle = () => {
    if (!member) return;

    // The gym creator has their own gym_members row with role 'owner' (see
    // setup-gym.tsx), and it shows up in this list like any other member.
    // Without this guard the toggle would read 'owner' as "not staff" and
    // silently demote them to 'staff'.
    if (member.role === 'owner') {
      Alert.alert(
        'Cannot Change Owner',
        'This is the gym owner account. Its role cannot be changed here.'
      );
      return;
    }

    const newRole = member.role === 'staff' ? 'member' : 'staff';
    const actionLabel = newRole === 'staff' ? 'Promote to Staff' : 'Demote to Member';

    Alert.alert(
      actionLabel,
      `Do you want to change ${member.profile?.full_name}'s role to ${newRole.toUpperCase()}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase
                .from('gym_members')
                .update({ role: newRole, updated_at: new Date().toISOString() })
                .eq('id', id);

              if (error) throw error;
              Alert.alert('Success', `Role updated to ${newRole.toUpperCase()}.`);
              fetchMemberDetail();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to update role.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  // Renewing early must extend the membership, not restart it — the RPC
  // expires the old subscription, so a start date of today would delete the
  // remaining paid days. See renewalStartDate().
  //
  // The plan defaults to whatever the member ASKED for. fetchPlans seeds
  // selectedPlanId with plans[0] (the shortest, since it orders by duration),
  // so a member who requested 3 Months had 1 Month preselected — one careless
  // tap away from charging them for the wrong plan.
  const openPaymentModal = useCallback(() => {
    applyStartDate(renewalStartDate(activeSubscription?.end_date));

    const requestedPlan =
      renewalRequest?.plan_id &&
      availablePlans.find((p) => p.id === renewalRequest.plan_id);

    if (requestedPlan) {
      setSelectedPlanId(requestedPlan.id);
      setAmountPaid(requestedPlan.price.toString());
    }

    setPaymentModalVisible(true);
  }, [activeSubscription?.end_date, renewalRequest?.plan_id, availablePlans]);

  // `?action=record` from the renewal queue. Waits for the plans and the
  // request to load, or the preselection above would have nothing to match
  // against. The ref keeps it to once per visit so dismissing the sheet
  // doesn't immediately reopen it.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (action !== 'record') return;
    if (loading || availablePlans.length === 0) return;
    if (!renewalFetched) return;

    autoOpenedRef.current = true;
    openPaymentModal();
  }, [action, loading, availablePlans.length, renewalFetched, openPaymentModal]);

  // Removing a member who has left the gym. Until this existed, 'rejected'
  // was only reachable while status was 'pending', so an approved member could
  // never be taken off the roster: they kept counting toward the dashboard and
  // kept receiving the gym's push notifications forever.
  //
  // Goes through an RPC because the status flip, expiring their subscription
  // and dropping any pending renewal request have to happen together --
  // see 022_remove_gym_member.sql.
  const handleRemove = () => {
    if (!member) return;

    if (member.role === 'owner') {
      Alert.alert(
        'Cannot Remove Owner',
        'This is the gym owner account and cannot be removed from the gym.'
      );
      return;
    }

    const name = member.profile?.full_name || 'this member';
    Alert.alert(
      'Remove from gym?',
      `${name} will be taken off the roster: no check-ins, no announcements, and they stop counting toward your member totals.\n\nTheir payment history is kept, and you can restore them from the Removed filter.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase.rpc('remove_gym_member', {
                p_gym_member_id: id,
              });
              if (error) throw error;
              Alert.alert('Removed', `${name} is no longer a member of this gym.`);
              fetchMemberDetail();
              refreshSubs();
              fetchRenewalRequest();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to remove member.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleRestore = () => {
    if (!member) return;
    const name = member.profile?.full_name || 'this member';

    Alert.alert(
      'Restore member?',
      `${name} will be back on the roster. Their subscription stays expired, so record a payment to give them an active plan.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase.rpc('restore_gym_member', {
                p_gym_member_id: id,
              });
              if (error) throw error;
              Alert.alert('Restored', `${name} is a member again.`);
              fetchMemberDetail();
              refreshSubs();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to restore member.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    const plan = availablePlans.find((p) => p.id === planId);
    if (plan) {
      setAmountPaid(plan.price.toString());
    }
  };

  // True when the chosen start date lands inside time the member has already
  // paid for. The RPC expires whatever the new period overlaps, so saving here
  // gives up the remainder of the existing plan.
  const overlapsPaidTime = !!(
    coverageEndDate &&
    startDate &&
    isValidDateString(startDate) &&
    startDate <= coverageEndDate
  );

  const submitPayment = async () => {
    if (!id || !selectedPlanId) {
      Alert.alert('Required', 'Please select a membership plan.');
      return;
    }

    const numAmount = parseFloat(amountPaid);
    if (isNaN(numAmount) || numAmount < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    // This is a free-text field, so "31-08-2026" and "2026-02-30" both reach
    // it. Postgres would reject them with a raw 22007/22008 error.
    if (startDate && !isValidDateString(startDate)) {
      Alert.alert('Invalid Start Date', 'Please enter the start date as DD/MM/YYYY.');
      return;
    }

    setSavingPayment(true);
    try {
      await createSubscription({
        gymMemberId: id,
        planId: selectedPlanId,
        amountPaid: numAmount,
        paymentMethod,
        startDate: startDate || today(),
      });

      Alert.alert('Success', 'Payment recorded and membership activated successfully!');
      setPaymentModalVisible(false);
      fetchMemberDetail();
      refreshSubs();
      // record_subscription_payment marks any open renewal request approved;
      // refetch so the banner clears without needing a pull-to-refresh.
      fetchRenewalRequest();
    } catch (e: any) {
      Alert.alert('Payment Error', e.message || 'Failed to record payment.');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleRecordPaymentSubmit = () => {
    if (!id || !selectedPlanId) {
      Alert.alert('Required', 'Please select a membership plan.');
      return;
    }

    const numAmount = parseFloat(amountPaid);
    if (isNaN(numAmount) || numAmount < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    if (startDate && !isValidDateString(startDate)) {
      Alert.alert('Invalid Start Date', 'Please enter the start date as DD/MM/YYYY.');
      return;
    }

    // This is how a member silently lost 4 months of a 6-month plan: a payment
    // recorded with an overlapping start date voided the earlier one with no
    // warning anywhere in the app.
    if (overlapsPaidTime && coverageEndDate) {
      Alert.alert(
        'This replaces paid time',
        `${member?.profile?.full_name || 'This member'} is already paid up to ${formatDate(
          coverageEndDate
        )}. Starting a new plan on ${formatDate(
          startDate
        )} replaces that plan, and the remaining days are lost.\n\nTo add time instead, set the start date to the day after ${formatDate(
          coverageEndDate
        )}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace anyway', style: 'destructive', onPress: submitPayment },
        ]
      );
      return;
    }

    submitPayment();
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading member details...
        </Text>
      </View>
    );
  }

  if (!member) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Member Not Found</Text>
        <Button title="Go Back" variant="outline" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }

  // Re-renders when the local day changes or the screen regains focus, so the
  // day count below cannot sit frozen on a screen left open.
  useToday();

  // Count down to coverageEndDate, NOT activeSubscription.end_date. A member who
  // renews early holds two active subscriptions, and access ends at the later
  // one -- reading the current row showed Aman "90 Days Left" when he was paid
  // through to 01/03/2027, which would have had the owner chasing him for a
  // renewal he had already bought.
  // Only the plan being displayed on this card. Other subscriptions with their
  // own balances are listed on the Dues screen.
  const balanceDue = activeSubscription
    ? Math.max(
        Number(activeSubscription.plan_price ?? 0) -
          Number(activeSubscription.amount_paid ?? 0),
        0
      )
    : 0;

  const daysLeft = coverageEndDate ? daysRemaining(coverageEndDate) : 0;
  const isExp = coverageEndDate ? daysLeft === 0 : true;

  // An approved member who has never paid, or whose plan lapsed.
  const hasNoPlan =
    !subsLoading && !activeSubscription && member.role === 'member' && member.status !== 'pending';

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

        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          Member Profile
        </Text>

        <View style={{ width: 40 }} />
      </View>

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
        {/* Profile Card */}
        <Card style={styles.profileCard} padding={20}>
          <View style={styles.profileTopRow}>
            <Avatar
              uri={member.profile?.photo_url}
              name={member.profile?.full_name || 'Member'}
              size={72}
            />
            <View style={styles.profileHeaderInfo}>
              <Text style={[styles.profileName, { color: colors.text }]}>
                {member.profile?.full_name || 'Anonymous Member'}
              </Text>

              <View style={styles.badgeRow}>
                {/* gym_members.status only says "approved to enter the gym",
                    not "paid up" — so an approved member with no subscription
                    was showing a green Active badge directly above "No active
                    membership subscription." Same confusion the dashboard's
                    member count had. */}
                {hasNoPlan ? (
                  <Badge text="NO PLAN" variant="warning" size="sm" />
                ) : (
                  <StatusBadge status={member.status} />
                )}
                <Badge
                  text={member.role.toUpperCase()}
                  variant={member.role === 'owner' ? 'warning' : member.role === 'staff' ? 'info' : 'default'}
                  size="sm"
                />
              </View>

              <Text style={[styles.joinedText, { color: colors.textTertiary }]}>
                Joined {formatDate(member.joined_at)}
              </Text>
            </View>
          </View>

          {/* Action Buttons Section */}
          <View style={styles.actionButtonContainer}>
            {member.status === 'pending' && (
              <View style={styles.dualActionRow}>
                <Button
                  title="Reject"
                  variant="danger"
                  loading={actionLoading}
                  onPress={handleReject}
                  style={styles.flexButton}
                />
                <Button
                  title="Approve"
                  variant="primary"
                  loading={actionLoading}
                  onPress={handleApprove}
                  style={styles.flexButton}
                />
              </View>
            )}

            {member.status === 'active' && (
              <View style={styles.activeActionsColumn}>
                <Button
                  title="Record Payment / Renew"
                  variant="primary"
                  icon={<Ionicons name="cash-outline" size={18} color="#FFFFFF" />}
                  onPress={openPaymentModal}
                  fullWidth
                />
                <Button
                  title={member.role === 'staff' ? 'Demote to Member' : 'Promote to Staff'}
                  variant="outline"
                  loading={actionLoading}
                  onPress={handleRoleToggle}
                  fullWidth
                  style={{ marginTop: 8 }}
                />
              </View>
            )}

            {member.status === 'expired' && (
              <Button
                title="Record Payment to Renew"
                variant="primary"
                icon={<Ionicons name="refresh-outline" size={18} color="#FFFFFF" />}
                onPress={openPaymentModal}
                fullWidth
              />
            )}

            {/* Leaving the gym is not the same as being rejected at the door,
                so this sits apart from the pending Approve/Reject pair. Hidden
                for the owner's own row, which the RPC also refuses. */}
            {(member.status === 'active' || member.status === 'expired') &&
              member.role !== 'owner' && (
                <TouchableOpacity
                  onPress={handleRemove}
                  disabled={actionLoading}
                  activeOpacity={0.7}
                  style={styles.removeLink}
                >
                  <Ionicons name="person-remove-outline" size={16} color={colors.error} />
                  <Text style={[styles.removeLinkText, { color: colors.error }]}>
                    Remove from gym
                  </Text>
                </TouchableOpacity>
              )}

            {member.status === 'removed' && (
              <View>
                <View
                  style={[
                    styles.removedNotice,
                    { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
                  ]}
                >
                  <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.removedNoticeText, { color: colors.textSecondary }]}>
                    Removed from the gym: no check-ins and no announcements.
                    The payment history below is kept.
                  </Text>
                </View>
                <Button
                  title="Restore Member"
                  variant="outline"
                  loading={actionLoading}
                  onPress={handleRestore}
                  fullWidth
                  style={{ marginTop: 10 }}
                />
              </View>
            )}
          </View>
        </Card>

        {/* Membership Details Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Membership Plan
          </Text>
        </View>

        <Card style={styles.membershipCard} padding={16}>
          {activeSubscription ? (
            <View>
              <View style={styles.planHeaderRow}>
                <View>
                  <Text style={[styles.planNameText, { color: colors.text }]}>
                    {activeSubscription.plan?.name || 'Active Plan'}
                  </Text>
                  <Text style={[styles.planSubText, { color: colors.textSecondary }]}>
                    {activeSubscription.plan?.duration_months} Months Membership
                  </Text>
                </View>
                <Badge
                  text={isExp ? 'Expired' : `${daysLeft} Days Left`}
                  variant={isExp ? 'error' : daysLeft <= 7 ? 'warning' : 'success'}
                  size="md"
                />
              </View>

              <View style={[styles.planDatesGrid, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                <View style={styles.dateCol}>
                  <Text style={[styles.dateColLabel, { color: colors.textTertiary }]}>START DATE</Text>
                  <Text style={[styles.dateColVal, { color: colors.text }]}>
                    {formatDate(activeSubscription.start_date)}
                  </Text>
                </View>
                <View style={styles.dateDivider} />
                <View style={styles.dateCol}>
                  <Text style={[styles.dateColLabel, { color: colors.textTertiary }]}>EXPIRY DATE</Text>
                  <Text style={[styles.dateColVal, { color: colors.text }]}>
                    {formatDate(activeSubscription.end_date)}
                  </Text>
                </View>
              </View>

              {/* A part paid plan is otherwise invisible here: the card shows
                  dates and the payment history shows what WAS paid, neither of
                  which says money is still owed. */}
              {balanceDue > 0 ? (
                <TouchableOpacity
                  style={[
                    styles.balanceRow,
                    {
                      borderColor: colors.warning,
                      backgroundColor: isDark ? 'rgba(255, 171, 0, 0.10)' : '#FFF8E1',
                    },
                  ]}
                  onPress={() => router.push('/(owner)/payments/dues')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="alert-circle" size={18} color={colors.warning} />
                  <Text style={[styles.balanceText, { color: colors.warning }]}>
                    ₹{balanceDue.toLocaleString('en-IN')} still due on this plan
                  </Text>
                  <Text style={[styles.balanceCta, { color: colors.warning }]}>Collect</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.warning} />
                </TouchableOpacity>
              ) : null}

              {/* Without this the dates above and the "N Days Left" badge look
                  like they contradict each other: the grid shows the plan running
                  today, the badge counts to the end of everything paid for. */}
              {upcomingSubscription ? (
                <View style={styles.renewedRow}>
                  <Ionicons name="arrow-forward-circle-outline" size={16} color={colors.primary} />
                  <Text style={[styles.renewedText, { color: colors.textSecondary }]}>
                    Already renewed —{' '}
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {upcomingSubscription.plan?.name || 'next plan'}
                    </Text>{' '}
                    takes over {formatDate(upcomingSubscription.start_date)} and runs to{' '}
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {formatDate(upcomingSubscription.end_date)}
                    </Text>
                    .
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.noPlanContainer}>
              <Ionicons name="card-outline" size={32} color={colors.textTertiary} />
              <Text style={[styles.noPlanText, { color: colors.textSecondary }]}>
                No active membership subscription.
              </Text>
              <Button
                title="Assign Plan"
                size="sm"
                variant="outline"
                onPress={openPaymentModal}
                style={{ marginTop: 8 }}
              />
            </View>
          )}
        </Card>

        {/* Contact & Personal Details */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Contact & Profile
          </Text>
        </View>

        <Card padding={16}>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={18} color={colors.primary} style={styles.infoIcon} />
            <View style={styles.infoTextContainer}>
              <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Email</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {member.profile?.email || 'N/A'}
              </Text>
            </View>
          </View>

          <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />

          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={18} color={colors.primary} style={styles.infoIcon} />
            <View style={styles.infoTextContainer}>
              <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Phone</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {member.profile?.phone || 'Not provided'}
              </Text>
            </View>
          </View>

          <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />

          <View style={styles.infoRow}>
            <Ionicons name="barbell-outline" size={18} color={colors.primary} style={styles.infoIcon} />
            <View style={styles.infoTextContainer}>
              <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Fitness Goal</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {member.profile?.fitness_goal
                  ? member.profile.fitness_goal.replace(/_/g, ' ').toUpperCase()
                  : 'Not specified'}
              </Text>
            </View>
          </View>

          <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />

          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={18} color={colors.primary} style={styles.infoIcon} />
            <View style={styles.infoTextContainer}>
              <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Gender & DOB</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {member.profile?.gender ? member.profile.gender.toUpperCase() : 'N/A'}
                {member.profile?.date_of_birth ? ` • ${formatDate(member.profile.date_of_birth)}` : ''}
              </Text>
            </View>
          </View>

          {member.profile?.address ? (
            <>
              <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={18} color={colors.primary} style={styles.infoIcon} />
                <View style={styles.infoTextContainer}>
                  <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Address</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {member.profile.address}
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          {member.profile?.emergency_contact_name ? (
            <>
              <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />
              <View style={styles.infoRow}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.warning} style={styles.infoIcon} />
                <View style={styles.infoTextContainer}>
                  <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Emergency Contact</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {member.profile.emergency_contact_name} ({member.profile.emergency_contact_phone || 'No phone'})
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          {member.profile?.health_notes ? (
            <>
              <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />
              <View style={styles.infoRow}>
                <Ionicons name="medkit-outline" size={18} color={colors.error} style={styles.infoIcon} />
                <View style={styles.infoTextContainer}>
                  <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Health / Medical Notes</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {member.profile.health_notes}
                  </Text>
                </View>
              </View>
            </>
          ) : null}
        </Card>

        {/* Open renewal request */}
        {renewalRequest ? (
          <View
            style={[
              styles.renewalBanner,
              { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
            ]}
          >
            <Ionicons name="refresh-circle-outline" size={22} color={colors.primary} />
            <View style={styles.renewalBannerText}>
              <Text style={[styles.renewalBannerTitle, { color: colors.primary }]}>
                Renewal requested
              </Text>
              <Text style={[styles.renewalBannerBody, { color: colors.textSecondary }]}>
                {renewalRequest.plan
                  ? `${renewalRequest.plan.name} — ₹${renewalRequest.plan.price}`
                  : 'Plan no longer available'}
                . Recording a payment will clear this request.
              </Text>
            </View>
          </View>
        ) : null}

        {/* Payment History Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Payment History
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
            {subscriptions.length} records
          </Text>
        </View>

        {subsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 20 }} />
        ) : subscriptions.length === 0 ? (
          <Card padding={20}>
            <View style={styles.emptySubs}>
              <Ionicons name="receipt-outline" size={32} color={colors.textTertiary} />
              <Text style={[styles.emptySubsText, { color: colors.textSecondary }]}>
                No subscription payments recorded yet.
              </Text>
            </View>
          </Card>
        ) : (
          subscriptions.map((sub) => (
            <Card key={sub.id} style={styles.subscriptionHistoryCard} padding={14}>
              <View style={styles.subHistoryTop}>
                <View>
                  <Text style={[styles.subHistoryPlanName, { color: colors.text }]}>
                    {sub.plan?.name || 'Membership Plan'}
                  </Text>
                  <Text style={[styles.subReceipt, { color: colors.textTertiary }]}>
                    Receipt #{sub.receipt_number}
                  </Text>
                </View>
                <View style={styles.subHistoryAmountCol}>
                  <Text style={[styles.subHistoryPrice, { color: colors.primary }]}>
                    ₹{sub.amount_paid.toLocaleString('en-IN')}
                  </Text>
                  <Badge
                    text={sub.payment_method.toUpperCase()}
                    variant="default"
                    size="sm"
                  />
                </View>
              </View>

              <View style={[styles.subDatesRow, { borderTopColor: colors.divider }]}>
                <Text style={[styles.subDateText, { color: colors.textSecondary }]}>
                  {formatDate(sub.start_date)} - {formatDate(sub.end_date)}
                </Text>
                {/* record_subscription_payment marks the previous subscription
                    'expired' whenever a new one is recorded. If its end date
                    hasn't arrived yet it wasn't expired, it was replaced by a
                    renewal — labelling it EXPIRED reads like the member lost
                    time they paid for. */}
                <Badge
                  text={
                    sub.status === 'active'
                      ? 'ACTIVE'
                      : sub.end_date >= today()
                        ? 'REPLACED'
                        : 'EXPIRED'
                  }
                  variant={sub.status === 'active' ? 'success' : 'default'}
                  size="sm"
                />
              </View>
            </Card>
          ))
        )}

        {/* Attendance Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Attendance
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
            {/* The query limits to 30, so "30 check-ins" would understate a
                long-standing member's real total. */}
            {checkIns.length === 30 ? 'Last 30' : `${checkIns.length} check-ins`}
          </Text>
        </View>

        {checkInsLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 20 }} />
        ) : checkIns.length === 0 ? (
          <Card padding={20}>
            <View style={styles.emptySubs}>
              <Ionicons name="calendar-outline" size={32} color={colors.textTertiary} />
              <Text style={[styles.emptySubsText, { color: colors.textSecondary }]}>
                No check-ins recorded yet.
              </Text>
            </View>
          </Card>
        ) : (
          <Card padding={14}>
            {checkIns.map((entry, index) => (
              <View
                key={entry.id}
                style={[
                  styles.checkInRow,
                  index < checkIns.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.divider,
                  },
                ]}
              >
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.checkInDate, { color: colors.text }]}>
                  {formatDate(localDateOf(entry.checked_in_at))}
                </Text>
                <Text style={[styles.checkInTime, { color: colors.textSecondary }]}>
                  {new Date(entry.checked_in_at).toLocaleTimeString('en-IN', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Record Payment Modal */}
      <Modal
        visible={paymentModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPaymentModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Record Payment
              </Text>
              <TouchableOpacity
                onPress={() => setPaymentModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {renewalRequest?.plan ? (
                <View
                  style={[
                    styles.requestedBanner,
                    { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  <Text style={[styles.requestedBannerText, { color: colors.text }]}>
                    {member.profile?.full_name?.split(' ')[0] || 'The member'} asked for{' '}
                    <Text style={{ fontWeight: '800' }}>{renewalRequest.plan.name}</Text>
                    {' '}(₹{renewalRequest.plan.price}) — preselected below.
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.inputGroupLabel, { color: colors.textSecondary }]}>
                Select Membership Plan
              </Text>

              {availablePlans.length === 0 ? (
                <Text style={[styles.warningNotice, { color: colors.warning }]}>
                  No active plans found. Please create plans in "Manage Plans".
                </Text>
              ) : (
                <View style={styles.planSelectionContainer}>
                  {availablePlans.map((plan) => {
                    const isSelected = selectedPlanId === plan.id;
                    return (
                      <TouchableOpacity
                        key={plan.id}
                        style={[
                          styles.planSelectCard,
                          {
                            backgroundColor: isSelected ? (isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.08)') : colors.surfaceElevated,
                            borderColor: isSelected ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => handleSelectPlan(plan.id)}
                        activeOpacity={0.7}
                      >
                        <View>
                          <Text style={[styles.planSelectTitle, { color: colors.text }]}>
                            {plan.name}
                          </Text>
                          <Text style={[styles.planSelectDuration, { color: colors.textSecondary }]}>
                            {plan.duration_months} {plan.duration_months === 1 ? 'Month' : 'Months'}
                          </Text>
                        </View>
                        <Text style={[styles.planSelectPrice, { color: colors.primary }]}>
                          ₹{plan.price.toLocaleString('en-IN')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Input
                label="Amount Paid (₹)"
                placeholder="Enter amount"
                keyboardType="numeric"
                value={amountPaid}
                onChangeText={setAmountPaid}
              />

              <Text style={[styles.inputGroupLabel, { color: colors.textSecondary }]}>
                Payment Method
              </Text>
              <View style={styles.paymentMethodRow}>
                {(['cash', 'upi', 'online'] as const).map((method) => {
                  const isSelected = paymentMethod === method;
                  return (
                    <TouchableOpacity
                      key={method}
                      style={[
                        styles.methodButton,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setPaymentMethod(method)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.methodButtonText,
                          { color: isSelected ? '#000000' : colors.textSecondary },
                        ]}
                      >
                        {method.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Input
                label="Start Date (DD/MM/YYYY)"
                placeholder="e.g. 01/09/2026"
                value={startDateText}
                onChangeText={onStartDateTextChange}
              />

              {overlapsPaidTime && coverageEndDate ? (
                <View
                  style={[
                    styles.overlapWarning,
                    { borderColor: colors.warning, backgroundColor: colors.surfaceElevated },
                  ]}
                >
                  <Ionicons name="warning-outline" size={16} color={colors.warning} />
                  <Text style={[styles.overlapWarningText, { color: colors.warning }]}>
                    Already paid up to {formatDate(coverageEndDate)}. This start date
                    replaces that plan and loses the remaining days. Use{' '}
                    {formatDate(renewalStartDate(coverageEndDate))} to add time instead.
                  </Text>
                </View>
              ) : null}

              {activeSubscription && startDate !== today() ? (
                <Text style={[styles.startDateHint, { color: colors.textSecondary }]}>
                  Starts the day after the current plan ends ({formatDate(activeSubscription.end_date)}),
                  so the remaining days aren't lost.
                </Text>
              ) : null}

              <View style={styles.modalActionsRow}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setPaymentModalVisible(false)}
                  style={styles.modalBtn}
                />
                <Button
                  title="Save Payment"
                  variant="primary"
                  loading={savingPayment}
                  disabled={availablePlans.length === 0}
                  onPress={handleRecordPaymentSubmit}
                  style={styles.modalBtn}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  profileCard: {
    borderRadius: 16,
    marginBottom: 20,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileHeaderInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  joinedText: {
    fontSize: 12,
  },
  actionButtonContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 16,
  },
  dualActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  activeActionsColumn: {
    width: '100%',
  },
  flexButton: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 13,
  },
  membershipCard: {
    borderRadius: 16,
    marginBottom: 14,
  },
  planHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  planNameText: {
    fontSize: 18,
    fontWeight: '700',
  },
  planSubText: {
    fontSize: 13,
    marginTop: 2,
  },
  planDatesGrid: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  dateCol: {
    flex: 1,
    alignItems: 'center',
  },
  dateDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dateColLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dateColVal: {
    fontSize: 14,
    fontWeight: '600',
  },
  noPlanContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  noPlanText: {
    fontSize: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoIcon: {
    marginRight: 14,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowDivider: {
    height: 1,
    marginVertical: 4,
  },
  emptySubs: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  emptySubsText: {
    fontSize: 13,
  },
  renewalBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 16,
  },
  renewalBannerText: { flex: 1 },
  renewalBannerTitle: { fontSize: 14, fontWeight: '700' },
  renewalBannerBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  checkInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  checkInDate: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  checkInTime: {
    fontSize: 13,
  },
  subscriptionHistoryCard: {
    borderRadius: 14,
    marginBottom: 10,
  },
  subHistoryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  subHistoryPlanName: {
    fontSize: 15,
    fontWeight: '700',
  },
  subReceipt: {
    fontSize: 11,
    marginTop: 2,
  },
  subHistoryAmountCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  subHistoryPrice: {
    fontSize: 16,
    fontWeight: '700',
  },
  subDatesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  subDateText: {
    fontSize: 12,
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
  inputGroupLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  warningNotice: {
    fontSize: 13,
    marginBottom: 14,
  },
  planSelectionContainer: {
    gap: 8,
    marginBottom: 16,
  },
  planSelectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  planSelectTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  planSelectDuration: {
    fontSize: 12,
    marginTop: 2,
  },
  planSelectPrice: {
    fontSize: 16,
    fontWeight: '700',
  },
  paymentMethodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  methodButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  methodButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  modalBtn: {
    flex: 1,
  },
  removeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  removeLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  removedNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  removedNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  overlapWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: -8,
    marginBottom: 14,
  },
  overlapWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  requestedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  requestedBannerText: { flex: 1, fontSize: 12, lineHeight: 17 },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  balanceText: { flex: 1, fontSize: 13, fontWeight: '700' },
  balanceCta: { fontSize: 13, fontWeight: '700' },
  renewedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
  },
  renewedText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  startDateHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: -8,
    marginBottom: 14,
  },
});
