import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  /** Member has an open renewal request waiting on the owner. */
  hasRenewalRequest?: boolean;
  /**
   * False for a member the owner registered at the desk who has not claimed an
   * app login. Worth showing in the list: they get no notifications and never
   * appear in attendance, and they are who a claim code is for.
   */
  hasAppLogin?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function MemberListItem({
  name,
  photoUrl,
  status,
  role,
  subtitle,
  hasRenewalRequest = false,
  hasAppLogin = true,
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

            {!hasAppLogin ? (
              <View style={[styles.noAppBadge, { borderColor: colors.border }]}>
                <Ionicons name="phone-portrait-outline" size={10} color={colors.textTertiary} />
                <Text style={[styles.noAppText, { color: colors.textTertiary }]}>NO APP</Text>
              </View>
            ) : null}

            {/* So the owner can see who is waiting while scrolling the list,
                instead of having to open each profile to find out. */}
            {hasRenewalRequest ? (
              <View
                style={[
                  styles.renewalBadge,
                  {
                    backgroundColor: isDark ? 'rgba(0, 230, 118, 0.16)' : 'rgba(0, 200, 83, 0.12)',
                  },
                ]}
              >
                <Text style={[styles.renewalText, { color: colors.primary }]}>RENEWAL</Text>
              </View>
            ) : null}
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
  renewalBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  renewalText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
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
  noAppBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  noAppText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
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
