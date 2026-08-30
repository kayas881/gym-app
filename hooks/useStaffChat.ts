import { useState, useEffect, useCallback, useRef } from 'react';
import { useSupabase } from './useSupabase';
import { useAppAuth } from '../lib/auth';

interface StaffChatMessage {
  id: string;
  gym_id: string;
  message: string;
  created_at: string;
  read_by: string[];
  sender: {
    id: string;
    full_name: string;
    photo_url: string | null;
  };
}

export function useStaffChat() {
  const supabase = useSupabase();
  const { gymId, profile } = useAppAuth();
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!gymId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('staff_chat_messages')
        .select(`
          id,
          gym_id,
          message,
          created_at,
          read_by,
          sender:profiles!sender_id (
            id,
            full_name,
            photo_url
          )
        `)
        .eq('gym_id', gymId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) {
        console.error('[useStaffChat]', error);
        return;
      }

      setMessages((data ?? []) as unknown as StaffChatMessage[]);
    } catch (err) {
      console.error('[useStaffChat]', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Unique per hook instance — see the note in useAnnouncements: a shared topic
  // returns an already-subscribed channel and .on() then throws.
  const channelIdRef = useRef(Math.random().toString(36).slice(2));

  // Subscribe to realtime messages
  useEffect(() => {
    if (!gymId) return;

    const channel = supabase
      .channel(`staff-chat:${gymId}:${channelIdRef.current}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'staff_chat_messages',
          filter: `gym_id=eq.${gymId}`,
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gymId, supabase, fetchMessages]);

  // Send a message
  const sendMessage = useCallback(
    async (messageText: string) => {
      if (!gymId || !profile?.id) throw new Error('Not authenticated');

      const { error } = await supabase.from('staff_chat_messages').insert({
        gym_id: gymId,
        sender_id: profile.id,
        message: messageText,
      });

      if (error) throw error;
    },
    [gymId, profile?.id, supabase]
  );

  // Mark messages as read
  const markAsRead = useCallback(
    async (messageIds: string[]) => {
      if (!profile?.id) return;

      for (const id of messageIds) {
        await supabase.rpc('mark_chat_message_read', {
          p_message_id: id,
          p_profile_id: profile.id,
        });
      }
    },
    [profile?.id, supabase]
  );

  const unreadCount = messages.filter(
    (m) => !m.read_by?.includes(profile?.id ?? '')
  ).length;

  return {
    messages,
    loading,
    unreadCount,
    refresh: fetchMessages,
    sendMessage,
    markAsRead,
  };
}
