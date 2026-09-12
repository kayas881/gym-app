import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';
import { today } from '../utils/date';

export interface DueRow {
  /** The subscription carrying the debt — what a balance payment is recorded against. */
  subscriptionId: string;
  gymMemberId: string;
  memberName: string;
  memberPhone: string | null;
  photoUrl: string | null;
  planName: string;
  planPrice: number;
  amountPaid: number;
  balance: number;
  startDate: string;
  endDate: string;
  /** The membership period has already ended and they still owe for it. */
  lapsed: boolean;
}

/**
 * Every subscription that has been part paid, newest first.
 *
 * Members routinely hand over less than the plan price and promise the rest.
 * One member is a mental note; thirty is money quietly written off, which is
 * the problem this exists to solve.
 *
 * Balance is `plan_price - amount_paid`, both on the subscription itself:
 * plan_price is snapshotted at the sale (migration 036) so editing a plan's
 * price later cannot rewrite what an old member owed, and amount_paid is the
 * total of the subscription_payments ledger, maintained by trigger.
 *
 * A NULL plan_price means the expected amount was never recorded — pre-036 rows
 * whose plan has since been deleted. Those are excluded rather than reported as
 * a debt of the full amount.
 */
export function useDues() {
  const supabase = useSupabase();
  const { gymId } = useAppAuth();

  const [dues, setDues] = useState<DueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDues = useCallback(async () => {
    if (!gymId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('subscriptions')
        .select(
          `
          id,
          plan_price,
          amount_paid,
          start_date,
          end_date,
          status,
          gym_member:gym_members!inner (
            id,
            gym_id,
            profile:profiles ( full_name, phone, photo_url )
          ),
          plan:membership_plans ( name )
        `
        )
        .eq('gym_member.gym_id', gymId)
        .not('plan_price', 'is', null)
        .order('start_date', { ascending: false });

      if (queryError) {
        setError(queryError.message);
        return;
      }

      // today(), not toISOString(): that reads the UTC day and would mark a
      // membership lapsed several hours early in IST.
      const todayStr = today();

      const rows: DueRow[] = ((data as any[]) ?? [])
        .map((s) => {
          const price = Number(s.plan_price ?? 0);
          const paid = Number(s.amount_paid ?? 0);
          return {
            subscriptionId: s.id,
            gymMemberId: s.gym_member?.id,
            memberName: s.gym_member?.profile?.full_name || 'Member',
            memberPhone: s.gym_member?.profile?.phone ?? null,
            photoUrl: s.gym_member?.profile?.photo_url ?? null,
            planName: s.plan?.name || 'Plan',
            planPrice: price,
            amountPaid: paid,
            balance: price - paid,
            startDate: s.start_date,
            endDate: s.end_date,
            lapsed: s.end_date < todayStr,
          };
        })
        // Filtered here rather than in SQL: PostgREST cannot compare two columns
        // in a filter, so the subtraction has to happen after the fetch.
        .filter((r) => r.balance > 0);

      setDues(rows);
    } catch (err) {
      console.error('[useDues]', err);
      setError('Failed to load outstanding balances');
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchDues();
  }, [fetchDues]);

  // DuesBanner lives on a mounted tab (dashboard, payments). Without this, an
  // owner who collects a balance on the Dues screen and taps back still sees
  // the banner's stale pre-collection amount, because that instance of this
  // hook was never told to look again -- same failure the dashboard's own
  // stats hit before it grew the matching useFocusEffect.
  useFocusEffect(
    useCallback(() => {
      fetchDues();
    }, [fetchDues])
  );

  /** Take some or all of what is owed on one subscription. */
  const collectBalance = useCallback(
    async (subscriptionId: string, amount: number, paymentMethod: string) => {
      const { error: rpcError } = await supabase.rpc('record_balance_payment', {
        p_subscription_id: subscriptionId,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_paid_on: null,
      });
      if (rpcError) throw rpcError;
      await fetchDues();
    },
    [supabase, fetchDues]
  );

  const totalOutstanding = useMemo(
    () => dues.reduce((sum, d) => sum + d.balance, 0),
    [dues]
  );

  /** Distinct members, since one member can owe on more than one subscription. */
  const membersOwing = useMemo(
    () => new Set(dues.map((d) => d.gymMemberId)).size,
    [dues]
  );

  return {
    dues,
    loading,
    error,
    totalOutstanding,
    membersOwing,
    refresh: fetchDues,
    collectBalance,
  };
}
