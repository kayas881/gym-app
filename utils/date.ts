/**
 * Date utility functions for membership calculations.
 */

/**
 * Format a date for display, day-first as used in India.
 * @example formatDate('2005-03-16') → '16/03/2005'
 *
 * DISPLAY ONLY. Everything stored, compared or sent to Postgres stays
 * ISO YYYY-MM-DD -- `today()`, `daysFromToday()`, `renewalStartDate()` and the
 * date columns themselves. Half the logic in this app compares those as plain
 * strings (`active_end_date < today()`), which only works because ISO sorts
 * lexicographically; day-first strings do not. Use `toIndianDate` to fill a text
 * input and `parseIndianDate` to read one back.
 *
 * The year is shown in full deliberately: "16/03/05" cannot distinguish 1905
 * from 2005, which for a date of birth changes someone's age by a century.
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format a timestamp as date + time, day-first.
 * @example formatDateTime('2005-03-16T10:30:00Z') → '16/03/2005, 4:00 pm'
 */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${formatDate(dateString)}, ${time}`;
}

/**
 * Render a stored ISO date into the day-first form a text input shows.
 * Anything not ISO is passed through untouched, so a half-typed value is never
 * rewritten under the user.
 * @example toIndianDate('2005-03-16') → '16/03/2005'
 */
export function toIndianDate(value?: string | null): string {
  if (!value) return '';
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Read a day-first date typed by a user and return it as ISO YYYY-MM-DD, or
 * null if it is not a real date. Storage and every comparison want ISO, so this
 * is the boundary where the two meet.
 *
 * Accepts 16/03/2005, 16-03-2005, 16.03.2005 and 1/3/2005, plus an already-ISO
 * value so a stored date or a paste still works. A two-digit year uses a
 * sliding window -- up to the current year is this century, above it the last --
 * so 05 is 2005 and 95 is 1995. Ambiguous by nature, which is why the display
 * side always writes the year in full.
 */
export function parseIndianDate(input: string): string | null {
  const v = input.trim();
  if (!v) return null;

  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return isValidDateString(v) ? v : null;

  const m = /^([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{2}|[0-9]{4})$/.exec(v);
  if (!m) return null;

  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  let year = m[3];
  if (year.length === 2) {
    const currentTwoDigit = new Date().getFullYear() % 100;
    const yy = Number(year);
    year = String(yy <= currentTwoDigit ? 2000 + yy : 1900 + yy);
  }

  const iso = `${year}-${month}-${day}`;
  // isValidDateString rejects overflow like 31/02, which Date rolls forward.
  return isValidDateString(iso) ? iso : null;
}

/**
 * Calculate the number of days remaining until a date.
 * Returns 0 if the date is in the past.
 */
export function daysRemaining(endDateString: string): number {
  const endDate = new Date(endDateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  const diffMs = endDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * True once a membership period has actually ended.
 *
 * end_date is INCLUSIVE, matching the database: expire_stale_memberships()
 * retires a subscription only when `end_date < today`, and keeps the member
 * active while `end_date >= today`. This used to be
 * `daysRemaining(end) === 0`, and daysRemaining returns 0 *on* the end date as
 * well as after it -- so on the last day of their membership a member was shown
 * "Membership Expired" while the database still considered them active and
 * check-in still worked.
 *
 * Compared as YYYY-MM-DD strings against the local day, the same way the rest of
 * this file avoids UTC drift.
 */
export function isExpired(endDateString: string): boolean {
  if (!endDateString) return false;
  const day = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(endDateString)
    ? endDateString
    : localDateOf(endDateString);
  return day < today();
}

/**
 * Format a Date as YYYY-MM-DD using its LOCAL calendar day.
 *
 * `toISOString()` converts to UTC first, which in IST (UTC+5:30) reports the
 * previous day between 00:00 and 05:29 local time — a payment recorded early
 * in the morning would be dated yesterday.
 */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate end date given a start date and duration in months.
 *
 * Clamps to the last day of the target month rather than overflowing into the
 * next one: Jan 31 + 1 month is Feb 28, not Mar 3. Plain `setMonth()` overflows
 * whenever the target month is shorter than the start day, which handed members
 * extra free days on any plan sold on the 29th-31st.
 */
export function calculateEndDate(startDate: string, durationMonths: number): string {
  const [year, month, day] = startDate.split('-').map(Number);

  // Day 1 of the target month, so the month arithmetic can't overflow.
  const target = new Date(year, month - 1 + durationMonths, 1);

  // Day 0 of the following month === last day of the target month.
  const lastDayOfTargetMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();

  target.setDate(Math.min(day, lastDayOfTargetMonth));
  return toLocalDateString(target);
}

/**
 * Get today's date as YYYY-MM-DD string, in the device's local calendar day.
 */
export function today(): string {
  return toLocalDateString(new Date());
}

/**
 * Today plus `days`, as a YYYY-MM-DD string in the local calendar day.
 */
export function daysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

/**
 * The local calendar day (YYYY-MM-DD) that a timestamp falls on.
 *
 * `timestamp.split('T')[0]` looks equivalent but reads the UTC day, so a 1am
 * IST check-in would be filed under the previous date.
 */
export function localDateOf(timestamp: string): string {
  return toLocalDateString(new Date(timestamp));
}

/**
 * Start and end instants (ISO) of a local calendar day, for querying
 * timestamptz columns.
 *
 * Comparing against a naive `'2026-08-30T00:00:00'` makes Postgres interpret it
 * as UTC, which in IST is 5:30am — so a plain string range silently covers the
 * wrong window. Converting through Date produces the correct instants.
 */
export function localDayRange(dateStr: string = today()): { start: string; end: string } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return {
    start: new Date(year, month - 1, day, 0, 0, 0, 0).toISOString(),
    end: new Date(year, month - 1, day, 23, 59, 59, 999).toISOString(),
  };
}

/**
 * Format a duration in days to a human-readable string.
 * @example formatDuration(45) → '1 month, 15 days'
 * @example formatDuration(3) → '3 days'
 * @example formatDuration(0) → 'Expired'
 */
export function formatDuration(days: number): string {
  if (days <= 0) return 'Expired';
  if (days === 1) return '1 day';

  const months = Math.floor(days / 30);
  const remainingDays = days % 30;

  if (months === 0) return `${days} days`;
  if (remainingDays === 0) return months === 1 ? '1 month' : `${months} months`;

  const monthStr = months === 1 ? '1 month' : `${months} months`;
  const dayStr = remainingDays === 1 ? '1 day' : `${remainingDays} days`;
  return `${monthStr}, ${dayStr}`;
}

/**
 * Get relative time string (e.g., "2 hours ago", "just now").
 */
export function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

/**
 * The date a renewal should start from, given the member's current end date.
 *
 * end_date is inclusive — a membership ending 30 Nov is valid through 30 Nov —
 * so a renewal begins the day after. When the current membership has already
 * lapsed (or there isn't one) the renewal simply starts today.
 *
 * This exists because record_subscription_payment expires the previous
 * subscription unconditionally. Defaulting an early renewal to today would
 * throw away every day the member had already paid for: renewing a 6-month
 * plan (valid to 28 Feb) with a 3-month plan on day two silently cut the
 * membership back to 30 Nov. Gyms add time on; they don't reset the clock.
 */
export function renewalStartDate(currentEndDate?: string | null): string {
  if (!currentEndDate) return today();

  const nextDay = new Date(currentEndDate);
  if (isNaN(nextDay.getTime())) return today();
  nextDay.setDate(nextDay.getDate() + 1);

  const candidate = toLocalDateString(nextDay);
  // A lapsed membership shouldn't backdate the new one.
  return candidate > today() ? candidate : today();
}

/**
 * Label for a feed timestamp: announcements, complaints.
 *
 * Four screens rendered `timeAgo(x) + " • " + formatDateTime(x)`, which came out
 * as "yesterday • 31 Aug 2026, 1:14 am" — the relative half and the absolute
 * half saying the same thing twice, on every row. This keeps whichever half is
 * actually carrying information: relative wording while that still locates the
 * event, the calendar date once it stops.
 *
 * The time of day is always kept. For a gym, "closed this morning" posted at
 * 1:14 am matters, and the day alone loses that.
 */
export function timestampLabel(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const time = date.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Compare local calendar days, not elapsed hours: something posted at 11pm is
  // "yesterday" at 1am, not "2 hours ago".
  const dayOf = toLocalDateString(date);
  const t = today();
  if (dayOf === t) return `Today, ${time}`;
  if (dayOf === daysFromToday(-1)) return `Yesterday, ${time}`;

  if (dayOf > daysFromToday(-7) && dayOf < t) {
    const days = Math.round(
      (new Date(`${t}T00:00:00`).getTime() - new Date(`${dayOf}T00:00:00`).getTime()) /
        86400000
    );
    return `${days} days ago, ${time}`;
  }

  // Older, or dated in the future (clock skew): show the calendar date.
  return formatDateTime(dateString);
}

/**
 * True if a YYYY-MM-DD string is a real calendar date.
 *
 * `new Date('2026-13-45')` is Invalid Date, but `new Date('31-08-2026')` is
 * *also* Invalid Date, and `new Date('2026-08-31extra')` parses fine — so the
 * shape has to be checked before the value.
 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (isNaN(parsed.getTime())) return false;
  // Rejects overflow like 2026-02-30, which Date silently rolls forward.
  return toLocalDateString(parsed) === value;
}

/**
 * Validate a free-text date of birth destined for profiles.date_of_birth,
 * which is a Postgres `date`. Returns null when the value is acceptable — an
 * empty string is acceptable, because date of birth is optional — otherwise the
 * message to show the user.
 *
 * Three screens collect this as free text (member profile, staff profile and
 * the complete-profile signup step). Only the member profile checked it, so
 * "17-05-2007" (day-first) and "2007-02-30" (overflow) reached the driver
 * directly from the other two and surfaced as an unreadable 22007/22008.
 */
export function dateOfBirthError(value: string): string | null {
  if (!value.trim()) return null;
  const iso = parseIndianDate(value);
  if (!iso) return 'Please enter it as DD/MM/YYYY, for example 09/04/2001.';
  if (iso > today()) return 'That date is in the future.';
  if (iso < '1900-01-01') return 'Please enter a realistic date.';
  return null;
}
