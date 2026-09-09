/**
 * Providers report a rate limit reset as an epoch number, an ISO timestamp, or
 * a string they already formatted themselves. Claude sends seconds, Codex can
 * send seconds or ISO, and a snapshot read back from disk can carry either, so
 * the numeric unit is inferred rather than assumed: anything below the year
 * 2286 in milliseconds is far more likely to be seconds.
 */
const EPOCH_SECONDS_CEILING = 10_000_000_000;

export function resolvePlanResetDate(value: unknown): Date | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return null;
    }
    const milliseconds = Date.parse(trimmed);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const milliseconds = value > EPOCH_SECONDS_CEILING ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The label shown in the badge and in the quota rows, where the column is one
 * `auto` track next to a meter and a percentage. It stays short on purpose: the
 * time when the reset is today, the weekday otherwise. The exact instant is not
 * lost — it travels alongside as `resetAt` and is spelled out in the tooltip.
 */
export function formatPlanResetLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = resolvePlanResetDate(trimmed);
    return parsed ? formatPlanResetDate(parsed) : trimmed;
  }

  const date = resolvePlanResetDate(value);
  if (!date) {
    return null;
  }

  return formatPlanResetDate(date);
}

function formatPlanResetDate(date: Date): string {
  const now = new Date();
  if (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  ) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

/**
 * The full instant, for the tooltip, where nothing competes for the width:
 * weekday, calendar date and time of day. "Weekly, resets Sat" answers when the
 * week rolls over only if the reader also works out which Saturday; "Sat
 * 12.09.2026 02:00" answers it outright.
 *
 * The three parts are formatted separately and joined with spaces rather than
 * asked of one `DateTimeFormat`, because a single call inserts locale
 * punctuation between them and the result reads as prose instead of a stamp.
 */
export function formatPlanResetInstant(value: unknown): string | null {
  const date = resolvePlanResetDate(value);
  if (!date) {
    return null;
  }

  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  const day = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  return `${weekday} ${day} ${time}`;
}
