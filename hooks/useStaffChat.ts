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
  // `loading` drives a full-screen spinner, so it must only be true for the
  // very first fetch. Sending a message and marking messages read both refetch,
  // and flipping `loading` on those made the whole chat flash "Loading
  // messages..." every time you hit send.
  const hasLoadedOnceRef = useRef(false);

  const fetchMessages = useCallback(async () => {
    if (!gymId) return;

    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
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
      hasLoadedOnceRef.current = true;
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
          // '*' rather than 'INSERT': marking a message read is an UPDATE to
          // read_by. With INSERT-only, the tab-badge instance of this hook
          // never heard about read receipts, so opening the chat marked
          // everything read in the database but left the badge showing until
          // the next message arrived. (Migration 009 sets REPLICA IDENTITY
          // FULL so UPDATE events carry the whole row.)
          event: '*',
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

      // Refetch rather than waiting on the realtime echo. Relying on the
      // subscription alone meant a sent message simply vanished for the sender
      // whenever realtime wasn't delivering — no error, no message, no clue.
      // useAnnouncements already does this after createAnnouncement.
      await fetchMessages();
    },
    [gymId, profile?.id, supabase, fetchMessages]
  );

  // Mark messages as read
  const markAsRead = useCallback(
    async (messageIds: string[]) => {
      if (!profile?.id) return;

      let markedAny = false;
      for (const id of messageIds) {
        const { error } = await supabase.rpc('mark_chat_message_read', {
          p_message_id: id,
          p_profile_id: profile.id,
        });
        // Previously the result was discarded entirely, so when this RPC did
        // not exist it failed silently on every call.
        if (error) {
          console.warn('[useStaffChat] mark_chat_message_read failed:', error.message);
        } else {
          markedAny = true;
        }
      }

      // Refresh locally instead of waiting for the realtime echo, so unread
      // state clears immediately on the screen that did the marking.
      if (markedAny) {
        await fetchMessages();
      }
    },
    [profile?.id, supabase, fetchMessages]
  );

  // Exclude your own messages: the sender is not in read_by when a message is
  // inserted, so sending one briefly lit up your own unread badge.
  const unreadCount = messages.filter(
    (m) => m.sender?.id !== profile?.id && !m.read_by?.includes(profile?.id ?? '')
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
