import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dateOfBirthError, parseIndianDate, toIndianDate } from '../../utils/date';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { uploadImageAsset, isLocalFileUri } from '../../lib/storage';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../constants/keyboard';

// Values must match the CHECK constraint on public.profiles.gender.
const GENDER_OPTIONS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Prefer not to say', value: 'prefer_not_to_say' },
];

export default function StaffProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, currentMembership, supabase, refreshProfile, signOut, userId } =
    useAppAuth();
  const { colors, isDark, toggleTheme } = useTheme();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  // Held in the day-first form the user sees; converted to ISO on save.
  const [dateOfBirth, setDateOfBirth] = useState(toIndianDate(profile?.date_of_birth));
  const [gender, setGender] = useState(profile?.gender || '');
  // Collected during complete-profile signup but absent from this form, so a
  // staff member could never see or correct their own stored address.
  const [address, setAddress] = useState(profile?.address || '');
  const [emergencyName, setEmergencyName] = useState(
    profile?.emergency_contact_name || ''
  );
  const [emergencyPhone, setEmergencyPhone] = useState(
    profile?.emergency_contact_phone || ''
  );
  // Photos saved before Storage uploads existed are dead local paths.
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    isLocalFileUri(profile?.photo_url) ? null : profile?.photo_url || null
  );
  const [pendingPhotoAsset, setPendingPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
      setDateOfBirth(toIndianDate(profile.date_of_birth));
      setGender(profile.gender || '');
      setAddress(profile.address || '');
      setEmergencyName(profile.emergency_contact_name || '');
      setEmergencyPhone(profile.emergency_contact_phone || '');
      setPhotoUrl(
        isLocalFileUri(profile.photo_url) ? null : profile.photo_url || null
      );
    }
  }, [profile]);

  const hasChanges = useMemo(() => {
    if (!profile) return false;
    const savedPhotoUrl = isLocalFileUri(profile.photo_url) ? null : profile.photo_url || null;
    return (
      fullName !== (profile.full_name || '') ||
      phone !== (profile.phone || '') ||
      dateOfBirth !== toIndianDate(profile.date_of_birth) ||
      gender !== (profile.gender || '') ||
      address !== (profile.address || '') ||
      emergencyName !== (profile.emergency_contact_name || '') ||
      emergencyPhone !== (profile.emergency_contact_phone || '') ||
      photoUrl !== savedPhotoUrl ||
      pendingPhotoAsset !== null
    );
  }, [
    profile,
    fullName,
    phone,
    dateOfBirth,
    gender,
    address,
    emergencyName,
    emergencyPhone,
    photoUrl,
    pendingPhotoAsset,
  ]);

  const handlePickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied',
          'Camera roll access is needed to change your photo.'
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

      if (!result.canceled && result.assets?.[0]?.uri) {
        setPhotoUrl(result.assets[0].uri);
        setPendingPhotoAsset(result.assets[0]);
      }
    } catch (err) {
      console.error('[StaffProfile] Error picking photo:', err);
      Alert.alert('Error', 'Failed to pick photo.');
    }
  };

  const handleSave = async () => {
    if (!profile?.id) return;
    if (!fullName.trim()) {
      Alert.alert('Required Field', 'Please enter your full name.');
      return;
    }

    // Free-text field writing to a Postgres `date`. Unchecked, a day-first or
    // overflow date failed in the driver and surfaced as a raw 22007/22008.
    const dobError = dateOfBirthError(dateOfBirth);
    if (dobError) {
      Alert.alert('Check your date of birth', dobError);
      return;
    }

    setIsSaving(true);
    try {
      let photoUrlToSave = photoUrl;
      if (pendingPhotoAsset && userId) {
        try {
          photoUrlToSave = await uploadImageAsset(
            supabase,
            'profile-photos',
            userId,
            pendingPhotoAsset
          );
          setPhotoUrl(photoUrlToSave);
          setPendingPhotoAsset(null);
        } catch (uploadErr: any) {
          console.error('[StaffProfile] Photo upload failed:', uploadErr);
          Alert.alert(
            'Photo Upload Failed',
            uploadErr?.message || 'Could not upload your photo. Please try again.'
          );
          return;
        }
      }

      if (isLocalFileUri(photoUrlToSave)) {
        photoUrlToSave = null;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          date_of_birth: parseIndianDate(dateOfBirth),
          gender: gender || null,
          address: address.trim() || null,
          emergency_contact_name: emergencyName.trim() || null,
          emergency_contact_phone: emergencyPhone.trim() || null,
          photo_url: photoUrlToSave || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);

      if (error) throw error;

      await refreshProfile();
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (err: any) {
      console.error('[StaffProfile] Error updating profile:', err);
      Alert.alert('Update Failed', err.message || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            router.replace('/(auth)/sign-in');
          } catch (err) {
            console.error('[StaffProfile] Sign out error:', err);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 12, 44),
            paddingBottom: insets.bottom + (hasChanges ? 166 : 106),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.screenTitle, { color: colors.text }]}>Your Profile</Text>
          <Text style={[styles.screenSubtitle, { color: colors.textSecondary }]}>
            Staff identity, contact details and emergency information
          </Text>
        </View>

        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handlePickPhoto} style={styles.avatarWrap} activeOpacity={0.8}>
            <Avatar uri={photoUrl} name={fullName || 'Staff'} size={76} />
            <View
              style={[
                styles.cameraBadge,
                { backgroundColor: colors.primary, borderColor: colors.background },
              ]}
            >
              <Ionicons name="camera" size={16} color="#000000" />
            </View>
          </TouchableOpacity>

          <View style={styles.identityCopy}>
            <Text style={[styles.identityName, { color: colors.text }]}>{fullName || 'Staff'}</Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{profile?.email}</Text>
            <Text style={[styles.roleLabel, { color: colors.primary }]}>
              {currentMembership?.gym?.name
                ? `Staff at ${currentMembership.gym.name}`
                : 'Gym staff'}
            </Text>
          </View>
        </View>

        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Personal Details</Text>
          <Input
            label="Full Name *"
            placeholder="Enter your full name"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />
          <Input
            label="Phone Number"
            placeholder="e.g. +91 98765 43210"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Input
            label="Date of Birth (DD/MM/YYYY)"
            placeholder="15/08/1995"
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            autoCapitalize="none"
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Gender
          </Text>
          <View style={styles.chipRow}>
            {GENDER_OPTIONS.map((option) => {
              const selected = gender === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setGender(selected ? '' : option.value)}
                  activeOpacity={0.7}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primaryMuted : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selected ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Address"
            placeholder="Street, area, city"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="words"
          />
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Emergency Contact</Text>
          <Input
            label="Contact Name"
            placeholder="e.g. Jane Doe"
            value={emergencyName}
            onChangeText={setEmergencyName}
            autoCapitalize="words"
          />
          <Input
            label="Contact Phone"
            placeholder="e.g. +91 98765 43210"
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            keyboardType="phone-pad"
          />
        </Card>

        <View
          style={[
            styles.rowButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons
            name={isDark ? 'moon' : 'sunny'}
            size={18}
            color={colors.textSecondary}
            style={styles.rowIcon}
          />
          <Text style={[styles.rowText, { color: colors.text }]}>
            {isDark ? 'Dark Mode' : 'Light Mode'}
          </Text>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: '#767577', true: colors.primaryLight }}
            thumbColor={isDark ? colors.primary : '#f4f3f4'}
          />
        </View>

        <TouchableOpacity
          onPress={handleSignOut}
          activeOpacity={0.7}
          style={styles.signOutButton}
        >
          <Ionicons
            name="log-out-outline"
            size={18}
            color={colors.error}
            style={styles.rowIcon}
          />
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {hasChanges ? (
        <View
          style={[
            styles.saveContainer,
            {
              bottom: Platform.OS === 'ios' ? 88 : 84,
              backgroundColor: colors.background,
              borderTopColor: colors.divider,
            },
          ]}
        >
          <Button
            title="Save Changes"
            onPress={handleSave}
            variant="primary"
            size="md"
            loading={isSaving}
            fullWidth
            icon={<Ionicons name="save-outline" size={18} color="#11170B" />}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  header: { marginBottom: 18 },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  screenSubtitle: { fontSize: 14 },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  avatarWrap: { position: 'relative', marginRight: 14 },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  identityCopy: { flex: 1 },
  identityName: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  profileEmail: { fontSize: 12, marginBottom: 4 },
  roleLabel: { fontSize: 13, fontWeight: '700' },
  sectionCard: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
  },
  fieldLabel: { fontSize: 14, fontWeight: '500', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  rowIcon: { marginRight: 10 },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600' },
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  signOutText: { fontSize: 15, fontWeight: '600' },
  saveContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 10,
  },
});
