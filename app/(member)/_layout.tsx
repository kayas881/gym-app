import React from 'react';
import { StyleSheet, Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme';

export default function MemberLayout() {
  const { colors } = useTheme();

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
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'home' : 'home-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Check In',
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color, size, focused }) => (
            <View style={[styles.iconWrap, focused && { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name={focused ? 'qr-code' : 'qr-code-outline'} size={size - 1} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="announcements"
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

      {/* Pushed from home/profile — not tabs. */}
      <Tabs.Screen name="payments" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="gym-info" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="renew" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="complaints/index" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="complaints/create" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: -3,
  },
  iconWrap: {
    width: 38,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
