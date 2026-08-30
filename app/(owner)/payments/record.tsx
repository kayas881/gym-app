import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useMembers } from '../../../hooks/useMembers';
import { useSubscriptions } from '../../../hooks/useSubscriptions';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Avatar from '../../../components/ui/Avatar';
import StatusBadge from '../../../components/ui/StatusBadge';
import { calculateEndDate, formatDate, today } from '../../../utils/date';
import { generateReceiptHTML } from '../../../utils/receipt-template';

interface MembershipPlan {
  id: string;
  gym_id: string;
  name: string;
  duration_months: number;
  price: number;
  description?: string | null;
  is_active?: boolean;
}

type PaymentMethod = 'cash' | 'upi' | 'online';

export default function RecordPaymentScreen() {
  const router = useRouter();
  const { gymId, currentMembership, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  // Wizard Step: 1 = Member, 2 = Plan, 3 = Payment Details, 4 = Confirmation/Receipt
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Member search & selection
  const [memberSearch, setMemberSearch] = useState('');
  const { members, loading: membersLoading } = useMembers({ status: 'all', search: memberSearch });
  const [selectedMember, setSelectedMember] = useState<(typeof members)[0] | null>(null);

  // Step 2: Plans fetch & selection
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);

  // Step 3: Payment details
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [startDate, setStartDate] = useState<string>(today());

  // Step 4: Submission & Receipt
  const { createSubscription } = useSubscriptions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedSubscription, setConfirmedSubscription] = useState<any | null>(null);
  const [isSharingPdf, setIsSharingPdf] = useState(false);

  // Fetch plans when gymId changes
  useEffect(() => {
    async function fetchPlans() {
      if (!gymId) return;
      setPlansLoading(true);
      try {
        const { data, error } = await supabase
          .from('membership_plans')
          .select('*')
          // Only sell plans that are still active — matches pending.tsx and
          // members/[id].tsx. Without this, a plan the owner deactivated in
          // "Manage Plans" could still be sold from this screen.
          .eq('is_active', true)
          .eq('gym_id', gymId)
          .order('duration_months', { ascending: true });

        if (error) {
          console.error('[RecordPayment] Error fetching plans:', error);
          return;
        }

        setPlans((data as MembershipPlan[]) || []);
      } catch (err) {
        console.error('[RecordPayment] Unexpected error fetching plans:', err);
      } finally {
        setPlansLoading(false);
      }
    }

    fetchPlans();
  }, [gymId, supabase]);

  // When a plan is selected, auto-fill amount
  const handleSelectPlan = (plan: MembershipPlan) => {
    setSelectedPlan(plan);
    setAmountPaid(plan.price.toString());
  };

  // Calculated End Date
  const calculatedEndDate = useMemo(() => {
    if (!selectedPlan) return today();
    try {
      return calculateEndDate(startDate || today(), selectedPlan.duration_months);
    } catch {
      return today();
    }
  }, [startDate, selectedPlan]);

  // Confirm payment submission
  const handleConfirmPayment = async () => {
    if (!selectedMember || !selectedPlan) {
      Alert.alert('Incomplete Details', 'Please select both a member and a plan.');
      return;
    }

    const numericAmount = parseFloat(amountPaid);
    if (isNaN(numericAmount) || numericAmount < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createSubscription({
        gymMemberId: selectedMember.id,
        planId: selectedPlan.id,
        amountPaid: numericAmount,
        paymentMethod,
        startDate,
      });

      setConfirmedSubscription(result);
    } catch (err: any) {
      console.error('[RecordPayment] Error recording payment:', err);
      Alert.alert('Error', err.message || 'Failed to record payment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Share generated PDF receipt
  const handleShareReceipt = async () => {
    if (!confirmedSubscription || !selectedMember || !selectedPlan) return;

    try {
      setIsSharingPdf(true);
      const gymName = currentMembership?.gym?.name || 'Gym';
      const memberName = selectedMember.profile?.full_name || 'Member';
      const memberEmail = selectedMember.profile?.email || 'N/A';

      const html = generateReceiptHTML({
        gymName,
        gymLogoUrl: currentMembership?.gym?.logo_url,
        memberName,
        memberEmail,
        planName: selectedPlan.name,
        durationMonths: selectedPlan.duration_months,
        amountPaid: parseFloat(amountPaid) || selectedPlan.price,
        paymentMethod,
        startDate,
        endDate: calculatedEndDate,
        receiptNumber: confirmedSubscription.receipt_number,
        paymentDate: new Date().toISOString(),
      });

      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          UTI: '.pdf',
          mimeType: 'application/pdf',
          dialogTitle: `Receipt-${confirmedSubscription.receipt_number}.pdf`,
        });
      } else {
        Alert.alert('Sharing Unavailable', 'PDF sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.error('[RecordPayment] PDF Share Error:', err);
      Alert.alert('Error', err.message || 'Could not share receipt.');
    } finally {
      setIsSharingPdf(false);
    }
  };

  // Step 1: Member Selection UI
  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.stepHeading, { color: colors.text }]}>
        Select Member
      </Text>
      <Text style={[styles.stepSubheading, { color: colors.textSecondary }]}>
        Search and select the member receiving this subscription
      </Text>

      <Input
        placeholder="Search by name, email, or phone..."
        value={memberSearch}
        onChangeText={setMemberSearch}
        leftIcon={<Ionicons name="search" size={18} color={colors.textTertiary} />}
        rightIcon={
          memberSearch ? (
            <TouchableOpacity onPress={() => setMemberSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : undefined
        }
        style={styles.searchBox}
      />

      {membersLoading ? (
        <View style={styles.loadingWrapper}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingSubText, { color: colors.textSecondary }]}>
            Loading members...
          </Text>
        </View>
      ) : members.length === 0 ? (
        <View style={styles.emptyMembersBox}>
          <Ionicons name="person-outline" size={40} color={colors.textTertiary} />
          <Text style={[styles.emptyMembersText, { color: colors.textSecondary }]}>
            No members found matching "{memberSearch}"
          </Text>
        </View>
      ) : (
        <View style={styles.memberList}>
          {members.map((m) => {
            const isSelected = selectedMember?.id === m.id;
            return (
              <Card
                key={m.id}
                onPress={() => setSelectedMember(m)}
                style={[
                  styles.memberSelectCard,
                  isSelected && {
                    borderColor: colors.primary,
                    borderWidth: 2,
                    backgroundColor: isDark ? 'rgba(0, 230, 118, 0.06)' : 'rgba(0, 200, 83, 0.05)',
                  },
                ]}
                padding={12}
              >
                <View style={styles.memberCardContent}>
                  <Avatar
                    uri={m.profile?.photo_url}
                    name={m.profile?.full_name || 'Member'}
                    size={44}
                  />
                  <View style={styles.memberCardInfo}>
                    <Text style={[styles.memberNameText, { color: colors.text }]} numberOfLines={1}>
                      {m.profile?.full_name || 'Unnamed Member'}
                    </Text>
                    <Text style={[styles.memberContactText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {m.profile?.phone || m.profile?.email || 'No contact info'}
                    </Text>
                  </View>
                  <View style={styles.memberCardRight}>
                    <StatusBadge status={m.status} />
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={colors.primary}
                        style={styles.checkIcon}
                      />
                    )}
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );

  // Step 2: Plan Selection UI
  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.stepHeading, { color: colors.text }]}>
        Choose Membership Plan
      </Text>
      <Text style={[styles.stepSubheading, { color: colors.textSecondary }]}>
        Select a duration package for {selectedMember?.profile?.full_name || 'the member'}
      </Text>

      {plansLoading ? (
        <View style={styles.loadingWrapper}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingSubText, { color: colors.textSecondary }]}>
            Loading plans...
          </Text>
        </View>
      ) : plans.length === 0 ? (
        <View style={styles.emptyMembersBox}>
          <Ionicons name="pricetags-outline" size={40} color={colors.textTertiary} />
          <Text style={[styles.emptyMembersText, { color: colors.textSecondary }]}>
            No membership plans configured yet.
          </Text>
        </View>
      ) : (
        <View style={styles.plansGrid}>
          {plans.map((plan) => {
            const isSelected = selectedPlan?.id === plan.id;
            return (
              <Card
                key={plan.id}
                onPress={() => handleSelectPlan(plan)}
                style={[
                  styles.planCard,
                  isSelected && {
                    borderColor: colors.primary,
                    borderWidth: 2,
                    backgroundColor: isDark ? 'rgba(0, 230, 118, 0.08)' : 'rgba(0, 200, 83, 0.06)',
                  },
                ]}
                padding={16}
              >
                <View style={styles.planCardHeader}>
                  <Text style={[styles.planName, { color: colors.text }]}>
                    {plan.name}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </View>

                <View style={styles.planDetailsRow}>
                  <View style={styles.planDurationBadge}>
                    <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.planDurationText, { color: colors.textSecondary }]}>
                      {plan.duration_months} {plan.duration_months === 1 ? 'month' : 'months'}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.planPrice, { color: colors.primary }]}>
                  ₹{plan.price.toLocaleString('en-IN')}
                </Text>

                {plan.description ? (
                  <Text style={[styles.planDesc, { color: colors.textTertiary }]} numberOfLines={2}>
                    {plan.description}
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );

  // Step 3: Payment Details UI
  const renderStep3 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.stepHeading, { color: colors.text }]}>
        Payment Details
      </Text>
      <Text style={[styles.stepSubheading, { color: colors.textSecondary }]}>
        Enter the collection amount, payment method, and effective start date
      </Text>

      {/* Amount Input */}
      <Input
        label="Amount to Collect (₹)"
        placeholder="Enter amount"
        value={amountPaid}
        onChangeText={setAmountPaid}
        keyboardType="numeric"
        leftIcon={<Text style={[styles.currencyPrefix, { color: colors.primary }]}>₹</Text>}
      />

      {/* Payment Method Selector */}
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Payment Method
      </Text>
      <View style={styles.methodSelector}>
        {(
          [
            { id: 'upi', label: 'UPI / QR', icon: 'qr-code-outline' },
            { id: 'cash', label: 'Cash', icon: 'cash-outline' },
            { id: 'online', label: 'Online / Card', icon: 'card-outline' },
          ] as const
        ).map((m) => {
          const isSelected = paymentMethod === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.methodOption,
                {
                  backgroundColor: isSelected
                    ? (isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.1)')
                    : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setPaymentMethod(m.id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={m.icon as any}
                size={22}
                color={isSelected ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.methodOptionText,
                  { color: isSelected ? colors.text : colors.textSecondary },
                  isSelected && styles.methodOptionActiveText,
                ]}
              >
                {m.label}
              </Text>
              {isSelected && (
                <View style={[styles.radioActiveDot, { backgroundColor: colors.primary }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Start Date */}
      <Input
        label="Start Date (YYYY-MM-DD)"
        placeholder="YYYY-MM-DD"
        value={startDate}
        onChangeText={setStartDate}
        leftIcon={<Ionicons name="calendar-outline" size={18} color={colors.textTertiary} />}
      />

      {/* Quick Date Fillers */}
      <View style={styles.quickDateChips}>
        <TouchableOpacity
          style={[styles.dateChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
          onPress={() => setStartDate(today())}
        >
          <Text style={[styles.dateChipText, { color: colors.textSecondary }]}>Today</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.dateChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
          onPress={() => {
            const tmrw = new Date();
            tmrw.setDate(tmrw.getDate() + 1);
            setStartDate(tmrw.toISOString().split('T')[0]);
          }}
        >
          <Text style={[styles.dateChipText, { color: colors.textSecondary }]}>Tomorrow</Text>
        </TouchableOpacity>
      </View>

      {/* Duration & End Date Preview */}
      <Card style={styles.previewDateCard} padding={14}>
        <View style={styles.previewDateRow}>
          <View style={styles.previewDateCol}>
            <Text style={[styles.previewDateLabel, { color: colors.textSecondary }]}>
              Membership Period
            </Text>
            <Text style={[styles.previewDateVal, { color: colors.text }]}>
              {formatDate(startDate || today())} → {formatDate(calculatedEndDate)}
            </Text>
          </View>
          <View style={styles.previewDurationPill}>
            <Text style={[styles.previewDurationText, { color: colors.primary }]}>
              {selectedPlan?.duration_months || 1} mo
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );

  // Step 4: Confirmation & Success Receipt
  const renderStep4 = () => {
    // If payment already completed, show receipt confirmation state
    if (confirmedSubscription) {
      return (
        <View style={styles.successContainer}>
          <View style={[styles.successIconCircle, { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.15)' : 'rgba(0, 200, 83, 0.12)' }]}>
            <Ionicons name="checkmark-done-circle" size={64} color={colors.primary} />
          </View>

          <Text style={[styles.successTitle, { color: colors.text }]}>
            Payment Recorded!
          </Text>
          <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
            Subscription activated and receipt generated successfully.
          </Text>

          {/* Receipt Number Badge */}
          <View
            style={[
              styles.confirmedReceiptBox,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.receiptBoxLabel, { color: colors.textSecondary }]}>
              Receipt Number
            </Text>
            <Text style={[styles.receiptBoxNumber, { color: colors.primary }]}>
              {confirmedSubscription.receipt_number}
            </Text>
          </View>

          {/* Summary Breakdown */}
          <Card style={styles.receiptBreakdownCard} padding={16}>
            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>Member</Text>
              <Text style={[styles.breakdownVal, { color: colors.text }]}>
                {selectedMember?.profile?.full_name}
              </Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>Plan</Text>
              <Text style={[styles.breakdownVal, { color: colors.text }]}>
                {selectedPlan?.name}
              </Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>Validity</Text>
              <Text style={[styles.breakdownVal, { color: colors.text }]}>
                {formatDate(startDate)} - {formatDate(calculatedEndDate)}
              </Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>Method</Text>
              <Text style={[styles.breakdownVal, { color: colors.text }]}>
                {paymentMethod.toUpperCase()}
              </Text>
            </View>

            <View style={[styles.breakdownDivider, { backgroundColor: colors.divider }]} />

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownTotalLabel, { color: colors.text }]}>Total Paid</Text>
              <Text style={[styles.breakdownTotalVal, { color: colors.primary }]}>
                ₹{parseFloat(amountPaid || '0').toLocaleString('en-IN')}
              </Text>
            </View>
          </Card>

          {/* Success Action Buttons */}
          <View style={styles.successActions}>
            <Button
              title="Share Receipt (PDF)"
              variant="primary"
              loading={isSharingPdf}
              icon={<Ionicons name="share-social-outline" size={18} color="#FFFFFF" />}
              onPress={handleShareReceipt}
              fullWidth
            />

            <Button
              title="Done"
              variant="secondary"
              onPress={() => router.replace('/(owner)/payments')}
              fullWidth
              style={styles.doneBtn}
            />
          </View>
        </View>
      );
    }

    // Pre-confirmation overview
    return (
      <View style={styles.stepContainer}>
        <Text style={[styles.stepHeading, { color: colors.text }]}>
          Review & Confirm
        </Text>
        <Text style={[styles.stepSubheading, { color: colors.textSecondary }]}>
          Please verify the payment details before confirming
        </Text>

        <Card style={styles.summaryOverviewCard} padding={18}>
          <View style={styles.overviewSection}>
            <Text style={[styles.overviewSectionTitle, { color: colors.textSecondary }]}>
              MEMBER DETAILS
            </Text>
            <View style={styles.overviewMemberRow}>
              <Avatar
                uri={selectedMember?.profile?.photo_url}
                name={selectedMember?.profile?.full_name || 'Member'}
                size={40}
              />
              <View style={styles.overviewMemberInfo}>
                <Text style={[styles.overviewMemberName, { color: colors.text }]}>
                  {selectedMember?.profile?.full_name}
                </Text>
                <Text style={[styles.overviewMemberSub, { color: colors.textSecondary }]}>
                  {selectedMember?.profile?.email || selectedMember?.profile?.phone}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.cardDivider, { backgroundColor: colors.divider }]} />

          <View style={styles.overviewSection}>
            <Text style={[styles.overviewSectionTitle, { color: colors.textSecondary }]}>
              SUBSCRIPTION & DATES
            </Text>
            <View style={styles.overviewDetailsGrid}>
              <View style={styles.overviewGridRow}>
                <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>Plan</Text>
                <Text style={[styles.overviewVal, { color: colors.text }]}>
                  {selectedPlan?.name} ({selectedPlan?.duration_months} mo)
                </Text>
              </View>

              <View style={styles.overviewGridRow}>
                <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>Start Date</Text>
                <Text style={[styles.overviewVal, { color: colors.text }]}>
                  {formatDate(startDate)}
                </Text>
              </View>

              <View style={styles.overviewGridRow}>
                <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>End Date</Text>
                <Text style={[styles.overviewVal, { color: colors.text }]}>
                  {formatDate(calculatedEndDate)}
                </Text>
              </View>

              <View style={styles.overviewGridRow}>
                <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>Payment Method</Text>
                <Text style={[styles.overviewVal, { color: colors.text }]}>
                  {paymentMethod.toUpperCase()}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.cardDivider, { backgroundColor: colors.divider }]} />

          <View style={[styles.overviewAmountBox, { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.1)' : 'rgba(0, 200, 83, 0.08)' }]}>
            <Text style={[styles.overviewAmountLabel, { color: colors.text }]}>
              Total Amount
            </Text>
            <Text style={[styles.overviewAmountValue, { color: colors.primary }]}>
              ₹{parseFloat(amountPaid || '0').toLocaleString('en-IN')}
            </Text>
          </View>
        </Card>
      </View>
    );
  };

  // Determine if Next is enabled for current step
  const isNextDisabled = () => {
    if (currentStep === 1) return !selectedMember;
    if (currentStep === 2) return !selectedPlan;
    if (currentStep === 3) {
      const val = parseFloat(amountPaid);
      return isNaN(val) || val < 0 || !startDate;
    }
    return false;
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => {
            if (currentStep > 1 && !confirmedSubscription) {
              setCurrentStep((prev) => (prev - 1) as any);
            } else {
              router.back();
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Record Payment
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Step {currentStep} of 4
          </Text>
        </View>
      </View>

      {/* Progress Step Bar */}
      {!confirmedSubscription && (
        <View style={styles.stepProgressBar}>
          {[1, 2, 3, 4].map((step) => {
            const isCompleted = currentStep > step;
            const isCurrent = currentStep === step;

            return (
              <View key={step} style={styles.stepIndicatorWrapper}>
                <View
                  style={[
                    styles.stepIndicatorDot,
                    {
                      backgroundColor: isCurrent
                        ? colors.primary
                        : isCompleted
                        ? colors.statusActive
                        : colors.surfaceElevated,
                      borderColor: isCurrent || isCompleted ? colors.primary : colors.border,
                    },
                  ]}
                >
                  {isCompleted ? (
                    <Ionicons name="checkmark" size={14} color="#000000" />
                  ) : (
                    <Text
                      style={[
                        styles.stepIndicatorNum,
                        { color: isCurrent ? '#000000' : colors.textTertiary },
                      ]}
                    >
                      {step}
                    </Text>
                  )}
                </View>
                {step < 4 && (
                  <View
                    style={[
                      styles.stepConnectorLine,
                      {
                        backgroundColor: currentStep > step ? colors.primary : colors.border,
                      },
                    ]}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Content Scroll View */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
      </ScrollView>

      {/* Bottom Navigation Buttons */}
      {!confirmedSubscription && (
        <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {currentStep > 1 && (
            <Button
              title="Back"
              variant="secondary"
              onPress={() => setCurrentStep((prev) => (prev - 1) as any)}
              style={styles.backStepBtn}
            />
          )}

          {currentStep < 4 ? (
            <Button
              title="Next Step"
              variant="primary"
              disabled={isNextDisabled()}
              onPress={() => setCurrentStep((prev) => (prev + 1) as any)}
              style={styles.nextStepBtn}
            />
          ) : (
            <Button
              title="Confirm Payment"
              variant="primary"
              loading={isSubmitting}
              onPress={handleConfirmPayment}
              style={styles.confirmBtn}
            />
          )}
        </View>
      )}
    </KeyboardAvoidingView>
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
    paddingBottom: 12,
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
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  stepProgressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 12,
  },
  stepIndicatorWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepIndicatorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndicatorNum: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepConnectorLine: {
    width: 44,
    height: 2,
    marginHorizontal: 4,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    paddingTop: 8,
  },
  stepContainer: {
    gap: 8,
  },
  stepHeading: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  stepSubheading: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  searchBox: {
    marginBottom: 8,
  },
  loadingWrapper: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  loadingSubText: {
    fontSize: 13,
  },
  emptyMembersBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  emptyMembersText: {
    fontSize: 14,
    textAlign: 'center',
  },
  memberList: {
    gap: 8,
  },
  memberSelectCard: {
    marginBottom: 2,
  },
  memberCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberCardInfo: {
    marginLeft: 12,
    flex: 1,
  },
  memberNameText: {
    fontSize: 15,
    fontWeight: '700',
  },
  memberContactText: {
    fontSize: 12,
    marginTop: 2,
  },
  memberCardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  checkIcon: {
    marginTop: 2,
  },
  plansGrid: {
    gap: 10,
  },
  planCard: {
    marginBottom: 2,
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  planName: {
    fontSize: 17,
    fontWeight: '700',
  },
  planDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  planDurationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  planDurationText: {
    fontSize: 13,
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  planDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  currencyPrefix: {
    fontSize: 18,
    fontWeight: '700',
    marginRight: 4,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  methodSelector: {
    gap: 8,
    marginBottom: 16,
  },
  methodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  methodOptionText: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  methodOptionActiveText: {
    fontWeight: '700',
  },
  radioActiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  quickDateChips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: -8,
    marginBottom: 16,
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  previewDateCard: {
    marginTop: 4,
  },
  previewDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewDateCol: {
    flex: 1,
  },
  previewDateLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  previewDateVal: {
    fontSize: 14,
    fontWeight: '700',
  },
  previewDurationPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  previewDurationText: {
    fontSize: 13,
    fontWeight: '700',
  },
  summaryOverviewCard: {
    gap: 14,
  },
  overviewSection: {
    gap: 8,
  },
  overviewSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  overviewMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overviewMemberInfo: {
    marginLeft: 12,
    flex: 1,
  },
  overviewMemberName: {
    fontSize: 16,
    fontWeight: '700',
  },
  overviewMemberSub: {
    fontSize: 13,
    marginTop: 1,
  },
  cardDivider: {
    height: 1,
  },
  overviewDetailsGrid: {
    gap: 8,
  },
  overviewGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overviewLabel: {
    fontSize: 13,
  },
  overviewVal: {
    fontSize: 14,
    fontWeight: '600',
  },
  overviewAmountBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
  },
  overviewAmountLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  overviewAmountValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  successContainer: {
    alignItems: 'center',
    paddingTop: 20,
    paddingHorizontal: 8,
  },
  successIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  confirmedReceiptBox: {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 16,
  },
  receiptBoxLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  receiptBoxNumber: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  receiptBreakdownCard: {
    width: '100%',
    gap: 10,
    marginBottom: 24,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 13,
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: '600',
  },
  breakdownDivider: {
    height: 1,
    marginVertical: 4,
  },
  breakdownTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  breakdownTotalVal: {
    fontSize: 18,
    fontWeight: '800',
  },
  successActions: {
    width: '100%',
    gap: 10,
  },
  doneBtn: {
    marginTop: 4,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1,
    gap: 10,
  },
  backStepBtn: {
    flex: 1,
  },
  nextStepBtn: {
    flex: 2,
  },
  confirmBtn: {
    flex: 1,
  },
});
