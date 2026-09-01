import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';

interface Complaint {
  id: string;
  gym_id: string;
  member_id: string;
  subject: string;
  body: string;
  photo_url: string | null;
  status: 'new' | 'acknowledged' | 'resolved';
  owner_response: string | null;
  created_at: string;
  updated_at: string;
  member?: {
    profile: {
      full_name: string;
      photo_url: string | null;
    };
  };
}

interface CreateComplaintInput {
  subject: string;
  body: string;
  photoUrl?: string;
}

export function useComplaints(memberId?: string) {
  const supabase = useSupabase();
  const { gymId, currentMembership } = useAppAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComplaints = useCallback(async () => {
    if (!gymId) return;

    setLoading(true);
    try {
      let query = supabase
        .from('complaints')
        .select(`
          *,
          member:gym_members (
            profile:profiles (
              full_name,
              photo_url
            )
          )
        `)
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });

      // If memberId is provided, filter to only this member's complaints
      if (memberId) {
        query = query.eq('member_id', memberId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[useComplaints]', error);
        return;
      }

      setComplaints((data ?? []) as unknown as Complaint[]);
    } catch (err) {
      console.error('[useComplaints]', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, memberId, supabase]);

  useEffect(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  // Submit a complaint (member action)
  const submitComplaint = useCallback(
    async (input: CreateComplaintInput) => {
      if (!gymId || !currentMembership?.id) throw new Error('Not authenticated');

      const { error } = await supabase.from('complaints').insert({
        gym_id: gymId,
        member_id: currentMembership.id,
        subject: input.subject,
        body: input.body,
        photo_url: input.photoUrl || null,
      });

      if (error) throw error;
      await fetchComplaints();
    },
    [gymId, currentMembership?.id, supabase, fetchComplaints]
  );

  // Update complaint status (owner action)
  const updateComplaintStatus = useCallback(
    async (complaintId: string, status: 'acknowledged' | 'resolved', response?: string) => {
      const updateData: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (response) {
        updateData.owner_response = response;
      }

      const { error } = await supabase
        .from('complaints')
        .update(updateData)
        .eq('id', complaintId);

      if (error) throw error;
      await fetchComplaints();
    },
    [supabase, fetchComplaints]
  );

  // Count by status
  const counts = {
    new: complaints.filter((c) => c.status === 'new').length,
    acknowledged: complaints.filter((c) => c.status === 'acknowledged').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
    total: complaints.length,
  };

  return {
    complaints,
    loading,
    counts,
    refresh: fetchComplaints,
    submitComplaint,
    updateComplaintStatus,
  };
}
