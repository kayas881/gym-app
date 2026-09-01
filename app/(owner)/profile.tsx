import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import { uploadImageAsset, isLocalFileUri } from '../../lib/storage';

/**
 * The owner's own profile.
 *
 * Deliberately not a reuse of (member)/profile.tsx: half of that screen is
 * fitness goal, health notes and emergency contact, which belong to somebody
 * training at the gym, not to the person running it. What the owner needs is
 * the opposite — the name, photo, phone and email that members see on the gym
 * info screen when they want to reach whoever is in charge.
 */
export default function OwnerProfileScreen() {
  const router = useRouter();
  const { profile, userId, supabase, refreshProfile } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || '');
    setPhone(profile.phone || '');
    setEmail(profile.email || '');
    setAddress(profile.address || '');
    setPhotoUrl(profile.photo_url || null);
  }, [profile]);

  // Same idiom as (member)/profile.tsx: diff the fields against the loaded
  // profile rather than tracking a dirty flag, so saving (which refreshes
  // `profile`) clears it automatically.
  const hasChanges = useMemo(() => {
    if (!profile) return false;
    return (
      fullName.trim() !== (profile.full_name || '') ||
      phone.trim() !== (profile.phone || '') ||
      address.trim() !== (profile.address || '') ||
      photoUrl !== (profile.photo_url || null)
    );
  }, [profile, fullName, phone, address, photoUrl]);

  const handlePickPhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Allow photo library access to change your profile picture.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        // The upload path reads base64 — expo-file-system's native read is not
        // available here. Same reason as (member)/profile.tsx.
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      // Held locally and uploaded on save, so backing out of the screen does
      // not leave an orphaned object in the bucket.
      setPendingPhoto(result.assets[0]);
      setPhotoUrl(result.assets[0].uri);
    } catch (err) {
      console.error('[OwnerProfile] Photo pick error:', err);
      Alert.alert('Error', 'Could not open the photo library.');
    }
  }, []);

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    if (!profile?.id || !userId) return;

    setSaving(true);
    try {
      let photoUrlToSave = photoUrl;

      if (pendingPhoto) {
        photoUrlToSave = await uploadImageAsset(
          supabase,
          'profile-photos',
          userId,
          pendingPhoto
        );
      } else if (isLocalFileUri(photoUrl)) {
        // A file:// URI from a previous session would 404 for every member.
        photoUrlToSave = null;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          photo_url: photoUrlToSave,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);

      if (error) throw error;

      setPendingPhoto(null);
      setPhotoUrl(photoUrlToSave);
      await refreshProfile();
      Alert.alert('Profile Saved', 'Your details have been updated.');
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior="padding"
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Card padding={20} style={styles.photoCard}>
          <TouchableOpacity onPress={handlePickPhoto} activeOpacity={0.8} style={styles.photoWrap}>
            <Avatar uri={photoUrl} name={fullName || 'Owner'} size={96} />
            <View
              style={[
                styles.cameraBadge,
                { backgroundColor: colors.primary, borderColor: colors.background },
              ]}
            >
              <Ionicons name="camera" size={16} color="#000000" />
            </View>
          </TouchableOpacity>

          <Text style={[styles.photoHint, { color: colors.textSecondary }]}>
            Tap to change your photo. Members see this on the gym info screen.
          </Text>

          <View style={styles.badgeRow}>
            <Badge text="OWNER" variant="warning" size="sm" />
            <Badge text="ADMINISTRATOR" variant="default" size="sm" />
          </View>
        </Card>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Details</Text>

        <Card padding={16}>
          <Input
            label="Full Name *"
            placeholder="Your name"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          <Input
            label="Phone"
            placeholder="Contact number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Input
            label="Address"
            placeholder="Your address"
            value={address}
            onChangeText={setAddress}
            multiline
            numberOfLines={2}
          />

          {/* Email comes from the Clerk account, so editing it here would put
              profiles.email out of step with the identity used to sign in. */}
          <Input
            label="Email (from your sign-in account)"
            placeholder="Email"
            value={email}
            onChangeText={() => {}}
            editable={false}
          />
        </Card>

        <View
          style={[
            styles.visibilityNote,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <Ionicons name="eye-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.visibilityText, { color: colors.textSecondary }]}>
            Your name, photo, phone and email are shown to your members so they
            know who runs the gym and how to reach you. Your address is not.
          </Text>
        </View>

        {hasChanges ? (
          <Button
            title="Save Profile"
            variant="primary"
            loading={saving}
            onPress={handleSave}
            fullWidth
            icon={<Ionicons name="save-outline" size={18} color="#000000" />}
            style={{ marginTop: 16 }}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 48 },
  photoCard: { borderRadius: 16, alignItems: 'center', marginBottom: 18 },
  photoWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 17,
  },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  visibilityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  visibilityText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
