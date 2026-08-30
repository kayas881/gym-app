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
  const { gymId, profile } = useAppAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnouncements = useCallback(async () => {
    if (!gymId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select(`
          id,
          gym_id,
          title,
          body,
          target_audience,
          created_at,
          author:profiles!author_id (
            full_name,
            photo_url
          )
        `)
        .eq('gym_id', gymId)
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
  }, [gymId, supabase]);

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

      const { error } = await supabase.from('announcements').insert({
        gym_id: gymId,
        author_id: profile.id,
        title: input.title,
        body: input.body,
        target_audience: input.targetAudience,
      });

      if (error) throw error;
      await fetchAnnouncements();
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
