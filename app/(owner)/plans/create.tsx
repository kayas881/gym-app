import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../../../lib/auth';
import { useTheme } from '../../../lib/theme';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';

const QUICK_DURATIONS = [1, 3, 6, 12];

export default function CreateOrEditPlanScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { gymId, supabase, isSignedIn } = useAppAuth();
  const { colors, isDark } = useTheme();

  const isEditing = !!id;

  const [name, setName] = useState('');
  const [durationMonths, setDurationMonths] = useState('1');
  const [price, setPrice] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [fetchingPlan, setFetchingPlan] = useState(isEditing);
  const [saving, setSaving] = useState(false);

  const fetchPlanDetails = useCallback(async () => {
    if (!id) return;

    setFetchingPlan(true);
    try {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('[CreatePlan] Fetch error:', error);
        // Don't alert if the session ended mid-request (e.g. during sign-out).
        if (isSignedIn) Alert.alert('Error', 'Failed to load plan details.');
        router.back();
        return;
      }

      if (data) {
        setName(data.name || '');
        setDurationMonths(data.duration_months?.toString() || '1');
        setPrice(data.price?.toString() || '');
        setIsActive(data.is_active ?? true);
      }
    } catch (err) {
      console.error('[CreatePlan] Unexpected error:', err);
    } finally {
      setFetchingPlan(false);
    }
  }, [id, supabase, router]);

  useEffect(() => {
    if (isEditing) {
      fetchPlanDetails();
    }
  }, [isEditing, fetchPlanDetails]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Required', 'Please enter a plan name.');
      return;
    }

    const durationNum = parseInt(durationMonths, 10);
    if (isNaN(durationNum) || durationNum <= 0) {
      Alert.alert('Invalid Duration', 'Please enter a valid duration in months (at least 1).');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      Alert.alert('Invalid Price', 'Please enter a valid price (₹).');
      return;
    }

    if (!gymId) {
      Alert.alert('Error', 'Gym ID not found. Please try again.');
      return;
    }

    setSaving(true);
    try {
      if (isEditing && id) {
        // Update existing plan
        const { error } = await supabase
          .from('membership_plans')
          .update({
            name: trimmedName,
            duration_months: durationNum,
            price: priceNum,
            is_active: isActive,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        if (error) throw error;
        Alert.alert('Plan Updated', `"${trimmedName}" has been successfully updated.`);
      } else {
        // Create new plan
        const { error } = await supabase.from('membership_plans').insert({
          gym_id: gymId,
          name: trimmedName,
          duration_months: durationNum,
          price: priceNum,
          is_active: isActive,
        });

        if (error) throw error;
        Alert.alert('Plan Created', `"${trimmedName}" is now available for member enrollment.`);
      }

      router.back();
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Could not save the membership plan.');
    } finally {
      setSaving(false);
    }
  };

  if (fetchingPlan) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading plan details...
        </Text>
      </View>
    );
  }

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
          {isEditing ? 'Edit Plan' : 'New Membership Plan'}
        </Text>

        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card padding={20} style={styles.formCard}>
          {/* Plan Name */}
          <Input
            label="Plan Name"
            placeholder="e.g. Monthly Standard, Annual Pro"
            value={name}
            onChangeText={setName}
          />

          {/* Duration in Months */}
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Duration (Months)
            </Text>

            {/* Quick selection chips */}
            <View style={styles.quickChipsRow}>
              {QUICK_DURATIONS.map((dur) => {
                const isSelected = durationMonths === dur.toString();
                return (
                  <TouchableOpacity
                    key={dur}
                    style={[
                      styles.quickChip,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceElevated,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setDurationMonths(dur.toString())}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        { color: isSelected ? '#000000' : colors.textSecondary },
                      ]}
                    >
                      {dur} {dur === 1 ? 'Month' : 'Months'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Input
              placeholder="Or enter custom duration in months"
              keyboardType="number-pad"
              value={durationMonths}
              onChangeText={setDurationMonths}
              style={{ marginTop: 8 }}
            />
          </View>

          {/* Price */}
          <Input
            label="Price (₹)"
            placeholder="e.g. 1500"
            keyboardType="numeric"
            value={price}
            onChangeText={setPrice}
            leftIcon={
              <Text style={[styles.rupeeIcon, { color: colors.primary }]}>₹</Text>
            }
          />

          {/* Active Switch */}
          <View style={[styles.switchCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
            <View style={styles.switchInfo}>
              <Text style={[styles.switchTitle, { color: colors.text }]}>
                Plan Active Status
              </Text>
              <Text style={[styles.switchSubtitle, { color: colors.textSecondary }]}>
                Active plans can be selected when recording new subscriptions
              </Text>
            </View>
            <Switch
              value={isActive}
              onValueChange={setIsActive}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={isDark ? '#FFFFFF' : '#FFFFFF'}
            />
          </View>
        </Card>

        {/* Action Button */}
        <View style={styles.buttonContainer}>
          <Button
            title={isEditing ? 'Save Changes' : 'Create Plan'}
            variant="primary"
            size="lg"
            loading={saving}
            onPress={handleSave}
            fullWidth
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
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
  formCard: {
    borderRadius: 16,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  quickChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  quickChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  rupeeIcon: {
    fontSize: 18,
    fontWeight: '700',
  },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  switchInfo: {
    flex: 1,
    marginRight: 12,
  },
  switchTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  switchSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  buttonContainer: {
    marginTop: 8,
  },
});
