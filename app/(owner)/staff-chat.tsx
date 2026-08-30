import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useStaffChat } from '../../hooks/useStaffChat';
import Avatar from '../../components/ui/Avatar';
import { formatDateTime } from '../../utils/date';

export default function OwnerStaffChatScreen() {
  const router = useRouter();
  const { profile } = useAppAuth();
  const { colors, isDark } = useTheme();
  const { messages, loading, sendMessage, markAsRead } = useStaffChat();

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Mark unread messages on view
  useEffect(() => {
    if (messages.length > 0 && profile?.id) {
      const unreadIds = messages
        .filter((m) => !m.read_by?.includes(profile.id))
        .map((m) => m.id);

      if (unreadIds.length > 0) {
        markAsRead(unreadIds);
      }
    }
  }, [messages, profile?.id, markAsRead]);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setInputText('');
    setIsSending(true);

    try {
      await sendMessage(text);
      // Auto-scroll to bottom after sending
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 150);
    } catch (err: any) {
      console.error('[StaffChat] Send error:', err);
      setInputText(text); // restore text on failure
    } finally {
      setIsSending(false);
    }
  };

  const formatMessageTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  const renderMessageItem = ({ item }: { item: (typeof messages)[0] }) => {
    const isMe = item.sender?.id === profile?.id;
    const senderName = item.sender?.full_name || 'Staff Member';
    const photoUrl = item.sender?.photo_url;

    if (isMe) {
      return (
        <View style={styles.myMessageRow}>
          <View style={styles.myMessageWrapper}>
            <View
              style={[
                styles.myBubble,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text style={styles.myMessageText}>
                {item.message}
              </Text>
            </View>
            <Text style={[styles.myTimestamp, { color: colors.textTertiary }]}>
              {formatMessageTime(item.created_at)}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.otherMessageRow}>
        <Avatar uri={photoUrl} name={senderName} size={32} style={styles.otherAvatar} />
        <View style={styles.otherMessageWrapper}>
          <Text style={[styles.otherSenderName, { color: colors.primaryLight || colors.primary }]}>
            {senderName}
          </Text>
          <View
            style={[
              styles.otherBubble,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.otherMessageText, { color: colors.text }]}>
              {item.message}
            </Text>
          </View>
          <Text style={[styles.otherTimestamp, { color: colors.textTertiary }]}>
            {formatMessageTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconWrap,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)' },
          ]}
        >
          <Ionicons name="chatbubbles-outline" size={44} color={colors.textTertiary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          Staff & Team Channel
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Coordinate with trainers, staff, and management in real time. Send your first message below.
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Staff & Team Chat
          </Text>
          <View style={styles.headerStatusRow}>
            <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Gym Internal Channel
            </Text>
          </View>
        </View>
      </View>

      {/* Message List */}
      {loading && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading team chat...
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={styles.messageListContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            if (messages.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
        />
      )}

      {/* Message Input Bar */}
      <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.text,
            },
          ]}
          placeholder="Type a message to staff..."
          placeholderTextColor={colors.inputPlaceholder}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={1000}
          returnKeyType="default"
        />

        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor: inputText.trim() ? colors.primary : colors.surfaceElevated,
              opacity: inputText.trim() && !isSending ? 1 : 0.6,
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
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  headerSubtitle: {
    fontSize: 12,
  },
  messageListContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 12,
  },
  myMessageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  myMessageWrapper: {
    maxWidth: '80%',
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
    lineHeight: 20,
    fontWeight: '500',
  },
  myTimestamp: {
    fontSize: 10,
    marginTop: 3,
    marginRight: 4,
  },
  otherMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
    maxWidth: '82%',
  },
  otherAvatar: {
    marginRight: 8,
    marginTop: 16,
  },
  otherMessageWrapper: {
    flex: 1,
  },
  otherSenderName: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
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
    lineHeight: 20,
  },
  otherTimestamp: {
    fontSize: 10,
    marginTop: 3,
    marginLeft: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
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
    paddingVertical: 8,
    fontSize: 15,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
