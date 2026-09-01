import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import Card from '../../components/ui/Card';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import {
  DAY_KEYS,
  DAY_LABELS,
  OperatingHours,
  formatDayHours,
  isOpenNow,
  parseOperatingHours,
  todayKey,
} from '../../utils/operating-hours';

interface GymInfo {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  description: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  amenities: string[] | null;
  operating_hours: any;
}

interface OwnerCard {
  profile_id: string;
  full_name: string;
  photo_url: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * What a member can find out about the gym they belong to.
 *
 * Before this, a member could see the gym's name and nothing else — not the
 * opening hours, not a phone number, not even who the owner was.
 */
export default function MemberGymInfoScreen() {
  const router = useRouter();
  const { gymId, supabase, isSignedIn } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [gym, setGym] = useState<GymInfo | null>(null);
  const [owner, setOwner] = useState<OwnerCard | null>(null);
  const [hours, setHours] = useState<OperatingHours | null>(null);
  const [legacySummary, setLegacySummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!gymId || !isSignedIn) return;

    try {
      const [gymResult, ownerResult] = await Promise.all([
        supabase
          .from('gyms')
          .select(
            'id, name, logo_url, address, description, contact_phone, contact_email, amenities, operating_hours'
          )
          .eq('id', gymId)
          .single(),
        // An RPC rather than a profiles select, so this screen reads only the
        // owner's contact fields — never the health notes or emergency contact
        // that the same-gym profiles policy would also permit.
        supabase.rpc('get_gym_owner_card', { p_gym_id: gymId }),
      ]);

      if (gymResult.error) {
        console.error('[GymInfo] Gym fetch error:', gymResult.error);
      } else if (gymResult.data) {
        setGym(gymResult.data as GymInfo);
        const parsed = parseOperatingHours(gymResult.data.operating_hours);
        setHours(parsed.hours);
        setLegacySummary(parsed.legacySummary);
      }

      if (ownerResult.error) {
        console.warn('[GymInfo] Owner fetch error:', ownerResult.error.message);
      } else {
        const rows = (ownerResult.data as OwnerCard[]) || [];
        setOwner(rows[0] ?? null);
      }
    } catch (err) {
      console.error('[GymInfo] Unexpected error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gymId, supabase, isSignedIn]);

  useEffect(() => {
    load();
  }, [load]);

  const openExternal = async (url: string, label: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Not Available', `This device can't open ${label}.`);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      console.error('[GymInfo] Linking error:', err);
      Alert.alert('Error', `Could not open ${label}.`);
    }
  };

  const openStatus = isOpenNow(hours);
  const currentDay = todayKey();

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Gym</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Identity */}
        <Card padding={20} style={styles.gymCard}>
          <View style={styles.gymTopRow}>
            <Avatar uri={gym?.logo_url} name={gym?.name || 'Gym'} size={64} shape="rounded" />
            <View style={styles.gymHeaderInfo}>
              <Text style={[styles.gymName, { color: colors.text }]}>
                {gym?.name || 'Your Gym'}
              </Text>
              {openStatus === null ? (
                <Badge text="HOURS NOT SET" variant="default" size="sm" />
              ) : (
                <Badge
                  text={openStatus ? 'OPEN NOW' : 'CLOSED NOW'}
                  variant={openStatus ? 'success' : 'error'}
                  size="sm"
                />
              )}
            </View>
          </View>

          {gym?.description ? (
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {gym.description}
            </Text>
          ) : null}
        </Card>

        {/* Opening hours */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Opening Hours</Text>

        <Card padding={14} style={styles.sectionCard}>
          {hours ? (
            <>
              {DAY_KEYS.map((key, index) => {
                const day = hours.days[key];
                const isToday = key === currentDay;
                return (
                  <View
                    key={key}
                    style={[
                      styles.hoursRow,
                      index < DAY_KEYS.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.divider,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayName,
                        {
                          color: isToday ? colors.primary : colors.text,
                          fontWeight: isToday ? '800' : '600',
                        },
                      ]}
                    >
                      {DAY_LABELS[key]}
                      {isToday ? '  •  Today' : ''}
                    </Text>
                    <Text
                      style={[
                        styles.dayValue,
                        { color: day.closed ? colors.error : colors.textSecondary },
                      ]}
                    >
                      {formatDayHours(day)}
                    </Text>
                  </View>
                );
              })}

              {hours.note ? (
                <View style={[styles.noteRow, { borderTopColor: colors.divider }]}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                  <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                    {hours.note}
                  </Text>
                </View>
              ) : null}
            </>
          ) : legacySummary ? (
            <Text style={[styles.legacyText, { color: colors.textSecondary }]}>
              {legacySummary}
            </Text>
          ) : (
            <Text style={[styles.legacyText, { color: colors.textTertiary }]}>
              Your gym hasn't set its opening hours yet.
            </Text>
          )}
        </Card>

        {/* Contact & location */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Contact & Location</Text>

        <Card padding={16} style={styles.sectionCard}>
          {gym?.address ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={18} color={colors.primary} style={styles.infoIcon} />
              <View style={styles.infoTextContainer}>
                <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Address</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>{gym.address}</Text>
              </View>
            </View>
          ) : null}

          {gym?.contact_phone ? (
            <>
              {gym?.address ? <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} /> : null}
              <TouchableOpacity
                style={styles.infoRow}
                activeOpacity={0.7}
                onPress={() => openExternal(`tel:${gym.contact_phone}`, 'the phone dialler')}
              >
                <Ionicons name="call-outline" size={18} color={colors.primary} style={styles.infoIcon} />
                <View style={styles.infoTextContainer}>
                  <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Phone</Text>
                  <Text style={[styles.infoValue, { color: colors.primary }]}>
                    {gym.contact_phone}
                  </Text>
                </View>
                <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </>
          ) : null}

          {gym?.contact_email ? (
            <>
              <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />
              <TouchableOpacity
                style={styles.infoRow}
                activeOpacity={0.7}
                onPress={() => openExternal(`mailto:${gym.contact_email}`, 'the mail app')}
              >
                <Ionicons name="mail-outline" size={18} color={colors.primary} style={styles.infoIcon} />
                <View style={styles.infoTextContainer}>
                  <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Email</Text>
                  <Text style={[styles.infoValue, { color: colors.primary }]}>
                    {gym.contact_email}
                  </Text>
                </View>
                <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </>
          ) : null}

          {!gym?.address && !gym?.contact_phone && !gym?.contact_email ? (
            <Text style={[styles.legacyText, { color: colors.textTertiary }]}>
              No contact details added yet.
            </Text>
          ) : null}
        </Card>

        {/* Amenities */}
        {gym?.amenities && gym.amenities.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Facilities</Text>
            <Card padding={14} style={styles.sectionCard}>
              <View style={styles.chipWrap}>
                {gym.amenities.map((item) => (
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
                    <Ionicons name="checkmark-circle-outline" size={14} color={colors.primary} />
                    <Text style={[styles.chipText, { color: colors.text }]}>{item}</Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        ) : null}

        {/* Who runs the gym */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Gym Owner</Text>

        <Card padding={16} style={styles.sectionCard}>
          {owner ? (
            <>
              <View style={styles.ownerRow}>
                <Avatar uri={owner.photo_url} name={owner.full_name || 'Owner'} size={52} />
                <View style={styles.ownerInfo}>
                  <Text style={[styles.ownerName, { color: colors.text }]}>
                    {owner.full_name || 'Gym Owner'}
                  </Text>
                  <Badge text="OWNER" variant="warning" size="sm" />
                </View>
              </View>

              {owner.phone ? (
                <>
                  <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />
                  <TouchableOpacity
                    style={styles.infoRow}
                    activeOpacity={0.7}
                    onPress={() => openExternal(`tel:${owner.phone}`, 'the phone dialler')}
                  >
                    <Ionicons name="call-outline" size={18} color={colors.primary} style={styles.infoIcon} />
                    <View style={styles.infoTextContainer}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Phone</Text>
                      <Text style={[styles.infoValue, { color: colors.primary }]}>{owner.phone}</Text>
                    </View>
                    <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </>
              ) : null}

              {owner.email ? (
                <>
                  <View style={[styles.rowDivider, { backgroundColor: colors.divider }]} />
                  <TouchableOpacity
                    style={styles.infoRow}
                    activeOpacity={0.7}
                    onPress={() => openExternal(`mailto:${owner.email}`, 'the mail app')}
                  >
                    <Ionicons name="mail-outline" size={18} color={colors.primary} style={styles.infoIcon} />
                    <View style={styles.infoTextContainer}>
                      <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>Email</Text>
                      <Text style={[styles.infoValue, { color: colors.primary }]}>{owner.email}</Text>
                    </View>
                    <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </>
              ) : null}
            </>
          ) : (
            <Text style={[styles.legacyText, { color: colors.textTertiary }]}>
              Owner details are not available.
            </Text>
          )}
        </Card>

        <TouchableOpacity
          style={[
            styles.complaintLink,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
          onPress={() => router.push('/(member)/complaints')}
          activeOpacity={0.7}
        >
          <Ionicons name="chatbox-ellipses-outline" size={18} color={colors.primary} />
          <Text style={[styles.complaintLinkText, { color: colors.text }]}>
            Raise a complaint or suggestion
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </ScrollView>
    </View>
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  gymCard: { borderRadius: 16, marginBottom: 8 },
  gymTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  gymHeaderInfo: { flex: 1, gap: 6, alignItems: 'flex-start' },
  gymName: { fontSize: 20, fontWeight: '700' },
  description: { fontSize: 13, lineHeight: 19, marginTop: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 18, marginBottom: 10 },
  sectionCard: { borderRadius: 14 },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  dayName: { fontSize: 14 },
  dayValue: { fontSize: 13, fontWeight: '600' },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 6,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  legacyText: { fontSize: 13, lineHeight: 19 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  infoIcon: { marginRight: 14 },
  infoTextContainer: { flex: 1 },
  infoLabel: { fontSize: 11, fontWeight: '500', marginBottom: 2 },
  infoValue: { fontSize: 14, fontWeight: '600' },
  rowDivider: { height: 1, marginVertical: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ownerInfo: { flex: 1, gap: 6, alignItems: 'flex-start' },
  ownerName: { fontSize: 16, fontWeight: '700' },
  complaintLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 18,
  },
  complaintLinkText: { flex: 1, fontSize: 14, fontWeight: '600' },
});
