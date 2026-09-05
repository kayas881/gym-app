import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAppAuth } from '../../../lib/auth';
import DuesBanner from '../../../components/DuesBanner';
import { useTheme } from '../../../lib/theme';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Avatar from '../../../components/ui/Avatar';
import { planDurationSuffix } from '../../../utils/plan-label';
import { formatDate, formatDateTime } from '../../../utils/date';
import { generateReceiptHTML } from '../../../utils/receipt-template';

type FilterPeriod = 'this_month' | 'last_month' | 'all_time';

interface PaymentRecord {
  id: string;
  gym_member_id: string;
  plan_id: string;
  amount_paid: number;
  payment_method: string;
  start_date: string;
  end_date: string;
  receipt_number: string;
  status: string;
  created_at: string;
  gym_member: {
    id: string;
    gym_id: string;
    profile: {
      id?: string;
      full_name: string;
      email?: string;
      photo_url: string | null;
    } | null;
  } | null;
  plan: {
    id?: string;
    name: string;
    duration_months: number;
    price?: number;
  } | null;
}

export default function OwnerPaymentsScreen() {
  const router = useRouter();
  const { gymId, currentMembership, supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<FilterPeriod>('this_month');
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentRecord | null>(null);
  const [isSharingPdf, setIsSharingPdf] = useState(false);

  // Fetch all payment records for this gym
  const fetchPayments = useCallback(async () => {
    if (!gymId) return;

    try {
      // Query subscriptions joined with gym_members, profiles, and membership_plans
      const { data, error } = await supabase
        .from('subscriptions')
        .select(`
          id,
          gym_member_id,
          plan_id,
          amount_paid,
          payment_method,
          start_date,
          end_date,
          receipt_number,
          status,
          created_at,
          gym_member:gym_members!inner (
            id,
            gym_id,
            profile:profiles (
              id,
              full_name,
              email,
              photo_url
            )
          ),
          plan:membership_plans (
            id,
            name,
            duration_months,
            price
          )
        `)
        .eq('gym_member.gym_id', gymId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[OwnerPayments] Error fetching payments:', error);
        return;
      }

      setPayments((data as unknown as PaymentRecord[]) || []);
    } catch (err) {
      console.error('[OwnerPayments] Unexpected error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPayments();
  };

  // Filter payments based on selected period
  const filteredPayments = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    if (selectedPeriod === 'this_month') {
      const startOfThisMonth = new Date(currentYear, currentMonth, 1);
      return payments.filter((p) => new Date(p.created_at) >= startOfThisMonth);
    }

    if (selectedPeriod === 'last_month') {
      const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1);
      const endOfLastMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
      return payments.filter((p) => {
        const paymentDate = new Date(p.created_at);
        return paymentDate >= startOfLastMonth && paymentDate <= endOfLastMonth;
      });
    }

    // 'all_time'
    return payments;
  }, [payments, selectedPeriod]);

  // Calculate revenue & count for selected period
  const summaryStats = useMemo(() => {
    const totalRevenue = filteredPayments.reduce((acc, curr) => acc + (Number(curr.amount_paid) || 0), 0);
    const count = filteredPayments.length;
    return { totalRevenue, count };
  }, [filteredPayments]);

  // Generate and share PDF receipt
  const handleShareReceipt = async (record: PaymentRecord) => {
    try {
      setIsSharingPdf(true);
      const gymName = currentMembership?.gym?.name || 'Gym';
      const memberName = record.gym_member?.profile?.full_name || 'Member';
      const memberEmail = record.gym_member?.profile?.email || 'N/A';
      const planName = record.plan?.name || 'Custom Plan';
      const durationMonths = record.plan?.duration_months || 1;

      const html = generateReceiptHTML({
        gymName,
        gymLogoUrl: currentMembership?.gym?.logo_url,
        memberName,
        memberEmail,
        planName,
        durationMonths,
        amountPaid: record.amount_paid,
        paymentMethod: record.payment_method,
        startDate: record.start_date,
        endDate: record.end_date,
        receiptNumber: record.receipt_number,
        paymentDate: record.created_at,
      });

      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          UTI: '.pdf',
          mimeType: 'application/pdf',
          dialogTitle: `Receipt-${record.receipt_number}.pdf`,
        });
      } else {
        Alert.alert('Sharing Unavailable', 'PDF sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.error('[OwnerPayments] Share PDF error:', err);
      Alert.alert('Error', err.message || 'Could not generate receipt PDF.');
    } finally {
      setIsSharingPdf(false);
    }
  };

  const getPaymentMethodBadge = (method: string) => {
    const normalized = (method || '').toLowerCase();
    if (normalized === 'upi') {
      return <Badge text="UPI" variant="info" size="sm" />;
    }
    if (normalized === 'cash') {
      return <Badge text="Cash" variant="success" size="sm" />;
    }
    return <Badge text="Online" variant="warning" size="sm" />;
  };

  const renderPaymentItem = ({ item }: { item: PaymentRecord }) => {
    const memberName = item.gym_member?.profile?.full_name || 'Unknown Member';
    const photoUrl = item.gym_member?.profile?.photo_url;
    const planName = item.plan?.name || 'Membership Plan';
    // Plan names usually already state the term ("3 Months"), which rendered as
    // "3 Months • 3 mo". The shared helper decides when the suffix adds anything.
    const duration = planDurationSuffix(planName, item.plan?.duration_months);

    return (
      <Card
        style={styles.paymentCard}
        onPress={() => setSelectedReceipt(item)}
        padding={14}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.memberInfoRow}>
            <Avatar uri={photoUrl} name={memberName} size={40} />
            <View style={styles.memberTextGroup}>
              <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                {memberName}
              </Text>
              <Text style={[styles.planSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {planName} {duration ? `• ${duration}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.amountContainer}>
            <Text style={[styles.amountText, { color: colors.primary }]}>
              ₹{item.amount_paid.toLocaleString('en-IN')}
            </Text>
            {getPaymentMethodBadge(item.payment_method)}
          </View>
        </View>

        <View style={[styles.cardDivider, { backgroundColor: colors.divider }]} />

        <View style={styles.cardBottomRow}>
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color={colors.textTertiary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {formatDate(item.created_at)}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="receipt-outline" size={13} color={colors.textTertiary} />
            <Text style={[styles.receiptNumberText, { color: colors.textTertiary }]}>
              {item.receipt_number}
            </Text>
          </View>
        </View>
      </Card>
    );
  };

  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconCircle,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' },
          ]}
        >
          <Ionicons name="card-outline" size={48} color={colors.textTertiary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No Payments Found
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {selectedPeriod === 'this_month'
            ? 'No payments have been recorded for this month yet.'
            : selectedPeriod === 'last_month'
            ? 'No payments were recorded during the last month.'
            : 'Start recording member subscription payments to build your history.'}
        </Text>
        <Button
          title="Record New Payment"
          variant="primary"
          icon={<Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />}
          onPress={() => router.push('/(owner)/payments/record')}
          style={styles.emptyActionButton}
        />
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Payment History
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Track member renewals and collections
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.recordBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(owner)/payments/record')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={20} color="#000000" />
          <Text style={styles.recordBtnText}>Record</Text>
        </TouchableOpacity>
      </View>

      <DuesBanner style={styles.duesBannerSpacing} />

      {/* Summary Card */}
      <View style={styles.summaryCardWrapper}>
        <Card style={styles.summaryCard} padding={16}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                {selectedPeriod === 'this_month'
                  ? 'Revenue This Month'
                  : selectedPeriod === 'last_month'
                  ? 'Revenue Last Month'
                  : 'Total Revenue'}
              </Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                ₹{summaryStats.totalRevenue.toLocaleString('en-IN')}
              </Text>
            </View>

            <View style={[styles.summaryDividerVertical, { backgroundColor: colors.divider }]} />

            <View style={styles.summaryColRight}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                Transactions
              </Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {summaryStats.count}
              </Text>
            </View>
          </View>
        </Card>
      </View>

      {/* Period Filter Tabs */}
      <View style={styles.filterSection}>
        <View style={[styles.filterSegmentContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.filterTab,
              selectedPeriod === 'this_month' && { backgroundColor: colors.primary },
            ]}
            onPress={() => setSelectedPeriod('this_month')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: selectedPeriod === 'this_month' ? '#000000' : colors.textSecondary },
                selectedPeriod === 'this_month' && styles.filterTabActiveText,
              ]}
            >
              This Month
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterTab,
              selectedPeriod === 'last_month' && { backgroundColor: colors.primary },
            ]}
            onPress={() => setSelectedPeriod('last_month')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: selectedPeriod === 'last_month' ? '#000000' : colors.textSecondary },
                selectedPeriod === 'last_month' && styles.filterTabActiveText,
              ]}
            >
              Last Month
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterTab,
              selectedPeriod === 'all_time' && { backgroundColor: colors.primary },
            ]}
            onPress={() => setSelectedPeriod('all_time')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: selectedPeriod === 'all_time' ? '#000000' : colors.textSecondary },
                selectedPeriod === 'all_time' && styles.filterTabActiveText,
              ]}
            >
              All Time
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Payment Records List */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading payment records...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredPayments}
          keyExtractor={(item) => item.id}
          renderItem={renderPaymentItem}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Receipt Detail Modal */}
      <Modal
        visible={!!selectedReceipt}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedReceipt(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {selectedReceipt && (
              <>
                <View style={styles.modalHeader}>
                  <View style={styles.receiptTitleWrap}>
                    <Ionicons name="receipt" size={22} color={colors.primary} />
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      Receipt Details
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedReceipt(null)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={styles.modalBody}>
                  {/* Receipt Header Badge */}
                  <View
                    style={[
                      styles.receiptBadgeContainer,
                      { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.08)' },
                    ]}
                  >
                    <Text style={[styles.receiptNumberLabel, { color: colors.textSecondary }]}>
                      Receipt No.
                    </Text>
                    <Text style={[styles.receiptNumberMain, { color: colors.primary }]}>
                      {selectedReceipt.receipt_number}
                    </Text>
                  </View>

                  {/* Receipt Detail Rows */}
                  <View style={styles.receiptDetailsBox}>
                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Gym</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {currentMembership?.gym?.name || 'Gym'}
                      </Text>
                    </View>

                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Member</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {selectedReceipt.gym_member?.profile?.full_name || 'Member'}
                      </Text>
                    </View>

                    {selectedReceipt.gym_member?.profile?.email ? (
                      <View style={styles.receiptRow}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Email</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {selectedReceipt.gym_member.profile.email}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Plan</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {selectedReceipt.plan?.name || 'Custom Plan'} ({selectedReceipt.plan?.duration_months || 1} mo)
                      </Text>
                    </View>

                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Start Date</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {formatDate(selectedReceipt.start_date)}
                      </Text>
                    </View>

                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>End Date</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {formatDate(selectedReceipt.end_date)}
                      </Text>
                    </View>

                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Payment Date</Text>
                      <Text style={[styles.detailValue, { color: colors.text }]}>
                        {formatDateTime(selectedReceipt.created_at)}
                      </Text>
                    </View>

                    <View style={styles.receiptRow}>
                      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Payment Method</Text>
                      <View style={styles.methodBadgeWrap}>
                        {getPaymentMethodBadge(selectedReceipt.payment_method)}
                      </View>
                    </View>

                    <View style={[styles.receiptAmountRow, { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.1)' : 'rgba(0, 200, 83, 0.08)' }]}>
                      <Text style={[styles.amountRowLabel, { color: colors.text }]}>Amount Paid</Text>
                      <Text style={[styles.amountRowValue, { color: colors.primary }]}>
                        ₹{selectedReceipt.amount_paid.toLocaleString('en-IN')}
                      </Text>
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.modalActionButtons}>
                    <Button
                      title="Share / Print Receipt (PDF)"
                      variant="primary"
                      loading={isSharingPdf}
                      icon={<Ionicons name="share-outline" size={18} color="#FFFFFF" />}
                      onPress={() => handleShareReceipt(selectedReceipt)}
                      style={styles.shareBtn}
                    />

                    <Button
                      title="Close"
                      variant="secondary"
                      onPress={() => setSelectedReceipt(null)}
                      style={styles.closeBtn}
                    />
                  </View>
                </ScrollView>
              </>
            )}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
  },
  headerTitleGroup: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  recordBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  duesBannerSpacing: { marginHorizontal: 16 },
  summaryCardWrapper: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  summaryCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#00E676',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryCol: {
    flex: 1.3,
  },
  summaryColRight: {
    flex: 0.9,
    paddingLeft: 16,
  },
  summaryDividerVertical: {
    width: 1,
    height: 36,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  filterSection: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterSegmentContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  filterTabActiveText: {
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 90,
  },
  paymentCard: {
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  memberTextGroup: {
    marginLeft: 10,
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
  },
  planSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  amountContainer: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
  },
  cardDivider: {
    height: 1,
    marginVertical: 10,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  receiptNumberText: {
    fontSize: 11,
    fontFamily: 'monospace',
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
    paddingHorizontal: 24,
    paddingTop: 50,
    gap: 10,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
  emptyActionButton: {
    marginTop: 10,
    paddingHorizontal: 20,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    maxHeight: '85%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  receiptTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    marginBottom: 10,
  },
  receiptBadgeContainer: {
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  receiptNumberLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  receiptNumberMain: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  receiptDetailsBox: {
    gap: 12,
    marginBottom: 20,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: '60%',
  },
  methodBadgeWrap: {
    alignItems: 'flex-end',
  },
  receiptAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  amountRowLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  amountRowValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  modalActionButtons: {
    gap: 10,
    marginTop: 6,
    marginBottom: 20,
  },
  shareBtn: {
    width: '100%',
  },
  closeBtn: {
    width: '100%',
  },
});
