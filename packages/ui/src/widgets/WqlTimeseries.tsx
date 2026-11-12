import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { useChartShape } from './useChartShape';
import { WqlEmptyState } from './WqlEmptyState';
import { mergeSeries, formatTimestamp, tooltipTimestamp } from './chartData';
import { SERIES_COLORS } from './chartPalette';

export interface WqlTimeseriesProps {
  result: QueryResult;
  unit?: string;
}

function formatWithUnit(formattedNumber: string, unit?: string): string {
  const cleanUnit = unit?.trim();
  return cleanUnit ? `${formattedNumber} ${cleanUnit}` : formattedNumber;
}

/**
 * Shared Y-axis tick display formatter: locale-grouped number (`0` decimals for
 * large magnitudes, up to `1` decimal for small fractional ticks) + space before
 * `unit` when present (e.g. `5,000 kg`).
 */
export function formatTimeseriesTick(value: number | string, unit?: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return formatWithUnit(String(value), unit);
  }
  const maximumFractionDigits = Math.abs(numeric) >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(numeric);
  return formatWithUnit(formatted, unit);
}

/**
 * Shared Tooltip value display formatter: locale-grouped number rounded to at
 * most 1 fraction digit (drops trailing `.0` automatically, e.g. `12,179 kg`).
 */
export function formatTimeseriesTooltipValue(value: number | string, unit?: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return formatWithUnit(String(value), unit);
  }
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(numeric);
  return formatWithUnit(formatted, unit);
}

export function WqlTimeseries({ result, unit: unitProp }: WqlTimeseriesProps) {
  const shape = useChartShape(result);
  const data = useMemo(() => mergeSeries(result.series), [result]);
  const unit = result.series[0]?.unit ?? unitProp;

  if (shape.kind !== 'timeseries' && shape.kind !== 'scalar') {
    return <WqlEmptyState result={result} />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={formatTimestamp}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
          tickFormatter={(v) => formatTimeseriesTick(v as number | string, unit)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            borderColor: 'hsl(var(--border))',
            fontSize: '12px',
            color: 'hsl(var(--popover-foreground))',
          }}
          labelFormatter={(v) => tooltipTimestamp(v as number)}
          formatter={(v) => [formatTimeseriesTooltipValue(v as number | string, unit), '']}
        />
        {result.series.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 11 }} />
        )}
        {result.series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.label}
            name={s.label}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
