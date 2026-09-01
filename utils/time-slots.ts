import { TIME_SLOTS, TimeSlot } from '../constants/config';

/**
 * Determine which time slot a check-in time falls into.
 */
export function getTimeSlotForHour(hour: number): TimeSlot | null {
  for (const [slot, range] of Object.entries(TIME_SLOTS)) {
    if (hour >= range.start && hour < range.end) {
      return slot as TimeSlot;
    }
  }
  return null;
}

/**
 * Auto-detect a member's time slot based on their check-in history.
 * Returns the time slot where they check in most frequently.
 *
 * @param checkInTimes - Array of ISO timestamp strings
 * @returns The most common time slot, or null if insufficient data
 */
export function detectTimeSlot(checkInTimes: string[]): TimeSlot | null {
  if (checkInTimes.length < 3) return null; // Need at least 3 check-ins to determine pattern

  const slotCounts: Record<string, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
  };

  for (const time of checkInTimes) {
    const hour = new Date(time).getHours();
    const slot = getTimeSlotForHour(hour);
    if (slot) {
      slotCounts[slot]++;
    }
  }

  // Find the slot with the most check-ins
  let maxSlot: TimeSlot = 'morning';
  let maxCount = 0;

  for (const [slot, count] of Object.entries(slotCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxSlot = slot as TimeSlot;
    }
  }

  // Only return if there's a clear pattern (>50% of check-ins)
  const totalSlotted = Object.values(slotCounts).reduce((a, b) => a + b, 0);
  if (totalSlotted > 0 && maxCount / totalSlotted > 0.5) {
    return maxSlot;
  }

  return maxSlot; // Return the most common even if not dominant
}

/**
 * Get a display label for a time slot.
 */
export function getTimeSlotLabel(slot: TimeSlot): string {
  const labels: Record<TimeSlot, string> = {
    morning: '🌅 Morning (5-11 AM)',
    afternoon: '☀️ Afternoon (11 AM-4 PM)',
    evening: '🌙 Evening (4-10 PM)',
  };
  return labels[slot];
}

/**
 * Get a short label for a time slot.
 */
export function getTimeSlotShortLabel(slot: TimeSlot): string {
  const labels: Record<TimeSlot, string> = {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
  };
  return labels[slot];
}
