import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useAnnouncements } from '../../../hooks/useAnnouncements';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../../constants/keyboard';

type AudienceType = 'everyone' | 'active' | 'morning' | 'afternoon' | 'evening' | 'staff';

const AUDIENCE_OPTIONS: Array<{ label: string; value: AudienceType; desc: string }> = [
  { label: 'Everyone', value: 'everyone', desc: 'All members, staff, and visitors' },
  { label: 'Active Members', value: 'active', desc: 'Members with currently active plans' },
  { label: 'Morning Slot', value: 'morning', desc: 'Members attending 5 AM – 11 AM' },
  { label: 'Afternoon Slot', value: 'afternoon', desc: 'Members attending 11 AM – 4 PM' },
  { label: 'Evening Slot', value: 'evening', desc: 'Members attending 4 PM – 10 PM' },
  { label: 'Staff Only', value: 'staff', desc: 'Internal team announcements only' },
];

export default function StaffCreateAnnouncementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gymId, profile } = useAppAuth();
  const { colors } = useTheme();

  const { createAnnouncement } = useAnnouncements();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetAudience, setTargetAudience] = useState<AudienceType>('everyone');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});

  const validate = (): boolean => {
    const errs: { title?: string; body?: string } = {};

    if (!title.trim()) {
      errs.title = 'Title is required';
    } else if (title.trim().length < 3) {
      errs.title = 'Title must be at least 3 characters';
    }

    if (!body.trim()) {
      errs.body = 'Announcement message is required';
    } else if (body.trim().length < 10) {
      errs.body = 'Message must be at least 10 characters';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handlePost = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        targetAudience,
      });

      Alert.alert('Success', 'Announcement posted successfully.', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (err: any) {
      console.error('[StaffCreateAnnouncement] Error:', err);
      Alert.alert('Post Failed', err.message || 'Failed to post announcement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        // Without this the first tap while the keyboard is open only dismisses
        // it, so a field or button below has to be tapped twice.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Row */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Post Announcement
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Broadcast important notices to your gym members or staff
            </Text>
          </View>
        </View>

        {/* Inputs */}
        <View style={styles.form}>
          <Input
            label="Announcement Title *"
            placeholder="e.g. Special Holiday Hours / Maintenance Alert"
            value={title}
            onChangeText={(text) => {
              setTitle(text);
              if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
            }}
            error={errors.title}
          />

          <Input
            label="Message Details *"
            placeholder="Write full announcement details for members here..."
            value={body}
            onChangeText={(text) => {
              setBody(text);
              if (errors.body) setErrors((prev) => ({ ...prev, body: undefined }));
            }}
            multiline
            numberOfLines={5}
            inputStyle={styles.multilineInput}
            error={errors.body}
          />

          {/* Target Audience Picker */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Target Audience
          </Text>
          <View style={styles.audienceGrid}>
            {AUDIENCE_OPTIONS.map((item) => {
              const isSelected = targetAudience === item.value;
              return (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.audienceChip,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setTargetAudience(item.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.audienceTitle,
                      { color: isSelected ? '#11170B' : colors.textSecondary },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.audienceDesc, { color: colors.textSecondary }]}>
            {AUDIENCE_OPTIONS.find((item) => item.value === targetAudience)?.desc}
          </Text>

          {/* Post Button */}
          <View style={styles.submitSection}>
            <Button
              title="Post Announcement"
              onPress={handlePost}
              variant="primary"
              size="lg"
              loading={isSubmitting}
              fullWidth
              icon={<Ionicons name="megaphone-outline" size={20} color="#000000" />}
            />
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  form: {
    marginTop: 4,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 10,
  },
  audienceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  audienceChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  audienceTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  audienceDesc: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 9,
    marginBottom: 18,
  },
  submitSection: {
    marginTop: 4,
  },
});
