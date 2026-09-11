import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { Input, Button, Card } from '../../components/ui';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { parseGymJoinQrPayload } from '../../components/GymQRCode';
import {
  DAY_KEYS,
  defaultOperatingHours,
  parseTimeInput,
  serializeOperatingHours,
} from '../../utils/operating-hours';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../constants/keyboard';

type SetupTab = 'create' | 'join';

export default function SetupGymScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile, userId, supabase, refreshMembership, signOut } = useAppAuth();

  const [activeTab, setActiveTab] = useState<SetupTab>('create');

  // Create Gym Form State
  const [gymName, setGymName] = useState('');
  const [gymAddress, setGymAddress] = useState('');
  const [openingTime, setOpeningTime] = useState('6:00 AM');
  const [closingTime, setClosingTime] = useState('10:00 PM');
  const [gymNameError, setGymNameError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Join Gym Form State
  const [gymCode, setGymCode] = useState('');
  const [gymCodeError, setGymCodeError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  /**
   * A gym is joined with its six-character join_code (migration 030). Owners who
   * already sent someone the raw UUID keep working -- that is what the UUID
   * branch is for -- but it is no longer what anyone is asked to type.
   *
   * Codes are stored uppercase from an alphabet with no I, L, O, 0 or 1, so
   * input is upper-cased and anything that is not A-Z or 0-9 is dropped. That
   * quietly absorbs the spaces, hyphens and stray punctuation people add when
   * copying a code out of a WhatsApp message.
   */
  const looksLikeUuid = (value: string) =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value
    );

  const normalizeJoinCode = (raw: string) =>
    raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Handle Create Gym
  const handleCreateGym = async () => {
    if (!gymName.trim()) {
      setGymNameError('Gym name is required');
      return;
    }
    setGymNameError('');

    if (!userId || !profile?.id) {
      Alert.alert('Error', 'User profile not found. Please re-authenticate.');
      return;
    }

    // Free-text time fields feeding a structured document, so parse before
    // saving rather than storing whatever was typed. A wrong closing time is
    // not cosmetic: it decides who counts as an evening member for targeted
    // announcements.
    const openIso = parseTimeInput(openingTime);
    const closeIso = parseTimeInput(closingTime);
    if (!openIso || !closeIso) {
      Alert.alert(
        'Check your opening hours',
        'Enter times like 6:00 AM and 10:00 PM.'
      );
      return;
    }
    if (openIso === closeIso) {
      Alert.alert(
        'Check your opening hours',
        'Opening and closing time cannot be the same.'
      );
      return;
    }

    setIsCreating(true);
    try {
      // Build the version-2 hours document migration 023 introduced.
      //
      // This used to write { opening, closing, summary } -- the pre-023 shape --
      // so every NEW gym was born legacy: parseOperatingHours() returns
      // hours: null for that, meaning no per-day hours and no "open now" until
      // the owner happened to open Gym Hours and re-save. These two fields set
      // the same times for all seven days; the owner refines individual days,
      // and weekly closures, on the Gym Hours screen afterwards.
      const hours = defaultOperatingHours();
      for (const key of DAY_KEYS) {
        hours.days[key] = { closed: false, open: openIso, close: closeIso };
      }

      // 1. Insert gym into gyms table
      const { data: gymData, error: gymError } = await supabase
        .from('gyms')
        .insert({
          name: gymName.trim(),
          address: gymAddress.trim() || null,
          owner_clerk_id: userId,
          // gyms stores hours as a JSONB column, not separate time columns.
          operating_hours: serializeOperatingHours(hours),
        })
        .select()
        .single();

      if (gymError) {
        console.error('[SetupGym] Gym creation error:', gymError);
        Alert.alert('Error', gymError.message || 'Failed to create gym');
        return;
      }

      // 2. Insert into gym_members with role='owner', status='active'
      const { error: memberError } = await supabase
        .from('gym_members')
        .insert({
          gym_id: gymData.id,
          profile_id: profile.id,
          role: 'owner',
          status: 'active',
        });

      if (memberError) {
        console.error('[SetupGym] Member link error:', memberError);
        Alert.alert('Error', memberError.message || 'Failed to assign owner role');
        return;
      }

      // 3. Create default plans (1 Month - ₹1000, 3 Months - ₹2000, 6 Months - ₹4000)
      try {
        await supabase.from('membership_plans').insert([
          {
            gym_id: gymData.id,
            name: '1 Month',
            duration_months: 1,
            price: 1000,
          },
          {
            gym_id: gymData.id,
            name: '3 Months',
            duration_months: 3,
            price: 2000,
          },
          {
            gym_id: gymData.id,
            name: '6 Months',
            duration_months: 6,
            price: 4000,
          },
        ]);
      } catch (planErr) {
        console.warn('[SetupGym] Could not create default plans:', planErr);
      }

      // 4. Refresh membership state and navigate to root
      await refreshMembership();
      router.replace('/');
    } catch (err: any) {
      console.error('[SetupGym] Unexpected create gym error:', err);
      Alert.alert(
        'Error',
        err.message || 'An unexpected error occurred while creating your gym.'
      );
    } finally {
      setIsCreating(false);
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission Needed',
          'We need the camera to read your gym’s QR code. You can also type the 6-character code instead.'
        );
        return;
      }
    }
    setScannerVisible(true);
  };

  const handleJoinScan = ({ data }: BarcodeScanningResult) => {
    const scanned = parseGymJoinQrPayload(data);
    if (!scanned) {
      // Most likely the check-in QR, which carries { gym_id } instead. Say so
      // rather than failing silently -- both posters live in the same gym.
      setScannerVisible(false);
      Alert.alert(
        'Not a join code',
        'That looks like the check-in QR, not the join poster. Ask for the "Join" code, or type the 6 characters instead.'
      );
      return;
    }
    setScannerVisible(false);
    setGymCode(scanned);
    setGymCodeError('');
  };

  // Handle Join Gym
  const handleJoinGym = async () => {
    const rawCode = gymCode.trim();
    if (!rawCode) {
      setGymCodeError('Please enter your gym code');
      return;
    }
    const isUuid = looksLikeUuid(rawCode);
    const joinCode = isUuid ? rawCode : normalizeJoinCode(rawCode);
    if (!isUuid && joinCode.length !== 6) {
      setGymCodeError('A gym code is 6 characters, like T6JBRC');
      return;
    }
    setGymCodeError('');

    if (!profile?.id) {
      Alert.alert('Error', 'User profile not found. Please re-authenticate.');
      return;
    }

    setIsJoining(true);
    try {
      // Look the gym up by join code, or by id when someone pastes an old UUID.
      const { data: gymData, error: gymLookupError } = await supabase
        .from('gyms')
        .select('id, name')
        .eq(isUuid ? 'id' : 'join_code', joinCode)
        .maybeSingle();

      if (gymLookupError || !gymData) {
        Alert.alert(
          'Gym Not Found',
          `No gym has the code "${joinCode}". Codes are 6 characters and are shown on the poster at your gym -- check it with your gym's staff.`
        );
        return;
      }

      // Check if already a member or pending
      const { data: existingMembership } = await supabase
        .from('gym_members')
        .select('id, status')
        .eq('gym_id', gymData.id)
        .eq('profile_id', profile.id)
        .maybeSingle();

      if (existingMembership) {
        if (existingMembership.status === 'pending') {
          Alert.alert(
            'Request Already Sent',
            'You already have a pending membership request for this gym.',
            [
              {
                text: 'OK',
                onPress: async () => {
                  await refreshMembership();
                  router.replace('/');
                },
              },
            ]
          );
          return;
        } else if (existingMembership.status === 'active') {
          Alert.alert('Already Member', 'You are already an active member of this gym.');
          await refreshMembership();
          router.replace('/');
          return;
        }
      }

      // 2. Insert into gym_members with role='member', status='pending'
      const { error: joinError } = await supabase
        .from('gym_members')
        .insert({
          gym_id: gymData.id,
          profile_id: profile.id,
          role: 'member',
          status: 'pending',
        });

      if (joinError) {
        console.error('[SetupGym] Join gym error:', joinError);
        Alert.alert('Error', joinError.message || 'Failed to submit membership request.');
        return;
      }

      // 3. Show confirmation message
      Alert.alert(
        'Request Sent!',
        `Your request to join ${gymData.name} has been sent. The gym owner will review your membership.`,
        [
          {
            text: 'Continue',
            onPress: async () => {
              await refreshMembership();
              router.replace('/');
            },
          },
        ]
      );
    } catch (err: any) {
      console.error('[SetupGym] Unexpected join gym error:', err);
      Alert.alert(
        'Error',
        err.message || 'An unexpected error occurred while requesting to join.'
      );
    } finally {
      setIsJoining(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } catch (err) {
      console.error('[SetupGym] Sign out error:', err);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={KEYBOARD_AVOID_BEHAVIOR}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: colors.primaryMuted },
              ]}
            >
              <Ionicons name="barbell" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              Gym Setup
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Create a new gym to manage members, or join an existing gym with a gym code.
            </Text>
          </View>

          {/* Segmented Tab Switcher */}
          <View
            style={[
              styles.tabSwitcher,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setActiveTab('create')}
              style={[
                styles.tabButton,
                activeTab === 'create' && [
                  styles.activeTabButton,
                  { backgroundColor: colors.surfaceElevated },
                ],
              ]}
            >
              <Ionicons
                name="business-outline"
                size={18}
                color={
                  activeTab === 'create' ? colors.primary : colors.textSecondary
                }
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.tabButtonText,
                  {
                    color:
                      activeTab === 'create' ? colors.text : colors.textSecondary,
                    fontWeight: activeTab === 'create' ? '700' : '500',
                  },
                ]}
              >
                Create Gym
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setActiveTab('join')}
              style={[
                styles.tabButton,
                activeTab === 'join' && [
                  styles.activeTabButton,
                  { backgroundColor: colors.surfaceElevated },
                ],
              ]}
            >
              <Ionicons
                name="enter-outline"
                size={18}
                color={
                  activeTab === 'join' ? colors.primary : colors.textSecondary
                }
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.tabButtonText,
                  {
                    color:
                      activeTab === 'join' ? colors.text : colors.textSecondary,
                    fontWeight: activeTab === 'join' ? '700' : '500',
                  },
                ]}
              >
                Join Gym
              </Text>
            </TouchableOpacity>
          </View>

          {/* TAB 1: CREATE GYM */}
          {activeTab === 'create' ? (
            <View style={styles.tabContent}>
              <Card
                style={[
                  styles.infoCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.infoRow}>
                  <Ionicons
                    name="sparkles"
                    size={20}
                    color={colors.primary}
                    style={styles.infoIcon}
                  />
                  <Text
                    style={[
                      styles.infoCardText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    You will become the Owner of this gym. Default membership plans (1, 3, and 6 months) will be created automatically.
                  </Text>
                </View>
              </Card>

              <Input
                label="Gym Name *"
                placeholder="e.g. Iron Forge Fitness"
                value={gymName}
                onChangeText={(text) => {
                  setGymName(text);
                  if (text.trim()) setGymNameError('');
                }}
                error={gymNameError}
                autoCapitalize="words"
                leftIcon={
                  <Ionicons
                    name="fitness-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                }
              />

              <Input
                label="Gym Address"
                placeholder="e.g. 101 Fitness Boulevard, Downtown"
                value={gymAddress}
                onChangeText={setGymAddress}
                autoCapitalize="sentences"
                leftIcon={
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                }
              />

              <View style={styles.hoursRow}>
                <View style={styles.halfInput}>
                  <Input
                    label="Opening Time"
                    placeholder="e.g. 6:00 AM"
                    value={openingTime}
                    onChangeText={setOpeningTime}
                    autoCapitalize="none"
                    leftIcon={
                      <Ionicons
                        name="time-outline"
                        size={18}
                        color={colors.textSecondary}
                      />
                    }
                  />
                </View>
                <View style={styles.halfInput}>
                  <Input
                    label="Closing Time"
                    placeholder="e.g. 10:00 PM"
                    value={closingTime}
                    onChangeText={setClosingTime}
                    autoCapitalize="none"
                    leftIcon={
                      <Ionicons
                        name="moon-outline"
                        size={18}
                        color={colors.textSecondary}
                      />
                    }
                  />
                </View>
              </View>

              <View style={styles.submitContainer}>
                <Button
                  title="Create Gym & Become Owner"
                  onPress={handleCreateGym}
                  variant="primary"
                  size="lg"
                  loading={isCreating}
                  fullWidth={true}
                  icon={
                    <Ionicons
                      name="add-circle-outline"
                      size={20}
                      color="#000000"
                    />
                  }
                  textStyle={styles.submitButtonText}
                />
              </View>
            </View>
          ) : null}

          {/* TAB 2: JOIN GYM */}
          {activeTab === 'join' ? (
            <View style={styles.tabContent}>
              <Card
                style={[
                  styles.infoCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.infoRow}>
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={colors.info}
                    style={styles.infoIcon}
                  />
                  <Text
                    style={[
                      styles.infoCardText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Enter the 6-character code on the poster at your gym, or scan its QR code. Your gym's staff can also read it out to you.
                  </Text>
                </View>
              </Card>

              <Input
                label="Gym Code *"
                placeholder="e.g. T6JBRC"
                value={gymCode}
                onChangeText={(text) => {
                  // Upper-cased as it is typed: the codes are uppercase, and
                  // leaving it lowercase makes a correct code look wrong.
                  setGymCode(looksLikeUuid(text.trim()) ? text : text.toUpperCase());
                  if (text.trim()) setGymCodeError('');
                }}
                error={gymCodeError}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={40}
                leftIcon={
                  <Ionicons
                    name="key-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                }
              />

              {/* The fast path when the member is standing at the gym looking
                  at the poster. Typing the six characters stays available for a
                  camera that will not focus, or joining from home. */}
              <TouchableOpacity
                onPress={openScanner}
                activeOpacity={0.7}
                style={[
                  styles.scanRow,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
                <Text style={[styles.scanRowText, { color: colors.text }]}>
                  Scan the QR on your gym's poster
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={styles.submitContainer}>
                <Button
                  title="Join Gym"
                  onPress={handleJoinGym}
                  variant="primary"
                  size="lg"
                  loading={isJoining}
                  fullWidth={true}
                  icon={
                    <Ionicons
                      name="paper-plane-outline"
                      size={20}
                      color="#000000"
                    />
                  }
                  textStyle={styles.submitButtonText}
                />
              </View>
            </View>
          ) : null}

          {/* Sign Out Footer */}
          <View style={styles.footerContainer}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleSignOut}
              style={styles.signOutButton}
            >
              <Ionicons
                name="log-out-outline"
                size={16}
                color={colors.textTertiary}
                style={styles.signOutIcon}
              />
              <Text style={[styles.signOutText, { color: colors.textTertiary }]}>
                Signed in as {profile?.email || 'User'} • Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={styles.scannerScreen}>
          {scannerVisible ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleJoinScan}
            />
          ) : null}

          <View style={styles.scannerOverlay}>
            <View style={styles.scannerFrame} />
            <Text style={styles.scannerHint}>
              Point the camera at the QR code on your gym's join poster
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => setScannerVisible(false)}
            style={styles.scannerCancel}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
            <Text style={styles.scannerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  scanRowText: { flex: 1, fontSize: 14, fontWeight: '600' },
  scannerScreen: { flex: 1, backgroundColor: '#000000' },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerFrame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#B7F34A',
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  scannerHint: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 40,
  },
  scannerCancel: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  scannerCancelText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  safeArea: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  tabSwitcher: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    marginBottom: 24,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  activeTabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabIcon: {
    marginRight: 6,
  },
  tabButtonText: {
    fontSize: 14,
  },
  tabContent: {
    width: '100%',
  },
  infoCard: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  infoCardText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  hoursRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  submitContainer: {
    marginTop: 12,
  },
  submitButtonText: {
    color: '#000000',
    fontWeight: '700',
  },
  footerContainer: {
    marginTop: 32,
    alignItems: 'center',
  },
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  signOutIcon: {
    marginRight: 6,
  },
  signOutText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
