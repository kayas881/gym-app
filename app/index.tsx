import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

export default function IndexScreen() {
  const router = useRouter();
  const {
    isLoaded,
    isSignedIn,
    isProfileComplete,
    profileLoading,
    currentMembership,
    role,
    membershipLoading,
    refreshMembership,
    signOut,
  } = useAppAuth();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading = !isLoaded || (isSignedIn && (profileLoading || membershipLoading));

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      router.replace('/(auth)/sign-in');
      return;
    }

    // Wait until profile and membership have finished loading
    if (profileLoading || membershipLoading) return;

    // If profile is not complete, redirect to complete-profile
    if (!isProfileComplete) {
      router.replace('/(auth)/complete-profile');
      return;
    }

    // If no membership found, redirect to setup-gym
    if (!currentMembership) {
      router.replace('/(auth)/setup-gym');
      return;
    }

    // If membership status is pending, stay on this screen to display waiting UI
    if (currentMembership.status === 'pending') {
      return;
    }

    // If active membership, route based on role
    if (currentMembership.status === 'active') {
      if (role === 'owner') {
        router.replace('/(owner)/dashboard');
      } else if (role === 'staff') {
        router.replace('/(staff)/');
      } else if (role === 'member') {
        router.replace('/(member)/home');
      } else {
        router.replace('/(member)/home');
      }
    }
  }, [
    isLoaded,
    isSignedIn,
    profileLoading,
    membershipLoading,
    isProfileComplete,
    currentMembership,
    role,
    router,
  ]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshMembership();
    } catch (err) {
      console.error('[Index] Error refreshing membership:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } catch (err) {
      console.error('[Index] Error signing out:', err);
    }
  };

  // Full-screen Loading State
  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading Gym App...
        </Text>
      </View>
    );
  }

  // Pending Approval State
  if (isSignedIn && isProfileComplete && currentMembership?.status === 'pending') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.pendingCardContainer}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primaryMuted }]}>
            <Ionicons name="time-outline" size={48} color={colors.warning} />
          </View>

          <Text style={[styles.pendingTitle, { color: colors.text }]}>
            Waiting for Approval
          </Text>

          <Text style={[styles.pendingSubtitle, { color: colors.textSecondary }]}>
            Your membership request has been submitted and is awaiting approval by the gym administration.
          </Text>

          <View style={[styles.gymInfoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.gymLabel, { color: colors.textTertiary }]}>GYM</Text>
            <Text style={[styles.gymName, { color: colors.text }]}>
              {currentMembership.gym?.name || 'Selected Gym'}
            </Text>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: colors.primaryMuted, borderColor: colors.statusPending },
                ]}
              >
                <Text style={[styles.statusBadgeText, { color: colors.statusPending }]}>
                  Pending Approval
                </Text>
              </View>

              {currentMembership.role && (
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.roleBadgeText, { color: colors.textSecondary }]}>
                    Role: {currentMembership.role.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={handleRefresh}
              disabled={isRefreshing}
              activeOpacity={0.8}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="refresh" size={18} color="#000000" style={styles.buttonIcon} />
                  <Text style={styles.primaryButtonText}>Check Status</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={handleSignOut}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.textSecondary} style={styles.buttonIcon} />
              <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Fallback loading / transitional state
  return (
    <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: '500',
  },
  pendingCardContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  pendingTitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  pendingSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  gymInfoCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 32,
  },
  gymLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  gymName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionButtons: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonIcon: {
    marginRight: 8,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
