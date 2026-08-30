import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';
import { calculateEndDate, today } from '../utils/date';
import { generateReceiptNumber } from '../utils/receipt-template';

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

  // Create a new subscription (record payment)
  const createSubscription = useCallback(
    async (input: CreateSubscriptionInput) => {
      // Get plan details for calculating end date
      const { data: plan, error: planError } = await supabase
        .from('membership_plans')
        .select('duration_months')
        .eq('id', input.planId)
        .single();

      if (planError) throw planError;

      const startDate = input.startDate || today();
      const endDate = calculateEndDate(startDate, plan.duration_months);
      const receiptNumber = generateReceiptNumber();

      // Mark any existing active subscription as expired
      await supabase
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('gym_member_id', input.gymMemberId)
        .eq('status', 'active');

      // Create the new subscription
      const { data, error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          gym_member_id: input.gymMemberId,
          plan_id: input.planId,
          amount_paid: input.amountPaid,
          payment_method: input.paymentMethod,
          start_date: startDate,
          end_date: endDate,
          receipt_number: receiptNumber,
          status: 'active',
        })
        .select(`
          *,
          plan:membership_plans (
            id,
            name,
            duration_months,
            price
          )
        `)
        .single();

      if (insertError) throw insertError;

      // Also update member status to active
      await supabase
        .from('gym_members')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', input.gymMemberId);

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
