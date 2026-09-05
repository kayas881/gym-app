import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSignIn } from '@clerk/expo/legacy';
import { useTheme } from '../../lib/theme';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../constants/keyboard';

/**
 * Password recovery.
 *
 * Until this screen existed there was no way back into an account: a member who
 * forgot their password and had not used "Continue with Google" was locked out
 * permanently, with nothing on the sign-in screen even acknowledging the
 * problem. For a gym whose members are not technical, that is a guaranteed
 * support call.
 *
 * Uses the same legacy Clerk surface the rest of this folder does
 * (`signIn.create` + `attemptFirstFactor` + `setActive`), rather than the newer
 * `signIn.resetPasswordEmailCode` helpers, so the auth code stays consistent:
 *
 *   1. create({ strategy: 'reset_password_email_code' }) emails a code
 *   2. attemptFirstFactor({ code, password }) verifies it AND sets the password
 *   3. status 'complete' -> setActive() signs them straight in
 *
 * `needs_second_factor` is handled by sending them back to sign-in, which
 * already implements the MFA step; duplicating it here would be a second copy
 * of a security-sensitive flow for a rare case.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { signIn, setActive, isLoaded } = useSignIn();

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  const clerkMessage = (err: any, fallback: string) =>
    err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || fallback;

  const handleSendCode = async () => {
    if (!isLoaded || !signIn) return;

    const identifier = email.trim();
    if (!identifier) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier,
      });
      setNotice(`We sent a 6-digit code to ${identifier}.`);
      setStep('reset');
    } catch (err: any) {
      console.error('[ForgotPassword] Send code error:', err);
      setErrorMessage(
        clerkMessage(err, 'Could not send a reset code. Check the address and try again.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isLoaded || !signIn || !setActive) return;

    if (code.trim().length < 6) {
      setErrorMessage('Enter the 6-digit code from your email.');
      return;
    }
    // Matches the minimum enforced on the sign-up screen.
    if (password.length < 15) {
      setErrorMessage('Your new password must be at least 15 characters long.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: code.trim(),
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        // index.tsx decides where this account belongs (profile, gym setup, or
        // their role's home), so hand back to it rather than guessing here.
        router.replace('/');
        return;
      }

      if (result.status === 'needs_second_factor') {
        setErrorMessage(
          'Password changed. This account uses two-factor authentication, so please sign in with your new password to finish.'
        );
        setStep('request');
        return;
      }

      setErrorMessage('Could not complete the reset. Please try again.');
    } catch (err: any) {
      console.error('[ForgotPassword] Reset error:', err);
      setErrorMessage(clerkMessage(err, 'That code was not accepted. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || !isLoaded;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={KEYBOARD_AVOID_BEHAVIOR}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.primaryMuted }]}>
            <Ionicons name="lock-open-outline" size={32} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Reset Password</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {step === 'request'
              ? 'Enter the email you signed up with and we will send you a code.'
              : 'Enter the code we emailed you and choose a new password.'}
          </Text>

          {notice && step === 'reset' ? (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: isDark ? 'rgba(0, 230, 118, 0.08)' : '#F0FAF5',
                  borderColor: colors.primary,
                },
              ]}
            >
              <Ionicons name="mail-outline" size={16} color={colors.primary} />
              <Text style={[styles.bannerText, { color: colors.text }]}>{notice}</Text>
            </View>
          ) : null}

          {errorMessage ? (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: isDark ? '#2A1515' : '#FFEBEE',
                  borderColor: colors.error,
                },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text style={[styles.bannerText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          ) : null}

          {step === 'request' ? (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Email Address</Text>
              <View
                style={[
                  styles.field,
                  { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                ]}
              >
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={colors.inputPlaceholder}
                  style={styles.fieldIcon}
                />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="name@example.com"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (errorMessage) setErrorMessage('');
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  editable={!busy}
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={handleSendCode}
                disabled={busy}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send Reset Code</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Verification Code
              </Text>
              <View
                style={[
                  styles.field,
                  { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                ]}
              >
                <Ionicons
                  name="keypad-outline"
                  size={20}
                  color={colors.inputPlaceholder}
                  style={styles.fieldIcon}
                />
                <TextInput
                  style={[styles.input, styles.codeInput, { color: colors.text }]}
                  placeholder="123456"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t);
                    if (errorMessage) setErrorMessage('');
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!busy}
                />
              </View>

              <Text style={[styles.label, { color: colors.textSecondary }]}>New Password</Text>
              <View
                style={[
                  styles.field,
                  { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                ]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={colors.inputPlaceholder}
                  style={styles.fieldIcon}
                />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Minimum 15 characters"
                  placeholderTextColor={colors.inputPlaceholder}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (errorMessage) setErrorMessage('');
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((p) => !p)}
                  style={styles.eyeButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.inputPlaceholder}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={handleResetPassword}
                disabled={busy}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Text style={styles.primaryButtonText}>Set New Password</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setStep('request');
                  setCode('');
                  setPassword('');
                  setErrorMessage('');
                }}
                style={styles.secondaryLink}
                disabled={busy}
              >
                <Text style={[styles.secondaryLinkText, { color: colors.textSecondary }]}>
                  Use a different email
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            onPress={() => router.replace('/(auth)/sign-in')}
            style={styles.backRow}
            disabled={loading}
          >
            <Ionicons name="arrow-back" size={16} color={colors.textSecondary} />
            <Text style={[styles.backText, { color: colors.textSecondary }]}>
              Back to Sign In
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 40 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 54,
    marginBottom: 18,
  },
  fieldIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15 },
  codeInput: { letterSpacing: 6, fontWeight: '700' },
  eyeButton: { paddingLeft: 8 },
  primaryButton: {
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonText: { color: '#000000', fontSize: 16, fontWeight: '700' },
  secondaryLink: { alignItems: 'center', paddingVertical: 14 },
  secondaryLinkText: { fontSize: 14, fontWeight: '600' },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
  },
  backText: { fontSize: 14, fontWeight: '600' },
});
