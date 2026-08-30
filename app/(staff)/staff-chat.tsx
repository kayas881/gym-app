import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useStaffChat } from '../../hooks/useStaffChat';
import Avatar from '../../components/ui/Avatar';

export default function StaffChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, gymId, currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    messages,
    loading,
    sendMessage,
    markAsRead,
  } = useStaffChat();

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Mark unread messages on view. The owner screen did this; the staff screen
  // did not, so a staff member's unread count never cleared.
  useEffect(() => {
    if (messages.length > 0 && profile?.id) {
      const unreadIds = messages
        // Skip your own messages — you're never in read_by for them, so
        // including them meant an extra RPC + refetch after every send.
        .filter((m) => m.sender?.id !== profile.id && !m.read_by?.includes(profile.id))
        .map((m) => m.id);

      if (unreadIds.length > 0) {
        markAsRead(unreadIds);
      }
    }
  }, [messages, profile?.id, markAsRead]);

  // Invert messages list for chat UI
  const invertedMessages = useMemo(() => {
    return [...messages].reverse();
  }, [messages]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setInputText('');
    setIsSending(true);
    try {
      await sendMessage(text);
      // Jump to your own message after sending. This list is `inverted`, so the
      // newest message sits at offset 0 — scrollToEnd would go to the OLDEST.
      // Only done for the sender: scrolling on every incoming message would
      // drag the reader away from history whenever someone else typed.
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 150);
    } catch (err: any) {
      console.error('[StaffChat] Send error:', err);
      // Restore input text on failure
      setInputText(text);
    } finally {
      setIsSending(false);
    }
  };

  const renderMessageItem = ({ item }: { item: (typeof messages)[0] }) => {
    const isMe = item.sender?.id === profile?.id;
    const timeFormatted = new Date(item.created_at).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (isMe) {
      return (
        <View style={styles.myMessageRow}>
          <View style={styles.myMessageContainer}>
            <View
              style={[
                styles.myBubble,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text style={styles.myMessageText}>{item.message}</Text>
            </View>
            <Text style={[styles.myTimeText, { color: colors.textTertiary }]}>
              {timeFormatted}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.otherMessageRow}>
        <Avatar
          uri={item.sender?.photo_url}
          name={item.sender?.full_name || 'Staff'}
          size={32}
          style={styles.senderAvatar}
        />
        <View style={styles.otherMessageContainer}>
          <Text style={[styles.senderName, { color: colors.textSecondary }]}>
            {item.sender?.full_name || 'Staff Member'}
          </Text>
          <View
            style={[
              styles.otherBubble,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.otherMessageText, { color: colors.text }]}>
              {item.message}
            </Text>
          </View>
          <Text style={[styles.otherTimeText, { color: colors.textTertiary }]}>
            {timeFormatted}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      // 'padding' on BOTH platforms, not 'height' on Android.
      //
      // Android needs an explicit behavior at all (it was `undefined`, so the
      // keyboard covered the input). But 'height' shrinks this view, and during
      // the resize the Android window background shows through as a white flash
      // before the keyboard covers it. 'padding' keeps the view full-size and
      // only insets its content, so nothing is ever exposed and the transition
      // stays smooth.
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top + 8, 40),
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backButton, { borderColor: colors.border }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="shield-checkmark" size={18} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Staff Team Chat
            </Text>
          </View>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {currentMembership?.gym?.name || 'Staff Only'}
          </Text>
        </View>

        <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
      </View>

      {/* Messages List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>
            Loading messages...
          </Text>
        </View>
      ) : invertedMessages.length === 0 ? (
        /*
          Rendered as a sibling rather than via ListEmptyComponent. An
          `inverted` FlatList flips its content, and the empty component was
          coming out upside-down: it sits outside the inverted transform on
          this RN version, so the manual scaleY(-1) "correction" was doing the
          flipping rather than undoing it. Keeping it out of the list avoids
          depending on that behaviour at all.
        */
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.surfaceElevated }]}>
            <Ionicons name="chatbubbles-outline" size={48} color={colors.textTertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No messages yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Start the conversation with your gym team and staff colleagues.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={invertedMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          inverted
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Input Bar */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.text,
            },
          ]}
          placeholder="Type a message to team..."
          placeholderTextColor={colors.inputPlaceholder}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={1000}
        />

        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor: inputText.trim() ? colors.primary : colors.surfaceElevated,
              opacity: inputText.trim() ? 1 : 0.6,
            },
          ]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
          activeOpacity={0.8}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <Ionicons
              name="send"
              size={18}
              color={inputText.trim() ? '#000000' : colors.textTertiary}
            />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  myMessageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  myMessageContainer: {
    maxWidth: '78%',
    alignItems: 'flex-end',
  },
  myBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  myMessageText: {
    color: '#000000',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  myTimeText: {
    fontSize: 10,
    marginTop: 4,
    marginRight: 4,
  },
  otherMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  senderAvatar: {
    marginRight: 8,
    marginTop: 14,
  },
  otherMessageContainer: {
    maxWidth: '78%',
    alignItems: 'flex-start',
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    marginLeft: 4,
  },
  otherBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  otherMessageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  otherTimeText: {
    fontSize: 10,
    marginTop: 4,
    marginLeft: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLabel: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    // No scaleY correction: this renders outside the inverted FlatList now.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
});
