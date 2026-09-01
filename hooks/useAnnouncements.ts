import { useState, useEffect, useCallback, useRef } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';

interface Announcement {
  id: string;
  gym_id: string;
  title: string;
  body: string;
  target_audience: string;
  created_at: string;
  /** Used to identify the author reliably; names are not unique. */
  author_id: string;
  author: {
    full_name: string;
    photo_url: string | null;
  };
}

interface CreateAnnouncementInput {
  title: string;
  body: string;
  targetAudience: 'everyone' | 'active' | 'morning' | 'afternoon' | 'evening' | 'staff';
}

export function useAnnouncements() {
  const supabase = useSupabase();
  const { gymId, profile, role } = useAppAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnouncements = useCallback(async () => {
    if (!gymId) return;

    setLoading(true);
    try {
      let query = supabase
        .from('announcements')
        .select(`
          id,
          gym_id,
          title,
          body,
          target_audience,
          created_at,
          author_id,
          author:profiles!author_id (
            full_name,
            photo_url
          )
        `)
        .eq('gym_id', gymId);

      // Don't ship staff-only announcements to plain members.
      //
      // announcements_select_policy is is_gym_member_or_owner(gym_id), so RLS
      // permits every member to read every row — audience is enforced only in
      // the UI. Without this the full title and body of a staff-only post sat
      // in a member's fetched data even though the list hid it.
      if (role !== 'owner' && role !== 'staff') {
        query = query.neq('target_audience', 'staff');
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[useAnnouncements]', error);
        return;
      }

      setAnnouncements((data ?? []) as unknown as Announcement[]);
    } catch (err) {
      console.error('[useAnnouncements]', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase, role]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // supabase.channel() hands back an *existing* channel when the topic matches,
  // and calling .on() on one that has already subscribed throws. Two screens
  // mounted at once (e.g. sibling tabs) would collide on a gym-only topic, so
  // give every hook instance its own.
  const channelIdRef = useRef(Math.random().toString(36).slice(2));

  // Subscribe to realtime announcement updates
  useEffect(() => {
    if (!gymId) return;

    const channel = supabase
      .channel(`announcements:${gymId}:${channelIdRef.current}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'announcements',
          filter: `gym_id=eq.${gymId}`,
        },
        () => {
          fetchAnnouncements(); // Refetch on new announcement
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gymId, supabase, fetchAnnouncements]);

  // Create a new announcement
  const createAnnouncement = useCallback(
    async (input: CreateAnnouncementInput) => {
      if (!gymId || !profile?.id) throw new Error('Not authenticated');

      // Need the id back to trigger push, so select the inserted row.
      // announcements_select_policy resolves through gyms/gym_members, which
      // already exist here, so RETURNING is safe.
      const { data: created, error } = await supabase
        .from('announcements')
        .insert({
          gym_id: gymId,
          author_id: profile.id,
          title: input.title,
          body: input.body,
          target_audience: input.targetAudience,
        })
        .select('id')
        .single();

      if (error) throw error;
      await fetchAnnouncements();

      // Fire the push notification. Deliberately not awaited into the caller's
      // error path: the announcement is already saved and visible in-app, so a
      // notification failure must not make posting look like it failed.
      //
      // This is the ONLY announcement push path. A database trigger doing the
      // same thing was added and then reverted (migrations 031 and 035) because
      // running both delivered every announcement twice. The Edge Function wins
      // because it reads Expo's tickets to prune dead tokens and batches at
      // Expo's 100-message limit, neither of which a pg_net trigger can do.
      // Its source lives at supabase/functions/notify-announcement/index.ts.
      if (created?.id) {
        supabase.functions
          .invoke('notify-announcement', {
            body: { announcement_id: created.id },
          })
          .then(({ error: fnError }) => {
            if (fnError) {
              console.warn('[useAnnouncements] push notify failed:', fnError.message);
            }
          })
          .catch((err) => {
            console.warn('[useAnnouncements] push notify threw:', err);
          });
      }
    },
    [gymId, profile?.id, supabase, fetchAnnouncements]
  );

  // Delete an announcement
  const deleteAnnouncement = useCallback(
    async (announcementId: string) => {
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', announcementId);

      if (error) throw error;
      await fetchAnnouncements();
    },
    [supabase, fetchAnnouncements]
  );

  return {
    announcements,
    loading,
    refresh: fetchAnnouncements,
    createAnnouncement,
    deleteAnnouncement,
  };
}
