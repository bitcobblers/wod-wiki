import { type IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { formatDurationSmart } from '../../utils/formatTime';
import type { MetricPresentationSurface } from './types';

/** Metric types whose numeric value represents milliseconds. */
const TIME_LIKE_TYPES = new Set<string>([
  MetricType.Duration,
  MetricType.Time,
  MetricType.Elapsed,
  MetricType.Total,
]);

export function isTimeLikeMetric(type: MetricType | string): boolean {
  return TIME_LIKE_TYPES.has(type as string);
}

/** Collapse adjacent duplicate token labels (WW-079, e.g. "Thrusters" + "Thrusters"). */
export function dedupePresentedLabels(labels: readonly string[]): string[] {
  const deduped: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    const lower = label.toLowerCase();
    const prev = deduped[deduped.length - 1]?.toLowerCase();
    if (prev && (prev === lower || prev.endsWith(` ${lower}`))) continue;
    deduped.push(label);
  }
  return deduped;
}

/** Convert an IMetric value/image pair to a usable base string. */
function baseText(metric: IMetric): string {
  if (metric.image) return metric.image;
  if (metric.value === undefined || metric.value === null) return metric.type;
  if (metric.value instanceof Date) {
    return metric.value.toISOString();
  }
  if (Array.isArray(metric.value)) {
    const spans = metric.value.filter(
      (item): item is { started: number; ended?: number } =>
        Boolean(item) && typeof item === 'object' && 'started' in item && typeof (item as { started?: unknown }).started === 'number',
    );
    if (spans.length > 0 && spans.length === metric.value.length) {
      const totalMs = spans.reduce((acc, s) => acc + Math.max(0, (s.ended ?? s.started) - s.started), 0);
      return formatDurationSmart(totalMs);
    }
    return metric.value.map((item) => String(item)).filter(Boolean).join(', ');
  }
  if (typeof metric.value === 'object') {
    const v = metric.value as Record<string, unknown>;
    if ('amount' in v && 'units' in v) {
      return v.amount !== undefined ? `${v.amount} ${v.units}` : String(v.units);
    }
    if ('text' in v) return String(v.text);
    if ('current' in v) return `Round ${v.current}`;
    if ('started' in v && typeof v.started === 'number') {
      const ended = typeof v.ended === 'number' ? v.ended : v.started;
      return formatDurationSmart(Math.max(0, ended - v.started));
    }
    return computeColumnLabel(metric.type);
  }
  return String(metric.value);
}

/**
 * Compute the display label for a metric on a given surface.
 * All per-type formatting rules live here — nowhere else.
 */
export function computeLabel(metric: IMetric, _surface: MetricPresentationSurface): string {
  // Time-based: format ms value with smart HH:MM or MM:SS
  if (isTimeLikeMetric(metric.type) && typeof metric.value === 'number') {
    return formatDurationSmart(metric.value);
  }

  const base = baseText(metric);

  // Rounds: append "Round" / "Rounds" suffix when base is a bare number (UX-03)
  if (metric.type === MetricType.Rounds || (metric.type as string) === 'rounds') {
    const trimmed = base.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return `${base} ${n === 1 ? 'Round' : 'Rounds'}`;
    }
  }

  return base;
}

