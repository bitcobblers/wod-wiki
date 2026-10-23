/**
 * Date formatting helpers pinned to 'en-US' so the UI is stable regardless of
 * the user's browser locale (e.g. zh-CN would otherwise render "12月8日").
 *
 * All callers should use these helpers instead of calling `Date.prototype.toLocaleDateString`
 * or `Date.prototype.toLocaleString` with an undefined or locale-agnostic `locales` argument.
 */

export function formatDateHeader(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateMedium(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateWeekdayShort(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTimeMediumShort(date: Date): string {
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDateTimeMedium(date: Date): string {
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
}

export function formatDateDefault(date: Date): string {
  return date.toLocaleDateString('en-US');
}

/**
 * 'YYYY-MM-DD' in local time. Avoids the UTC shift `toISOString()` introduces.
 */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
