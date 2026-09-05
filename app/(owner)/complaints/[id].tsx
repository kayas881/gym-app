import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { createSignedImageUrl } from '../../../lib/storage';
import { useTheme } from '../../../lib/theme';
import { useComplaints } from '../../../hooks/useComplaints';
import Card from '../../../components/ui/Card';
import Avatar from '../../../components/ui/Avatar';
import Badge, { BadgeVariant } from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { formatDateTime, timeAgo } from '../../../utils/date';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../../constants/keyboard';

interface ComplaintDetail {
  id: string;
  gym_id: string;
  member_id: string;
  subject: string;
  body: string;
  photo_url: string | null;
  status: 'new' | 'acknowledged' | 'resolved';
  owner_response: string | null;
  created_at: string;
  updated_at?: string;
  member?: {
    id: string;
    profile: {
      full_name: string;
      email?: string;
      phone?: string | null;
      photo_url: string | null;
    };
  };
}

export default function OwnerComplaintDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { supabase, gymId, isSignedIn } = useAppAuth();
  const { colors, isDark } = useTheme();
  const { updateComplaintStatus } = useComplaints();

  const [complaint, setComplaint] = useState<ComplaintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [responseMessage, setResponseMessage] = useState('');
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);

  // Fetch complaint details
  // complaint-photos is a PRIVATE bucket, so complaints.photo_url holds the
  // storage path rather than a viewable URL. Mint a short-lived signed URL for
  // display; it expires, which is the point of keeping the bucket private.
  const [photoSignedUrl, setPhotoSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = complaint?.photo_url;
    if (!path) {
      setPhotoSignedUrl(null);
      return;
    }
    (async () => {
      const url = await createSignedImageUrl(supabase, 'complaint-photos', path);
      if (!cancelled) setPhotoSignedUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [complaint?.photo_url, supabase]);

  const fetchComplaint = useCallback(async () => {
    if (!id || !gymId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('complaints')
        .select(`
          id,
          gym_id,
          member_id,
          subject,
          body,
          photo_url,
          status,
          owner_response,
          created_at,
          updated_at,
          member:gym_members (
            id,
            profile:profiles (
              full_name,
              email,
              phone,
              photo_url
            )
          )
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('[ComplaintDetail] Fetch error:', error);
        // Don't alert if the session ended mid-request (e.g. during sign-out).
        if (isSignedIn) Alert.alert('Error', 'Failed to load complaint details.');
        return;
      }

      setComplaint(data as unknown as ComplaintDetail);
      if (data?.owner_response) {
        setResponseMessage(data.owner_response);
      }
    } catch (err) {
      console.error('[ComplaintDetail] Unexpected error:', err);
    } finally {
      setLoading(false);
    }
  }, [id, gymId, supabase]);

  useEffect(() => {
    fetchComplaint();
  }, [fetchComplaint]);

  // Handle acknowledge
  const handleAcknowledge = async () => {
    if (!complaint) return;
    setIsAcknowledging(true);
    try {
      await updateComplaintStatus(complaint.id, 'acknowledged');
      setComplaint((prev) => (prev ? { ...prev, status: 'acknowledged' } : null));
      Alert.alert('Acknowledged', 'Complaint status has been updated to acknowledged.');
    } catch (err: any) {
      console.error('[ComplaintDetail] Acknowledge error:', err);
      Alert.alert('Error', err.message || 'Failed to acknowledge complaint.');
    } finally {
      setIsAcknowledging(false);
    }
  };

  // Handle send response & resolve
  const handleSendResponse = async () => {
    if (!complaint) return;
    if (!responseMessage.trim()) {
      Alert.alert('Required', 'Please enter a response before resolving the complaint.');
      return;
    }

    setIsSubmittingResponse(true);
    try {
      await updateComplaintStatus(complaint.id, 'resolved', responseMessage.trim());
      setComplaint((prev) =>
        prev
          ? {
              ...prev,
              status: 'resolved',
              owner_response: responseMessage.trim(),
            }
          : null
      );
      Alert.alert('Resolved', 'Response saved and complaint marked as resolved.');
    } catch (err: any) {
      console.error('[ComplaintDetail] Response error:', err);
      Alert.alert('Error', err.message || 'Failed to submit response.');
    } finally {
      setIsSubmittingResponse(false);
    }
  };

  const getStatusBadgeConfig = (
    status: 'new' | 'acknowledged' | 'resolved'
  ): { label: string; variant: BadgeVariant } => {
    switch (status) {
      case 'new':
        return { label: 'New', variant: 'error' };
      case 'acknowledged':
        return { label: 'Acknowledged', variant: 'warning' };
      case 'resolved':
        return { label: 'Resolved', variant: 'success' };
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>
          Loading complaint details...
        </Text>
      </View>
    );
  }

  if (!complaint) {
    return (
      <View style={[styles.errorScreen, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>
          Complaint Not Found
        </Text>
        <Button
          title="Go Back"
          variant="secondary"
          onPress={() => router.back()}
          style={styles.errorBackBtn}
        />
      </View>
    );
  }

  const { label: statusLabel, variant: statusVariant } = getStatusBadgeConfig(complaint.status);
  const memberName = complaint.member?.profile?.full_name || 'Gym Member';
  const photoUrl = complaint.member?.profile?.photo_url;
  const email = complaint.member?.profile?.email;
  const phone = complaint.member?.profile?.phone;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
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
            Complaint Details
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            Submitted {timeAgo(complaint.created_at)}
          </Text>
        </View>

        <Badge text={statusLabel} variant={statusVariant} size="sm" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Member Info Card */}
        <Card style={styles.memberCard} padding={16}>
          <View style={styles.memberRow}>
            <Avatar uri={photoUrl} name={memberName} size={48} />
            <View style={styles.memberInfo}>
              <Text style={[styles.memberName, { color: colors.text }]}>
                {memberName}
              </Text>
              {email ? (
                <Text style={[styles.memberSub, { color: colors.textSecondary }]}>
                  {email}
                </Text>
              ) : null}
              {phone ? (
                <Text style={[styles.memberSub, { color: colors.textSecondary }]}>
                  {phone}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>

        {/* Complaint Content Card */}
        <Card style={styles.complaintBodyCard} padding={18}>
          <View style={styles.cardSection}>
            <Text style={[styles.sectionMeta, { color: colors.textTertiary }]}>
              SUBMITTED ON {formatDateTime(complaint.created_at).toUpperCase()}
            </Text>
            <Text style={[styles.subjectTitle, { color: colors.text }]}>
              {complaint.subject}
            </Text>
            <Text style={[styles.bodyDescription, { color: colors.text }]}>
              {complaint.body}
            </Text>
          </View>

          {/* Attached Photo */}
          {complaint.photo_url && photoSignedUrl ? (
            <View style={styles.photoContainer}>
              <Text style={[styles.photoLabel, { color: colors.textSecondary }]}>
                Attached Photo Evidence:
              </Text>
              <TouchableOpacity
                onPress={() => setPhotoViewerVisible(true)}
                activeOpacity={0.9}
              >
                <Image
                  source={{ uri: photoSignedUrl }}
                  style={[styles.attachedImage, { borderColor: colors.border }]}
                  resizeMode="cover"
                />
                <View style={[styles.expandBadge, { backgroundColor: colors.overlay }]}>
                  <Ionicons name="expand" size={16} color="#FFFFFF" />
                  <Text style={styles.expandText}>Tap to enlarge</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>

        {/* Actions & Status Responses */}
        {complaint.status === 'new' && (
          <Card style={styles.actionCard} padding={16}>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>
              Quick Action
            </Text>
            <Text style={[styles.actionCardSubtitle, { color: colors.textSecondary }]}>
              Let the member know their feedback has been received and is being investigated.
            </Text>
            <Button
              title="Acknowledge Complaint"
              variant="outline"
              loading={isAcknowledging}
              icon={<Ionicons name="eye-outline" size={18} color={colors.primary} />}
              onPress={handleAcknowledge}
              style={styles.acknowledgeBtn}
            />
          </Card>
        )}

        {/* Response / Resolution Section */}
        {complaint.status === 'resolved' && complaint.owner_response ? (
          <Card
            style={[
              styles.resolvedCard,
              { borderColor: colors.success, backgroundColor: isDark ? 'rgba(0, 230, 118, 0.05)' : 'rgba(0, 200, 83, 0.04)' },
            ]}
            padding={16}
          >
            <View style={styles.resolvedHeader}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={[styles.resolvedHeaderTitle, { color: colors.success }]}>
                Complaint Resolved
              </Text>
            </View>
            <Text style={[styles.responseLabel, { color: colors.textSecondary }]}>
              Your Response to Member:
            </Text>
            <Text style={[styles.resolvedResponseText, { color: colors.text }]}>
              {complaint.owner_response}
            </Text>
          </Card>
        ) : (
          <Card style={styles.responseCard} padding={16}>
            <View style={styles.responseHeader}>
              <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
              <Text style={[styles.responseTitle, { color: colors.text }]}>
                {complaint.status === 'acknowledged'
                  ? 'Respond & Resolve Complaint'
                  : 'Send Response'}
              </Text>
            </View>

            <Input
              label="Owner Response *"
              placeholder="Explain the action taken or solution provided..."
              value={responseMessage}
              onChangeText={setResponseMessage}
              multiline
              numberOfLines={4}
              inputStyle={styles.responseInput}
            />

            <Button
              title="Send Response & Mark Resolved"
              variant="primary"
              loading={isSubmittingResponse}
              icon={<Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />}
              onPress={handleSendResponse}
              style={styles.sendResponseBtn}
            />
          </Card>
        )}
      </ScrollView>

      {/* Full Photo Modal */}
      {photoSignedUrl && (
        <Modal
          visible={photoViewerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setPhotoViewerVisible(false)}
        >
          <View style={[styles.photoModalBackdrop, { backgroundColor: colors.overlay }]}>
            <TouchableOpacity
              style={styles.closePhotoBtn}
              onPress={() => setPhotoViewerVisible(false)}
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>

            <Image
              source={{ uri: photoSignedUrl }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          </View>
        </Modal>
      )}
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
    paddingBottom: 14,
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
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 80,
    gap: 14,
  },
  memberCard: {
    marginBottom: 0,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberInfo: {
    marginLeft: 14,
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '700',
  },
  memberSub: {
    fontSize: 13,
    marginTop: 2,
  },
  complaintBodyCard: {
    gap: 14,
  },
  cardSection: {
    gap: 8,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subjectTitle: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  bodyDescription: {
    fontSize: 14,
    lineHeight: 22,
  },
  photoContainer: {
    marginTop: 4,
  },
  photoLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  attachedImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    borderWidth: 1,
  },
  expandBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  expandText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  actionCard: {
    gap: 8,
  },
  actionCardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  actionCardSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  acknowledgeBtn: {
    width: '100%',
  },
  responseCard: {
    gap: 12,
  },
  responseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  responseTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  responseInput: {
    minHeight: 100,
  },
  sendResponseBtn: {
    width: '100%',
  },
  resolvedCard: {
    gap: 8,
    borderWidth: 1.5,
  },
  resolvedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  resolvedHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  responseLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  resolvedResponseText: {
    fontSize: 14,
    lineHeight: 21,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingLabel: {
    fontSize: 14,
  },
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  errorBackBtn: {
    marginTop: 8,
  },
  photoModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closePhotoBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullScreenImage: {
    width: '90%',
    height: '80%',
  },
});
