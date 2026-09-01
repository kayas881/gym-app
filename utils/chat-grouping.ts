/**
 * Consecutive-message grouping for the staff chat screens.
 *
 * Both staff-chat screens drew the avatar, the sender's name and a timestamp on
 * every single row, so three messages typed in a row read as three separate
 * announcements from a stranger. This decides what a given row still needs to
 * draw. The owner and staff screens style their bubbles differently, so they
 * share this decision rather than a component.
 */

/** Same sender inside this window is treated as one continuous group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface GroupableMessage {
  created_at: string;
  sender?: { id?: string | null } | null;
}

export interface MessageGrouping {
  /** Draw the avatar and sender name: this row starts a group. */
  showHeader: boolean;
  /** Draw the timestamp: this row ends a group. */
  showTimestamp: boolean;
}

function sameSender(a: GroupableMessage, b: GroupableMessage): boolean {
  const idA = a.sender?.id;
  const idB = b.sender?.id;
  // A missing sender id must never group — otherwise two different people with
  // an unresolved profile would collapse into one another.
  return idA != null && idB != null && idA === idB;
}

function withinWindow(older: GroupableMessage, newer: GroupableMessage): boolean {
  const gap =
    new Date(newer.created_at).getTime() - new Date(older.created_at).getTime();
  return Number.isFinite(gap) && Math.abs(gap) <= GROUP_WINDOW_MS;
}

/**
 * `messages` must be in ascending (oldest-first) order, which is what
 * useStaffChat returns.
 */
export function messageGrouping(
  messages: GroupableMessage[],
  index: number
): MessageGrouping {
  const item = messages[index];
  if (!item) return { showHeader: true, showTimestamp: true };

  const prev = index > 0 ? messages[index - 1] : undefined;
  const next = messages[index + 1];

  const continuesPrev = !!prev && sameSender(prev, item) && withinWindow(prev, item);
  const continuedByNext = !!next && sameSender(item, next) && withinWindow(item, next);

  return { showHeader: !continuesPrev, showTimestamp: !continuedByNext };
}
