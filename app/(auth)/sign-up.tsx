import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { useOAuth } from '@clerk/expo';
import { useSignUp } from '@clerk/expo/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme';
import { KEYBOARD_AVOID_BEHAVIOR } from '../../constants/keyboard';

export default function SignUpScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });

  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Verification state
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [resendingCode, setResendingCode] = useState(false);
  // Clerk rate-limits verification emails. Without a cooldown, tapping Resend a
  // few times turns a working screen into a raw rate-limit error, so the button
  // holds itself shut and says how long for.
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccessMessage, setResendSuccessMessage] = useState('');

  // Loading & Error states
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignUp = async () => {
    if (!isLoaded || !signUp || !setActive) return;

    setErrorMessage('');
    setResendSuccessMessage('');

    // Validations
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!trimmedEmail || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter a password.');
      return;
    }

    if (password.length < 15) {
      setErrorMessage('Password must be at least 15 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      // Note: this Clerk instance has the "Name" personal information field
      // disabled, so firstName/lastName are rejected by the API. Full name is
      // stored via unsafeMetadata and picked up by lib/auth.tsx when it
      // creates the Supabase profile row.
      const createdUser = await signUp.create({
        emailAddress: trimmedEmail,
        password,
        unsafeMetadata: { fullName: trimmedName },
      });

      if (createdUser.status === 'complete') {
        await setActive({ session: createdUser.createdSessionId });
        router.replace('/');
        return;
      }

      // Send verification email
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: any) {
      console.error('[SignUp] Error:', err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Failed to create account. Please try again.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!isLoaded || !signUp || !setActive) return;

    setErrorMessage('');
    const code = verificationCode.trim();

    if (!code || code.length < 6) {
      setErrorMessage('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
      } else {
        console.log('[SignUp] Verification status:', result.status);
        setErrorMessage('Verification was not completed. Please try again.');
      }
    } catch (err: any) {
      console.error('[SignUp] Verification Error:', err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Invalid verification code. Please check and try again.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResendCode = async () => {
    if (!isLoaded || !signUp) return;

    setErrorMessage('');
    setResendSuccessMessage('');
    setResendingCode(true);

    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setResendSuccessMessage('A new verification code has been sent to your email.');
      setResendCooldown(30);
    } catch (err: any) {
      console.error('[SignUp] Resend Code Error:', err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Failed to resend code. Please try again in a few moments.';
      setErrorMessage(message);
    } finally {
      setResendingCode(false);
    }
  };

  const handleGoogleSignUp = async () => {
    try {
      setErrorMessage('');
      setGoogleLoading(true);

      // Send the OAuth redirect to a route that actually exists. Without an
      // explicit redirectUrl, Clerk returns to a path expo-router has no screen
      // for, which flashed "Unmatched Route" before the session resolved.
      const { createdSessionId, setActive: setOAuthActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/'),
      });

      if (createdSessionId && setOAuthActive) {
        await setOAuthActive({ session: createdSessionId });
        router.replace('/');
      }
    } catch (err: any) {
      console.error('[SignUp] Google OAuth Error:', err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Failed to sign up with Google.';
      setErrorMessage(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.keyboardContainer, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_AVOID_BEHAVIOR}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Verification View */}
        {pendingVerification ? (
          <View style={styles.contentWrapper}>
            {/* Header Area */}
            <View style={styles.headerContainer}>
              <View style={[styles.iconCircle, { backgroundColor: colors.primaryMuted }]}>
                <Ionicons name="mail-unread-outline" size={40} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>
                Verify Your Email
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                We've sent a 6-digit verification code to{'\n'}
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {email.trim()}
                </Text>
              </Text>
            </View>

            {/* Error message banner */}
            {errorMessage ? (
              <View
                style={[
                  styles.errorContainer,
                  { backgroundColor: isDark ? '#2A1515' : '#FFEBEE', borderColor: colors.error },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={20} color={colors.error} style={styles.errorIcon} />
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {/* Success message banner */}
            {resendSuccessMessage ? (
              <View
                style={[
                  styles.successContainer,
                  { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
                ]}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} style={styles.errorIcon} />
                <Text style={[styles.successText, { color: colors.primary }]}>
                  {resendSuccessMessage}
                </Text>
              </View>
            ) : null}

            {/* Code Input */}
            <View style={styles.formContainer}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Verification Code
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    styles.codeInputWrapper,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.codeInput, { color: colors.text }]}
                    placeholder="123456"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={verificationCode}
                    onChangeText={(text) => {
                      setVerificationCode(text.replace(/[^0-9]/g, ''));
                      if (errorMessage) setErrorMessage('');
                    }}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                    editable={!loading}
                  />
                </View>
              </View>

              {/* Verify Button */}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  (!isLoaded || loading) && styles.buttonDisabled,
                ]}
                onPress={handleVerifyCode}
                disabled={!isLoaded || loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.primaryButtonText}>Verify Email</Text>
                )}
              </TouchableOpacity>

              {/* Resend Code Button */}
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                  (resendingCode || resendCooldown > 0) && styles.buttonDisabled,
                ]}
                onPress={handleResendCode}
                disabled={resendingCode || loading || resendCooldown > 0}
                activeOpacity={0.8}
              >
                {resendingCode ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Back to Sign Up Button */}
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setPendingVerification(false);
                  setErrorMessage('');
                  setResendSuccessMessage('');
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="arrow-back" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
                <Text style={[styles.backButtonText, { color: colors.textSecondary }]}>
                  Back to Sign Up
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Sign Up Form View */
          <View style={styles.contentWrapper}>
            {/* Header Area */}
            <View style={styles.headerContainer}>
              <Text style={[styles.brandTitle, { color: colors.primary }]}>
                GYM APP
              </Text>
              <Text style={[styles.title, { color: colors.text }]}>
                Create Account
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Join today to manage your workouts, memberships, and fitness goals.
              </Text>
            </View>

            {/* Error message banner */}
            {errorMessage ? (
              <View
                style={[
                  styles.errorContainer,
                  { backgroundColor: isDark ? '#2A1515' : '#FFEBEE', borderColor: colors.error },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={20} color={colors.error} style={styles.errorIcon} />
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {/* Form Fields */}
            <View style={styles.formContainer}>
              {/* Full Name */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Full Name
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color={colors.inputPlaceholder}
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder="John Doe"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={fullName}
                    onChangeText={(text) => {
                      setFullName(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoCapitalize="words"
                    autoCorrect={false}
                    textContentType="name"
                    editable={!loading && !googleLoading}
                  />
                </View>
              </View>

              {/* Email Address */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Email Address
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                    },
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
                    onChangeText={(text) => {
                      setEmail(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    editable={!loading && !googleLoading}
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Password
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                    },
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
                    onChangeText={(text) => {
                      setPassword(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    editable={!loading && !googleLoading}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((prev) => !prev)}
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
              </View>

              {/* Confirm Password */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  Confirm Password
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={20}
                    color={colors.inputPlaceholder}
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder="Re-enter password"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={confirmPassword}
                    onChangeText={(text) => {
                      setConfirmPassword(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="newPassword"
                    editable={!loading && !googleLoading}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword((prev) => !prev)}
                    style={styles.eyeButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.inputPlaceholder}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Create Account Button */}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  (!isLoaded || loading || googleLoading) && styles.buttonDisabled,
                ]}
                onPress={handleSignUp}
                disabled={!isLoaded || loading || googleLoading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.primaryButtonText}>Create Account</Text>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: colors.divider }]} />
                <Text style={[styles.dividerText, { color: colors.textTertiary }]}>
                  Or continue with
                </Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.divider }]} />
              </View>

              {/* Google Sign-up Button */}
              <TouchableOpacity
                style={[
                  styles.googleButton,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                  googleLoading && styles.buttonDisabled,
                ]}
                onPress={handleGoogleSignUp}
                disabled={!isLoaded || loading || googleLoading}
                activeOpacity={0.8}
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <>
                    <View style={[styles.googleIconBadge, { backgroundColor: isDark ? '#2D2D2D' : '#F0F0F0' }]}>
                      <Text style={styles.googleIconText}>G</Text>
                    </View>
                    <Text style={[styles.googleButtonText, { color: colors.text }]}>
                      Continue with Google
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Footer / Sign In Link */}
            <View style={styles.footerContainer}>
              <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                Already have an account?{' '}
              </Text>
              <Link href="/(auth)/sign-in" asChild>
                <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={[styles.footerLink, { color: colors.primary }]}>
                    Sign In
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
  },
  contentWrapper: {
    width: '100%',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  errorIcon: {
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  codeInputWrapper: {
    justifyContent: 'center',
    height: 56,
  },
  fieldIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    width: '100%',
  },
  eyeButton: {
    padding: 4,
    marginLeft: 6,
  },
  primaryButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  backButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 13,
    paddingHorizontal: 12,
    fontWeight: '500',
  },
  googleButton: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  googleIconText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4285F4',
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '700',
  },
});
