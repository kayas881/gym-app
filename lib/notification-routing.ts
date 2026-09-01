import type { UserRole } from './auth';

/**
 * Where a tapped push notification should take the user.
 *
 * Kept as a pure function, separate from the listener, because the mapping is
 * the part worth testing: it has to stay in step with the `data` payloads the
 * database actually sends, and those live in SQL where TypeScript cannot see
 * them.
 *
 * Every payload below is emitted by `send_push_to_profiles`:
 *
 *   type                      | sent to           | migration
 *   --------------------------|-------------------|---------------
 *   announcement              | targeted audience | 031
 *   membership_expiring       | member            | 016, 021, 024
 *   complaint_update          | member            | 017
 *   membership_expired_owner  | owner             | 016, 021, 024
 *   renewal_request           | owner             | 019
 *   weekly_summary            | owner             | 017
 *
 * Returning null means "just open the app where it was". That is the right
 * outcome for an unknown type, and also for a payload that does not match the
 * signed-in role: a device can be handed to another account, and a queued
 * notification can outlive a promotion from member to staff. Pushing an owner
 * into /(member)/renew would land them on a screen with no data.
 */
export function routeForNotification(data: unknown, role: UserRole): string | null {
  if (!data || typeof data !== 'object') return null;

  const type = (data as Record<string, unknown>).type;
  if (typeof type !== 'string') return null;

  switch (type) {
    // The only type every role can receive: announcement_recipients() resolves
    // the audience (everyone / active / staff / a time slot), so a staff-only
    // post reaches staff and the owner, and a slot-targeted one reaches members.
    // Each role reads announcements on its own screen.
    case 'announcement':
      if (role === 'member') return '/(member)/announcements';
      if (role === 'staff') return '/(staff)/announcements';
      if (role === 'owner') return '/(owner)/announcements';
      return null;

    // "Renew to keep your access." Renew is where they can act on it.
    case 'membership_expiring':
      return role === 'member' ? '/(member)/renew' : null;

    // There is no member-side complaint DETAIL screen, so the list is the
    // deepest correct target. The owner's reply is rendered on the card there.
    case 'complaint_update':
      return role === 'member' ? '/(member)/complaints' : null;

    // "Review them in Members."
    case 'membership_expired_owner':
      return role === 'owner' ? '/(owner)/members' : null;

    // Renewal requests are listed on the pending screen, not the members list.
    case 'renewal_request':
      return role === 'owner' ? '/(owner)/members/pending' : null;

    case 'weekly_summary':
      return role === 'owner' ? '/(owner)/dashboard' : null;

    default:
      return null;
  }
}
