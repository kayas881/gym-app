import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAppAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import GymQRCode, { buildPermanentGymQrPayload } from './GymQRCode';

type QrMode = 'daily' | 'permanent';

/**
 * Screen body shared by the owner and staff "Check-In Code" screens.
 *
 * Offers both a rotating daily code and a permanent printable one, because the
 * two have a real operational trade-off and only the gym owner can weigh it:
 * the daily code defeats screenshot re-use but somebody has to put it on
 * display every single day, which in a small gym tends to mean it stops
 * happening. Check-ins here don't drive billing, so the looser option is a
 * legitimate choice rather than a bug.
 */
export default function CheckInQRScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gymId, currentMembership } = useAppAuth();
  const { colors } = useTheme();

  // Defaults to 'permanent': a code that has to be re-displayed every morning
  // is a chore the gym staff realistically won't keep up with, and check-ins
  // don't drive billing here — so the printable one is the practical default.
  // The daily code stays available for anyone who wants the stricter behaviour.
  const [mode, setMode] = useState<QrMode>('permanent');
  const [printing, setPrinting] = useState(false);

  const gymName = currentMembership?.gym?.name ?? 'Your Gym';

  /**
   * Renders the permanent code to a PDF and hands it to the share sheet.
   *
   * Deliberately NOT Print.printAsync(): that requires an Android print service
   * to be installed, and without one it throws PrintManagerNotAvailableException
   * from a native render callback — which crashes the app outright and cannot be
   * caught by a JS try/catch. printToFileAsync + shareAsync has no such
   * dependency and is the same path the receipt PDFs already use. The user can
   * then print, save or send the poster with whatever app they prefer.
   *
   * The QR is an image URL rather than the react-native-qrcode-svg component,
   * because the HTML document must be self-contained and that component only
   * exists inside the React tree.
   */
  const handlePrint = async () => {
    if (!gymId) return;
    setPrinting(true);
    try {
      const payload = encodeURIComponent(buildPermanentGymQrPayload(gymId));
      const html = `
        <html>
          <body style="font-family: -apple-system, Roboto, sans-serif; text-align:center; padding:48px;">
            <h1 style="font-size:34px; margin-bottom:4px;">${gymName}</h1>
            <p style="font-size:20px; color:#555; margin-top:0;">Scan to check in</p>
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${payload}"
              style="width:420px; height:420px; margin:28px 0;" />
            <p style="font-size:18px; color:#555;">
              Open the gym app &rarr; Check In &rarr; scan this code
            </p>
            <p style="font-size:13px; color:#999; margin-top:36px;">
              Permanent code — does not expire.
            </p>
          </body>
        </html>`;

      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${gymName} check-in code`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Saved', `The poster was saved to:
${uri}`);
      }
    } catch (err: any) {
      console.error('[CheckInQR] Poster generation failed:', err);
      Alert.alert(
        'Could Not Create Poster',
        err?.message || 'Something went wrong generating the PDF.'
      );
    } finally {
      setPrinting(false);
    }
  };

  const renderModeOption = (value: QrMode, label: string, detail: string) => {
    const selected = mode === value;
    return (
      <TouchableOpacity
        key={value}
        onPress={() => setMode(value)}
        activeOpacity={0.8}
        style={[
          styles.modeOption,
          {
            backgroundColor: selected ? colors.primaryMuted : colors.surface,
            borderColor: selected ? colors.primary : colors.border,
          },
        ]}
      >
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={18}
          color={selected ? colors.primary : colors.textTertiary}
        />
        <View style={styles.modeText}>
          <Text
            style={[styles.modeLabel, { color: selected ? colors.primary : colors.text }]}
          >
            {label}
          </Text>
          <Text style={[styles.modeDetail, { color: colors.textSecondary }]}>
            {detail}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Check-In Code</Text>
          <View style={styles.backButton} />
        </View>

        {gymId ? (
          <>
            <View style={styles.modeGroup}>
              {renderModeOption(
                'permanent',
                'Permanent (recommended)',
                'Print once and display it at the gym. A member who photographs it could check in from home.'
              )}
              {renderModeOption(
                'daily',
                'Changes daily',
                'Stricter — a screenshot stops working tomorrow — but someone has to put the new code on display every day.'
              )}
            </View>

            <GymQRCode gymId={gymId} gymName={currentMembership?.gym?.name} mode={mode} />

            {mode === 'permanent' ? (
              <TouchableOpacity
                onPress={handlePrint}
                disabled={printing}
                activeOpacity={0.8}
                style={[
                  styles.printButton,
                  { backgroundColor: colors.primary },
                  printing && styles.printButtonDisabled,
                ]}
              >
                <Ionicons name="download-outline" size={18} color="#000000" />
                <Text style={styles.printButtonText}>
                  {printing ? 'Preparing…' : 'Save / print poster (PDF)'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={32} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No gym is linked to this account yet.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backButton: { width: 32, height: 32, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  modeGroup: { gap: 10, marginBottom: 20 },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeText: { flex: 1 },
  modeLabel: { fontSize: 15, fontWeight: '700' },
  modeDetail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  printButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
    marginTop: 20,
  },
  printButtonDisabled: { opacity: 0.6 },
  printButtonText: { color: '#000000', fontSize: 15, fontWeight: '700' },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
