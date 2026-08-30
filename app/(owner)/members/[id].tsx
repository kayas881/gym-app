import React, { useState, useEffect, useCallback } from 'react';
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
import { daysRemaining, formatDate, formatDateTime, today, localDateOf } from '../../../utils/date';

interface MemberDetail {
  id: string;
  gym_id: string;
  role: 'owner' | 'staff' | 'member';
  status: 'pending' | 'active' | 'expired' | 'rejected';
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
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const [startDate, setStartDate] = useState<string>(today());
  const [savingPayment, setSavingPayment] = useState(false);

  // Recent check-ins for this member (Phase 2 item 5). This was deferred until
  // Phase 3 built check-in, because before that check_ins was always empty.
  const [checkIns, setCheckIns] = useState<{ id: string; checked_in_at: string }[]>([]);
  const [checkInsLoading, setCheckInsLoading] = useState(true);

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

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    const plan = availablePlans.find((p) => p.id === planId);
    if (plan) {
      setAmountPaid(plan.price.toString());
    }
  };

  const handleRecordPaymentSubmit = async () => {
    if (!id || !selectedPlanId) {
      Alert.alert('Required', 'Please select a membership plan.');
      return;
    }

    const numAmount = parseFloat(amountPaid);
    if (isNaN(numAmount) || numAmount < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
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
    } catch (e: any) {
      Alert.alert('Payment Error', e.message || 'Failed to record payment.');
    } finally {
      setSavingPayment(false);
    }
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

  const daysLeft = activeSubscription ? daysRemaining(activeSubscription.end_date) : 0;
  const isExp = activeSubscription ? daysLeft === 0 : true;

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
                <StatusBadge status={member.status} />
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
                  onPress={() => setPaymentModalVisible(true)}
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
                onPress={() => setPaymentModalVisible(true)}
                fullWidth
              />
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
                onPress={() => setPaymentModalVisible(true)}
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
                <Badge
                  text={sub.status.toUpperCase()}
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
            {checkIns.length} check-ins
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
                label="Start Date (YYYY-MM-DD)"
                placeholder="YYYY-MM-DD"
                value={startDate}
                onChangeText={setStartDate}
              />

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
});
