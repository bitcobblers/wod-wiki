import type { ReactElement } from 'react';

function formatWithUnit(formattedNumber: string, unit?: string): string {
  const cleanUnit = unit?.trim();
  return cleanUnit ? `${formattedNumber} ${cleanUnit}` : formattedNumber;
}

/**
 * Shared Y-axis tick display formatter: locale-grouped number (`0` decimals for
 * large magnitudes `>= 100`, up to `1` decimal for smaller fractional ticks)
 * + a separating space before `unit` when present (e.g. `5,000 kg`, `62 ms`).
 */
export function formatAxisTick(value: number | string, unit?: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return formatWithUnit(String(value), unit);
  }
  const maximumFractionDigits = Math.abs(numeric) >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(numeric);
  return formatWithUnit(formatted, unit);
}

/**
 * Shared metric value formatter for tooltips, summary cards, and tables:
 * locale-grouped number rounded to at most 1 fraction digit (drops `.0`
 * automatically) + spaced unit (`11,362.5 kg`).
 */
export function formatMetricValue(value: number | string, unit?: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return formatWithUnit(String(value), unit);
  }
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(numeric);
  return formatWithUnit(formatted, unit);
}

/**
 * Compact numeric display with at most 1 decimal on `k`/`M` suffixes and a
 * separating space before `unit` (e.g. `12.5k kg`, `480 kg`).
 */
export function formatCompactMetricValue(value: number | string, unit?: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return formatWithUnit(String(value), unit);
  }
  const abs = Math.abs(numeric);
  let compact: string;
  if (abs >= 1_000_000) {
    compact = `${Number((numeric / 1_000_000).toFixed(1))}M`;
  } else if (abs >= 1_000) {
    compact = `${Number((numeric / 1_000).toFixed(1))}k`;
  } else {
    compact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(numeric);
  }
  return formatWithUnit(compact, unit);
}

/**
 * Estimate a non-clipping Y-axis width from the sample values and unit label
 * so formatted ticks like `12,500 kg` or `65 ms` stay single-line and legible.
 */
export function computeYAxisWidth(
  values: readonly number[],
  unit?: string,
  minWidth = 56,
  maxWidth = 104,
): number {
  let maxLen = formatAxisTick(0, unit).length;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const len = formatAxisTick(v, unit).length;
    if (len > maxLen) maxLen = len;
  }
  const estimated = Math.ceil(maxLen * 6.5 + 14);
  return Math.max(minWidth, Math.min(maxWidth, estimated));
}

export interface SingleLineYAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: number | string };
  unit?: string;
}

/**
 * Custom Recharts SVG Y-axis tick renderer that keeps tick value and unit on
 * one unwrapped line (`white-space: nowrap`) with right alignment.
 */
export function SingleLineYAxisTick({
  x = 0,
  y = 0,
  payload,
  unit,
}: SingleLineYAxisTickProps): ReactElement {
  const raw = payload?.value ?? '';
  const text = formatAxisTick(raw, unit);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={4}
        textAnchor="end"
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
        style={{ whiteSpace: 'nowrap' }}
      >
        {text}
      </text>
    </g>
  );
}
