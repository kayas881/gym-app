import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { uploadImageAsset, isLocalFileUri } from '../../lib/storage';
import { dateOfBirthError, parseIndianDate, toIndianDate } from '../../utils/date';
import { Input, Button } from '../../components/ui';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../constants/keyboard';

// Options for dropdowns.
// `value` must match the CHECK constraints on public.profiles — the DB only
// accepts the snake_case forms, so the human-readable label is display-only.
interface SelectOption {
  label: string;
  value: string;
}

const GENDER_OPTIONS: SelectOption[] = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Prefer not to say', value: 'prefer_not_to_say' },
];

/**
 * Must stay exactly these three values: announcement_recipients() matches
 * preferred_gym_timing against 'morning' / 'afternoon' / 'evening' to decide who
 * a slot-targeted announcement reaches. This used to be a free-text box whose
 * placeholder suggested "e.g. 6-8 AM or 6-8 PM", so anyone who followed the hint
 * typed a value matching no slot and was then silently left out of every
 * slot-targeted announcement.
 */
const GYM_TIMING_OPTIONS: SelectOption[] = [
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' },
];

const FITNESS_GOAL_OPTIONS: SelectOption[] = [
  { label: 'Weight Loss', value: 'weight_loss' },
  { label: 'Muscle Gain', value: 'muscle_gain' },
  { label: 'General Fitness', value: 'general_fitness' },
  { label: 'Flexibility', value: 'flexibility' },
  { label: 'Endurance', value: 'endurance' },
  { label: 'Other', value: 'other' },
];

interface SelectFieldProps {
  label: string;
  value: string;
  placeholder: string;
  options: SelectOption[];
  onSelect: (option: string) => void;
  leftIcon?: React.ReactNode;
  error?: string;
}

