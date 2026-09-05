import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';
import { useDues, DueRow } from '../../../hooks/useDues';
import { formatDate } from '../../../utils/date';
import Card from '../../../components/ui/Card';
import Avatar from '../../../components/ui/Avatar';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank'];

/**
 * Who still owes money, and how much.
 *
 * The gym owner's actual problem: members hand over part of a plan and promise
 * the rest. One is a mental note, thirty is money written off. Everything here
 * answers one question at a glance — who, how much, and how do I collect it.
 */
export default function OwnerDuesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { dues, loading, totalOutstanding, membersOwing, refresh, collectBalance } = useDues();

  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<DueRow | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [saving, setSaving] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const openCollect = (row: DueRow) => {
    setSelected(row);
    // Prefilled with the whole balance: settling in full is the common case,
    // and a second part payment is still allowed by editing it down.
    setAmount(String(row.balance));
    setMethod('cash');
  };

  const handleCollect = async () => {
    if (!selected) return;
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      Alert.alert('Enter an amount', 'How much are you collecting?');
      return;
    }
    if (value > selected.balance) {
      Alert.alert(
        'More than is owed',
        `${selected.memberName} only owes ₹${selected.balance.toLocaleString('en-IN')}.`
      );
      return;
    }

    setSaving(true);
    try {
      await collectBalance(selected.subscriptionId, value, method);
      const left = selected.balance - value;
      setSelected(null);
      Alert.alert(
        'Payment recorded',
        left > 0
          ? `₹${value.toLocaleString('en-IN')} collected. ₹${left.toLocaleString('en-IN')} still outstanding.`
          : `₹${value.toLocaleString('en-IN')} collected. ${selected.memberName} is fully paid up.`
      );
    } catch (err: any) {
      console.error('[Dues] Collect error:', err);
      Alert.alert('Could not record payment', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderItem = ({ item }: { item: DueRow }) => (
    <Card style={styles.card} padding={14}>
      <View style={styles.rowTop}>
        <Avatar uri={item.photoUrl} name={item.memberName} size={42} />
        <View style={styles.rowInfo}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {item.memberName}
          </Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.planName} · {formatDate(item.startDate)}
          </Text>
        </View>
        <View style={styles.amountCol}>
          <Text style={[styles.balance, { color: colors.warning }]}>
            ₹{item.balance.toLocaleString('en-IN')}
          </Text>
          <Text style={[styles.ofTotal, { color: colors.textTertiary }]}>
            of ₹{item.planPrice.toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

      {item.lapsed ? (
        <View style={styles.lapsedRow}>
          <Badge text="Plan already ended" variant="error" size="sm" />
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {item.memberPhone ? (
          <TouchableOpacity
            style={[styles.callBtn, { borderColor: colors.border }]}
            onPress={() => Linking.openURL(`tel:${item.memberPhone}`)}
            activeOpacity={0.7}
          >
            <Ionicons name="call-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.callText, { color: colors.textSecondary }]}>Call</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.viewBtn, { borderColor: colors.border }]}
          onPress={() => router.push(`/(owner)/members/${item.gymMemberId}`)}
          activeOpacity={0.7}
        >
          <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.callText, { color: colors.textSecondary }]}>Profile</Text>
        </TouchableOpacity>

        <Button
          title="Collect"
          size="sm"
          variant="primary"
          onPress={() => openCollect(item)}
          style={styles.collectBtn}
        />
      </View>
    </Card>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 12, 44) }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Outstanding Dues</Text>
      </View>

      <FlatList
        data={dues}
        keyExtractor={(item) => item.subscriptionId}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
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
          dues.length > 0 ? (
            <View
              style={[
                styles.summary,
                {
                  backgroundColor: isDark ? 'rgba(255, 171, 0, 0.10)' : '#FFF8E1',
                  borderColor: colors.warning,
                },
              ]}
            >
              <Text style={[styles.summaryAmount, { color: colors.warning }]}>
                ₹{totalOutstanding.toLocaleString('en-IN')}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                owed by {membersOwing} {membersOwing === 1 ? 'member' : 'members'}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading && !refreshing ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.success} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing outstanding</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                Every member has paid their plan in full. Part payments show up here
                automatically.
              </Text>
            </View>
          )
        }
      />

      {/* Collect modal */}
      <Modal
        visible={!!selected}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Collect from {selected?.memberName}
              </Text>
              <TouchableOpacity
                onPress={() => setSelected(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
              {selected?.planName} · owes ₹{selected?.balance.toLocaleString('en-IN')} of ₹
              {selected?.planPrice.toLocaleString('en-IN')}
            </Text>

            <Input
              label="Amount collected (₹)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Payment method</Text>
            <View style={styles.methodRow}>
              {PAYMENT_METHODS.map((m) => {
                const on = method === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setMethod(m)}
                    activeOpacity={0.7}
                    style={[
                      styles.methodChip,
                      {
                        backgroundColor: on ? colors.primary : colors.surfaceElevated,
                        borderColor: on ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.methodText, { color: on ? '#000000' : colors.textSecondary }]}
                    >
                      {m.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Button
              title="Record Payment"
              onPress={handleCollect}
              variant="primary"
              size="lg"
              fullWidth
              loading={saving}
              style={styles.modalBtn}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  list: { paddingHorizontal: 16 },
  summary: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryAmount: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  summaryLabel: { fontSize: 13, marginTop: 2 },
  card: { marginBottom: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowInfo: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  amountCol: { alignItems: 'flex-end' },
  balance: { fontSize: 18, fontWeight: '800' },
  ofTotal: { fontSize: 11, marginTop: 1 },
  lapsedRow: { flexDirection: 'row', marginTop: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  callText: { fontSize: 13, fontWeight: '600' },
  collectBtn: { marginLeft: 'auto' },
  center: { paddingVertical: 80, alignItems: 'center' },
  empty: { paddingVertical: 60, alignItems: 'center', paddingHorizontal: 24 },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  modalSub: { fontSize: 13, marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  methodChip: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  methodText: { fontSize: 12, fontWeight: '700' },
  modalBtn: { marginTop: 4 },
});
