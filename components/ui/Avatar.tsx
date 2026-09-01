import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  StyleProp,
  ViewStyle,
  ImageStyle,
} from 'react-native';
import { useTheme } from '../../lib/theme';

export interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  /**
   * 'circle' (default) for people. 'rounded' for a gym logo: a squared frame
   * that fits the whole image instead of cropping a circle out of the middle.
   */
  shape?: 'circle' | 'rounded';
  style?: StyleProp<ViewStyle>;
}

function getInitials(name: string): string {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function Avatar({
  uri,
  name,
  size = 40,
  shape = 'circle',
  style,
}: AvatarProps) {
  const { colors } = useTheme();
  const [imageError, setImageError] = useState(false);

  const borderRadius = shape === 'rounded' ? Math.round(size * 0.22) : size / 2;
  const fontSize = Math.max(10, Math.round(size * 0.38));
  const initials = getInitials(name);

  const sizeStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius,
  };

  const imageStyle: ImageStyle = {
    width: size,
    height: size,
    borderRadius,
  };

  const showImage = uri && !imageError;

  return (
    <View
      style={[
        styles.container,
        sizeStyle,
        !showImage && { backgroundColor: colors.primaryMuted },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={[styles.image, imageStyle]}
          onError={() => setImageError(true)}
          // 'contain' for a logo so none of it is cut off; 'cover' for a face,
          // where filling the frame matters more than seeing the edges.
          resizeMode={shape === 'rounded' ? 'contain' : 'cover'}
        />
      ) : (
        <Text
          style={[
            styles.initials,
            {
              fontSize,
              color: colors.primary,
              lineHeight: fontSize * 1.2,
            },
          ]}
          numberOfLines={1}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initials: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
