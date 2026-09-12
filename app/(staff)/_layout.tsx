import React, { useEffect } from 'react';
import { StyleSheet, Platform, View } from 'react-native';
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
          borderColor: colors.border,
          borderWidth: 1,
          height: Platform.OS === 'ios' ? 82 : 68,
          paddingBottom: Platform.OS === 'ios' ? 22 : 7,
          paddingTop: 7,
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: Platform.OS === 'ios' ? 4 : 8,
          borderRadius: 22,
          elevation: 12,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.28,
          shadowRadius: 14,
        },
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'grid' : 'grid-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'people' : 'people-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="announcements/index"
        options={{
          title: 'Updates',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'megaphone' : 'megaphone-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="staff-chat"
        options={{
          title: 'Team',
          tabBarBadge: chatBadge,
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'person' : 'person-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />

      {/* Pushed from other screens — not tabs. */}
      <Tabs.Screen name="announcements/create" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="qr-code" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="invite" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: -3,
  },
  tabBarItem: { paddingVertical: 1 },
  iconWrap: {
    width: 38,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
