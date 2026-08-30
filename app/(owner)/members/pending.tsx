import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useMembers } from '../../../hooks/useMembers';
import { useSubscriptions } from '../../../hooks/useSubscriptions';
import Avatar from '../../../components/ui/Avatar';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { formatDate, timeAgo, today } from '../../../utils/date';

interface MembershipPlan {
  id: string;
  name: string;
  duration_months: number;
  price: number;
  is_active: boolean;
}

export default function PendingApprovalsScreen() {
  const router = useRouter();
  const { gymId, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    members,
    loading,
    refresh,
    approveMember,
    rejectMember,
  } = useMembers({ status: 'pending' });

  // Approval with Plan Modal State
  const [selectedMember, setSelectedMember] = useState<{ id: string; name: string } | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<MembershipPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'online'>('cash');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Subscriptions hook for creating subscription
  const { createSubscription } = useSubscriptions();

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
        console.error('[PendingApprovals] Plans fetch error:', error);
        return;
      }

      const plans = (data || []) as MembershipPlan[];
      setAvailablePlans(plans);
      if (plans.length > 0 && !selectedPlanId) {
        setSelectedPlanId(plans[0].id);
        setAmountPaid(plans[0].price.toString());
      }
    } catch (err) {
      console.error('[PendingApprovals] Plans error:', err);
    }
  }, [gymId, supabase, selectedPlanId]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleOpenApproveModal = (memberId: string, name: string) => {
    setSelectedMember({ id: memberId, name });
    if (availablePlans.length > 0) {
      setSelectedPlanId(availablePlans[0].id);
      setAmountPaid(availablePlans[0].price.toString());
    }
    setModalVisible(true);
  };

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    const plan = availablePlans.find((p) => p.id === planId);
    if (plan) {
      setAmountPaid(plan.price.toString());
    }
  };

  const handleApproveWithoutPayment = async () => {
    if (!selectedMember) return;
    setSubmittingAction(true);
    try {
      await approveMember(selectedMember.id);
      Alert.alert('Approved', `${selectedMember.name} has been approved without an upfront payment.`);
      setModalVisible(false);
      refresh();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to approve member.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleApproveWithPayment = async () => {
    if (!selectedMember || !selectedPlanId) {
      Alert.alert('Required', 'Please choose a plan to record payment.');
      return;
    }

    const numAmount = parseFloat(amountPaid);
    if (isNaN(numAmount) || numAmount < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    setSubmittingAction(true);
    try {
      await createSubscription({
        gymMemberId: selectedMember.id,
        planId: selectedPlanId,
        amountPaid: numAmount,
        paymentMethod,
        startDate: today(),
      });

      Alert.alert('Success', `${selectedMember.name} approved with active subscription.`);
      setModalVisible(false);
      refresh();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to approve and record payment.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRejectPrompt = (memberId: string, name: string) => {
    Alert.alert(
      'Reject Application',
      `Are you sure you want to reject the membership request from ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await rejectMember(memberId);
              Alert.alert('Application Rejected', `The request from ${name} was rejected.`);
              refresh();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to reject application.');
            }
          },
        },
      ]
    );
  };

  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconCircle,
            { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.08)' },
          ]}
        >
          <Ionicons name="checkmark-done-circle-outline" size={56} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No Pending Approvals
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          All member applications have been reviewed. When new members request to join, they will appear here.
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
            Pending Approvals
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {members.length} {members.length === 1 ? 'applicant waiting' : 'applicants waiting'}
          </Text>
        </View>
      </View>

      {/* List */}
      {loading && members.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading pending requests...
          </Text>
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => (
            <Card
              style={styles.memberCard}
              padding={16}
              onPress={() => router.push(`/(owner)/members/${item.id}`)}
            >
              {/* Member Top Info */}
              <View style={styles.memberHeaderRow}>
                <Avatar
                  uri={item.profile?.photo_url}
                  name={item.profile?.full_name || 'Applicant'}
                  size={50}
                />
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                    {item.profile?.full_name || 'New Applicant'}
                  </Text>
                  <Text style={[styles.memberTime, { color: colors.textTertiary }]}>
                    Applied {timeAgo(item.joined_at)} ({formatDate(item.joined_at)})
                  </Text>
                </View>
                <Badge text="PENDING" variant="warning" size="sm" />
              </View>

              {/* Registration Details */}
              <View style={[styles.detailsBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                {item.profile?.email ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="mail-outline" size={15} color={colors.textSecondary} />
                    <Text style={[styles.detailText, { color: colors.text }]}>
                      {item.profile.email}
                    </Text>
                  </View>
                ) : null}

                {item.profile?.phone ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="call-outline" size={15} color={colors.textSecondary} />
                    <Text style={[styles.detailText, { color: colors.text }]}>
                      {item.profile.phone}
                    </Text>
                  </View>
                ) : null}

                {item.profile?.fitness_goal ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="barbell-outline" size={15} color={colors.primary} />
                    <Text style={[styles.detailText, { color: colors.text }]}>
                      Goal: {item.profile.fitness_goal.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Inline Action Buttons */}
              <View style={styles.inlineActions}>
                <Button
                  title="Reject"
                  variant="danger"
                  size="sm"
                  onPress={() => handleRejectPrompt(item.id, item.profile?.full_name || 'Applicant')}
                  style={styles.actionBtn}
                />
                <Button
                  title="Approve"
                  variant="primary"
                  size="sm"
                  onPress={() => handleOpenApproveModal(item.id, item.profile?.full_name || 'Applicant')}
                  style={styles.actionBtn}
                />
              </View>
            </Card>
          )}
        />
      )}

      {/* Approval & Plan Selection Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Approve Application
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                  {selectedMember?.name}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>
                Assign Membership Plan (Optional)
              </Text>

              {availablePlans.length === 0 ? (
                <Text style={[styles.noPlansText, { color: colors.textSecondary }]}>
                  No active membership plans found. You can approve without a payment record now and assign a plan later.
                </Text>
              ) : (
                <View style={styles.plansContainer}>
                  {availablePlans.map((plan) => {
                    const isSelected = selectedPlanId === plan.id;
                    return (
                      <TouchableOpacity
                        key={plan.id}
                        style={[
                          styles.planCard,
                          {
                            backgroundColor: isSelected
                              ? (isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.08)')
                              : colors.surfaceElevated,
                            borderColor: isSelected ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => handleSelectPlan(plan.id)}
                        activeOpacity={0.7}
                      >
                        <View>
                          <Text style={[styles.planTitle, { color: colors.text }]}>
                            {plan.name}
                          </Text>
                          <Text style={[styles.planDuration, { color: colors.textSecondary }]}>
                            {plan.duration_months} {plan.duration_months === 1 ? 'Month' : 'Months'}
                          </Text>
                        </View>
                        <Text style={[styles.planPrice, { color: colors.primary }]}>
                          ₹{plan.price.toLocaleString('en-IN')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {availablePlans.length > 0 && (
                <>
                  <Input
                    label="Amount Received (₹)"
                    placeholder="Enter amount paid"
                    keyboardType="numeric"
                    value={amountPaid}
                    onChangeText={setAmountPaid}
                  />

                  <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>
                    Payment Mode
                  </Text>
                  <View style={styles.methodRow}>
                    {(['cash', 'upi', 'online'] as const).map((m) => {
                      const isSelected = paymentMethod === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          style={[
                            styles.methodChip,
                            {
                              backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                              borderColor: isSelected ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => setPaymentMethod(m)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.methodChipText,
                              { color: isSelected ? '#000000' : colors.textSecondary },
                            ]}
                          >
                            {m.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Action Buttons in Modal */}
              <View style={styles.modalActionButtons}>
                {availablePlans.length > 0 && (
                  <Button
                    title="Approve with Payment"
                    variant="primary"
                    loading={submittingAction}
                    onPress={handleApproveWithPayment}
                    fullWidth
                    style={{ marginBottom: 8 }}
                  />
                )}

                <Button
                  title="Approve without Payment"
                  variant="outline"
                  loading={submittingAction}
                  onPress={handleApproveWithoutPayment}
                  fullWidth
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
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
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
    paddingTop: 80,
    gap: 12,
  },
  emptyIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  memberCard: {
    borderRadius: 16,
    marginBottom: 14,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 17,
    fontWeight: '700',
  },
  memberTime: {
    fontSize: 12,
    marginTop: 2,
  },
  detailsBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 6,
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  noPlansText: {
    fontSize: 13,
    marginBottom: 16,
  },
  plansContainer: {
    gap: 8,
    marginBottom: 14,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  planTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  planDuration: {
    fontSize: 12,
    marginTop: 2,
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '700',
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  methodChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalActionButtons: {
    marginTop: 6,
    marginBottom: 14,
  },
});
