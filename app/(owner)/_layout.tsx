import React, { useEffect } from 'react';
import { StyleSheet, Platform } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme';
import { useStaffChat } from '../../hooks/useStaffChat';

export default function OwnerLayout() {
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
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="members/index"
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
        name="payments/index"
        options={{
          title: 'Payments',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'card' : 'card-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
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

      {/*
        Expo Router registers EVERY route in this folder as a tab by default.
        Detail/create screens are pushed onto the stack from elsewhere, so they
        must be hidden with `href: null` — otherwise they render as unlabelled
        extra tabs (the row of placeholder glyphs).
        Reached via: the dashboard's gear button (settings), Quick Actions
        (plans, record payment), the members list (detail, pending), and
        dashboard modals (announcements, complaints).
      */}
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="qr-code" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="gym-hours" options={{ href: null }} />
      <Tabs.Screen name="invite" options={{ href: null }} />
      <Tabs.Screen name="members/[id]" options={{ href: null }} />
      <Tabs.Screen name="members/pending" options={{ href: null }} />
      <Tabs.Screen name="members/add" options={{ href: null }} />
      <Tabs.Screen name="payments/record" options={{ href: null }} />
      <Tabs.Screen name="payments/dues" options={{ href: null }} />
      <Tabs.Screen name="plans/index" options={{ href: null }} />
      <Tabs.Screen name="plans/create" options={{ href: null }} />
      <Tabs.Screen name="announcements/index" options={{ href: null }} />
      <Tabs.Screen name="announcements/create" options={{ href: null }} />
      <Tabs.Screen name="complaints/index" options={{ href: null }} />
      <Tabs.Screen name="complaints/[id]" options={{ href: null }} />
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
