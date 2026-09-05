import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { uploadImageAssetToPath } from '../../../lib/storage';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../../constants/keyboard';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

/**
 * Registering a walk-in member at the desk.
 *
 * Most gym members will never download an app, and until migration 037 they
 * therefore did not exist in the system at all — the owner could not record
 * their payment, see their dues or count them anywhere, so he ran the app and a
 * notebook side by side. This is the flow that makes the app the single record.
 *
 * Two deliberate choices about the photo:
 *
 *   - It is offered but never required. The whole promise of this screen is
 *     "ten seconds at the desk"; a mandatory photo breaks that the first time
 *     somebody is in a hurry, and staff quietly stop using the flow.
 *   - The member is created FIRST and the photo attached after. Gym wifi drops,
 *     and losing a paying member's record because an upload failed would be far
 *     worse than saving them without a picture.
 *
 * The photo matters more here than it does for an app user's avatar: for a
 * member with no login it is the identity. Two people called Rahul, a wrong
 * digit in a phone number, someone saying "put it on my account" — a face is how
 * whoever is at the desk matches the person to the right record before taking
 * money.
 */
export default function AddMemberScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { supabase, gymId, userId } = useAppAuth();
  const { colors } = useTheme();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    // Needed to upload without expo-file-system (see lib/storage.ts).
    base64: true,
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Permission Needed',
          'We need the camera to photograph the member. You can also add them without a photo.'
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync(pickerOptions);
      if (!result.canceled && result.assets?.[0]) setPhoto(result.assets[0]);
    } catch (err) {
      console.error('[AddMember] Camera error:', err);
      Alert.alert('Error', 'Could not open the camera.');
    }
  };

  const chooseFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'We need access to your photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (!result.canceled && result.assets?.[0]) setPhoto(result.assets[0]);
    } catch (err) {
      console.error('[AddMember] Library error:', err);
      Alert.alert('Error', 'Could not open your photos.');
    }
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      setNameError('Enter the member’s name');
      return;
    }
    setNameError('');
    if (!gymId) return;

    setSaving(true);
    try {
      // 1. The record first. Everything else is optional decoration on top.
      const { data: created, error } = await supabase.rpc('create_managed_member', {
        p_gym_id: gymId,
        p_full_name: fullName.trim(),
        p_phone: phone.trim() || null,
        p_photo_url: null,
      });

      if (error) throw error;

      const gymMemberId = (created as any)?.id;

      // 2. Then the photo, deliberately after the member is safely saved. A
      //    failed upload downgrades to "member added without a photo" rather
      //    than losing them.
      if (photo && gymMemberId && userId) {
        try {
          const url = await uploadImageAssetToPath(
            supabase,
            'profile-photos',
            userId,
            photo
          );
          await supabase.rpc('update_managed_member', {
            p_gym_member_id: gymMemberId,
            p_full_name: fullName.trim(),
            p_phone: phone.trim() || null,
            p_photo_url: url,
          });
        } catch (uploadErr) {
          console.warn('[AddMember] Photo upload failed:', uploadErr);
          Alert.alert(
            'Member added, photo did not upload',
            `${fullName.trim()} was saved. You can add their photo later from their profile.`
          );
          router.replace(`/(owner)/members/${gymMemberId}`);
          return;
        }
      }

      Alert.alert(
        'Member added',
        `${fullName.trim()} is on your list. Record their payment next.`,
        [{ text: 'OK', onPress: () => router.replace(`/(owner)/members/${gymMemberId}`) }]
      );
    } catch (err: any) {
      console.error('[AddMember] Save error:', err);
      Alert.alert('Could not add member', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>Add Member</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              For members who joined at the gym, with or without the app
            </Text>
          </View>
        </View>

        {/* Photo */}
        <View style={styles.photoBlock}>
          <TouchableOpacity onPress={takePhoto} activeOpacity={0.8}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.photo} />
            ) : (
              <View style={[styles.photoPlaceholder, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                <Ionicons name="camera" size={30} color={colors.primary} />
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.photoActions}>
            <TouchableOpacity onPress={takePhoto} activeOpacity={0.7}>
              <Text style={[styles.photoAction, { color: colors.primary }]}>
                {photo ? 'Retake photo' : 'Take photo'}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.photoDivider, { color: colors.textTertiary }]}>·</Text>
            <TouchableOpacity onPress={chooseFromLibrary} activeOpacity={0.7}>
              <Text style={[styles.photoAction, { color: colors.textSecondary }]}>Choose</Text>
            </TouchableOpacity>
            {photo ? (
              <>
                <Text style={[styles.photoDivider, { color: colors.textTertiary }]}>·</Text>
                <TouchableOpacity onPress={() => setPhoto(null)} activeOpacity={0.7}>
                  <Text style={[styles.photoAction, { color: colors.error }]}>Remove</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>

          <Text style={[styles.photoHint, { color: colors.textTertiary }]}>
            Optional, but it makes people much easier to identify at the desk
          </Text>
        </View>

        <Card padding={16} style={styles.card}>
          <Input
            label="Full Name *"
            placeholder="e.g. Ramesh Kumar"
            value={fullName}
            onChangeText={(t) => {
              setFullName(t);
              if (nameError) setNameError('');
            }}
            error={nameError}
            autoCapitalize="words"
          />

          <Input
            label="Phone Number"
            placeholder="e.g. 98765 43210"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </Card>

        <View
          style={[
            styles.notice,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <Ionicons name="information-circle-outline" size={18} color={colors.info} />
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            This member has no app login yet, so they will not receive
            notifications and cannot scan the check-in QR. You can give them a
            claim code later to link the app to this record.
          </Text>
        </View>

        <Button
          title={saving ? 'Adding...' : 'Add Member'}
          onPress={handleSave}
          variant="primary"
          size="lg"
          fullWidth
          loading={saving}
          icon={saving ? undefined : <Ionicons name="person-add" size={20} color="#000000" />}
        />

        {saving ? (
          <View style={styles.savingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.savingText, { color: colors.textSecondary }]}>
              Saving the member first, photo after
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  photoBlock: { alignItems: 'center', marginBottom: 20 },
  photo: { width: 104, height: 104, borderRadius: 52 },
  photoPlaceholder: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  photoAction: { fontSize: 14, fontWeight: '700' },
  photoDivider: { fontSize: 14 },
  photoHint: { fontSize: 12, marginTop: 6, textAlign: 'center' },
  card: { marginBottom: 16 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  savingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  savingText: { fontSize: 12 },
});
