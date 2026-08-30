import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { uploadImageAsset, isLocalFileUri } from '../../lib/storage';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const GENDER_OPTIONS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
];

const FITNESS_GOALS = [
  { label: 'Weight Loss', value: 'weight_loss' },
  { label: 'Muscle Gain', value: 'muscle_gain' },
  { label: 'General Fitness', value: 'general_fitness' },
  { label: 'Endurance', value: 'endurance' },
  { label: 'Flexibility', value: 'flexibility' },
];

const TIMING_SLOTS = [
  { label: '🌅 Morning', value: 'morning' },
  { label: '☀️ Afternoon', value: 'afternoon' },
  { label: '🌙 Evening', value: 'evening' },
];

export default function MemberProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, currentMembership, supabase, refreshProfile, signOut, userId } =
    useAppAuth();
  const { colors, isDark, toggleTheme, mode, setMode } = useTheme();

  // Form states
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [dateOfBirth, setDateOfBirth] = useState(profile?.date_of_birth || '');
  const [gender, setGender] = useState(profile?.gender || '');
  const [fitnessGoal, setFitnessGoal] = useState(profile?.fitness_goal || '');
  const [preferredTiming, setPreferredTiming] = useState(profile?.preferred_gym_timing || '');
  const [emergencyName, setEmergencyName] = useState(profile?.emergency_contact_name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergency_contact_phone || '');
  // Photos saved before Storage uploads existed are dead local paths — ignore
  // them so the avatar shows initials rather than a broken image.
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    isLocalFileUri(profile?.photo_url) ? null : profile?.photo_url || null
  );
  const [pendingPhotoAsset, setPendingPhotoAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Sync profile data when loaded
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
      setDateOfBirth(profile.date_of_birth || '');
      setGender(profile.gender || '');
      setFitnessGoal(profile.fitness_goal || '');
      setPreferredTiming(profile.preferred_gym_timing || '');
      setEmergencyName(profile.emergency_contact_name || '');
      setEmergencyPhone(profile.emergency_contact_phone || '');
      // Same guard as the initial state: don't resurrect a dead local path.
      setPhotoUrl(isLocalFileUri(profile.photo_url) ? null : profile.photo_url || null);
    }
  }, [profile]);

  // Check if any changes were made
  const hasChanges = useMemo(() => {
    if (!profile) return false;
    return (
      fullName !== (profile.full_name || '') ||
      phone !== (profile.phone || '') ||
      dateOfBirth !== (profile.date_of_birth || '') ||
      gender !== (profile.gender || '') ||
      fitnessGoal !== (profile.fitness_goal || '') ||
      preferredTiming !== (profile.preferred_gym_timing || '') ||
      emergencyName !== (profile.emergency_contact_name || '') ||
      emergencyPhone !== (profile.emergency_contact_phone || '') ||
      photoUrl !== (profile.photo_url || null)
    );
  }, [
    profile,
    fullName,
    phone,
    dateOfBirth,
    gender,
    fitnessGoal,
    preferredTiming,
    emergencyName,
    emergencyPhone,
    photoUrl,
  ]);

  const handlePickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera roll access is needed to change your photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        // Needed to upload without expo-file-system (see lib/storage.ts).
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]?.uri) {
        // Preview locally; uploaded on save.
        setPhotoUrl(result.assets[0].uri);
        setPendingPhotoAsset(result.assets[0]);
      }
    } catch (err) {
      console.error('[Profile] Error picking photo:', err);
      Alert.alert('Error', 'Failed to pick photo.');
    }
  };

  const handleSaveProfile = async () => {
    if (!profile?.id) return;
    if (!fullName.trim()) {
      Alert.alert('Required Field', 'Please enter your full name.');
      return;
    }

    setIsSaving(true);
    try {
      // Upload a newly picked photo and store its public URL, not the local path.
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
          console.error('[Profile] Photo upload failed:', uploadErr);
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
          date_of_birth: dateOfBirth.trim() || null,
          gender: gender || null,
          fitness_goal: fitnessGoal || null,
          preferred_gym_timing: preferredTiming || null,
          emergency_contact_name: emergencyName.trim() || null,
          emergency_contact_phone: emergencyPhone.trim() || null,
          photo_url: photoUrlToSave || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);

      if (error) throw error;

      await refreshProfile();
      Alert.alert('Success', 'Profile updated successfully.');
    } catch (err: any) {
      console.error('[Profile] Error updating profile:', err);
      Alert.alert('Update Failed', err.message || 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
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
            console.error('[Profile] Sign out error:', err);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Profile & Settings</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Manage your personal fitness details and preferences
          </Text>
        </View>

        {/* Profile Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={handlePickPhoto}
            style={styles.avatarWrap}
            activeOpacity={0.8}
          >
            <Avatar uri={photoUrl} name={fullName || 'Member'} size={96} />
            <View style={[styles.cameraBadge, { backgroundColor: colors.primary }]}>
              <Ionicons name="camera" size={18} color="#000000" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>
            {profile?.email}
          </Text>
          <Text style={[styles.gymBadgeText, { color: colors.primary }]}>
            {currentMembership?.gym?.name || 'Active Member'}
          </Text>
        </View>

        {/* Personal Details Section */}
        <Card style={styles.sectionCard} padding={16}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Personal Details
          </Text>

          <Input
            label="Full Name *"
            placeholder="John Doe"
            value={fullName}
            onChangeText={setFullName}
            leftIcon={<Ionicons name="person-outline" size={18} color={colors.textSecondary} />}
          />

          <Input
            label="Email Address"
            value={profile?.email || ''}
            onChangeText={() => {}}
            editable={false}
            leftIcon={<Ionicons name="mail-outline" size={18} color={colors.textSecondary} />}
          />

          <Input
            label="Phone Number"
            placeholder="+91 9876543210"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            leftIcon={<Ionicons name="call-outline" size={18} color={colors.textSecondary} />}
          />

          <Input
            label="Date of Birth (YYYY-MM-DD)"
            placeholder="1995-08-15"
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            leftIcon={<Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />}
          />

          {/* Gender Selector */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Gender</Text>
          <View style={styles.chipRow}>
            {GENDER_OPTIONS.map((g) => {
              const isSelected = gender === g.value;
              return (
                <TouchableOpacity
                  key={g.value}
                  style={[
                    styles.chipButton,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setGender(g.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: isSelected ? '#000000' : colors.textSecondary },
                    ]}
                  >
                    {g.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Fitness Preferences Section */}
        <Card style={styles.sectionCard} padding={16}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Fitness Goals & Timing
          </Text>

          {/* Fitness Goal */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Primary Fitness Goal
          </Text>
          <View style={styles.chipWrapRow}>
            {FITNESS_GOALS.map((goal) => {
              const isSelected = fitnessGoal === goal.value;
              return (
                <TouchableOpacity
                  key={goal.value}
                  style={[
                    styles.chipButton,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setFitnessGoal(goal.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: isSelected ? '#000000' : colors.textSecondary },
                    ]}
                  >
                    {goal.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Preferred Timing */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 12 }]}>
            Preferred Gym Timing
          </Text>
          <View style={styles.chipRow}>
            {TIMING_SLOTS.map((slot) => {
              const isSelected = preferredTiming === slot.value;
              return (
                <TouchableOpacity
                  key={slot.value}
                  style={[
                    styles.chipButton,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setPreferredTiming(slot.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: isSelected ? '#000000' : colors.textSecondary },
                    ]}
                  >
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Emergency Contact Section */}
        <Card style={styles.sectionCard} padding={16}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Emergency Contact
          </Text>

          <Input
            label="Contact Person Name"
            placeholder="e.g. Sarah Smith"
            value={emergencyName}
            onChangeText={setEmergencyName}
            leftIcon={<Ionicons name="heart-outline" size={18} color={colors.textSecondary} />}
          />

          <Input
            label="Emergency Contact Phone"
            placeholder="+91 9876543210"
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            keyboardType="phone-pad"
            leftIcon={<Ionicons name="call-outline" size={18} color={colors.textSecondary} />}
          />
        </Card>

        {/* App Settings / Theme Toggle */}
        <Card style={styles.sectionCard} padding={16}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Preferences
          </Text>

          <View style={styles.themeToggleRow}>
            <View style={styles.themeInfo}>
              <Ionicons
                name={isDark ? 'moon-outline' : 'sunny-outline'}
                size={22}
                color={colors.primary}
              />
              <View style={styles.themeTextWrap}>
                <Text style={[styles.themeTitle, { color: colors.text }]}>
                  Dark Theme
                </Text>
                <Text style={[styles.themeSub, { color: colors.textSecondary }]}>
                  {isDark ? 'Dark mode enabled' : 'Light mode enabled'}
                </Text>
              </View>
            </View>

            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: '#767577', true: colors.primaryLight }}
              thumbColor={isDark ? colors.primary : '#f4f3f4'}
            />
          </View>
        </Card>

        {/* Save Button (when changes detected) */}
        {hasChanges && (
          <View style={styles.saveContainer}>
            <Button
              title="Save Changes"
              onPress={handleSaveProfile}
              variant="primary"
              size="lg"
              loading={isSaving}
              fullWidth
              icon={<Ionicons name="save-outline" size={20} color="#000000" />}
            />
          </View>
        )}

        {/* Sign Out Button */}
        <View style={styles.signOutContainer}>
          <Button
            title="Sign Out"
            onPress={handleSignOut}
            variant="danger"
            size="lg"
            fullWidth
            icon={<Ionicons name="log-out-outline" size={20} color="#FFFFFF" />}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  profileEmail: {
    fontSize: 14,
    marginBottom: 4,
  },
  gymBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCard: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chipButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  themeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeTextWrap: {
    gap: 2,
  },
  themeTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  themeSub: {
    fontSize: 12,
  },
  saveContainer: {
    marginBottom: 14,
  },
  signOutContainer: {
    marginTop: 6,
    marginBottom: 16,
  },
});
