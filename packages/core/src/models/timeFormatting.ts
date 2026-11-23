import type { IMetric } from './Metric';

const TIME_METRIC_TYPES = new Set(['duration', 'elapsed', 'total', 'time']);

/**
 * Convert a duration/elapsed/total/time metric value into milliseconds.
 * Runtime and parser duration metrics (`DurationMetric`, `ElapsedMetric`,
 * `TotalMetric`) always carry milliseconds even when `unit` is omitted, so
 * unitless values on time-like types are treated as milliseconds — never `* 1000`.
 */
export function metricToMs(metric: {
  type?: IMetric['type'];
  value?: unknown;
  unit?: string;
}): number | undefined {
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
    return undefined;
  }
  const unit = metric.unit?.trim().toLowerCase();
  if (unit === 'ms' || unit === 'millisecond' || unit === 'milliseconds') {
    return metric.value;
  }
  if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
    return metric.value * 1000;
  }
  if (unit === 'min' || unit === 'm' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
    return metric.value * 60_000;
  }
  if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
    return metric.value * 3_600_000;
  }
  if (!unit && TIME_METRIC_TYPES.has(String(metric.type ?? '').toLowerCase())) {
    return metric.value;
  }
  return metric.value;
}

/**
 * Canonical rounded MM:SS (or H:MM:SS when >= 1 hour) duration formatter
 * shared across summary cards, spreadsheet grids, and stream cards.
 */
export function formatDurationMMSS(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
