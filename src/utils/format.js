/**
 * utils/format.js
 * ---------------------------------------------------------------------------
 * Tiny pure helpers used across many components. Keeping them here stops us
 * from repeating `new Date(...).toLocaleDateString()` in every page.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-15' -> '15 Oct 2026' */
export function formatDate(isoDate) {
  if (!isoDate) return '—';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** '2026-10-15' -> 9 (whole days from today; negative when overdue) */
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** '9 days left' / 'Closes today' / 'Deadline passed' */
export function deadlineLabel(isoDate) {
  const days = daysUntil(isoDate);
  if (days === null) return '—';
  if (days < 0) return 'Deadline passed';
  if (days === 0) return 'Closes today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

/** Initials for avatars: 'Aarav Sharma' -> 'AS' */
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

/**
 * '2026-11-05T09:12:00Z' -> '2 days ago' / 'Today'.
 * Used by external job cards, whose timestamps are real ISO instants from the
 * provider rather than the plain YYYY-MM-DD dates used internally.
 */
export function relativeTime(isoInstant) {
  if (!isoInstant) return null;
  const time = new Date(isoInstant).getTime();
  if (Number.isNaN(time)) return null;

  const diffMinutes = Math.round((Date.now() - time) / 60000);
  if (diffMinutes < 60) return diffMinutes <= 1 ? 'Just now' : `${diffMinutes} minutes ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`;

  const date = new Date(isoInstant);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * A salary band in the provider's own currency, e.g. '₹12,00,000 - ₹18,00,000'.
 * Returns null when the provider sent no numbers - never a guess.
 */
export function formatSalary(salary) {
  if (!salary) return null;
  const { min, max, currency } = salary;
  const format = (value) => {
    if (!value) return null;
    try {
      return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: currency || 'INR',
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  };

  const low = format(min);
  const high = format(max);
  if (low && high && min !== max) return `${low} - ${high}`;
  return low || high || null;
}

/** Turns an enum-ish string into a CSS-safe class suffix: 'Under Review' -> 'under-review' */
export function slugify(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, '-');
}
