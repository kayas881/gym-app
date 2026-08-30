import React, { useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  color?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  onPress,
  style,
}: StatCardProps) {
  const { colors, isDark } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const accentColor = color || colors.primary;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  const cardContent = (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: accentColor,
          borderLeftWidth: 4,
          shadowColor: colors.shadow,
        },
        style,
      ]}
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.title, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {icon ? (
          <View
            style={[
              styles.iconWrapper,
              {
                backgroundColor: isDark
                  ? `${accentColor}20`
                  : `${accentColor}18`,
              },
            ]}
          >
            <Ionicons
              name={icon as any}
              size={18}
              color={accentColor}
            />
          </View>
        ) : null}
      </View>

      <Text
        style={[styles.value, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>

      {subtitle ? (
        <Text
          style={[styles.subtitle, { color: colors.textTertiary }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          {cardContent}
        </Pressable>
      </Animated.View>
    );
  }

  return cardContent;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginVertical: 2,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 4,
  },
  pressed: {
    opacity: 0.9,
  },
});
