import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { useDues } from '../hooks/useDues';

interface Props {
  style?: StyleProp<ViewStyle>;
}

/**
 * What the gym is still owed, and a way into the Dues screen to collect it.
 *
 * Money that came in and money still outstanding are two different numbers, and
 * every other surface in this app reports the first one. The dashboard says
 * "Revenue ₹2,300", the payment history lists what WAS collected, a member's
 * card shows their plan dates — none of them can say that somebody handed over
 * ₹300 of a ₹500 plan and owes ₹200. Without this banner a part payment is
 * recorded correctly and then never seen again, which is the exact failure the
 * whole part-payment feature exists to prevent.
 *
 * Renders nothing when the gym is fully paid up. An "₹0 outstanding" row would
 * be noise on a screen the owner reads every morning, and worse, it would train
 * them to skip past the spot where a real number will eventually appear.
 */
export default function DuesBanner({ style }: Props) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { totalOutstanding, membersOwing } = useDues();

  if (totalOutstanding <= 0) return null;

  return (
    <TouchableOpacity
      style={[
        styles.banner,
        {
          backgroundColor: isDark ? 'rgba(255, 171, 0, 0.10)' : '#FFF8E1',
          borderColor: colors.warning,
        },
        style,
      ]}
      onPress={() => router.push('/(owner)/payments/dues')}
      activeOpacity={0.8}
    >
      <Ionicons name="alert-circle" size={22} color={colors.warning} />
      <View style={styles.textGroup}>
        <Text style={[styles.amount, { color: colors.warning }]}>
          ₹{totalOutstanding.toLocaleString('en-IN')} outstanding
        </Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {membersOwing} {membersOwing === 1 ? 'member has' : 'members have'} a balance to pay
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.warning} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  textGroup: { flex: 1 },
  amount: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 1 },
});
