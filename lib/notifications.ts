import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Push notification setup (Phase 5).
 *
 * Everything here is best-effort and never throws into the UI: push depends on
 * a real device, a development/production build (not Expo Go), OS-level
 * permission, and network. A gym app must stay fully usable when any of those
 * is missing, so failures are logged and swallowed.
 */

// Foreground behaviour. Without this, notifications arriving while the app is
// open are delivered silently and the user sees nothing.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android requires a channel or notifications arrive without sound/heads-up. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Gym Updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#B7F34A',
  });
}

/**
 * Asks for permission and returns the Expo push token, or null.
 *
 * Returns null (rather than throwing) on a simulator, in Expo Go, or when the
 * user declines — all normal states the caller should simply carry on from.
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    // Push requires real hardware; emulators cannot receive it.
    if (!Device.isDevice) {
      console.log('[Notifications] Skipped: not a physical device.');
      return null;
    }

    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    // Only prompt if not already decided — repeatedly asking is a bad
    // experience and iOS ignores the second request anyway.
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status !== 'granted') {
      console.log('[Notifications] Permission not granted.');
      return null;
    }

    // The EAS project id is required for push tokens in SDK 49+. It comes from
    // app.json extra.eas.projectId.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    if (!projectId) {
      console.warn('[Notifications] No EAS projectId; cannot mint a push token.');
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data ?? null;
  } catch (err) {
    // Expo Go on SDK 53+ throws here rather than returning null.
    console.warn('[Notifications] Could not get push token:', err);
    return null;
  }
}

/**
 * Registers this device's push token against the signed-in profile.
 *
 * Upserts on the token: if a device is handed to another user, the row moves to
 * the new profile rather than leaving the old one receiving their notifications.
 */
export async function registerPushToken(
  supabase: SupabaseClient,
  profileId: string
): Promise<string | null> {
  const token = await getExpoPushToken();
  if (!token) return null;

  try {
    const { error } = await supabase.from('push_tokens').upsert(
      {
        token,
        profile_id: profileId,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    );

    if (error) {
      console.warn('[Notifications] Could not save push token:', error.message);
      return null;
    }
    return token;
  } catch (err) {
    console.warn('[Notifications] Unexpected error saving push token:', err);
    return null;
  }
}

/**
 * Removes this device's token, so a signed-out phone stops receiving
 * notifications meant for the person who was using it.
 */
export async function unregisterPushToken(
  supabase: SupabaseClient
): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (!token) return;
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch (err) {
    console.warn('[Notifications] Could not remove push token:', err);
  }
}
