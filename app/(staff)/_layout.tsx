import React, { useEffect } from 'react';
import { StyleSheet, Platform } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme';
import { useStaffChat } from '../../hooks/useStaffChat';

export default function StaffLayout() {
  const { colors } = useTheme();
  // Drives the Chat tab badge. Previously nothing anywhere indicated that a
  // new message had arrived — you had to open the chat to find out.
  const { unreadCount, refresh: refreshChat } = useStaffChat();

  // A tab bar is not a screen, so useFocusEffect is unavailable here. The
  // pathname changing is the next best signal that the user has moved, and it
  // covers the case that was broken: leaving the chat after reading it.
  const pathname = usePathname();
  useEffect(() => {
    refreshChat();
  }, [pathname, refreshChat]);

  // Navigation alone would not notice a message arriving while the user sits
  // on one tab, which for a chat badge is the point of it.
  useEffect(() => {
    const timer = setInterval(refreshChat, 60_000);
    return () => clearInterval(timer);
  }, [refreshChat]);

  // Reading the chat is not "1 unread". The screen marks messages read on
  // arrival, but this instance would not learn that until the next refresh.
  const onChatScreen = pathname.includes('staff-chat');
  const chatBadge = !onChatScreen && unreadCount > 0 ? unreadCount : undefined;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
          elevation: 8,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
        },
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements/index"
        options={{
          title: 'Announcements',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'megaphone' : 'megaphone-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="staff-chat"
        options={{
          title: 'Chat',
          tabBarBadge: chatBadge,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* Pushed from other screens — not tabs. */}
      <Tabs.Screen name="announcements/create" options={{ href: null }} />
      <Tabs.Screen name="qr-code" options={{ href: null }} />
      <Tabs.Screen name="invite" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: -2,
  },
});
