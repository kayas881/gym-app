import React, { useState } from 'react';
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
import { useOAuth } from '@clerk/expo';
import { useSignIn } from '@clerk/expo/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Device-trust / second-factor verification state.
  // Clerk returns status 'needs_client_trust' when signing in with a password
  // on a device it doesn't recognise. The runtime resolves that through the
  // SAME path as 'needs_second_factor' (prepareSecondFactor/attemptSecondFactor).
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [secondFactorStrategy, setSecondFactorStrategy] =
    useState<'email_code' | 'phone_code'>('email_code');
  const [resendingCode, setResendingCode] = useState(false);
  const [resendSuccessMessage, setResendSuccessMessage] = useState('');

  const handleSignIn = async () => {
    if (!isLoaded || !signIn || !setActive) return;

    // Reset error
    setErrorMessage('');

    // Basic validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const result = await signIn.create({
        identifier: trimmedEmail,
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
        return;
      }

      // 'needs_client_trust' = Clerk device trust: password sign-in from a
      // device it hasn't seen before. 'needs_second_factor' = ordinary MFA.
      // Both are completed via prepareSecondFactor/attemptSecondFactor.
      if (
        result.status === 'needs_client_trust' ||
        result.status === 'needs_second_factor'
      ) {
        // Prefer an email code; fall back to SMS if that's what's on offer.
        const supportsPhone = result.supportedSecondFactors?.some(
          (factor) => factor.strategy === 'phone_code'
        );
        const strategy = supportsPhone ? 'phone_code' : 'email_code';

        setSecondFactorStrategy(strategy);
        await signIn.prepareSecondFactor({ strategy });
        setPendingVerification(true);
        return;
      }

      console.log('[SignIn] Sign in status:', result.status);
      setErrorMessage('Additional verification is required for this account.');
    } catch (err: any) {
      console.error('[SignIn] Error:', err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Failed to sign in. Please check your credentials.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySecondFactor = async () => {
    if (!isLoaded || !signIn || !setActive) return;

    setErrorMessage('');
    setResendSuccessMessage('');
    const code = verificationCode.trim();

    if (!code || code.length < 6) {
      setErrorMessage('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.attemptSecondFactor({
        strategy: secondFactorStrategy,
        code,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
      } else {
        console.log('[SignIn] Second factor status:', result.status);
        setErrorMessage('Verification was not completed. Please try again.');
      }
    } catch (err: any) {
      console.error('[SignIn] Second factor error:', err);
      setErrorMessage(
        err?.errors?.[0]?.longMessage ||
          err?.errors?.[0]?.message ||
          err?.message ||
          'Invalid verification code. Please check and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendSecondFactor = async () => {
    if (!isLoaded || !signIn) return;

    setErrorMessage('');
    setResendSuccessMessage('');
    setResendingCode(true);

    try {
      await signIn.prepareSecondFactor({ strategy: secondFactorStrategy });
      setResendSuccessMessage(
        secondFactorStrategy === 'phone_code'
          ? 'A new code has been sent to your phone.'
          : 'A new code has been sent to your email.'
      );
    } catch (err: any) {
      console.error('[SignIn] Resend second factor error:', err);
      setErrorMessage(
        err?.errors?.[0]?.longMessage ||
          err?.errors?.[0]?.message ||
          err?.message ||
          'Failed to resend code. Please try again in a few moments.'
      );
    } finally {
      setResendingCode(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setErrorMessage('');
      setGoogleLoading(true);

      const { createdSessionId, setActive: setOAuthActive } = await startOAuthFlow();

      if (createdSessionId && setOAuthActive) {
        await setOAuthActive({ session: createdSessionId });
        router.replace('/');
      }
    } catch (err: any) {
      console.error('[SignIn] Google OAuth Error:', err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Failed to sign in with Google.';
      setErrorMessage(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  // Device-trust / MFA code entry.
  if (pendingVerification) {
    return (
      <KeyboardAvoidingView
        style={[styles.keyboardContainer, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerContainer}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primaryMuted }]}>
              <Ionicons name="shield-checkmark-outline" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Verify It's You</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {secondFactorStrategy === 'phone_code'
                ? "We've sent a 6-digit code to your phone to confirm this device."
                : "We've sent a 6-digit code to your email to confirm this device."}
            </Text>
          </View>

          {errorMessage ? (
            <View
              style={[
                styles.errorContainer,
                { backgroundColor: isDark ? '#2A1515' : '#FFEBEE', borderColor: colors.error },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={20} color={colors.error} style={styles.errorIcon} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          ) : null}

          {resendSuccessMessage ? (
            <View
              style={[
                styles.successContainer,
                { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
              ]}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} style={styles.errorIcon} />
              <Text style={[styles.successText, { color: colors.primary }]}>{resendSuccessMessage}</Text>
            </View>
          ) : null}

          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                Verification Code
              </Text>
              <View
                style={[
                  styles.inputWrapper,
                  styles.codeInputWrapper,
                  { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
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

            <TouchableOpacity
              style={[
                styles.signInButton,
                { backgroundColor: colors.primary },
                (!isLoaded || loading) && styles.buttonDisabled,
              ]}
              onPress={handleVerifySecondFactor}
              disabled={!isLoaded || loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <Text style={styles.signInButtonText}>Verify & Sign In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.secondaryButton,
                { borderColor: colors.border, backgroundColor: colors.surface },
                resendingCode && styles.buttonDisabled,
              ]}
              onPress={handleResendSecondFactor}
              disabled={resendingCode || loading}
              activeOpacity={0.8}
            >
              {resendingCode ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                  Resend Code
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setPendingVerification(false);
                setVerificationCode('');
                setErrorMessage('');
                setResendSuccessMessage('');
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.backButtonText, { color: colors.textSecondary }]}>
                Back to Sign In
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.keyboardContainer, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header / Logo Area */}
        <View style={styles.headerContainer}>
          <Text style={[styles.brandTitle, { color: colors.primary }]}>
            GYM APP
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Welcome Back
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Sign in to access your workouts, memberships, and records.
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
          {/* Email input */}
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

          {/* Password input */}
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
                placeholder="Enter your password"
                placeholderTextColor={colors.inputPlaceholder}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMessage) setErrorMessage('');
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
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

          {/* Sign In Button */}
          <TouchableOpacity
            style={[
              styles.signInButton,
              { backgroundColor: colors.primary },
              (!isLoaded || loading || googleLoading) && styles.buttonDisabled,
            ]}
            onPress={handleSignIn}
            disabled={!isLoaded || loading || googleLoading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#000000" />
            ) : (
              <Text style={styles.signInButtonText}>Sign In</Text>
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

          {/* Google Sign-in Button */}
          <TouchableOpacity
            style={[
              styles.googleButton,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
              googleLoading && styles.buttonDisabled,
            ]}
            onPress={handleGoogleSignIn}
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

        {/* Footer / Sign Up Link */}
        <View style={styles.footerContainer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Don't have an account?{' '}
          </Text>
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.footerLink, { color: colors.primary }]}>
                Sign Up
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
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
  headerContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  codeInputWrapper: {
    justifyContent: 'center',
    height: 56,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    width: '100%',
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
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 16,
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
  fieldIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
  },
  eyeButton: {
    padding: 4,
    marginLeft: 6,
  },
  signInButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  signInButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
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
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '700',
  },
});
