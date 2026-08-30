import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';

interface Subscription {
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

      // Find the active subscription
      const active = subs.find((s) => s.status === 'active');
      setActiveSubscription(active ?? null);
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
    loading,
    error,
    refresh: fetchSubscriptions,
    createSubscription,
  };
}
