import { parseJournalDate } from '../services/parseJournalDate';

// Accepts RFC 9562 versions 1-8 (v7 included — note IDs are time-ordered v7).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the value looks like a note UUID (any version 1-8). */
export function isNoteUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type DayRoute =
  | { kind: 'date'; date: string }
  | { kind: 'invalid' };

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isValidDayDate(value: string): boolean {
  if (!parseJournalDate(value)) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

/** Resolve a `/day/:date` pathname. Anything else is invalid — the retired
 * `/journal/:identity` grammar (UUID alias, slug alias, `/journal/:date/:uuid`)
 * no longer resolves. */
export function resolveDayRoute(pathname: string): DayRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const m = normalized.match(/^\/day\/([^/]+)$/);
  if (!m) return { kind: 'invalid' };
  const value = decodeSegment(m[1]!);
  if (value != null && isValidDayDate(value)) return { kind: 'date', date: value };
  return { kind: 'invalid' };
}
