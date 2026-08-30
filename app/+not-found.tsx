import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../lib/theme';

/**
 * Catch-all for unmatched deep links.
 *
 * OAuth redirects and stray links can land on a path with no screen. Without
 * this, expo-router renders its bare "Unmatched Route" page; sending the user
 * to the index route instead lets normal role-based routing take over.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