function formatTooltipValue(metric: IMetric): string {
  if (isTimeLikeMetric(metric.type) && typeof metric.value === 'number') {
    return formatDurationSmart(metric.value);
  }
  const val = metric.value;
  if (typeof val === 'number' && Number.isFinite(val)) {
    const formatted = Number.isInteger(val) ? String(val) : (Math.round(val * 10) / 10).toFixed(1);
    return metric.unit ? `${formatted} ${metric.unit}` : formatted;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (Array.isArray(val)) {
    if (metric.image) return metric.image;
    const spans = val.filter(
      (item): item is { started: number; ended?: number } =>
        Boolean(item) && typeof item === 'object' && 'started' in item && typeof (item as { started?: unknown }).started === 'number',
    );
    if (spans.length > 0 && spans.length === val.length) {
      const totalMs = spans.reduce((acc, s) => acc + Math.max(0, (s.ended ?? s.started) - s.started), 0);
      return formatDurationSmart(totalMs);
    }
    return val.map((item) => String(item)).filter(Boolean).join(', ');
  }
  if (val !== null && typeof val === 'object') {
    if (metric.image) return metric.image;
    const obj = val as Record<string, unknown>;
    if ('amount' in obj && 'units' in obj) {
      return obj.amount !== undefined ? `${obj.amount} ${obj.units}` : String(obj.units);
    }
    if ('text' in obj) return String(obj.text);
    if ('current' in obj) return `Round ${obj.current}`;
    if ('started' in obj && typeof obj.started === 'number') {
      const ended = typeof obj.ended === 'number' ? obj.ended : obj.started;
      return formatDurationSmart(Math.max(0, ended - obj.started));
    }
    return computeColumnLabel(metric.type);
  }
  if (metric.image && metric.unit && typeof val === 'string' && !val.includes(metric.unit)) {
    return metric.image;
  }
  return val !== undefined && val !== null ? String(val) : (metric.image ?? computeColumnLabel(metric.type));
}

/**
 * Build a tooltip string for a metric. Athlete-facing surfaces render a concise
 * `ColumnLabel: value` tooltip without developer internals; `debug` keeps
 * Type/Value/Origin/Block/Time details.
 */
export function buildTooltip(metric: IMetric, surface?: MetricPresentationSurface): string {
  if (surface && surface !== 'debug') {
    const heading = computeColumnLabel(metric.type);
    const valText = formatTooltipValue(metric);
    return valText ? `${heading}: ${valText}` : heading;
  }
  const parts: string[] = [];
  parts.push(`Type: ${metric.type}`);
  if (metric.value !== undefined) parts.push(`Value: ${formatTooltipValue(metric)}`);
  if (metric.origin) parts.push(`Origin: ${metric.origin}`);
  if (metric.sourceBlockKey) parts.push(`Block: ${metric.sourceBlockKey}`);
  if (metric.timestamp) {
    const ts = metric.timestamp instanceof Date ? metric.timestamp : new Date(metric.timestamp);
    if (!Number.isNaN(ts.getTime())) parts.push(`Time: ${ts.toISOString()}`);
  }
  return parts.join('\n');
}

/**
 * Canonical column labels for the review grid.
 * Replaces METRIC_LABELS in GridHeader.tsx.
 */
const COLUMN_LABEL_MAP: Partial<Record<string, string>> = {
  duration:        'Duration',
  rep:             'Reps',
  effort:          'Effort',
  distance:        'Distance',
  rounds:          'Rounds',
  resistance:      'Resistance',
  action:          'Action',
  increment:       'Increment',
  metric:          'Metric',
  label:           'Label',
  text:            'Text',
  custom:          'Custom',
  calculated:      'Calculated',
  'current-round': 'Current Round',
  volume:          'Volume',
  intensity:       'Intensity',
  load:            'Load',
  work:            'Work',
  lap:             'Lap',
  group:           'Group',
  time:            'Time',
  elapsed:         'Elapsed',
  total:           'Total',
  'system-time':   'System Time',
  spans:           'Spans',
  system:          'System',
  rir:             'RIR',
  'session-rpe':   'Session RPE',
  'session-load':  'Session Load',
  'met-score':     'MET Score',
  tis:             'TIS',
  sound:           'Sound',
  // Derived / analytics columns (keys are lowercased in computeColumnLabel).
  'calc.metminutes':       'MET Minutes',
  metminutes:              'MET Minutes',
  metminutesestimated:     'MET Minutes Est.',
  sessionload:             'Session Load',
  totalvolume:             'Total Volume',
  totalreps:               'Total Reps',
  totaldistance:           'Total Distance',
  'calc.acwr':             'ACWR',
  'calc.monotony':         'Monotony',
  'calc.strain':           'Strain',
  'calc.readiness':        'Readiness',
  'calc.hrv':              'HRV',
  'calc.sleep':            'Sleep',
  'calc.soreness':         'Soreness',
};

/** Acronyms uppercased verbatim during metric-key humanization. */
const METRIC_KEY_ACRONYMS: Readonly<Record<string, string>> = {
  met: 'MET',
  hrv: 'HRV',
  rpe: 'RPE',
  tis: 'TIS',
  acwr: 'ACWR',
  vo2max: 'VO2max',
};

export function humanizeMetricKey(value: string): string {
  const spaced = value
    .replace(/^calc\./i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();

  if (spaced.length === 0) return '';

  return spaced
    .split(/\s+/)
    .map((word) => {
      const acronym = METRIC_KEY_ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      if (word === word.toUpperCase()) return word;
      if (/^[A-Z]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function computeColumnLabel(type: MetricType | string): string {
  const key = String(type).trim();
  const normalized = key.toLowerCase();
  return COLUMN_LABEL_MAP[normalized] ?? humanizeMetricKey(key);
}
