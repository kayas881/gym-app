import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAppAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { buildGymJoinQrPayload } from './GymQRCode';
import Card from './ui/Card';
import Button from './ui/Button';

/**
 * How a new member is told which gym to join. Screen body shared by the
 * owner and staff "Invite Members" screens -- staff are the ones at the desk
 * when the owner is not there, which is the whole problem this solves.
 *
 * Before this, joining meant pasting the gym's UUID, which only the owner had
 * and which only survives a copy-paste, so the owner had to be reachable every
 * time somebody signed up. This screen is built to be left behind instead:
 * screenshot it into the gym's WhatsApp group, or print it and stick it on the
 * wall, and nobody needs the owner at all.
 *
 * Three ways in, on purpose, because each one fails differently:
 *   - the QR square, for anyone standing in front of the poster;
 *   - the six characters underneath, for a camera that will not focus, a code
 *     read out over the phone, or a member joining from home;
 *   - Share, for sending it to one person directly.
 */
export default function InviteMembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { supabase, gymId, currentMembership } = useAppAuth();
  const { colors } = useTheme();

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  const fetchJoinCode = useCallback(async () => {
    if (!gymId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('gyms')
        .select('name, join_code')
        .eq('id', gymId)
        .single();

      if (error) {
        console.error('[Invite] Fetch join code error:', error);
        return;
      }
      setJoinCode(data?.join_code ?? null);
      setGymName(data?.name ?? '');
    } catch (err) {
      console.error('[Invite] Unexpected error:', err);
    } finally {
      setLoading(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchJoinCode();
  }, [fetchJoinCode]);

  const displayName = gymName || currentMembership?.gym?.name || 'our gym';

  const handleShare = async () => {
    if (!joinCode) return;
    try {
      await Share.share({
        message:
          `Join ${displayName} on Gymnos.\n\n` +
          `Gym code: ${joinCode}\n\n` +
          `Install the app, sign up, tap "Join Gym" and enter the code above.`,
      });
    } catch (err) {
      console.error('[Invite] Share error:', err);
      Alert.alert('Could not share', 'Please try again.');
    }
  };

  /**
   * Renders the poster to a PDF and hands it to the share sheet, so it can
   * actually be printed and put on the wall rather than screenshotted.
   *
   * Same two constraints as the check-in poster in CheckInQRScreen, for the same
   * reasons: printToFileAsync + shareAsync rather than Print.printAsync, because
   * the latter throws PrintManagerNotAvailableException from a native callback
   * when no Android print service is installed and that cannot be caught in JS;
   * and the QR is an image URL because the HTML has to stand alone, outside the
   * React tree where react-native-qrcode-svg lives.
   */
  const handlePrint = async () => {
    if (!joinCode) return;
    setPrinting(true);
    try {
      const payload = encodeURIComponent(buildGymJoinQrPayload(joinCode));
      const html = `
        <html>
          <body style="font-family: -apple-system, Roboto, sans-serif; text-align:center; padding:48px;">
            <p style="font-size:18px; letter-spacing:6px; color:#777; margin:0;">JOIN</p>
            <h1 style="font-size:36px; margin:4px 0 8px;">${gymName || 'Our Gym'}</h1>
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${payload}"
              style="width:400px; height:400px; margin:24px 0 12px;" />
            <p style="font-size:17px; color:#555; margin:0;">or enter this code</p>
            <p style="font-size:56px; font-weight:800; letter-spacing:14px; margin:8px 0 0;">
              ${joinCode}
            </p>
            <p style="font-size:17px; color:#555; margin-top:28px;">
              Install the gym app &rarr; sign up &rarr; Join Gym &rarr; enter the code
            </p>
            <p style="font-size:13px; color:#999; margin-top:34px;">
              This code does not expire. Join requests still need approval.
            </p>
          </body>
        </html>`;

      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${gymName || 'Gym'} join poster`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Saved', `The poster was saved to:\n${uri}`);
      }
    } catch (err: any) {
      console.error('[Invite] Poster generation failed:', err);
      Alert.alert(
        'Could Not Create Poster',
        err?.message || 'Something went wrong generating the PDF.'
      );
    } finally {
      setPrinting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const tips = [
    'Print the poster and put it on the front desk or notice board.',
    "Send the screenshot to your gym's WhatsApp group.",
    'The six characters work on their own, so staff can read them out over the phone.',
    'The code never changes, so a printed poster keeps working.',
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 12, 44) }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[
            styles.backBtn,
            { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
          ]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Invite Members</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {!joinCode ? (
          <Card padding={20}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              This gym has no join code yet. Try again in a moment.
            </Text>
            <Button title="Retry" variant="outline" size="sm" onPress={fetchJoinCode} />
          </Card>
        ) : (
          <>
            {/* The printable part: QR and code together, on white so it
                photographs and prints legibly whatever the app theme is. */}
            <View style={styles.posterWrap}>
              <View style={styles.poster}>
                <Text style={styles.posterEyebrow}>JOIN</Text>
                <Text style={styles.posterGym} numberOfLines={2}>
                  {displayName}
                </Text>

                <View style={styles.qrBox}>
                  <QRCode
                    value={buildGymJoinQrPayload(joinCode)}
                    size={200}
                    backgroundColor="#FFFFFF"
                    color="#000000"
                  />
                </View>

                <Text style={styles.posterOr}>or enter this code</Text>
                <Text style={styles.posterCode} selectable>
                  {joinCode}
                </Text>
                <Text style={styles.posterFoot}>
                  Sign up on Gymnos, tap Join Gym, enter the code
                </Text>
              </View>
            </View>

            <Button
              title="Share code"
              onPress={handleShare}
              variant="primary"
              size="lg"
              fullWidth
              icon={<Ionicons name="share-social-outline" size={20} color="#000000" />}
              style={styles.shareBtn}
            />

            <Button
              title={printing ? 'Building poster...' : 'Print poster (PDF)'}
              onPress={handlePrint}
              variant="outline"
              size="lg"
              fullWidth
              loading={printing}
              icon={<Ionicons name="print-outline" size={20} color={colors.primary} />}
              style={styles.shareBtn}
            />

            <Card padding={16} style={styles.tipsCard}>
              <Text style={[styles.tipsTitle, { color: colors.text }]}>
                Leave this where members can find it
              </Text>
              {tips.map((tip) => (
                <View key={tip} style={styles.tipRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  <Text style={[styles.tipText, { color: colors.textSecondary }]}>{tip}</Text>
                </View>
              ))}
            </Card>

            <Text style={[styles.privacyNote, { color: colors.textTertiary }]}>
              Anyone with this code can request to join {displayName}. Requests still
              wait for your approval under Members, Pending, so the code on its own
              does not let anyone in.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  content: { paddingHorizontal: 16 },
  posterWrap: { alignItems: 'center', marginBottom: 20 },
  poster: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  posterEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 3,
    color: '#6B7280',
  },
  posterGym: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000000',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 18,
  },
  qrBox: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  posterOr: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 18,
    marginBottom: 4,
  },
  posterCode: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 8,
    color: '#000000',
    // Trailing letter-spacing pushes the glyphs left; nudge them back.
    marginLeft: 8,
  },
  posterFoot: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 14,
    textAlign: 'center',
  },
  shareBtn: { marginBottom: 20 },
  tipsCard: { marginBottom: 16 },
  tipsTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18 },
  privacyNote: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 8 },
  errorText: { fontSize: 14, marginBottom: 12 },
});
