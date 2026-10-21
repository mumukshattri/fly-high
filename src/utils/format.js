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

/** Turns an enum-ish string into a CSS-safe class suffix: 'Under Review' -> 'under-review' */
export function slugify(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, '-');
}
