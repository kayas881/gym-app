import type { KeyboardAvoidingViewProps } from 'react-native';

/**
 * What every `KeyboardAvoidingView` in this app should use.
 *
 * This used to be `Platform.OS === 'ios' ? 'padding' : undefined`, i.e. **no
 * keyboard handling at all on Android**. That was correct once: the Android
 * manifest sets `windowSoftInputMode="adjustResize"`, so the OS shrank the
 * window when the keyboard opened and a ScrollView could scroll on its own.
 *
 * It stopped being correct when edge-to-edge arrived — `edgeToEdgeEnabled=true`
 * in android/gradle.properties. Under edge-to-edge the app draws behind the
 * system bars and the window is no longer resized for the IME, so `adjustResize`
 * no longer does anything on its own and the keyboard simply covers whatever is
 * at the bottom of the screen. Reported on a real phone against the opening and
 * closing time fields on Gym Setup, which sit lowest on that form.
 *
 * `padding` works on both platforms: RN's KeyboardAvoidingView listens to
 * `keyboardDidShow` on Android too and pads by the measured overlap between its
 * own frame and the keyboard, which shrinks the ScrollView viewport so the
 * focused field can scroll into view.
 *
 * There is no double-compensation to worry about while edge-to-edge is on,
 * because the window is not also resizing. If edge-to-edge is ever turned off,
 * revisit this — Android would then resize AND pad.
 */
export const KEYBOARD_AVOID_BEHAVIOR: KeyboardAvoidingViewProps['behavior'] =
  'padding';
