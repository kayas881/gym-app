import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useTheme } from '../../lib/theme';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  text: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
}

export default function Badge({
  text,
  variant = 'default',
  size = 'md',
  style,
  textStyle,
  icon,
}: BadgeProps) {
  const { colors, isDark } = useTheme();

  const getVariantStyles = (): { bg: string; text: string; border: string } => {
    switch (variant) {
      case 'success':
        return {
          bg: isDark ? 'rgba(0, 230, 118, 0.15)' : 'rgba(0, 200, 83, 0.12)',
          text: colors.success,
          border: isDark ? 'rgba(0, 230, 118, 0.3)' : 'rgba(0, 200, 83, 0.25)',
        };
      case 'warning':
        return {
          bg: isDark ? 'rgba(255, 179, 0, 0.15)' : 'rgba(245, 127, 23, 0.12)',
          text: colors.warning,
          border: isDark ? 'rgba(255, 179, 0, 0.3)' : 'rgba(245, 127, 23, 0.25)',
        };
      case 'error':
        return {
          bg: isDark ? 'rgba(255, 82, 82, 0.15)' : 'rgba(211, 47, 47, 0.12)',
          text: colors.error,
          border: isDark ? 'rgba(255, 82, 82, 0.3)' : 'rgba(211, 47, 47, 0.25)',
        };
      case 'info':
        return {
          bg: isDark ? 'rgba(68, 138, 255, 0.15)' : 'rgba(25, 118, 210, 0.12)',
          text: colors.info,
          border: isDark ? 'rgba(68, 138, 255, 0.3)' : 'rgba(25, 118, 210, 0.25)',
        };
      case 'default':
      default:
        return {
          bg: colors.surfaceElevated,
          text: colors.textSecondary,
          border: colors.border,
        };
    }
  };

  const variantStyle = getVariantStyles();

  return (
    <View
      style={[
        styles.badge,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        {
          backgroundColor: variantStyle.bg,
          borderColor: variantStyle.border,
        },
        style,
      ]}
    >
      {icon ? <View style={styles.iconContainer}>{icon}</View> : null}
      <Text
        style={[
          styles.text,
          size === 'sm' ? styles.textSm : styles.textMd,
          { color: variantStyle.text },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
  },
  sizeSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sizeMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
  textSm: {
    fontSize: 10,
    lineHeight: 14,
  },
  textMd: {
    fontSize: 12,
    lineHeight: 16,
  },
  iconContainer: {
    marginRight: 4,
  },
});
