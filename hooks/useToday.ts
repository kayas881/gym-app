import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { today } from '../utils/date';

/**
 * The local calendar day as YYYY-MM-DD, which actually changes when the day
 * does.
 *
 * Why this exists. Anything counting days -- `daysRemaining()`, `isExpired()`,
 * a check-in streak -- reads the clock, but the values it is derived from (a
 * subscription's end_date, a list of check-ins) do not change at midnight. So a
 * `useMemo` keyed only on those never recomputes, and the number it produced on
 * first render is the number it keeps forever.
 *
 * That is not theoretical: Expo Router keeps tab screens mounted, so the
 * member's Home tab can sit in the background for days. The reported symptom
 * was a membership showing the same "181 days left" on two different days.
 *
 * Put this in the dependency array of any memo that reads the clock. It updates
 * on two triggers, because each covers a case the other misses:
 *   - regaining focus, for a screen the user navigates back to;
 *   - a timer armed for the next local midnight, for a screen left open.
 */
export function useToday(): string {
  const [day, setDay] = useState(today);

  // A screen the user comes back to re-checks immediately.
  useFocusEffect(
    useCallback(() => {
      setDay(today());
    }, [])
  );

  // A screen nobody touches still rolls over on its own. Re-armed after each
  // rollover because `day` is a dependency.
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    // setHours(24, ...) is midnight at the start of tomorrow, local time, and
    // handles month and year ends without any date arithmetic.
    nextMidnight.setHours(24, 0, 0, 0);

    // A second past midnight, so the timer cannot fire a hair early and read
    // the previous day back out.
    const delay = nextMidnight.getTime() - now.getTime() + 1000;

    const timer = setTimeout(() => setDay(today()), delay);
    return () => clearTimeout(timer);
  }, [day]);

  return day;
}
