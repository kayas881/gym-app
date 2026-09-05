import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Share, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { formatDateTime } from '../utils/date';
import Button from './ui/Button';

interface ClaimCode {
  id: string;
  code: string;
  expires_at: string;
  claimed_at: string | null;
  claimed_by_email: string | null;
  revoked_at: string | null;
}

interface Props {
  gymMemberId: string;
  memberName: string;
  /** Whether this member already has an app login; the panel hides itself if so. */
  hasAppLogin: boolean;
}

/**
 * The owner's half of linking an app login to a member they created by hand.
 *
 * Deliberately shows the code's *state*, not just the code. If something looks
 * wrong — a code read out loud in a busy gym, or claimed by an address the owner
 * does not recognise — the two things they need are visible: who claimed it, and
 * a way to kill it.
 *
 * Hidden entirely once the member has a login, because there is nothing left to
 * claim and a stale "Generate code" button would only invite confusion.
 */
export default function ClaimCodePanel({ gymMemberId, memberName, hasAppLogin }: Props) {
  const { supabase } = useAppAuth();
  const { colors, isDark } = useTheme();

  const [code, setCode] = useState<ClaimCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const fetchCode = useCallback(async () => {
    if (!gymMemberId) return;
    setLoading(true);
    try {
      // Most recent first: generating a new code retires the old one, so the
      // newest row is always the one that matters.
      const { data, error } = await supabase
        .from('member_claim_codes')
        .select('id, code, expires_at, claimed_at, claimed_by_email, revoked_at')
        .eq('gym_member_id', gymMemberId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        console.warn('[ClaimCode] fetch:', error.message);
        return;
      }
      setCode((data?.[0] as ClaimCode) ?? null);
    } finally {
      setLoading(false);
    }
  }, [gymMemberId, supabase]);

  useEffect(() => {
    if (!hasAppLogin) fetchCode();
    else setLoading(false);
  }, [fetchCode, hasAppLogin]);

  if (hasAppLogin) return null;

  const generate = async () => {
    setWorking(true);
    try {
      const { data, error } = await supabase.rpc('generate_member_claim_code', {
        p_gym_member_id: gymMemberId,
      });
      if (error) throw error;
      setCode(data as ClaimCode);
    } catch (err: any) {
      console.error('[ClaimCode] generate:', err);
      Alert.alert('Could not create a code', err?.message || 'Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const revoke = async () => {
    if (!code) return;
    Alert.alert(
      'Cancel this code?',
      `${code.code} will stop working immediately. You can generate a new one.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel code',
          style: 'destructive',
          onPress: async () => {
            setWorking(true);
            try {
              const { error } = await supabase.rpc('revoke_member_claim_code', {
                p_code_id: code.id,
              });
              if (error) throw error;
              await fetchCode();
            } catch (err: any) {
              Alert.alert('Could not cancel', err?.message || 'Please try again.');
            } finally {
              setWorking(false);
            }
          },
        },
      ]
    );
  };

  const share = async () => {
    if (!code) return;
    try {
      await Share.share({
        message:
          `Hi ${memberName}, your gym membership is already set up.\n\n` +
          `Install Gym App, sign up, then enter this code to see your plan and payments:\n\n` +
          `${code.code}\n\n` +
          `The code works once and expires on ${formatDateTime(code.expires_at)}.`,
      });
    } catch (err) {
      console.error('[ClaimCode] share:', err);
    }
  };

  const now = Date.now();
  const claimed = !!code?.claimed_at;
  const revoked = !!code?.revoked_at && !claimed;
  const expired = !!code && !claimed && !revoked && new Date(code.expires_at).getTime() <= now;
  const live = !!code && !claimed && !revoked && !expired;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.headerRow}>
        <Ionicons name="key-outline" size={18} color={colors.warning} />
        <Text style={[styles.title, { color: colors.text }]}>App access</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
      ) : live && code ? (
        <>
          <Text style={[styles.codeValue, { color: colors.primary }]} selectable>
            {code.code}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            Works once · expires {formatDateTime(code.expires_at)}
          </Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {memberName} enters this after signing up, and keeps their plan,
            payments and balance.
          </Text>
          <View style={styles.actionRow}>
            <Button title="Share" size="sm" variant="primary" onPress={share} style={styles.flexBtn} />
            <Button
              title="Cancel code"
              size="sm"
              variant="outline"
              onPress={revoke}
              loading={working}
              style={styles.flexBtn}
            />
          </View>
        </>
      ) : claimed && code ? (
        <>
          <View style={styles.claimedRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={[styles.claimedText, { color: colors.text }]}>
              Claimed {formatDateTime(code.claimed_at as string)}
            </Text>
          </View>
          {/* The one field that would reveal the WRONG person having claimed it:
              after adoption the profile carries the member's own name either way. */}
          {code.claimed_by_email ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              by {code.claimed_by_email}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {revoked
              ? 'The last code was cancelled.'
              : expired
                ? 'The last code expired unused.'
                : `${memberName} has no app login. Give them a code and they keep everything already on this record.`}
          </Text>
          <Button
            title={code ? 'Generate a new code' : 'Generate claim code'}
            size="sm"
            variant="outline"
            onPress={generate}
            loading={working}
            style={styles.generateBtn}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  loader: { alignSelf: 'flex-start', marginVertical: 6 },
  codeValue: { fontSize: 30, fontWeight: '800', letterSpacing: 6, marginVertical: 2 },
  meta: { fontSize: 12, marginTop: 2 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  flexBtn: { flex: 1 },
  generateBtn: { marginTop: 12, alignSelf: 'flex-start' },
  claimedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  claimedText: { fontSize: 14, fontWeight: '600' },
});
