import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ClerkProvider } from '@clerk/expo';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { tokenCache } from '../lib/clerk';
import { ThemeProvider, useTheme } from '../lib/theme';
import { AuthProvider } from '../lib/auth';
import { CLERK_PUBLISHABLE_KEY } from '../constants/config';

function AppContent() {
  const { colors, isDark } = useTheme();

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
