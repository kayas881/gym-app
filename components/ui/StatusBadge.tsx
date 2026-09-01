import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../lib/theme';

export type MemberStatus = 'pending' | 'active' | 'expired' | 'rejected' | 'removed';

export interface StatusBadgeProps {
  status: MemberStatus;
  style?: StyleProp<ViewStyle>;
}

export default function StatusBadge({ status, style }: StatusBadgeProps) {
  const { colors, isDark } = useTheme();

  const getStatusConfig = () => {
    switch (status) {
      case 'active':
        return {
          label: 'Active',
          color: colors.statusActive,
          bg: isDark ? 'rgba(0, 230, 118, 0.15)' : 'rgba(0, 200, 83, 0.12)',
          border: isDark ? 'rgba(0, 230, 118, 0.3)' : 'rgba(0, 200, 83, 0.25)',
        };
      case 'pending':
        return {
          label: 'Pending',
          color: colors.statusPending,
          bg: isDark ? 'rgba(255, 179, 0, 0.15)' : 'rgba(245, 127, 23, 0.12)',
          border: isDark ? 'rgba(255, 179, 0, 0.3)' : 'rgba(245, 127, 23, 0.25)',
        };
      case 'expired':
        return {
          label: 'Expired',
          color: colors.statusExpired,
          bg: isDark ? 'rgba(255, 82, 82, 0.15)' : 'rgba(211, 47, 47, 0.12)',
          border: isDark ? 'rgba(255, 82, 82, 0.3)' : 'rgba(211, 47, 47, 0.25)',
        };
      case 'removed':
        return {
          label: 'Removed',
          color: colors.textTertiary,
          bg: isDark ? 'rgba(158, 158, 158, 0.12)' : 'rgba(117, 117, 117, 0.10)',
          border: isDark ? 'rgba(158, 158, 158, 0.25)' : 'rgba(117, 117, 117, 0.2)',
        };
      case 'rejected':
      default:
        return {
          label: 'Rejected',
          color: colors.statusRejected,
          bg: isDark ? 'rgba(158, 158, 158, 0.15)' : 'rgba(158, 158, 158, 0.12)',
          border: isDark ? 'rgba(158, 158, 158, 0.3)' : 'rgba(158, 158, 158, 0.25)',
        };
    }
  };

  const { label, color, bg, border } = getStatusConfig();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: bg,
          borderColor: border,
        },
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
});
