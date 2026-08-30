import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Switch,
  Alert,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';

interface MembershipPlan {
  id: string;
  gym_id: string;
  name: string;
  duration_months: number;
  price: number;
  is_active: boolean;
  created_at: string;
}

export default function PlansListScreen() {
  const router = useRouter();
  const { gymId, supabase, isSignedIn } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    if (!gymId) return;

    try {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('*')
        .eq('gym_id', gymId)
        .order('duration_months', { ascending: true });

      if (error) {
        console.error('[PlansList] Fetch error:', error);
        // Don't alert if the session ended mid-request (e.g. during sign-out).
        if (isSignedIn) Alert.alert('Error', 'Failed to load membership plans.');
        return;
      }

      setPlans((data || []) as MembershipPlan[]);
    } catch (err) {
      console.error('[PlansList] Unexpected error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gymId, supabase, isSignedIn]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPlans();
  };

  const handleToggleActive = async (plan: MembershipPlan) => {
    setTogglingId(plan.id);
    const newStatus = !plan.is_active;

    try {
      const { error } = await supabase
        .from('membership_plans')
        .update({ is_active: newStatus, updated_at: new Date().toISOString() })
        .eq('id', plan.id);

      if (error) throw error;

      setPlans((prev) =>
        prev.map((p) => (p.id === plan.id ? { ...p, is_active: newStatus } : p))
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update plan status.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeletePlan = (plan: MembershipPlan) => {
    Alert.alert(
      'Delete Plan',
      `Are you sure you want to delete "${plan.name}"? This can only be done while no payment has ever used it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('membership_plans')
                .delete()
                .eq('id', plan.id);

              if (error) throw error;

              setPlans((prev) => prev.filter((p) => p.id !== plan.id));
              Alert.alert('Deleted', `"${plan.name}" has been removed.`);
            } catch (err: any) {
              // subscriptions.plan_id references membership_plans(id) with no
              // ON DELETE rule, so Postgres refuses to delete any plan a
              // payment has used. Offer deactivation instead: it stops the plan
              // being sold while keeping historical receipts intact.
              if (err?.code === '23503') {
                Alert.alert(
                  'Plan In Use',
                  `"${plan.name}" is linked to existing payments, so it can't be deleted without destroying those records. Deactivate it instead to stop offering it to new members.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Deactivate',
                      onPress: () => {
                        if (plan.is_active) handleToggleActive(plan);
                      },
                    },
                  ]
                );
                return;
              }
              Alert.alert('Error', err.message || 'Could not delete plan.');
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
          <Ionicons name="pricetags-outline" size={56} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No Membership Plans
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Create membership packages (e.g. Monthly, Quarterly, Annual) so members can join and make payments.
        </Text>
        <Button
          title="+ Add First Plan"
          variant="primary"
          onPress={() => router.push('/(owner)/plans/create')}
          style={{ marginTop: 8 }}
        />
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
            Membership Plans
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {plans.length} {plans.length === 1 ? 'plan configured' : 'plans configured'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(owner)/plans/create')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={22} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Plans List */}
      {loading && plans.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading plans...
          </Text>
        </View>
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => {
            const isToggling = togglingId === item.id;
            return (
              <Card style={styles.planCard} padding={18}>
                {/* Top Row: Name and Active Switch */}
                <View style={styles.cardHeaderRow}>
                  <View style={styles.cardTitleGroup}>
                    <Text style={[styles.planName, { color: colors.text }]}>
                      {item.name}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge
                        text={item.is_active ? 'ACTIVE' : 'INACTIVE'}
                        variant={item.is_active ? 'success' : 'default'}
                        size="sm"
                      />
                      <Badge
                        text={`${item.duration_months} ${item.duration_months === 1 ? 'Month' : 'Months'}`}
                        variant="info"
                        size="sm"
                      />
                    </View>
                  </View>

                  <View style={styles.switchWrapper}>
                    {isToggling ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Switch
                        value={item.is_active}
                        onValueChange={() => handleToggleActive(item)}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor={isDark ? '#FFFFFF' : '#FFFFFF'}
                      />
                    )}
                  </View>
                </View>

                {/* Price Display */}
                <View style={styles.priceRow}>
                  <Text style={[styles.priceCurrency, { color: colors.primary }]}>₹</Text>
                  <Text style={[styles.priceAmount, { color: colors.text }]}>
                    {Number(item.price).toLocaleString('en-IN')}
                  </Text>
                  <Text style={[styles.pricePerDuration, { color: colors.textSecondary }]}>
                    / {item.duration_months === 1 ? 'month' : `${item.duration_months} months`}
                  </Text>
                </View>

                {/* Actions Footer */}
                <View style={[styles.cardFooter, { borderTopColor: colors.divider }]}>
                  <TouchableOpacity
                    style={[styles.footerActionBtn, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
                    onPress={() => router.push(`/(owner)/plans/create?id=${item.id}`)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                    <Text style={[styles.footerBtnText, { color: colors.text }]}>
                      Edit Plan
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.footerActionBtn, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
                    onPress={() => handleDeletePlan(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={[styles.footerBtnText, { color: colors.error }]}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              </Card>
            );
          }}
        />
      )}
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
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: 4,
  },
  planCard: {
    borderRadius: 16,
    marginBottom: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitleGroup: {
    flex: 1,
    marginRight: 12,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  switchWrapper: {
    paddingTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  priceCurrency: {
    fontSize: 20,
    fontWeight: '700',
    marginRight: 2,
  },
  priceAmount: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  pricePerDuration: {
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  footerActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  footerBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
