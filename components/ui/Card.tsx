import React, { useRef } from 'react';
import {
  Pressable,
  Animated,
  StyleSheet,
  StyleProp,
  ViewStyle,
  View,
} from 'react-native';
import { useTheme } from '../../lib/theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padding?: number;
}

export default function Card({
  children,
  style,
  onPress,
  padding = 16,
}: CardProps) {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;

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

  const containerStyle: ViewStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    padding,
    shadowColor: colors.shadow,
  };

  if (onPress) {
    return (
      <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, styles.shadowContainer]}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={({ pressed }) => [
            styles.cardBase,
            containerStyle,
            pressed && styles.pressed,
            style,
          ]}
        >
          {children}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.cardBase, styles.shadowContainer, containerStyle, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  cardBase: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  shadowContainer: {
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  pressed: {
    opacity: 0.95,
  },
});
