import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../lib/theme';

export default function AuthLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="complete-profile" />
      <Stack.Screen name="setup-gym" />
    </Stack>
  );
}
