import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { today, formatDate } from '../utils/date';

/**
 * The payload encoded in the gym's check-in QR code.
 *
 * `date` makes the code rotate daily, so a member can't screenshot it once and
 * check in from home forever — app/(member)/scan.tsx rejects a payload whose
 * date isn't today.
 *
 * Note this is tamper-evident, not tamper-proof: the payload is plain JSON, so
 * someone who knows the gym id could hand-craft today's code. Closing that
 * needs a server-signed token (an Edge Function issuing an HMAC), which is
 * worth doing if check-in ever drives billing.
 */
export function buildGymQrPayload(gymId: string, dateStr: string = today()): string {
  return JSON.stringify({ gym_id: gymId, date: dateStr });
}

interface GymQRCodeProps {
  gymId: string;
  gymName?: string | null;
  /** Rendered size of the QR square. */
  size?: number;
}

/**
 * The scannable check-in code displayed at the gym counter.
 */
export default function GymQRCode({ gymId, gymName, size = 240 }: GymQRCodeProps) {
  const { colors } = useTheme();
  const todayStr = today();

  const payload = useMemo(() => buildGymQrPayload(gymId, todayStr), [gymId, todayStr]);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
        ]}
      >
        {gymName ? (
          <Text style={[styles.gymName, { color: colors.text }]} numberOfLines={2}>
            {gymName}
          </Text>
        ) : null}

        <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
          {formatDate(todayStr)}
        </Text>

        {/*
          Always render the QR on a white background with dark modules.
          Inverting it for dark mode makes many scanners fail.
        */}
        <View style={styles.qrFrame}>
          <QRCode value={payload} size={size} backgroundColor="#FFFFFF" color="#000000" />
        </View>

        <View style={styles.hintRow}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={colors.textTertiary}
            style={styles.hintIcon}
          />
          <Text style={[styles.hintText, { color: colors.textTertiary }]}>
            This code changes daily. Members scan it from the Check In tab.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  card: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  gymName: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 20,
  },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 20,
    paddingHorizontal: 8,
  },
  hintIcon: { marginRight: 6, marginTop: 1 },
  hintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
