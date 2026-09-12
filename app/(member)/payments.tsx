import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useSubscriptions } from '../../hooks/useSubscriptions';
import { formatDate, today } from '../../utils/date';
import { generateReceiptHTML, RECEIPT_PDF_OPTIONS } from '../../utils/receipt-template';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

export default function MemberPaymentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    subscriptions,
    activeSubscription,
    loading,
    refresh,
  } = useSubscriptions(currentMembership?.id);

  const todayStr = today();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<(typeof subscriptions)[0] | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const handleDownloadReceipt = async (item: (typeof subscriptions)[0]) => {
    try {
      setIsGeneratingPdf(true);
      const html = generateReceiptHTML({
        gymName: currentMembership?.gym?.name || 'Gym Center',
        gymLogoUrl: currentMembership?.gym?.logo_url,
        memberName: profile?.full_name || 'Member',
        memberEmail: profile?.email || '',
        planName: item.plan?.name || 'Gym Plan',
        durationMonths: item.plan?.duration_months || 1,
        amountPaid: item.amount_paid,
        paymentMethod: item.payment_method,
        startDate: item.start_date,
        endDate: item.end_date,
        receiptNumber: item.receipt_number,
        paymentDate: item.created_at || item.start_date,
      });

      const { uri } = await Print.printToFileAsync({ html, ...RECEIPT_PDF_OPTIONS });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          UTI: '.pdf',
          mimeType: 'application/pdf',
        });
      } else {
        Alert.alert('Receipt Generated', `Receipt PDF saved to: ${uri}`);
      }
    } catch (err: any) {
      console.error('[Payments] Error generating receipt PDF:', err);
      Alert.alert('Error', 'Failed to generate receipt PDF. Please try again.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const renderPaymentItem = ({ item }: { item: (typeof subscriptions)[0] }) => {
    // Since migration 024 an early renewal is also 'active' while still in the
    // future, so keying the CURRENT PLAN badge off status alone put it on the
    // row starting 1 Dec and left the row covering today unlabelled.
    const isCurrent = item.id === activeSubscription?.id;
    const isUpcoming = item.status === 'active' && item.start_date > todayStr;
    // Not active, but its period has not run out: a later payment superseded
    // it. That is a real payment whose remaining time was given up, so it
    // must not look the same as a plan that simply ran its course.
    const isReplaced = item.status !== 'active' && item.end_date >= todayStr;

    return (
      <Card
        style={[
          styles.paymentCard,
          (isCurrent || isUpcoming) && {
            borderColor: isCurrent ? colors.primary : colors.info,
            borderWidth: 1.5,
          },
        ]}
        padding={16}
        onPress={() => setSelectedReceipt(item)}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.planInfoGroup}>
            <View style={styles.titleWithBadge}>
              <Text style={[styles.planNameText, { color: colors.text }]}>
                {item.plan?.name || 'Membership Plan'}
              </Text>
              {isCurrent ? (
                <Badge text="CURRENT PLAN" variant="success" size="sm" />
              ) : isUpcoming ? (
                <Badge text="STARTS SOON" variant="info" size="sm" />
              ) : isReplaced ? (
                <Badge text="REPLACED" variant="warning" size="sm" />
              ) : null}
            </View>
            <Text style={[styles.receiptNumberText, { color: colors.textTertiary }]}>
              {item.receipt_number}
            </Text>
            {isReplaced ? (
              <Text style={[styles.replacedNote, { color: colors.warning }]}>
                Superseded by a later plan — ask your gym if this looks wrong.
              </Text>
            ) : null}
          </View>

          <Text style={[styles.amountText, { color: colors.primary }]}>
            ₹{item.amount_paid.toLocaleString('en-IN')}
          </Text>
        </View>

        <View style={styles.cardDivider} />

        <View style={styles.cardDetailsRow}>
          <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Payment Date
            </Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {formatDate(item.created_at || item.start_date)}
            </Text>
          </View>

          <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Duration
            </Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {formatDate(item.start_date)} – {formatDate(item.end_date)}
            </Text>
          </View>

          <View style={styles.detailItemRight}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Method
            </Text>
            <Badge
              text={item.payment_method.toUpperCase()}
              variant="default"
              size="sm"
            />
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={subscriptions}
        keyExtractor={(item) => item.id}
        renderItem={renderPaymentItem}
        contentContainerStyle={[
          styles.listContent,
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
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.header}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Payment History</Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                Plans, payments and receipts
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading && !refreshing ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary, marginTop: 12 }]}>
                Loading your payment records...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="receipt-outline" size={48} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No payment history found
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Your payment receipts will appear here once your subscriptions are recorded.
              </Text>
            </View>
          )
        }
      />

      {/* Receipt Details Modal */}
      <Modal
        visible={!!selectedReceipt}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedReceipt(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={styles.receiptModalHeader}>
                <Ionicons name="receipt-outline" size={24} color={colors.primary} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Payment Receipt
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedReceipt(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedReceipt && (
              <View style={styles.receiptContainer}>
                {/* Receipt Number Banner */}
                <View
                  style={[
                    styles.receiptNumberBanner,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.receiptNumberLabel, { color: colors.textSecondary }]}>
                    RECEIPT NO
                  </Text>
                  <Text style={[styles.receiptNumberVal, { color: colors.primary }]}>
                    {selectedReceipt.receipt_number}
                  </Text>
                </View>

                {/* Info Fields */}
                <View style={styles.receiptDetails}>
                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      Gym Name
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {currentMembership?.gym?.name || 'Gym Center'}
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      Member Name
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {profile?.full_name}
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      Plan Name
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {selectedReceipt.plan?.name || 'Membership'} (
                      {selectedReceipt.plan?.duration_months || 1} months)
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      Start Date
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {formatDate(selectedReceipt.start_date)}
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      End Date
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {formatDate(selectedReceipt.end_date)}
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      Payment Method
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {selectedReceipt.payment_method.toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>
                      Payment Date
                    </Text>
                    <Text style={[styles.receiptValue, { color: colors.text }]}>
                      {formatDate(selectedReceipt.created_at || selectedReceipt.start_date)}
                    </Text>
                  </View>

                  {/* Total Amount Box */}
                  <View
                    style={[
                      styles.totalAmountBox,
                      {
                        backgroundColor: isDark ? 'rgba(0, 230, 118, 0.1)' : '#E8F8F0',
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
                      Amount Paid
                    </Text>
                    <Text style={[styles.totalValue, { color: colors.primary }]}>
                      ₹{selectedReceipt.amount_paid.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.receiptActions}>
                  <Button
                    title="Download / Share Receipt PDF"
                    onPress={() => handleDownloadReceipt(selectedReceipt)}
                    variant="primary"
                    size="md"
                    loading={isGeneratingPdf}
                    fullWidth
                    icon={<Ionicons name="download-outline" size={20} color="#000000" />}
                  />
                </View>
              </View>
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
  listContent: {
    paddingHorizontal: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  header: { flex: 1 },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  paymentCard: {
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  planInfoGroup: {
    flex: 1,
    marginRight: 12,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  planNameText: {
    fontSize: 17,
    fontWeight: '700',
  },
  replacedNote: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  receiptNumberText: {
    fontSize: 12,
  },
  amountText: {
    fontSize: 20,
    fontWeight: '800',
  },
  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    marginVertical: 12,
  },
  cardDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailItem: {
    flex: 1,
  },
  detailItemRight: {
    alignItems: 'flex-end',
  },
  detailLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
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
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  receiptModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  receiptContainer: {
    paddingTop: 4,
  },
  receiptNumberBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  receiptNumberLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  receiptNumberVal: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  receiptDetails: {
    gap: 10,
    marginBottom: 20,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  receiptLabel: {
    fontSize: 13,
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalAmountBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  receiptActions: {
    marginTop: 4,
  },
});
