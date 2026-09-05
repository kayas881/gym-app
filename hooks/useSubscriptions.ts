import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';
import { today } from '../utils/date';

interface Subscription {
  id: string;
  gym_member_id: string;
  plan_id: string;
  amount_paid: number;
  /**
   * The plan price at the moment of sale (migration 036). Not read from
   * membership_plans at display time, because editing a plan's price must not
   * rewrite what an old member was supposed to have paid. Null on rows sold
   * before 036 whose plan has since been deleted.
   */
  plan_price: number | null;
  payment_method: string;
  start_date: string;
  end_date: string;
  receipt_number: string;
  status: string;
  created_at: string;
  plan?: {
    id: string;
    name: string;
    duration_months: number;
    price: number;
  };
}

interface CreateSubscriptionInput {
  gymMemberId: string;
  planId: string;
  amountPaid: number;
  paymentMethod: 'cash' | 'upi' | 'online';
  startDate?: string; // defaults to today
}

export function useSubscriptions(gymMemberId?: string) {
  const supabase = useSupabase();
  const { gymId } = useAppAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [activeSubscription, setActiveSubscription] = useState<Subscription | null>(null);
  /**
   * A paid period that hasn't begun yet — what an early renewal creates.
   * Non-null means the member is renewed and continues past
   * activeSubscription.end_date.
   */
  const [upcomingSubscription, setUpcomingSubscription] = useState<Subscription | null>(null);
  /**
   * The last date the member is covered to, across every non-superseded
   * subscription. This — not activeSubscription.end_date — is the honest
   * answer to "when do I lose access".
   */
  const [coverageEndDate, setCoverageEndDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    if (!gymMemberId) {
      setSubscriptions([]);
      setActiveSubscription(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('subscriptions')
        .select(`
          *,
          plan:membership_plans (
            id,
            name,
            duration_months,
            price
          )
        `)
        .eq('gym_member_id', gymMemberId)
        .order('created_at', { ascending: false });

      if (queryError) {
        setError(queryError.message);
        return;
      }

      const subs = (data ?? []) as Subscription[];
      setSubscriptions(subs);

      // Since migration 024 a member can hold two 'active' subscriptions at
      // once: the period covering today, and the early renewal that starts
      // when it ends. `subs.find(s => s.status === 'active')` on a
      // created_at-descending list therefore picked the FUTURE one — which is
      // how a member paid up to 30 Nov ended up looking at a plan dated
      // "1 Dec - 1 Mar" with progress stuck at 0%.
      const todayStr = today();
      const activeSubs = subs.filter((s) => s.status === 'active');

      const covering = activeSubs
        .filter((s) => s.start_date <= todayStr && s.end_date >= todayStr)
        // If two overlap, the one running longest is the member's real cover.
        .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0];

      const upcoming = activeSubs
        .filter((s) => s.start_date > todayStr)
        .sort((a, b) => (a.start_date > b.start_date ? 1 : -1))[0];

      // Falls back to the upcoming one so a member who has paid ahead of their
      // first day sees their plan rather than "no membership".
      setActiveSubscription(covering ?? upcoming ?? null);
      setUpcomingSubscription(covering ? (upcoming ?? null) : null);

      setCoverageEndDate(
        activeSubs.reduce<string | null>(
          (latest, s) => (latest === null || s.end_date > latest ? s.end_date : latest),
          null
        )
      );
    } catch (err) {
      setError('Failed to fetch subscriptions');
      console.error('[useSubscriptions]', err);
    } finally {
      setLoading(false);
    }
  }, [gymMemberId, supabase]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  // Create a new subscription (record payment).
  //
  // Delegates to a Postgres function so the whole thing is ONE transaction.
  // This previously ran four sequential unguarded writes (read plan, expire old
  // subscription, insert new, activate member); a failure after the insert left
  // a member paid but still 'pending', while the caller reported failure. The
  // function also generates the receipt number with a retry, instead of the
  // client minting one against a UNIQUE column with no collision handling.
  const createSubscription = useCallback(
    async (input: CreateSubscriptionInput) => {
      const { data: created, error: rpcError } = await supabase.rpc(
        'record_subscription_payment',
        {
          p_gym_member_id: input.gymMemberId,
          p_plan_id: input.planId,
          p_amount_paid: input.amountPaid,
          p_payment_method: input.paymentMethod,
          p_start_date: input.startDate ?? null,
        }
      );

      if (rpcError) throw rpcError;

      const createdRow = (Array.isArray(created) ? created[0] : created) as
        | { id: string }
        | null;
      if (!createdRow?.id) throw new Error('Payment was not recorded.');

      // Read the row back with the plan joined, so callers (the receipt screen)
      // keep getting the same shape they did before.
      const { data, error: readError } = await supabase
        .from('subscriptions')
        .select(`
          *,
          plan:membership_plans (
            id,
            name,
            duration_months,
            price
          )
        `)
        .eq('id', createdRow.id)
        .single();

      if (readError) throw readError;

      await fetchSubscriptions();
      return data as Subscription;
    },
    [supabase, fetchSubscriptions]
  );

  return {
    subscriptions,
    activeSubscription,
    upcomingSubscription,
    coverageEndDate,
    loading,
    error,
    refresh: fetchSubscriptions,
    createSubscription,
  };
}
