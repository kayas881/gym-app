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
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useAnnouncements } from '../../../hooks/useAnnouncements';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

type TargetAudience = 'everyone' | 'active' | 'morning' | 'afternoon' | 'evening' | 'staff';

interface AudienceOption {
  id: TargetAudience;
  label: string;
  sublabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    id: 'everyone',
    label: 'Everyone',
    sublabel: 'All members, staff, and pending applicants',
    icon: 'globe-outline',
  },
  {
    id: 'active',
    label: 'Active Members',
    sublabel: 'Only members with an active subscription',
    icon: 'checkmark-circle-outline',
  },
  {
    id: 'morning',
    label: 'Morning Members',
    sublabel: 'Members attending 5:00 AM – 11:00 AM',
    icon: 'sunny-outline',
  },
  {
    id: 'afternoon',
    label: 'Afternoon Members',
    sublabel: 'Members attending 11:00 AM – 4:00 PM',
    icon: 'partly-sunny-outline',
  },
  {
    id: 'evening',
    label: 'Evening Members',
    sublabel: 'Members attending 4:00 PM – 9:00 PM',
    icon: 'moon-outline',
  },
  {
    id: 'staff',
    label: 'Staff Only',
    sublabel: 'Gym trainers and administrative staff',
    icon: 'shield-checkmark-outline',
  },
];

export default function CreateAnnouncementScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { createAnnouncement } = useAnnouncements();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetAudience, setTargetAudience] = useState<TargetAudience>('everyone');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});

  const validate = () => {
    const newErrors: { title?: string; body?: string } = {};
    if (!title.trim()) {
      newErrors.title = 'Title is required';
    }
    if (!body.trim()) {
      newErrors.body = 'Message body is required';
    } else if (body.trim().length < 10) {
      newErrors.body = 'Message should be at least 10 characters';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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

      Alert.alert('Success', 'Announcement posted successfully!', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (err: any) {
      console.error('[CreateAnnouncement] Post error:', err);
      Alert.alert('Error', err.message || 'Failed to post announcement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Create Announcement
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Broadcast an update to your gym members
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title Input */}
        <Input
          label="Announcement Title *"
          placeholder="e.g., Special Holiday Schedule"
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
          }}
          error={errors.title}
          leftIcon={<Ionicons name="text-outline" size={18} color={colors.textTertiary} />}
        />

        {/* Target Audience Section */}
        <View style={styles.audienceSection}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Target Audience *
          </Text>
          <Text style={[styles.sectionSublabel, { color: colors.textTertiary }]}>
            Choose who should receive and see this announcement
          </Text>

          <View style={styles.audienceGrid}>
            {AUDIENCE_OPTIONS.map((opt) => {
              const isSelected = targetAudience === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.audienceCard,
                    {
                      backgroundColor: isSelected
                        ? (isDark ? 'rgba(0, 230, 118, 0.12)' : 'rgba(0, 200, 83, 0.1)')
                        : colors.surface,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setTargetAudience(opt.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.audienceCardLeft}>
                    <View
                      style={[
                        styles.audienceIconCircle,
                        {
                          backgroundColor: isSelected
                            ? colors.primary
                            : colors.surfaceElevated,
                        },
                      ]}
                    >
                      <Ionicons
                        name={opt.icon}
                        size={18}
                        color={isSelected ? '#000000' : colors.textSecondary}
                      />
                    </View>
                    <View style={styles.audienceTextWrap}>
                      <Text
                        style={[
                          styles.audienceName,
                          { color: colors.text },
                          isSelected && styles.audienceNameSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text style={[styles.audienceDesc, { color: colors.textSecondary }]}>
                        {opt.sublabel}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.radioCircle,
                      { borderColor: isSelected ? colors.primary : colors.border },
                    ]}
                  >
                    {isSelected && (
                      <View style={[styles.radioFill, { backgroundColor: colors.primary }]} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Message Body Input */}
        <View style={styles.bodySection}>
          <Input
            label="Announcement Message *"
            placeholder="Write your announcement content here. Include all relevant times, instructions, or details..."
            value={body}
            onChangeText={(text) => {
              setBody(text);
              if (errors.body) setErrors((prev) => ({ ...prev, body: undefined }));
            }}
            error={errors.body}
            multiline
            numberOfLines={6}
            inputStyle={styles.bodyInput}
          />
          <Text style={[styles.charCount, { color: colors.textTertiary }]}>
            {body.length} characters
          </Text>
        </View>

        {/* Preview Summary Card */}
        {title.trim().length > 0 && (
          <Card style={styles.previewCard} padding={16}>
            <View style={styles.previewHeader}>
              <Ionicons name="eye-outline" size={16} color={colors.primary} />
              <Text style={[styles.previewTag, { color: colors.primary }]}>
                Live Preview
              </Text>
            </View>
            <Text style={[styles.previewTitle, { color: colors.text }]}>
              {title.trim()}
            </Text>
            <Text style={[styles.previewBody, { color: colors.textSecondary }]} numberOfLines={3}>
              {body.trim() || 'Your message will appear here...'}
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* Bottom Sticky Action Button */}
      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Button
          title="Cancel"
          variant="secondary"
          onPress={() => router.back()}
          style={styles.cancelBtn}
        />
        <Button
          title="Post Announcement"
          variant="primary"
          loading={isSubmitting}
          icon={<Ionicons name="send" size={16} color="#FFFFFF" />}
          onPress={handlePost}
          style={styles.postBtn}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
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
  headerTitleGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 110,
    paddingTop: 8,
  },
  audienceSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  sectionSublabel: {
    fontSize: 12,
    marginBottom: 10,
  },
  audienceGrid: {
    gap: 8,
  },
  audienceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  audienceCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  audienceIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audienceTextWrap: {
    marginLeft: 10,
    flex: 1,
  },
  audienceName: {
    fontSize: 14,
    fontWeight: '600',
  },
  audienceNameSelected: {
    fontWeight: '700',
  },
  audienceDesc: {
    fontSize: 11,
    marginTop: 1,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  bodySection: {
    marginBottom: 8,
  },
  bodyInput: {
    minHeight: 130,
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: -10,
    marginBottom: 16,
  },
  previewCard: {
    marginTop: 4,
    marginBottom: 16,
    borderStyle: 'dashed',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  previewTag: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  previewBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1,
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
  },
  postBtn: {
    flex: 2,
  },
});
