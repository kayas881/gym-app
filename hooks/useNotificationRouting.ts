import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAppAuth } from '../lib/auth';
import { routeForNotification } from '../lib/notification-routing';

/**
 * Sends the user to the right screen when they tap a push notification.
 *
 * Until this existed, tapping any notification just opened the app wherever it
 * happened to be: "Renewal request" did not open the pending queue, and
 * "Membership expiring soon" did not open Renew. The payloads were already
 * being sent (see lib/notification-routing.ts) but nothing listened for them.
 *
 * Two entry points, because a tap arrives differently depending on the app's
 * state:
 *   - `addNotificationResponseReceivedListener` for a tap while the app is
 *     running or backgrounded;
 *   - `getLastNotificationResponseAsync` for a tap that launched the app from
 *     cold, which the listener never sees because it fires before we subscribe.
 *
 * Neither can navigate immediately. The route depends on the signed-in role,
 * and app/index.tsx does its own auth gating on launch, so navigating early
 * either targets the wrong role or gets bounced. Instead the payload is parked
 * and only consumed once a role is actually known.
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  const { isSignedIn, role, membershipLoading } = useAppAuth();

  // The payload waiting for a role to resolve.
  const [pending, setPending] = useState<unknown | null>(null);

  // getLastNotificationResponseAsync keeps returning the same response for the
  // life of the process, so without this it would re-fire on every state change
  // and drag the user back out of whatever they had navigated to.
  const coldStartConsumed = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        if (cancelled || coldStartConsumed.current) return;
        coldStartConsumed.current = true;
        const data = response?.notification?.request?.content?.data;
        if (data) setPending(data);
      } catch (err) {
        // A cold-start tap failing to route is a missed convenience, never a
        // reason to break launch.
        console.warn('[NotificationRouting] Cold start lookup failed:', err);
      }
    })();

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response?.notification?.request?.content?.data;
        if (data) setPending(data);
      }
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    // Wait for a settled role: routing is role-specific, and membershipLoading
    // is still true during the fetch right after launch.
    if (!isSignedIn || membershipLoading || !role) return;

    const route = routeForNotification(pending, role);
    setPending(null);

    if (!route) return;
    try {
      router.push(route as never);
    } catch (err) {
      console.warn('[NotificationRouting] Navigation failed:', route, err);
    }
  }, [pending, isSignedIn, membershipLoading, role, router]);
}
