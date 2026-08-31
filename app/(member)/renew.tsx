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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useSubscriptions } from '../../hooks/useSubscriptions';
import { daysRemaining, formatDate, isExpired } from '../../utils/date';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

interface MembershipPlan {
  id: string;
  gym_id: string;
  name: string;
  duration_months: number;
  price: number;
  is_active: boolean;
}

export default function RenewMembershipScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gymId, currentMembership, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  const { activeSubscription, loading: subLoading, refresh: refreshSub } = useSubscriptions(
    currentMembership?.id
  );

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Fetch gym's available membership plans
  const fetchPlans = useCallback(async () => {
    if (!gymId) return;

    setPlansLoading(true);
    try {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('*')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('price', { ascending: true });

      if (error) {
        console.error('[Renew] Error fetching plans:', error);
      } else {
        setPlans((data as MembershipPlan[]) || []);
      }
    } catch (err) {
      console.error('[Renew] Unexpected error fetching plans:', err);
    } finally {
      setPlansLoading(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshSub(), fetchPlans()]);
    setRefreshing(false);
  }, [refreshSub, fetchPlans]);

  const daysLeft = activeSubscription?.end_date ? daysRemaining(activeSubscription.end_date) : 0;
  // Same distinction as the home screen: a member approved without a payment
  // has no subscription yet but is NOT expired (see migration 003).
  const expired = activeSubscription?.end_date
    ? isExpired(activeSubscription.end_date)
    : currentMembership?.status === 'expired';
  const awaitingFirstPlan =
    !activeSubscription?.end_date && currentMembership?.status === 'active';

  const handleSelectPlan = (plan: MembershipPlan) => {
    setSelectedPlan(plan);
    setShowPaymentModal(true);
  };

  // Records the request so the owner sees it, instead of only telling the
  // member to pay at the desk. Writes to renewal_requests (member-insertable);
  // `subscriptions` stays owner-only, so payment is still recorded by the owner.
  const handleSubmitRequest = async () => {
    if (!selectedPlan || !currentMembership?.id || !gymId) return;

    setSubmittingRequest(true);
    try {
      // Clear any existing open request first, then insert the new choice.
      //
      // Not an upsert: the unique index is PARTIAL (WHERE status = 'pending'),
      // and Postgres cannot match ON CONFLICT (gym_member_id) to a partial
      // index unless the statement repeats that predicate — which PostgREST
      // does not emit, so upsert fails with 42P10. The partial index is the
      // right shape (a member may request again after one is approved), so the
      // delete-then-insert happens here instead. Both are permitted by the
      // member's own RLS policies.
      const { error: clearError } = await supabase
        .from('renewal_requests')
        .delete()
        .eq('gym_member_id', currentMembership.id)
        .eq('status', 'pending');

      if (clearError) throw clearError;

      const { error } = await supabase.from('renewal_requests').insert({
        gym_id: gymId,
        gym_member_id: currentMembership.id,
        plan_id: selectedPlan.id,
        status: 'pending',
      });

      if (error) throw error;

      setShowPaymentModal(false);
      Alert.alert(
        'Request Sent',
        `${gymName} has been notified that you'd like the ${selectedPlan.name} plan. Pay at the counter to activate it.`
      );
    } catch (err: any) {
      console.error('[Renew] Request failed:', err);
      Alert.alert(
        'Could Not Send Request',
        err?.message || 'Please try again, or speak to gym staff.'
      );
    } finally {
      setSubmittingRequest(false);
    }
  };

  const gymName = currentMembership?.gym?.name || 'Your Gym';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 32 },
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
        {/* Header Row */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Renew Membership
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Choose a plan to extend or renew your gym access
            </Text>
          </View>
        </View>

        {/* Current Plan Status Banner */}
        <Card
          style={[
            styles.statusCard,
            expired
              ? {
                  borderColor: colors.error,
                  backgroundColor: isDark ? 'rgba(255, 82, 82, 0.1)' : '#FFEBEE',
                }
              : {
                  borderColor: colors.primary,
                  backgroundColor: isDark ? 'rgba(0, 230, 118, 0.08)' : '#E8F8F0',
                },
          ]}
          padding={16}
        >
          <View style={styles.statusRow}>
            <View style={styles.statusIconWrap}>
              <Ionicons
                name={expired ? 'alert-circle' : 'time'}
                size={28}
                color={expired ? colors.error : colors.primary}
              />
            </View>
            <View style={styles.statusInfo}>
              <Text
                style={[
                  styles.statusTitle,
                  { color: expired ? colors.error : colors.primary },
                ]}
              >
                {expired ? 'Membership Expired' : `${daysLeft} Days Remaining`}
              </Text>
              <Text style={[styles.statusSubtitle, { color: colors.textSecondary }]}>
                {activeSubscription
                  ? `Current plan: ${activeSubscription.plan?.name || 'Active'} (Ends ${formatDate(
                      activeSubscription.end_date
                    )})`
                  : 'No active plan found. Select a plan below.'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Available Plans Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Available Plans
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
            Select a subscription plan for {gymName}
          </Text>
        </View>

        {plansLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading available membership plans...
            </Text>
          </View>
        ) : plans.length === 0 ? (
          <Card style={styles.emptyCard} padding={24}>
            <Ionicons name="pricetag-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No plans available
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Please contact the gym owner or management to create membership plans.
            </Text>
          </Card>
        ) : (
          plans.map((plan) => {
            const isCurrent = activeSubscription?.plan_id === plan.id;
            const durationLabel =
              plan.duration_months === 1
                ? '1 Month'
                : plan.duration_months === 12
                ? '1 Year (12 Months)'
                : `${plan.duration_months} Months`;

            return (
              <Card
                key={plan.id}
                style={[
                  styles.planCard,
                  isCurrent && {
                    borderColor: colors.primary,
                    borderWidth: 1.5,
                  },
                ]}
                padding={20}
              >
                <View style={styles.planCardHeader}>
                  <View style={styles.planInfoWrap}>
                    <View style={styles.planTitleBadgeRow}>
                      <Text style={[styles.planName, { color: colors.text }]}>
                        {plan.name}
                      </Text>
                      {isCurrent && (
                        <Badge text="CURRENT PLAN" variant="info" size="sm" />
                      )}
                    </View>
                    <Text style={[styles.planDuration, { color: colors.textSecondary }]}>
                      {durationLabel}
                    </Text>
                  </View>

                  <View style={styles.priceContainer}>
                    <Text style={[styles.priceCurrency, { color: colors.primary }]}>₹</Text>
                    <Text style={[styles.priceAmount, { color: colors.text }]}>
                      {plan.price.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                {/* Plan Highlights */}
                <View style={styles.featuresList}>
                  <View style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                    <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                      Full gym access during all operating hours
                    </Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                    <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                      Valid for {durationLabel} from activation date
                    </Text>
                  </View>
                </View>

                {/* Action Button */}
                <Button
                  title={isCurrent ? 'Renew This Plan' : 'Select Plan'}
                  onPress={() => handleSelectPlan(plan)}
                  variant={isCurrent ? 'primary' : 'outline'}
                  size="md"
                  fullWidth
                  style={styles.selectButton}
                />
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Payment / Renewal Instructions Modal */}
      <Modal
        visible={showPaymentModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPaymentModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleGroup}>
                <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Payment & Activation
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowPaymentModal(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedPlan && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Plan Summary Box */}
                <View
                  style={[
                    styles.planSummaryBox,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                    Selected Plan
                  </Text>
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryPlanName, { color: colors.text }]}>
                      {selectedPlan.name} ({selectedPlan.duration_months} Months)
                    </Text>
                    <Text style={[styles.summaryPrice, { color: colors.primary }]}>
                      ₹{selectedPlan.price.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                {/* Instructions */}
                <View style={styles.instructionContainer}>
                  <Text style={[styles.instructionHeading, { color: colors.text }]}>
                    How to complete renewal:
                  </Text>

                  <View style={styles.stepRow}>
                    <View style={[styles.stepNumberCircle, { backgroundColor: colors.primaryMuted }]}>
                      <Text style={[styles.stepNumber, { color: colors.primary }]}>1</Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.textSecondary }]}>
                      Pay the plan amount directly to the gym owner or at the front desk via Cash or UPI.
                    </Text>
                  </View>

                  <View style={styles.stepRow}>
                    <View style={[styles.stepNumberCircle, { backgroundColor: colors.primaryMuted }]}>
                      <Text style={[styles.stepNumber, { color: colors.primary }]}>2</Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.textSecondary }]}>
                      The gym owner will record the payment and activate your membership instantly.
                    </Text>
                  </View>

                  <View style={styles.stepRow}>
                    <View style={[styles.stepNumberCircle, { backgroundColor: colors.primaryMuted }]}>
                      <Text style={[styles.stepNumber, { color: colors.primary }]}>3</Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.textSecondary }]}>
                      You will receive an official payment receipt in your Payment History tab.
                    </Text>
                  </View>
                </View>

                {/* Important Notice */}
                <View
                  style={[
                    styles.noticeBox,
                    {
                      backgroundColor: isDark ? 'rgba(68, 138, 255, 0.1)' : '#E3F2FD',
                      borderColor: colors.info,
                    },
                  ]}
                >
                  <Ionicons name="information-circle-outline" size={20} color={colors.info} />
                  <Text style={[styles.noticeText, { color: colors.info }]}>
                    Please show this screen to the gym manager or staff when paying for faster verification.
                  </Text>
                </View>

                {/* Action */}
                <Button
                  title="Send Request"
                  onPress={handleSubmitRequest}
                  loading={submittingRequest}
                  variant="primary"
                  size="lg"
                  fullWidth
                  style={styles.modalGotItBtn}
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
  scrollContent: {
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
  headerTextGroup: {
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
  statusCard: {
    marginBottom: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconWrap: {
    marginRight: 12,
  },
  statusInfo: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 13,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  planCard: {
    marginBottom: 16,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  planInfoWrap: {
    flex: 1,
    marginRight: 12,
  },
  planTitleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
  },
  planDuration: {
    fontSize: 13,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceCurrency: {
    fontSize: 16,
    fontWeight: '700',
    marginRight: 2,
  },
  priceAmount: {
    fontSize: 24,
    fontWeight: '800',
  },
  featuresList: {
    gap: 8,
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150, 150, 150, 0.1)',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    fontSize: 13,
    flex: 1,
  },
  selectButton: {
    marginTop: 4,
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
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  planSummaryBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryPlanName: {
    fontSize: 15,
    fontWeight: '700',
  },
  summaryPrice: {
    fontSize: 18,
    fontWeight: '800',
  },
  instructionContainer: {
    marginBottom: 16,
  },
  instructionHeading: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  stepNumberCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepText: {
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    marginBottom: 18,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    fontWeight: '500',
  },
  modalGotItBtn: {
    marginTop: 4,
    marginBottom: 10,
  },
});
