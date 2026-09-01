import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
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
import {
  parseOperatingHours,
  summarizeOperatingHours,
} from '../../utils/operating-hours';

export default function GymSettingsScreen() {
  const router = useRouter();
  const { gymId, profile, userId, currentMembership, supabase, refreshMembership, signOut } =
    useAppAuth();
  const { colors, isDark, mode, setMode } = useTheme();

  // Gym details state
  const [gymName, setGymName] = useState('');
  const [gymAddress, setGymAddress] = useState('');
  const [description, setDescription] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [amenities, setAmenities] = useState<string[]>([]);
  const [amenityDraft, setAmenityDraft] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [pendingLogo, setPendingLogo] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  // Read-only here: the seven-day grid lives on its own screen because it is
  // far too tall to sit inside this one.
  const [hoursSummary, setHoursSummary] = useState('');

  const [loadingGym, setLoadingGym] = useState(true);
  const [savingGym, setSavingGym] = useState(false);

  // What the gym row held when it was last read or written. There is no live
  // gym object in context to diff against the way the profile screens do, so
  // the saved state has to be snapshotted explicitly.
  const [baseline, setBaseline] = useState({
    gymName: '',
    gymAddress: '',
    description: '',
    contactPhone: '',
    contactEmail: '',
    amenities: '[]',
    logoUrl: null as string | null,
  });


  const fetchGymDetails = useCallback(async () => {
    if (!gymId) return;

    setLoadingGym(true);
    try {
      const { data, error } = await supabase
        .from('gyms')
        .select('*')
        .eq('id', gymId)
        .single();

      if (error) {
        console.error('[Settings] Fetch gym error:', error);
        return;
      }

      if (data) {
        setGymName(data.name || '');
        setGymAddress(data.address || '');
        setDescription(data.description || '');
        setContactPhone(data.contact_phone || '');
        setContactEmail(data.contact_email || '');
        setAmenities(Array.isArray(data.amenities) ? data.amenities : []);
        setLogoUrl(data.logo_url || null);
        setJoinCode(data.join_code || null);

        setBaseline({
          gymName: data.name || '',
          gymAddress: data.address || '',
          description: data.description || '',
          contactPhone: data.contact_phone || '',
          contactEmail: data.contact_email || '',
          amenities: JSON.stringify(Array.isArray(data.amenities) ? data.amenities : []),
          logoUrl: data.logo_url || null,
        });

        // Rendered from the stored document rather than from the persisted
        // `summary` string, so a hand-edited or stale summary can't disagree
        // with the hours members actually see.
        const parsed = parseOperatingHours(data.operating_hours);
        setHoursSummary(
          parsed.hours ? summarizeOperatingHours(parsed.hours) : parsed.legacySummary || ''
        );
      }
    } catch (err) {
      console.error('[Settings] Unexpected error:', err);
    } finally {
      setLoadingGym(false);
    }
  }, [gymId, supabase]);

  useEffect(() => {
    fetchGymDetails();
  }, [fetchGymDetails]);

  // Returning from the Opening Hours screen has to re-read the summary, or the
  // row underneath keeps showing the hours from before the save.
  //
  // Deliberately NOT a full fetchGymDetails(): that rewrites every form field,
  // so a phone number typed but not yet saved would be silently discarded by
  // a trip to the hours screen and back.
  const fetchHoursSummary = useCallback(async () => {
    if (!gymId) return;
    try {
      const { data, error } = await supabase
        .from('gyms')
        .select('operating_hours')
        .eq('id', gymId)
        .single();

      if (error) {
        console.warn('[Settings] Hours summary refresh:', error.message);
        return;
      }

      const parsed = parseOperatingHours(data?.operating_hours);
      setHoursSummary(
        parsed.hours ? summarizeOperatingHours(parsed.hours) : parsed.legacySummary || ''
      );
    } catch (err) {
      console.warn('[Settings] Hours summary error:', err);
    }
  }, [gymId, supabase]);

  useFocusEffect(
    useCallback(() => {
      fetchHoursSummary();
    }, [fetchHoursSummary])
  );

  // Both save buttons write the whole gym row, so one flag governs both —
  // they appear and disappear together, which is honest about the fact that
  // they are the same action.
  const hasGymChanges = useMemo(
    () =>
      gymName.trim() !== baseline.gymName ||
      gymAddress.trim() !== baseline.gymAddress ||
      description.trim() !== baseline.description ||
      contactPhone.trim() !== baseline.contactPhone ||
      contactEmail.trim() !== baseline.contactEmail ||
      JSON.stringify(amenities) !== baseline.amenities ||
      logoUrl !== baseline.logoUrl,
    [
      gymName,
      gymAddress,
      description,
      contactPhone,
      contactEmail,
      amenities,
      logoUrl,
      baseline,
    ]
  );

  const handlePickLogo = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'Allow photo library access to set a gym logo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        // base64 because the native file read isn't available — same
        // constraint as the profile photo upload.
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      // Uploaded on save, not now, so abandoning the screen leaves no orphan
      // object in the bucket.
      setPendingLogo(result.assets[0]);
      setLogoUrl(result.assets[0].uri);
    } catch (err) {
      console.error('[Settings] Logo pick error:', err);
      Alert.alert('Error', 'Could not open the photo library.');
    }
  }, []);

  const addAmenity = () => {
    const value = amenityDraft.trim();
    if (!value) return;

    // Case-insensitive so "Parking" and "parking" don't both end up as chips.
    if (amenities.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setAmenityDraft('');
      return;
    }
    if (amenities.length >= 20) {
      Alert.alert('That is plenty', 'You can list up to 20 facilities.');
      return;
    }
    const tidied = value.charAt(0).toUpperCase() + value.slice(1);
    setAmenities((prev) => [...prev, tidied]);
    setAmenityDraft('');
  };

  const removeAmenity = (value: string) => {
    setAmenities((prev) => prev.filter((a) => a !== value));
  };

  const handleSaveGymInfo = async () => {
    if (!gymName.trim()) {
      Alert.alert('Required', 'Please enter a valid gym name.');
      return;
    }

    const email = contactEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Check the email', 'Enter a valid contact email, or leave it blank.');
      return;
    }

    if (!gymId || !userId) return;

    setSavingGym(true);
    try {
      let logoToSave = logoUrl;

      if (pendingLogo) {
        logoToSave = await uploadImageAsset(supabase, 'gym-logos', userId, pendingLogo);
      } else if (isLocalFileUri(logoUrl)) {
        // A file:// URI would resolve for nobody but this device.
        logoToSave = null;
      }

      // operating_hours is deliberately absent: it belongs to the hours screen,
      // and including it here would overwrite the seven-day document with
      // whatever this screen last happened to hold.
      const { error } = await supabase
        .from('gyms')
        .update({
          name: gymName.trim(),
          address: gymAddress.trim() || null,
          description: description.trim() || null,
          contact_phone: contactPhone.trim() || null,
          contact_email: email || null,
          amenities,
          logo_url: logoToSave,
          updated_at: new Date().toISOString(),
        })
        .eq('id', gymId);

      if (error) throw error;

      setPendingLogo(null);
      setLogoUrl(logoToSave);
      setBaseline({
        gymName: gymName.trim(),
        gymAddress: gymAddress.trim(),
        description: description.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: email,
        amenities: JSON.stringify(amenities),
        logoUrl: logoToSave,
      });
      await refreshMembership();
      Alert.alert('Settings Saved', 'Gym information has been updated.');
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not update gym settings.');
    } finally {
      setSavingGym(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(auth)/sign-in');
            } catch (err) {
              console.error('[Settings] Sign out error:', err);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Gym Settings
        </Text>

        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Owner account. Tappable, because until now the owner was the one
            person in the app who could not edit their own name or photo — and
            members see both on the gym info screen. */}
        <Card
          padding={16}
          style={styles.accountCard}
          onPress={() => router.push('/(owner)/profile')}
        >
          <View style={styles.accountRow}>
            <Avatar
              uri={profile?.photo_url}
              name={profile?.full_name || 'Owner'}
              size={56}
            />
            <View style={styles.accountInfo}>
              <Text style={[styles.accountName, { color: colors.text }]}>
                {profile?.full_name || 'Gym Owner'}
              </Text>
              <Text style={[styles.accountEmail, { color: colors.textSecondary }]}>
                {profile?.email}
              </Text>
              <View style={styles.badgeRow}>
                <Badge text="OWNER" variant="warning" size="sm" />
                <Badge text="ADMINISTRATOR" variant="default" size="sm" />
              </View>
            </View>
            <View style={styles.editHint}>
              <Ionicons name="create-outline" size={18} color={colors.primary} />
              <Text style={[styles.editHintText, { color: colors.primary }]}>Edit</Text>
            </View>
          </View>
        </Card>

        {/* Gym Information Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Gym Profile & Information
          </Text>
        </View>

        <Card padding={18} style={styles.sectionCard}>
          {loadingGym ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 20 }} />
          ) : (
            <>
              {/* The gym-logos bucket and its storage policies have existed
                  since migration 004, which noted "upload UI is not built
                  yet". This is that UI. */}
              <TouchableOpacity
                onPress={handlePickLogo}
                activeOpacity={0.8}
                style={styles.logoPicker}
              >
                <Avatar uri={logoUrl} name={gymName || 'Gym'} size={72} shape="rounded" />
                <View style={styles.logoPickerText}>
                  <Text style={[styles.logoPickerTitle, { color: colors.text }]}>
                    Gym Logo
                  </Text>
                  <Text style={[styles.logoPickerHint, { color: colors.textSecondary }]}>
                    {logoUrl ? 'Tap to replace' : 'Tap to upload'} — shown to members
                  </Text>
                </View>
                <Ionicons name="image-outline" size={20} color={colors.primary} />
              </TouchableOpacity>

              <Input
                label="Gym Name"
                placeholder="e.g. Iron Forge Gym"
                value={gymName}
                onChangeText={setGymName}
              />

              <Input
                label="Gym Address / Location"
                placeholder="e.g. 123 Fitness St, Sector 4, Bangalore"
                value={gymAddress}
                onChangeText={setGymAddress}
                multiline
                numberOfLines={2}
              />

              <Input
                label="About the gym"
                placeholder="A short description your members will see"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
              />

              <Input
                label="Contact Phone"
                placeholder="Number members can call"
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
              />

              <Input
                label="Contact Email"
                placeholder="Email members can write to"
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {hasGymChanges ? (
                <Button
                  title="Save Gym Info"
                  variant="primary"
                  loading={savingGym}
                  onPress={handleSaveGymInfo}
                  fullWidth
                  icon={<Ionicons name="save-outline" size={18} color="#000000" />}
                  style={{ marginTop: 4 }}
                />
              ) : null}
            </>
          )}
        </Card>

        {/* QR Code & Tools Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Gym Tools & QR
          </Text>
        </View>

        <Card padding={16} style={styles.sectionCard}>
          <TouchableOpacity
            style={[styles.toolRow, { borderBottomColor: colors.divider }]}
            onPress={() => router.push('/(owner)/qr-code')}
            activeOpacity={0.7}
          >
            <View style={[styles.toolIconCircle, { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.15)' : 'rgba(0, 200, 83, 0.12)' }]}>
              <Ionicons name="qr-code-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={[styles.toolTitle, { color: colors.text }]}>
                Check-In QR Code
              </Text>
              <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]}>
                Show or print the code members scan to mark attendance
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolRow, { borderBottomColor: colors.divider }]}
            onPress={() => router.push('/(owner)/plans')}
            activeOpacity={0.7}
          >
            <View style={[styles.toolIconCircle, { backgroundColor: isDark ? 'rgba(68, 138, 255, 0.15)' : 'rgba(25, 118, 210, 0.12)' }]}>
              <Ionicons name="pricetags-outline" size={22} color={colors.info} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={[styles.toolTitle, { color: colors.text }]}>
                Membership Plans
              </Text>
              <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]}>
                Configure prices, duration packages, and active plans
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolRow, { borderBottomColor: colors.divider }]}
            onPress={() => router.push('/(owner)/gym-hours')}
            activeOpacity={0.7}
          >
            <View style={[styles.toolIconCircle, { backgroundColor: isDark ? 'rgba(255, 171, 0, 0.15)' : 'rgba(245, 124, 0, 0.12)' }]}>
              <Ionicons name="time-outline" size={22} color={colors.warning} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={[styles.toolTitle, { color: colors.text }]}>
                Opening Hours
              </Text>
              <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                {hoursSummary || 'Not set — members can\u2019t tell when you\u2019re open'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Members used to join by pasting the gym's raw UUID from here, which
              meant the owner had to be reachable for every signup. The six
              character join code (migration 030) replaces it; the invite screen
              is a printable poster carrying both the code and its QR. The raw
              UUID is no longer surfaced -- nothing should be asking for it now --
              but the join screen still accepts one, so anybody the owner already
              sent it to is not stranded. */}
          <TouchableOpacity
            style={[styles.toolRow, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/(owner)/invite')}
            activeOpacity={0.7}
          >
            <View style={[styles.toolIconCircle, { backgroundColor: isDark ? 'rgba(255, 171, 0, 0.15)' : 'rgba(245, 124, 0, 0.12)' }]}>
              <Ionicons name="key-outline" size={22} color={colors.warning} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={[styles.toolTitle, { color: colors.text }]}>
                Invite Members
              </Text>
              <Text style={[styles.joinCodeValue, { color: colors.primary }]} selectable>
                {joinCode || '------'}
              </Text>
              <Text style={[styles.toolSubtitle, { color: colors.textTertiary }]}>
                Share the code or print the QR poster
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </Card>

        {/* Facilities */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Facilities & Amenities
          </Text>
        </View>

        <Card padding={16} style={styles.sectionCard}>
          <Text style={[styles.facilitiesHint, { color: colors.textSecondary }]}>
            Listed on your members' gym info screen. Add whatever your gym has —
            parking, showers, steam room, personal training.
          </Text>

          <View style={styles.amenityInputRow}>
            <View style={styles.amenityInputField}>
              <Input
                placeholder="e.g. Showers"
                value={amenityDraft}
                onChangeText={setAmenityDraft}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={addAmenity}
              />
            </View>
            <TouchableOpacity
              onPress={addAmenity}
              activeOpacity={0.8}
              style={[
                styles.amenityAddButton,
                { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
              ]}
            >
              <Ionicons name="add" size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {amenities.length === 0 ? (
            <Text style={[styles.amenityEmpty, { color: colors.textTertiary }]}>
              Nothing added yet.
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {amenities.map((item) => (
                <View
                  key={item}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isDark ? 'rgba(0, 230, 118, 0.10)' : 'rgba(0, 200, 83, 0.08)',
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: colors.text }]}>{item}</Text>
                  <TouchableOpacity
                    onPress={() => removeAmenity(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Facilities save with the rest of the gym profile, so say so
              rather than letting the owner assume a chip is already stored. */}
          {hasGymChanges ? (
            <Button
              title="Save Facilities"
              variant="outline"
              size="sm"
              loading={savingGym}
              onPress={handleSaveGymInfo}
              fullWidth
              style={{ marginTop: 14 }}
            />
          ) : null}
        </Card>

        {/* Appearance / Theme Toggle */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Theme & Appearance
          </Text>
        </View>

        <Card padding={16} style={styles.sectionCard}>
          <View style={styles.themeSelector}>
            {(['dark', 'light', 'system'] as const).map((t) => {
              const isSelected = mode === t;
              const iconName =
                t === 'dark'
                  ? 'moon-outline'
                  : t === 'light'
                  ? 'sunny-outline'
                  : 'phone-portrait-outline';
              const label = t.charAt(0).toUpperCase() + t.slice(1);

              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.themeOption,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setMode(t)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={iconName}
                    size={20}
                    color={isSelected ? '#000000' : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.themeOptionText,
                      { color: isSelected ? '#000000' : colors.textSecondary },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Sign Out Button */}
        <View style={styles.signOutSection}>
          <Button
            title="Sign Out"
            variant="danger"
            size="lg"
            icon={<Ionicons name="log-out-outline" size={20} color="#FFFFFF" />}
            onPress={handleSignOut}
            fullWidth
          />
        </View>
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  editHint: { alignItems: 'center', gap: 2 },
  editHintText: { fontSize: 11, fontWeight: '700' },
  logoPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  logoPickerText: { flex: 1 },
  logoPickerTitle: { fontSize: 15, fontWeight: '700' },
  logoPickerHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  facilitiesHint: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
  amenityInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  amenityInputField: { flex: 1 },
  amenityAddButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amenityEmpty: { fontSize: 12, marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  joinCodeValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
    marginVertical: 2,
  },
  gymIdValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 2,
    marginBottom: 2,
  },
  screen: {
    flex: 1,
  },
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  accountCard: {
    borderRadius: 16,
    marginBottom: 20,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 18,
    fontWeight: '700',
  },
  accountEmail: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sectionHeader: {
    marginBottom: 8,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionCard: {
    borderRadius: 16,
    marginBottom: 16,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  toolIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  toolInfo: {
    flex: 1,
    marginRight: 8,
  },
  toolTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  toolSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  themeSelector: {
    flexDirection: 'row',
    gap: 10,
  },
  themeOption: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  themeOptionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  signOutSection: {
    marginTop: 16,
    marginBottom: 20,
  },
});