function SelectField({
  label,
  value,
  placeholder,
  options,
  onSelect,
  leftIcon,
  error,
}: SelectFieldProps) {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);

  // `value` holds the stored DB value; show its human-readable label.
  const selectedLabel = options.find((option) => option.value === value)?.label;

  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setModalVisible(true)}
        style={[
          styles.selectTrigger,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.error : colors.inputBorder,
          },
        ]}
      >
        {leftIcon ? <View style={styles.leftIconContainer}>{leftIcon}</View> : null}

        <Text
          style={[
            styles.selectValueText,
            {
              color: selectedLabel ? colors.text : colors.inputPlaceholder,
            },
          ]}
          numberOfLines={1}
        >
          {selectedLabel || placeholder}
        </Text>

        <Ionicons
          name="chevron-down"
          size={18}
          color={colors.textSecondary}
          style={styles.chevronIcon}
        />
      </TouchableOpacity>

      {error ? (
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      ) : null}

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.divider }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {label}
              </Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              bounces={false}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      onSelect(item.value);
                      setModalVisible(false);
                    }}
                    style={[
                      styles.optionItem,
                      isSelected && {
                        backgroundColor: colors.primaryMuted,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        {
                          color: isSelected ? colors.primary : colors.text,
                          fontWeight: isSelected ? '700' : '400',
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {isSelected ? (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={colors.primary}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function CompleteProfileScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { profile, userId, supabase, refreshProfile, refreshMembership, signOut } =
    useAppAuth();

  // Claiming an existing membership. Offered HERE, before any of the fields
  // below are filled in, because a successful claim adopts the record the gym
  // owner already created — name, phone, plan, payments and all — so typing any
  // of it first would be wasted work.
  const [claimVisible, setClaimVisible] = useState(false);
  const [claimCode, setClaimCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');

  const handleClaim = async () => {
    const entered = claimCode.trim();
    if (entered.length < 6) {
      setClaimError('Enter the 6-character code from your gym.');
      return;
    }
    setClaiming(true);
    setClaimError('');
    try {
      const { data, error } = await supabase.rpc('claim_member_record', {
        p_code: entered,
      });
      if (error) throw error;

      // The function reports failure in its result rather than raising, so that
      // it can record the attempt for rate limiting (a raise would roll that
      // insert back). Read `ok`, show `message`.
      const result = data as { ok?: boolean; message?: string } | null;
      if (!result?.ok) {
        setClaimError(result?.message || 'That code could not be used.');
        return;
      }

      setClaimVisible(false);
      // The signed-in user now points at the gym's record, so re-read both.
      await refreshProfile();
      await refreshMembership();
      Alert.alert(
        'Membership linked',
        'Your plan, payments and history are all here.',
        [
          {
            text: 'OK',
            // Back to the router entry point rather than guessing a destination:
            // index.tsx already knows whether a profile still needs finishing and
            // which role's home this account belongs on. Staying on this form
            // after a successful claim would be the wrong screen entirely.
            onPress: () => router.replace('/'),
          },
        ]
      );
    } catch (err: any) {
      console.error('[CompleteProfile] Claim error:', err);
      setClaimError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setClaiming(false);
    }
  };

  // Form State
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  // Held in the day-first form the user sees; converted to ISO on save.
  const [dob, setDob] = useState(toIndianDate(profile?.date_of_birth));
  const [gender, setGender] = useState(profile?.gender || '');
  const [emergencyName, setEmergencyName] = useState(
    profile?.emergency_contact_name || ''
  );
  const [emergencyPhone, setEmergencyPhone] = useState(
    profile?.emergency_contact_phone || ''
  );
  const [address, setAddress] = useState(profile?.address || '');
  const [healthNotes, setHealthNotes] = useState(profile?.health_notes || '');
  const [fitnessGoal, setFitnessGoal] = useState(profile?.fitness_goal || '');
  const [preferredTiming, setPreferredTiming] = useState(
    profile?.preferred_gym_timing || ''
  );
  // A photo saved before Storage uploads existed is a dead local path — ignore
  // it so the avatar falls back to initials rather than a broken image.
  const [photoUri, setPhotoUri] = useState<string | null>(
    isLocalFileUri(profile?.photo_url) ? null : profile?.photo_url || null
  );
  // Set when the user picks a new image; uploaded on save.
  const [pendingPhotoAsset, setPendingPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  const [saving, setSaving] = useState(false);
  const [fullNameError, setFullNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // Sync state if profile loads asynchronously
  useEffect(() => {
    if (profile) {
      if (!fullName && profile.full_name) setFullName(profile.full_name);
      if (!phone && profile.phone) setPhone(profile.phone);
      if (!dob && profile.date_of_birth) setDob(toIndianDate(profile.date_of_birth));
      if (!gender && profile.gender) setGender(profile.gender);
      if (!emergencyName && profile.emergency_contact_name)
        setEmergencyName(profile.emergency_contact_name);
      if (!emergencyPhone && profile.emergency_contact_phone)
        setEmergencyPhone(profile.emergency_contact_phone);
      if (!address && profile.address) setAddress(profile.address);
      if (!healthNotes && profile.health_notes)
        setHealthNotes(profile.health_notes);
      if (!fitnessGoal && profile.fitness_goal)
        setFitnessGoal(profile.fitness_goal);
      if (!preferredTiming && profile.preferred_gym_timing)
        setPreferredTiming(profile.preferred_gym_timing);
      if (!photoUri && profile.photo_url) setPhotoUri(profile.photo_url);
    }
  }, [profile]);

  // Pick Image via Expo Image Picker
  const handlePickImage = useCallback(async () => {
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'Please allow access to your photo library to set a profile picture.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        // Needed to upload without expo-file-system (see lib/storage.ts).
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        // Show the local file immediately; it's uploaded on save.
        setPhotoUri(result.assets[0].uri);
        setPendingPhotoAsset(result.assets[0]);
      }
    } catch (err) {
      console.error('[CompleteProfile] Error picking image:', err);
      Alert.alert('Error', 'Failed to select image. Please try again.');
    }
  }, []);

  // Save profile to Supabase
  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      setFullNameError('Full name is required');
      return;
    }
    setFullNameError('');

    // Phone is what marks the profile as complete (see lib/auth.tsx), so it
    // has to be filled in before we can move the user on.
    if (!phone.trim()) {
      setPhoneError('Phone number is required');
      return;
    }
    setPhoneError('');

    // Free-text field writing to a Postgres `date`. This is the signup step
    // every user passes through, so an unchecked day-first date failed the
    // whole profile save here with a raw 22007/22008 from the driver.
    const dobError = dateOfBirthError(dob);
    if (dobError) {
      Alert.alert('Check your date of birth', dobError);
      return;
    }

    if (!userId) {
      Alert.alert('Error', 'User ID not found. Please sign in again.');
      return;
    }

    setSaving(true);
    try {
      // Upload a newly picked photo to Storage and persist the public URL.
      // Storing the raw ImagePicker URI would only work on this device until
      // the OS cleared its cache.
      let photoUrlToSave = photoUri;
      if (pendingPhotoAsset) {
        try {
          photoUrlToSave = await uploadImageAsset(
            supabase,
            'profile-photos',
            userId,
            pendingPhotoAsset
          );
          setPhotoUri(photoUrlToSave);
          setPendingPhotoAsset(null);
        } catch (uploadErr: any) {
          console.error('[CompleteProfile] Photo upload failed:', uploadErr);
          Alert.alert(
            'Photo Upload Failed',
            uploadErr?.message ||
              'Could not upload your photo. Your other details were not saved — please try again.'
          );
          return;
        }
      }

      // Never persist a local file path.
      if (isLocalFileUri(photoUrlToSave)) {
        photoUrlToSave = null;
      }

      const updateData = {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        photo_url: photoUrlToSave || null,
        date_of_birth: parseIndianDate(dob),
        gender: gender || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
        address: address.trim() || null,
        health_notes: healthNotes.trim() || null,
        fitness_goal: fitnessGoal || null,
        preferred_gym_timing: preferredTiming.trim() || null,
      };

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('clerk_id', userId);

      if (error) {
        console.error('[CompleteProfile] Supabase update error:', error);
        Alert.alert('Error', error.message || 'Failed to update profile.');
        return;
      }

      // Refresh auth profile state
      await refreshProfile();

      // Route to index for next step detection
      router.replace('/');
    } catch (err: any) {
      console.error('[CompleteProfile] Unexpected error on save:', err);
      Alert.alert(
        'Error',
        err.message || 'An unexpected error occurred while saving profile.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } catch (err) {
      console.error('[CompleteProfile] Sign out error:', err);
    }
  };

  // Avatar Initials fallback
  const getInitials = (name: string) => {
    if (!name.trim()) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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
            <Text style={[styles.title, { color: colors.text }]}>
              Complete Your Profile
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Fill in your details to get the best gym experience tailored to your goals.
            </Text>
          </View>

          {/* Most members are registered at the desk long before they install
              anything. If the owner has given them a code, this is the shortest
              path to their real record. */}
          <TouchableOpacity
            style={[
              styles.claimBanner,
              {
                borderColor: colors.primary,
                backgroundColor: isDark ? 'rgba(0, 230, 118, 0.08)' : '#F0FAF5',
              },
            ]}
            onPress={() => setClaimVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="key-outline" size={20} color={colors.primary} />
            <View style={styles.claimBannerText}>
              <Text style={[styles.claimBannerTitle, { color: colors.text }]}>
                Already a member at your gym?
              </Text>
              <Text style={[styles.claimBannerSub, { color: colors.textSecondary }]}>
                Enter the code they gave you and skip filling this in
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>

          {/* Profile Photo Avatar */}
          <View style={styles.avatarSection}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handlePickImage}
              style={styles.avatarTouchable}
            >
              <View
                style={[
                  styles.avatarWrapper,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                  },
                ]}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarImage} />
                ) : (
                  <View
                    style={[
                      styles.avatarFallback,
                      { backgroundColor: colors.primaryMuted },
                    ]}
                  >
                    <Text
                      style={[styles.avatarInitials, { color: colors.primary }]}
                    >
                      {getInitials(fullName || profile?.email || '')}
                    </Text>
                  </View>
                )}
              </View>

              <View
                style={[
                  styles.cameraBadge,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.background,
                  },
                ]}
              >
                <Ionicons name="camera" size={16} color="#000000" />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePickImage}
              activeOpacity={0.7}
              style={styles.changePhotoTextButton}
            >
              <Text style={[styles.changePhotoText, { color: colors.primary }]}>
                {photoUri ? 'Change Photo' : 'Add Profile Photo'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Section: Personal Info */}
          <View style={styles.sectionHeader}>
            <Ionicons
              name="person-circle-outline"
              size={20}
              color={colors.primary}
              style={styles.sectionIcon}
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Personal Information
            </Text>
          </View>

          <Input
            label="Full Name *"
            placeholder="Enter your full name"
            value={fullName}
            onChangeText={(text) => {
              setFullName(text);
              if (text.trim()) setFullNameError('');
            }}
            error={fullNameError}
            autoCapitalize="words"
            leftIcon={
              <Ionicons
                name="person-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <Input
            label="Phone Number *"
            placeholder="e.g. +91 98765 43210"
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              if (text.trim()) setPhoneError('');
            }}
            error={phoneError}
            keyboardType="phone-pad"
            leftIcon={
              <Ionicons
                name="call-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <Input
            label="Date of Birth (DD/MM/YYYY)"
            placeholder="e.g. 21/05/1998"
            value={dob}
            onChangeText={setDob}
            autoCapitalize="none"
            leftIcon={
              <Ionicons
                name="calendar-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <SelectField
            label="Gender"
            value={gender}
            placeholder="Select gender"
            options={GENDER_OPTIONS}
            onSelect={setGender}
            leftIcon={
              <Ionicons
                name="male-female-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <Input
            label="Address"
            placeholder="Enter residential address"
            value={address}
            onChangeText={setAddress}
            multiline={true}
            numberOfLines={2}
            autoCapitalize="sentences"
            leftIcon={
              <Ionicons
                name="location-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          {/* Section: Fitness & Schedule */}
          <View style={[styles.sectionHeader, { marginTop: 12 }]}>
            <Ionicons
              name="barbell-outline"
              size={20}
              color={colors.primary}
              style={styles.sectionIcon}
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Fitness & Routine
            </Text>
          </View>

          <SelectField
            label="Primary Fitness Goal"
            value={fitnessGoal}
            placeholder="Select fitness goal"
            options={FITNESS_GOAL_OPTIONS}
            onSelect={setFitnessGoal}
            leftIcon={
              <Ionicons
                name="trophy-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <SelectField
            label="Preferred Gym Timing"
            value={preferredTiming}
            placeholder="Select when you usually train"
            options={GYM_TIMING_OPTIONS}
            onSelect={setPreferredTiming}
            leftIcon={
              <Ionicons
                name="time-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <Input
            label="Health Conditions / Medical Notes"
            placeholder="Any health conditions we should know about? (e.g. asthma, knee pain, hypertension)"
            value={healthNotes}
            onChangeText={setHealthNotes}
            multiline={true}
            numberOfLines={3}
            autoCapitalize="sentences"
            leftIcon={
              <Ionicons
                name="medkit-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          {/* Section: Emergency Contact */}
          <View style={[styles.sectionHeader, { marginTop: 12 }]}>
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={colors.primary}
              style={styles.sectionIcon}
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Emergency Contact
            </Text>
          </View>

          <Input
            label="Emergency Contact Name"
            placeholder="e.g. Jane Doe (Spouse / Parent)"
            value={emergencyName}
            onChangeText={setEmergencyName}
            autoCapitalize="words"
            leftIcon={
              <Ionicons
                name="person-add-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          <Input
            label="Emergency Contact Phone"
            placeholder="e.g. +91 98765 43210"
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            keyboardType="phone-pad"
            leftIcon={
              <Ionicons
                name="call-outline"
                size={18}
                color={colors.textSecondary}
              />
            }
          />

          {/* Save Button */}
          <View style={styles.actionContainer}>
            <Button
              title="Save Profile"
              onPress={handleSaveProfile}
              variant="primary"
              size="lg"
              loading={saving}
              fullWidth={true}
              icon={
                <Ionicons
                  name="checkmark-circle-outline"
                  size={20}
                  color="#000000"
                />
              }
              textStyle={styles.saveButtonText}
            />

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
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={claimVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setClaimVisible(false)}
      >
        <View style={[styles.claimOverlay, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              styles.claimSheet,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.claimSheetHeader}>
              <Text style={[styles.claimSheetTitle, { color: colors.text }]}>
                Enter your gym code
              </Text>
              <TouchableOpacity
                onPress={() => setClaimVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.claimSheetSub, { color: colors.textSecondary }]}>
              Your gym gives you a 6-character code. It links this app to the
              membership they already set up for you.
            </Text>

            <Input
              label="Claim Code"
              placeholder="e.g. HD3XF6"
              value={claimCode}
              onChangeText={(t) => {
                setClaimCode(t.toUpperCase());
                if (claimError) setClaimError('');
              }}
              error={claimError}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />

            <Button
              title="Link my membership"
              onPress={handleClaim}
              variant="primary"
              size="lg"
              fullWidth
              loading={claiming}
            />

            <Text style={[styles.claimSheetFoot, { color: colors.textTertiary }]}>
              No code? Just fill in your details below instead.
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  claimBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  claimBannerText: { flex: 1 },
  claimBannerTitle: { fontSize: 14, fontWeight: '700' },
  claimBannerSub: { fontSize: 12, marginTop: 1 },
  claimOverlay: { flex: 1, justifyContent: 'flex-end' },
  claimSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 32,
  },
  claimSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  claimSheetTitle: { fontSize: 18, fontWeight: '700' },
  claimSheetSub: { fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 16 },
  claimSheetFoot: { fontSize: 12, textAlign: 'center', marginTop: 14 },
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
    paddingTop: 16,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarTouchable: {
    position: 'relative',
  },
  avatarWrapper: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 52,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 32,
    fontWeight: '700',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  changePhotoTextButton: {
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  changePhotoText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: 8,
  },
  sectionIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  fieldWrapper: {
    width: '100%',
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  selectTrigger: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftIconContainer: {
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectValueText: {
    flex: 1,
    fontSize: 15,
  },
  chevronIcon: {
    marginLeft: 8,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '400',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionText: {
    fontSize: 15,
  },
  actionContainer: {
    marginTop: 20,
    gap: 12,
  },
  saveButtonText: {
    color: '#000000',
    fontWeight: '700',
  },
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  signOutIcon: {
    marginRight: 6,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
