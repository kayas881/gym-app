import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import { useComplaints } from '../../../hooks/useComplaints';
import { formatDate, formatDateTime, timeAgo } from '../../../utils/date';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';

export default function MemberComplaintsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentMembership } = useAppAuth();
  const { colors, isDark } = useTheme();

  const {
    complaints,
    loading,
    refresh,
  } = useComplaints(currentMembership?.id);

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const getStatusBadge = (status: 'new' | 'acknowledged' | 'resolved') => {
    switch (status) {
      case 'resolved':
        return <Badge text="Resolved" variant="success" size="sm" />;
      case 'acknowledged':
        return <Badge text="Acknowledged" variant="info" size="sm" />;
      case 'new':
      default:
        return <Badge text="Pending" variant="warning" size="sm" />;
    }
  };

  const renderComplaintItem = ({ item }: { item: (typeof complaints)[0] }) => {
    return (
      <Card style={styles.card} padding={16}>
        {/* Top Header */}
        <View style={styles.cardTopRow}>
          <View style={styles.subjectContainer}>
            <Text style={[styles.subjectText, { color: colors.text }]} numberOfLines={1}>
              {item.subject}
            </Text>
            <Text style={[styles.dateText, { color: colors.textTertiary }]}>
              {formatDate(item.created_at)} • {timeAgo(item.created_at)}
            </Text>
          </View>
          {getStatusBadge(item.status)}
        </View>

        {/* Complaint Body */}
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
          {item.body}
        </Text>

        {/* Owner's Response if available */}
        {item.owner_response ? (
          <View
            style={[
              styles.responseBox,
              {
                backgroundColor: isDark ? 'rgba(0, 230, 118, 0.08)' : '#F0FAF5',
                borderColor: isDark ? 'rgba(0, 230, 118, 0.25)' : '#C8E6C9',
              },
            ]}
          >
            <View style={styles.responseHeader}>
              <Ionicons name="chatbubbles" size={16} color={colors.primary} />
              <Text style={[styles.responseHeaderTitle, { color: colors.primary }]}>
                Gym Response
              </Text>
            </View>
            <Text style={[styles.responseText, { color: colors.text }]}>
              {item.owner_response}
            </Text>
          </View>
        ) : item.status === 'acknowledged' ? (
          <View
            style={[
              styles.statusNoteBox,
              {
                backgroundColor: isDark ? 'rgba(68, 138, 255, 0.08)' : '#E3F2FD',
                borderColor: isDark ? 'rgba(68, 138, 255, 0.25)' : '#BBDEFB',
              },
            ]}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.info} />
            <Text style={[styles.statusNoteText, { color: colors.info }]}>
              Gym management has acknowledged your feedback and is looking into it.
            </Text>
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={complaints}
        keyExtractor={(item) => item.id}
        renderItem={renderComplaintItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: Math.max(insets.top + 12, 44), paddingBottom: insets.bottom + 90 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              My Complaints & Feedback
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Submit issues, equipment repairs, or feedback directly to management
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading && !refreshing ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary, marginTop: 12 }]}>
                Loading your complaints...
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="checkmark-done-circle-outline" size={52} color={colors.success} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No complaints filed
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Have an issue or suggestion? Tap the button below to submit feedback to your gym manager.
              </Text>
            </View>
          )
        }
      />

      {/* Floating Action Button */}
      <View style={[styles.fabContainer, { bottom: insets.bottom + 20 }]}>
        <Button
          title="Submit New Complaint"
          onPress={() => router.push('/(member)/complaints/create')}
          variant="primary"
          size="lg"
          icon={<Ionicons name="add-circle-outline" size={22} color="#000000" />}
          style={styles.fabButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  card: {
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  subjectContainer: {
    flex: 1,
    marginRight: 10,
  },
  subjectText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 12,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  responseBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  responseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  responseHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  responseText: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusNoteBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusNoteText: {
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
  centerContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  fabContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  fabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
});
