/**
 * Announcement audience targeting.
 *
 * Extracted because the member announcements screen and the home-screen
 * preview each had their own copy of this filter, and both copies carried the
 * same two bugs: 'active' was treated as "always show", and the check-in
 * derived auto_time_slot was never consulted.
 *
 * Note the database does NOT enforce audience: announcements_select_policy is
 * `is_gym_member_or_owner(gym_id)`, so every gym member can read every row.
 * This filter is what makes targeting mean anything in the UI.
 */

export type TargetAudience =
  | 'everyone'
  | 'active'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'staff';

export type TimeSlot = 'morning' | 'afternoon' | 'evening';

export interface AudienceContext {
  /** gym_members.status */
  membershipStatus?: string | null;
  /** gym_members.role */
  role?: string | null;
  /** gym_members.preferred_time_slot — the member's explicit choice */
  preferredTimeSlot?: string | null;
  /** gym_members.auto_time_slot — detected from check-in history */
  autoTimeSlot?: string | null;
  /** profiles.preferred_gym_timing — free text such as "6-8 PM" */
  preferredGymTiming?: string | null;
}

function normalizeSlot(value?: string | null): TimeSlot | null {
  const slot = value?.trim().toLowerCase();
  return slot === 'morning' || slot === 'afternoon' || slot === 'evening'
    ? slot
    : null;
}

/**
 * The time slot a member counts as: anything they explicitly chose first, then
 * the slot inferred from check-ins as a fallback.
 *
 * Order matters. `autoTimeSlot` used to sit ahead of `preferredGymTiming`,
 * which meant a member who explicitly picked "morning" but had a single evening
 * check-in was targeted as evening — detection silently overrode an explicit
 * preference. `preferredTimeSlot` is a gym_members column nothing currently
 * writes; `preferredGymTiming` is what the profile screen actually saves, and
 * being free text it simply matches nothing when it isn't a slot name.
 *
 * Mirrors the precedence in the announcement_recipients SQL function, so push
 * targeting and the in-app feed agree.
 */
export function resolveMemberTimeSlot(ctx: AudienceContext): TimeSlot | null {
  return (
    normalizeSlot(ctx.preferredTimeSlot) ??
    normalizeSlot(ctx.preferredGymTiming) ??
    normalizeSlot(ctx.autoTimeSlot)
  );
}

/**
 * Whether an announcement with `targetAudience` should be shown to this member.
 */
export function canViewAnnouncement(
  targetAudience: string | null | undefined,
  ctx: AudienceContext
): boolean {
  const target = (targetAudience || 'everyone').trim().toLowerCase();

  // 'everyone' means everyone still attached to the gym. A rejected applicant
  // or a removed former member is not, and must not see the feed even though
  // announcement_recipients() already excludes them from push — the two paths
  // have to agree (that's the whole reason this module is shared).
  if (ctx.membershipStatus === 'rejected' || ctx.membershipStatus === 'removed') {
    return false;
  }

  switch (target) {
    case 'everyone':
      return true;

    // Previously returned true unconditionally, which made "Active Members
    // Only" identical to "Everyone" — expired and pending members saw it too.
    case 'active':
      return ctx.membershipStatus === 'active';

    case 'staff':
      return ctx.role === 'staff' || ctx.role === 'owner';

    case 'morning':
    case 'afternoon':
    case 'evening':
      return resolveMemberTimeSlot(ctx) === target;

    default:
      // Unknown audience: fail closed rather than leaking to everyone.
      return false;
  }
}
