import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';

export default function GymSettingsScreen() {
  const router = useRouter();
  const { gymId, profile, currentMembership, supabase, refreshMembership, signOut } = useAppAuth();
  const { colors, isDark, mode, setMode } = useTheme();

  // Gym details state
  const [gymName, setGymName] = useState('');
  const [gymAddress, setGymAddress] = useState('');
  const [operatingHours, setOperatingHours] = useState('');
  const [loadingGym, setLoadingGym] = useState(true);
  const [savingGym, setSavingGym] = useState(false);

  // QR Modal state (Phase 3 placeholder)
  const [qrModalVisible, setQrModalVisible] = useState(false);

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
        if (data.operating_hours) {
          if (typeof data.operating_hours === 'string') {
            setOperatingHours(data.operating_hours);
          } else if (typeof data.operating_hours === 'object' && data.operating_hours.summary) {
            setOperatingHours(data.operating_hours.summary);
          } else {
            setOperatingHours(JSON.stringify(data.operating_hours));
          }
        }
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

  const handleSaveGymInfo = async () => {
    if (!gymName.trim()) {
      Alert.alert('Required', 'Please enter a valid gym name.');
      return;
    }

    if (!gymId) return;

    setSavingGym(true);
    try {
      const { error } = await supabase
        .from('gyms')
        .update({
          name: gymName.trim(),
          address: gymAddress.trim() || null,
          operating_hours: operatingHours.trim() ? { summary: operatingHours.trim() } : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', gymId);

      if (error) throw error;

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
        {/* Owner Account Card */}
        <Card padding={16} style={styles.accountCard}>
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
                label="Operating Hours"
                placeholder="e.g. Mon-Sat: 6:00 AM - 10:00 PM, Sun: 7:00 AM - 1:00 PM"
                value={operatingHours}
                onChangeText={setOperatingHours}
                multiline
                numberOfLines={2}
              />

              <Button
                title="Save Gym Info"
                variant="primary"
                loading={savingGym}
                onPress={handleSaveGymInfo}
                style={{ marginTop: 4 }}
              />
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
            onPress={() => setQrModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.toolIconCircle, { backgroundColor: isDark ? 'rgba(0, 230, 118, 0.15)' : 'rgba(0, 200, 83, 0.12)' }]}>
              <Ionicons name="qr-code-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={[styles.toolTitle, { color: colors.text }]}>
                Generate Gym QR Code
              </Text>
              <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]}>
                Show QR for easy member registration and attendance check-in
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolRow, { borderBottomWidth: 0 }]}
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

      {/* QR Code Modal Placeholder */}
      <Modal
        visible={qrModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setQrModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.qrModalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.qrHeader}>
              <Text style={[styles.qrTitle, { color: colors.text }]}>
                {gymName || 'Gym'} QR Code
              </Text>
              <TouchableOpacity
                onPress={() => setQrModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.qrPlaceholderBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
              <Ionicons name="qr-code" size={140} color={colors.primary} />
              <Text style={[styles.qrGymName, { color: colors.text }]}>
                {gymName}
              </Text>
              <Text style={[styles.qrGymId, { color: colors.textTertiary }]}>
                GYM ID: {gymId}
              </Text>
            </View>

            <Text style={[styles.qrNote, { color: colors.textSecondary }]}>
              Members can scan this code to connect directly with your gym during sign-up or check-in.
            </Text>

            <Button
              title="Close"
              variant="outline"
              onPress={() => setQrModalVisible(false)}
              fullWidth
              style={{ marginTop: 16 }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  qrModalContent: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  qrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  qrPlaceholderBox: {
    width: '100%',
    paddingVertical: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  qrGymName: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  qrGymId: {
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  qrNote: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
});
