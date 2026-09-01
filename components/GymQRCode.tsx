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

/**
 * A code that never expires, for printing once and sticking on the wall.
 *
 * Omitting `date` is what makes it permanent: app/(member)/scan.tsx only
 * enforces freshness when the payload carries a date, so the scanner needs no
 * changes to support both modes.
 *
 * Trade-off, stated plainly: a member can screenshot this and "check in" from
 * home. The daily code prevents that but has to be re-displayed or reprinted
 * every day, which in a small gym usually means it stops happening at all.
 * Since check-ins don't drive billing here, that's the owner's call to make.
 */
export function buildPermanentGymQrPayload(gymId: string): string {
  return JSON.stringify({ gym_id: gymId });
}

/**
 * The payload for a gym's JOIN code -- deliberately a different shape from the
 * check-in payload above.
 *
 * Check-in carries { gym_id }, joining carries { join_code }. Keeping them
 * distinct means each scanner can recognise the other's code and say so, rather
 * than a member holding a join poster up to the check-in scanner and getting an
 * unexplained failure. The code is also emitted as plain text by generic QR
 * readers, which is why the six characters are printed under the square too.
 */
export function buildGymJoinQrPayload(joinCode: string): string {
  return JSON.stringify({ join_code: joinCode.toUpperCase() });
}

/**
 * Read a scanned QR and pull out a join code, whether it is our JSON payload or
 * a bare six-character code typed into some other QR generator.
 */
export function parseGymJoinQrPayload(data: string): string | null {
  const raw = data.trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.join_code === 'string') {
      return parsed.join_code.toUpperCase();
    }
    // A check-in code, not a join code -- let the caller tell them apart.
    if (parsed && typeof parsed.gym_id === 'string') return null;
  } catch {
    // Not JSON; fall through to the bare-code case.
  }
  const bare = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return bare.length === 6 ? bare : null;
}

interface GymQRCodeProps {
  gymId: string;
  gymName?: string | null;
  /** Rendered size of the QR square. */
  size?: number;
  /**
   * 'permanent' (default) can be printed once and left on the wall.
   * 'daily' rotates and defeats screenshot re-use, but must be re-displayed
   * every day — which is why it is not the default.
   */
  mode?: 'daily' | 'permanent';
}

/**
 * The scannable check-in code displayed at the gym counter.
 */
export default function GymQRCode({
  gymId,
  gymName,
  size = 240,
  mode = 'permanent',
}: GymQRCodeProps) {
  const { colors } = useTheme();
  const todayStr = today();

  const payload = useMemo(
    () =>
      mode === 'permanent'
        ? buildPermanentGymQrPayload(gymId)
        : buildGymQrPayload(gymId, todayStr),
    [gymId, todayStr, mode]
  );

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
          {mode === 'permanent' ? 'Permanent check-in code' : formatDate(todayStr)}
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
            {mode === 'permanent'
              ? 'This code never expires — print it once and display it at the gym. Anyone who photographs it could check in remotely.'
              : 'This code changes daily, so a screenshot will not work tomorrow. It has to be on display each day.'}
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
