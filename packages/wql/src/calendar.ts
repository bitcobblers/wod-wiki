/**
 * Calendar — system-local civil calendar arithmetic over captured execution
 * contexts (wayfinder datadog-analytics ticket 12, per the time alignment
 * contract §§ Evaluation context, Calendar and duration windows).
 *
 * Calendar days run from local midnight to the next local midnight in the
 * context's timezone; weeks start on Monday. All arithmetic is component
 * math via the timezone's civil date — never multiplication by 86 400 000
 * ms, which mislabels DST-shifted days. Range endpoints are half-open:
 * start included, exclusive end; an inclusive `to` civil date is implemented
 * as an exclusive bound at the following local midnight.
 */

/** One captured execution context: every relative window, bucket, and
 *  boundary decision in a document run resolves against this one capture. */
export interface ExecutionContext {
  /** Captured current instant (ms epoch). */
  readonly instant: number;
  /** IANA timezone name of the effective system timezone. */
  readonly timeZone: string;
}

/** Capture the execution context — once per document run (ticket 19's
 *  runner captures; QueryService consumes). */
export function captureContext(instant: number = Date.now(), timeZone: string = systemTimeZone()): ExecutionContext {
  return { instant, timeZone };
}

/** The system's IANA timezone. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function civilParts(iso: string): { y: number; m: number; d: number } {
  const match = CIVIL_DATE.exec(iso);
  if (!match) throw new Error(`Invalid civil date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

// Formatter cache (ticket 20): constructing Intl.DateTimeFormat dominates
// civil-date formatting cost — one formatter per (locale, options) key.
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = dateFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, ...options });
    dateFormatterCache.set(key, formatter);
  }
  return formatter;
}

/** Civil YYYY-MM-DD of `instant` interpreted in `timeZone` — the calendar
 *  the athlete lives in, not UTC. */
export function civilDateOf(instant: number, timeZone: string): string {
  const parts = dateFormatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return `${year}-${month}-${day}`;
}

/** Add `days` (may be negative) to a civil date — pure date math across
 *  month/year boundaries and leap days; no timezone involved. */
export function civilDateAdd(iso: string, days: number): string {
  const { y, m, d } = civilParts(iso);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Days between two civil dates (second minus first). */
export function civilDateDiff(a: string, b: string): number {
  const pa = civilParts(a);
  const pb = civilParts(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000,
  );
}

/** The Monday-starting civil week of a civil date. */
export function civilMonday(iso: string): string {
  const { y, m, d } = civilParts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday
  const back = (dow + 6) % 7;
  return civilDateAdd(iso, -back);
}

/** Offset (ms) of `timeZone` at `instant`: local = UTC + offset. */
function zonedOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUTC - instant;
}

/** The instant of local midnight (00:00) starting civil date `iso` in
 *  `timeZone` — component math that survives DST boundaries (a 23h or 25h
 *  day still starts at its own local 00:00). */
export function zonedStartOfDay(iso: string, timeZone: string): number {
  const { y, m, d } = civilParts(iso);
  // Two-iteration fixpoint: guess UTC midnight, correct by the zone's offset,
  // re-correct — settles DST shift edges (23h/25h days still start 00:00 local).
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zonedOffset(guess, timeZone);
  return guess - zonedOffset(first, timeZone);
}

/** Local noon of civil date `iso` in `timeZone` — the presentation-only
 *  representative instant for calendar buckets (never a join key). */
export function zonedNoon(iso: string, timeZone: string): number {
  return zonedStartOfDay(iso, timeZone) + 12 * 3_600_000;
}

/** A resolved range: [start, end). `endExclusive` marks the half-open
 *  convention; `end === Number.MAX_SAFE_INTEGER` with `endExclusive ===
 *  false` is the unbounded side. */
export interface ResolvedRange {
  readonly start: number;
  readonly end: number;
  /** True when `end` is an exclusive half-open bound (calendar windows and
   *  captured-instant relative cutoffs). */
  readonly endExclusive: boolean;
}

/** Resolve a parsed query window against the captured context — the single
 *  window→range mapping every execution path shares (time contract):
 *
 *  - `last Nd`: N local dates including today — midnight N−1 dates back
 *    through the captured current instant (inclusive cutoff, exclusive
 *    encoding `instant + 1`). Never N×86 400 000 ms.
 *  - `last Nw`: current Monday-start week plus N−1 preceding complete
 *    weeks, through the captured instant. Never a rolling 7N-date window.
 *  - explicit `from`/`to`: both named dates included in full — implemented
 *    as an exclusive bound at the following local midnight. An open `to`
 *    stays unbounded. Future ranges are preserved, never replaced.
 */
export function resolveWindowRange(
  w:
    | { kind: 'relative'; size: number; unit: 'd' | 'w' }
    | { kind: 'range'; start: string; end?: string }
    | { kind: 'param'; param: string; unit?: 'd' | 'w' }
    | undefined,
  ctx: ExecutionContext,
): ResolvedRange | undefined {
  if (!w || w.kind === 'param') return undefined;
  if (w.kind === 'relative') {
    const today = civilDateOf(ctx.instant, ctx.timeZone);
    const start = w.unit === 'd'
      ? civilDateAdd(today, -(w.size - 1))
      : civilDateAdd(civilMonday(today), -7 * (w.size - 1));
    return {
      start: zonedStartOfDay(start, ctx.timeZone),
      end: ctx.instant + 1, // inclusive captured instant, exclusive encoding
      endExclusive: true,
    };
  }
  const start = zonedStartOfDay(w.start, ctx.timeZone);
  if (w.end === undefined) {
    return { start, end: Number.MAX_SAFE_INTEGER, endExclusive: false };
  }
  // Inclusive `to` civil date → exclusive bound at the following local midnight.
  return {
    start,
    end: zonedStartOfDay(civilDateAdd(w.end, 1), ctx.timeZone),
    endExclusive: true,
  };
}

/** Half-open membership predicate: start included, exclusive end excluded
 *  (a metric exactly at Monday midnight belongs only to the new week).
 *  Unbounded ends admit everything. */
export function inRange(instant: number, range: ResolvedRange | undefined): boolean {
  if (!range) return true;
  if (instant < range.start) return false;
  if (range.endExclusive) return instant < range.end;
  return instant <= range.end;
}
