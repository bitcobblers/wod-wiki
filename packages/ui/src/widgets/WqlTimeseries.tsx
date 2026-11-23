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
import {
  mergeSeries,
  formatTimestamp,
  tooltipTimestamp,
  isOrdinalSeriesSet,
  buildOrdinalChartData,
} from './chartData';
import { SERIES_COLORS } from './chartPalette';
import { resolveWidgetDisplayUnit } from './unitIntegrity';
import {
  formatAxisTick,
  formatMetricValue,
  computeYAxisWidth,
  SingleLineYAxisTick,
} from './chartFormat';

export interface WqlTimeseriesProps {
  result: QueryResult;
  unit?: string;
}

/**
 * Shared Y-axis tick display formatter: locale-grouped number (`0` decimals for
 * large magnitudes, up to `1` decimal for small fractional ticks) + space before
 * `unit` when present (e.g. `5,000 kg`).
 */
export const formatTimeseriesTick = formatAxisTick;

/**
 * Shared Tooltip value display formatter: locale-grouped number rounded to at
 * most 1 fraction digit (drops trailing `.0` automatically, e.g. `12,179 kg`).
 */
export const formatTimeseriesTooltipValue = formatMetricValue;

const INTRINSIC_METRIC_UNITS: Record<string, string> = {
  'calc.hrv': 'ms',
  hrv: 'ms',
  'calc.sleep': 'h',
  sleep: 'h',
};

function resolveTimeseriesUnit(result: QueryResult, unitProp?: string): string | undefined {
  const seriesUnit = result.series[0]?.unit?.trim();
  if (seriesUnit) return seriesUnit;

  const seriesKey = result.series[0]?.key?.toLowerCase();
  if (seriesKey && INTRINSIC_METRIC_UNITS[seriesKey]) {
    return INTRINSIC_METRIC_UNITS[seriesKey];
  }

  const parsedMetric = result.parsed?.metric?.toLowerCase();
  if (parsedMetric && INTRINSIC_METRIC_UNITS[parsedMetric]) {
    return INTRINSIC_METRIC_UNITS[parsedMetric];
  }

  const rawQuery = (result as { query?: unknown }).query;
  if (typeof rawQuery === 'string' && /\b(?:calc\.hrv|hrv)\b/i.test(rawQuery)) {
    return 'ms';
  }

  const resolved = resolveWidgetDisplayUnit(result, unitProp);
  return resolved || undefined;
}

export function WqlTimeseries({ result, unit: unitProp }: WqlTimeseriesProps) {
  const shape = useChartShape(result);
  const isOrdinal = useMemo(() => isOrdinalSeriesSet(result.series), [result.series]);
  const data = useMemo(
    () => (isOrdinal ? buildOrdinalChartData(result.series) : mergeSeries(result.series)),
    [isOrdinal, result],
  );
  const unit = resolveTimeseriesUnit(result, unitProp);
  const yAxisWidth = useMemo(
    () =>
      computeYAxisWidth(
        result.series.flatMap((s) => s.points.map((p) => p.value)),
        unit,
      ),
    [result.series, unit],
  );

  if ((shape.kind !== 'timeseries' && shape.kind !== 'scalar') || data.length === 0) {
    return <WqlEmptyState result={result} fallbackMessage="No timeseries data available for this query." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data as Array<Record<string, number | string | undefined>>} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey={isOrdinal ? 'label' : 'ts'}
          tickFormatter={isOrdinal ? (v) => String(v) : formatTimestamp}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          stroke="hsl(var(--muted-foreground))"
          tick={<SingleLineYAxisTick unit={unit} />}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            borderColor: 'hsl(var(--border))',
            fontSize: '12px',
            color: 'hsl(var(--popover-foreground))',
          }}
          labelFormatter={isOrdinal ? (v) => String(v) : (v) => tooltipTimestamp(v as number)}
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
            dot={isOrdinal ? { r: 3 } : false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
