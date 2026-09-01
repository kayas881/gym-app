/**
 * Helpers for labelling membership plans without repeating yourself.
 *
 * Gym owners usually name plans after their term ("3 Months", "1 Month"), so
 * showing a separate duration badge or "• 3 mo" suffix produced "3 Months • 3
 * mo". These decide whether the extra label actually adds information.
 */

/**
 * True when the plan's name already states its duration.
 *
 * Uses non-digit boundaries rather than a plain `includes`, so a plan called
 * "Plan 100" is not treated as stating a 1-month term.
 */
export function planNameStatesDuration(
  planName: string | null | undefined,
  durationMonths: number | null | undefined
): boolean {
  if (!planName || !durationMonths) return false;
  return new RegExp(`(^|\\D)${durationMonths}(\\D|$)`).test(planName);
}

/**
 * A duration suffix to append after a plan name, or '' when redundant.
 *
 * @example planDurationSuffix('3 Months', 3) === ''
 * @example planDurationSuffix('Gold', 12)    === '12 mo'
 */
export function planDurationSuffix(
  planName: string | null | undefined,
  durationMonths: number | null | undefined
): string {
  if (!durationMonths) return '';
  return planNameStatesDuration(planName, durationMonths)
    ? ''
    : `${durationMonths} mo`;
}
