import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../lib/theme';
import Avatar from './ui/Avatar';
import StatusBadge, { MemberStatus } from './ui/StatusBadge';

export type MemberRole = 'owner' | 'staff' | 'member';

export interface MemberListItemProps {
  name: string;
  photoUrl?: string | null;
  status: MemberStatus;
  role: MemberRole;
  subtitle?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function MemberListItem({
  name,
  photoUrl,
  status,
  role,
  subtitle,
  onPress,
  style,
}: MemberListItemProps) {
  const { colors, isDark } = useTheme();

  const getRoleBadgeStyle = () => {
    switch (role) {
      case 'owner':
        return {
          bg: isDark ? 'rgba(255, 179, 0, 0.15)' : 'rgba(245, 127, 23, 0.12)',
          text: colors.warning,
        };
      case 'staff':
        return {
          bg: isDark ? 'rgba(68, 138, 255, 0.15)' : 'rgba(25, 118, 210, 0.12)',
          text: colors.info,
        };
      case 'member':
      default:
        return {
          bg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
          text: colors.textSecondary,
        };
    }
  };

  const formatRoleName = (r: MemberRole): string => {
    switch (r) {
      case 'owner':
        return 'Owner';
      case 'staff':
        return 'Staff';
      case 'member':
        return 'Member';
    }
  };

  const roleStyle = getRoleBadgeStyle();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.container,
        {
          borderBottomColor: colors.divider,
          backgroundColor: pressed ? (isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)') : 'transparent',
        },
        style,
      ]}
    >
      <View style={styles.leftSection}>
        <Avatar uri={photoUrl} name={name} size={44} />

        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.nameText, { color: colors.text }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <View
              style={[
                styles.roleBadge,
                { backgroundColor: roleStyle.bg },
              ]}
            >
              <Text
                style={[
                  styles.roleText,
                  { color: roleStyle.text },
                ]}
              >
                {formatRoleName(role)}
              </Text>
            </View>
          </View>

          {subtitle ? (
            <Text
              style={[styles.subtitleText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.rightSection}>
        <StatusBadge status={status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  infoContainer: {
    marginLeft: 12,
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  nameText: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  subtitleText: {
    fontSize: 13,
    marginTop: 2,
  },
  rightSection: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
