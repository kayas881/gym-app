import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ClerkProvider } from '@clerk/expo';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { tokenCache } from '../lib/clerk';
import { ThemeProvider, useTheme } from '../lib/theme';
import { AuthProvider } from '../lib/auth';
import { useNotificationRouting } from '../hooks/useNotificationRouting';
import { CLERK_PUBLISHABLE_KEY } from '../constants/config';

function AppContent() {
  const { colors, isDark } = useTheme();

  // Inside AuthProvider on purpose: the destination depends on the signed-in
  // role, so this cannot live above it. Inside the router tree too, so
  // useRouter() is usable.
  useNotificationRouting();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
