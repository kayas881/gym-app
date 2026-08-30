/**
 * Date utility functions for membership calculations.
 */

/**
 * Format a date string to a human-readable format.
 * @example formatDate('2024-03-15') → 'Mar 15, 2024'
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a timestamp to date + time.
 * @example formatDateTime('2024-03-15T10:30:00Z') → 'Mar 15, 2024 at 4:00 PM'
 */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
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
 * Check if a date is in the past.
 */
export function isExpired(endDateString: string): boolean {
  return daysRemaining(endDateString) === 0;
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
