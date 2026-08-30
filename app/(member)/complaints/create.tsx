import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useComplaints } from '../../../hooks/useComplaints';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

export default function CreateComplaintScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gymId, currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const { submitComplaint } = useComplaints();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});

  const handlePickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'We need access to your photos to attach an image to your complaint.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });

      if (!result.canceled && result.assets && result.assets[0]?.uri) {
        setSelectedPhoto(result.assets[0].uri);
      }
    } catch (err) {
      console.error('[CreateComplaint] Error picking image:', err);
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  const handleRemovePhoto = () => {
    setSelectedPhoto(null);
  };

  const validate = (): boolean => {
    const errs: { subject?: string; body?: string } = {};

    if (!subject.trim()) {
      errs.subject = 'Subject is required';
    } else if (subject.trim().length < 3) {
      errs.subject = 'Subject must be at least 3 characters';
    }

    if (!body.trim()) {
      errs.body = 'Description is required';
    } else if (body.trim().length < 10) {
      errs.body = 'Please provide more details (at least 10 characters)';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await submitComplaint({
        subject: subject.trim(),
        body: body.trim(),
        photoUrl: selectedPhoto || undefined,
      });

      Alert.alert(
        'Complaint Submitted',
        'Your feedback has been sent to the gym management. We will review it shortly.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (err: any) {
      console.error('[CreateComplaint] Error submitting:', err);
      Alert.alert('Submission Failed', err.message || 'Failed to submit complaint. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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
        {/* Header with Back Button */}
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
              Submit Feedback
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Report an issue, damaged equipment, or service request
            </Text>
          </View>
        </View>

        {/* Quick Suggestion Chips */}
        <View style={styles.chipsContainer}>
          <Text style={[styles.chipsLabel, { color: colors.textSecondary }]}>
            Common Topics:
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {[
              'Broken Equipment',
              'Cleanliness / Hygiene',
              'AC / Ventilation',
              'Locker Room Issue',
              'Trainer Feedback',
              'Timing Request',
            ].map((topic) => (
              <TouchableOpacity
                key={topic}
                style={[
                  styles.topicChip,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
                onPress={() => {
                  setSubject(topic);
                  setErrors((prev) => ({ ...prev, subject: undefined }));
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.topicChipText, { color: colors.textSecondary }]}>
                  {topic}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Form Inputs */}
        <View style={styles.form}>
          <Input
            label="Subject *"
            placeholder="e.g. Treadmill #3 display not working"
            value={subject}
            onChangeText={(text) => {
              setSubject(text);
              if (errors.subject) setErrors((prev) => ({ ...prev, subject: undefined }));
            }}
            error={errors.subject}
          />

          <Input
            label="Details & Description *"
            placeholder="Please describe the issue in detail so we can resolve it promptly..."
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

          {/* Photo Attachment */}
          <Text style={[styles.attachmentLabel, { color: colors.textSecondary }]}>
            Attach Photo (Optional)
          </Text>

          {selectedPhoto ? (
            <View style={[styles.photoPreviewContainer, { borderColor: colors.border }]}>
              <Image source={{ uri: selectedPhoto }} style={styles.photoPreview} />
              <TouchableOpacity
                style={[styles.removePhotoButton, { backgroundColor: colors.error }]}
                onPress={handleRemovePhoto}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.addPhotoButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={handlePickPhoto}
              activeOpacity={0.7}
            >
              <View style={[styles.photoIconCircle, { backgroundColor: colors.primaryMuted }]}>
                <Ionicons name="camera-outline" size={24} color={colors.primary} />
              </View>
              <View style={styles.photoTextGroup}>
                <Text style={[styles.photoButtonTitle, { color: colors.text }]}>
                  Take or Upload Photo
                </Text>
                <Text style={[styles.photoButtonSub, { color: colors.textTertiary }]}>
                  Helps staff identify and fix the issue faster
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Submit Button */}
          <View style={styles.submitContainer}>
            <Button
              title="Submit Complaint"
              onPress={handleSubmit}
              variant="primary"
              size="lg"
              loading={isSubmitting}
              fullWidth
              icon={<Ionicons name="paper-plane-outline" size={20} color="#000000" />}
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
  chipsContainer: {
    marginBottom: 18,
  },
  chipsLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsScroll: {
    flexDirection: 'row',
  },
  topicChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  topicChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  form: {
    marginTop: 4,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  attachmentLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 24,
  },
  photoIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  photoTextGroup: {
    flex: 1,
  },
  photoButtonTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  photoButtonSub: {
    fontSize: 12,
  },
  photoPreviewContainer: {
    position: 'relative',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 24,
    height: 180,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  removePhotoButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitContainer: {
    marginTop: 8,
  },
});
