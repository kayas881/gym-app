/**
 * Per-day gym opening hours.
 *
 * Replaces the single free-text string the owner used to type into Settings.
 * That string could say anything ("6-10", "mornings only"), so nothing could
 * ever answer "is the gym open right now" or "is it shut on Sunday".
 *
 * Shared by the owner's editor and the member-facing gym screen so the two can
 * never disagree — the same reason utils/announcement-audience.ts exists.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export const DAY_SHORT: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export interface DayHours {
  closed: boolean;
  /** "HH:MM", 24-hour. Retained even while closed - see normalizeDay. */
  open: string;
  close: string;
}

export interface OperatingHours {
  version: 2;
  days: Record<DayKey, DayHours>;
  /** Free text for the things a grid can't express ("Closed on Diwali"). */
  note?: string;
}

/**
 * getDay() returns 0 for Sunday, so it cannot index DAY_KEYS directly — a
 * mistake that would silently show Sunday's hours on Monday.
 */
const JS_DAY_TO_KEY: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function defaultOperatingHours(): OperatingHours {
  const days = {} as Record<DayKey, DayHours>;
  for (const key of DAY_KEYS) {
    days[key] = { closed: false, open: '06:00', close: '22:00' };
  }
  return { version: 2, days };
}

/**
 * A closed day KEEPS its open/close times rather than blanking them, so
 * toggling a day shut and open again restores the hours the owner had set
 * instead of snapping back to 06:00-22:00. formatDayHours() renders 'Closed'
 * regardless, so the retained values are never shown while closed.
 */
function normalizeDay(raw: any): DayHours {
  const closed = raw?.closed === true;
  const open = typeof raw?.open === 'string' && isValidTime(raw.open) ? raw.open : '06:00';
  const close = typeof raw?.close === 'string' && isValidTime(raw.close) ? raw.close : '22:00';
  return { closed, open, close };
}

/**
 * Reads whatever is in gyms.operating_hours.
 *
 * Three shapes exist in the wild: the version-2 document, the pre-023
 * `{ summary: "..." }`, and a bare string from even earlier. Anything
 * unrecognised yields nulls so the caller shows "not set" rather than
 * rendering garbage.
 */
export function parseOperatingHours(raw: any): {
  hours: OperatingHours | null;
  legacySummary: string | null;
} {
  if (!raw) return { hours: null, legacySummary: null };

  if (typeof raw === 'string') {
    const text = raw.trim();
    return { hours: null, legacySummary: text || null };
  }

  if (typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
    const days = {} as Record<DayKey, DayHours>;
    for (const key of DAY_KEYS) {
      days[key] = normalizeDay(raw.days[key]);
    }
    const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined;
    return { hours: { version: 2, days, note }, legacySummary: null };
  }

  if (typeof raw === 'object' && typeof raw.summary === 'string') {
    const text = raw.summary.trim();
    return { hours: null, legacySummary: text || null };
  }

  return { hours: null, legacySummary: null };
}

export function isValidTime(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Reads a time a person typed and returns it as "HH:MM", or null if it is not a
 * real time. The inverse of formatTime.
 *
 * Accepts what people actually write for a gym's hours: "6:00 AM", "6 AM",
 * "6am", "06:00", "18:00", "6". Anything else is rejected rather than guessed
 * at, because a wrong closing time silently changes who counts as an evening
 * member.
 */
export function parseTimeInput(value: string): string | null {
  const v = value.trim().toUpperCase().split(' ').join('');
  if (!v) return null;

  const match = /^([0-9]{1,2})(?::([0-9]{2}))?(AM|PM)?$/.exec(v);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'AM') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "06:00" -> "6:00 AM". Members shouldn't have to read 24-hour time. */
export function formatTime(value: string): string {
  if (!isValidTime(value)) return value;
  const [h, m] = value.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDayHours(day: DayHours): string {
  if (day.closed) return 'Closed';
  return `${formatTime(day.open)} – ${formatTime(day.close)}`;
}

/** Minutes since midnight, for comparisons. */
function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function todayKey(now: Date = new Date()): DayKey {
  return JS_DAY_TO_KEY[now.getDay()];
}

/**
 * Whether the gym is open at `now`.
 *
 * Handles a close time at or before the open time as an overnight shift
 * (a 24-hour gym might run 22:00–06:00), which a naive `open <= t < close`
 * would report as permanently closed.
 */
export function isOpenNow(hours: OperatingHours | null, now: Date = new Date()): boolean | null {
  if (!hours) return null;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = hours.days[todayKey(now)];

  if (today && !today.closed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (close > open) {
      if (minutes >= open && minutes < close) return true;
    } else if (minutes >= open) {
      // Overnight: still inside yesterday-evening's session.
      return true;
    }
  }

  // An overnight session that began yesterday and hasn't closed yet.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const prev = hours.days[todayKey(yesterday)];
  if (prev && !prev.closed) {
    const open = toMinutes(prev.open);
    const close = toMinutes(prev.close);
    if (close <= open && minutes < close) return true;
  }

  return false;
}

/**
 * Collapses the week into a readable line, grouping consecutive days that
 * share the same hours: "Mon – Fri 6:00 AM – 10:00 PM · Sat 7:00 AM – 1:00 PM
 * · Sun Closed".
 *
 * Written to storage as `summary` purely so readers predating 023 (which look
 * for operating_hours.summary) still show something. Nothing computes from it.
 */
export function summarizeOperatingHours(hours: OperatingHours | null): string {
  if (!hours) return '';

  const parts: string[] = [];
  let runStart = 0;

  const sameAs = (a: DayHours, b: DayHours) =>
    a.closed === b.closed && (a.closed || (a.open === b.open && a.close === b.close));

  for (let i = 1; i <= DAY_KEYS.length; i++) {
    const current = i < DAY_KEYS.length ? hours.days[DAY_KEYS[i]] : null;
    const previous = hours.days[DAY_KEYS[i - 1]];

    if (current && sameAs(current, previous)) continue;

    const startKey = DAY_KEYS[runStart];
    const endKey = DAY_KEYS[i - 1];
    const label =
      runStart === i - 1
        ? DAY_SHORT[startKey]
        : `${DAY_SHORT[startKey]} – ${DAY_SHORT[endKey]}`;

    parts.push(`${label} ${formatDayHours(previous)}`);
    runStart = i;
  }

  const summary = parts.join(' · ');
  return hours.note ? `${summary} · ${hours.note}` : summary;
}

/**
 * The value to write to gyms.operating_hours.
 */
export function serializeOperatingHours(hours: OperatingHours): Record<string, unknown> {
  return {
    version: 2,
    days: hours.days,
    ...(hours.note ? { note: hours.note } : {}),
    summary: summarizeOperatingHours(hours),
  };
}
