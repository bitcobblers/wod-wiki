import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
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
  SingleLineYAxisTick,
  computeYAxisWidth,
  formatMetricValue,
} from './chartFormat';

export interface WqlBarsProps {
  result: QueryResult;
  unit?: string;
}

export function WqlBars({ result, unit: unitProp }: WqlBarsProps) {
  const shape = useChartShape(result);
  const isOrdinal = useMemo(() => isOrdinalSeriesSet(result.series), [result.series]);
  const isTimeOrOrdinal = shape.kind === 'timeseries' || isOrdinal;

  const categoryData = useMemo(
    () =>
      result.series.map((s, i) => ({
        name: s.label,
        value: s.points[0]?.value ?? 0,
        fill: SERIES_COLORS[i % SERIES_COLORS.length],
      })),
    [result],
  );

  const seriesData = useMemo(
    () => (isOrdinal ? buildOrdinalChartData(result.series) : mergeSeries(result.series)),
    [isOrdinal, result],
  );

  const unit = resolveWidgetDisplayUnit(result, unitProp);
  const yAxisWidth = useMemo(
    () =>
      computeYAxisWidth(
        result.series.flatMap((s) => s.points.map((p) => p.value)),
        unit,
      ),
    [result.series, unit],
  );

  const hasDataPoints = useMemo(
    () =>
      result.series.some((s) =>
        s.points.some((p) => !(p as { missing?: boolean }).missing),
      ),
    [result.series],
  );

  if (shape.kind === 'error' || shape.kind === 'empty' || !hasDataPoints) {
    return <WqlEmptyState result={result} fallbackMessage="No bar data available for this query." />;
  }

  if (isTimeOrOrdinal) {
    if (seriesData.length === 0) {
      return <WqlEmptyState result={result} fallbackMessage="No bar data available for this query." />;
    }
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={seriesData as Array<Record<string, number | string | undefined>>} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
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
            formatter={(v, name) => [formatMetricValue(v as number | string, unit), String(name ?? '')]}
          />
          {result.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {result.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.label}
              name={s.label}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (shape.kind !== 'bars' && shape.kind !== 'scalar') {
    return <WqlEmptyState result={result} fallbackMessage="No bar data available for this query." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={categoryData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="name"
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
          formatter={(v, _n, p) => {
            const label = typeof p?.payload?.name === 'string' ? p.payload.name : '';
            return [formatMetricValue(v as number | string, unit), label];
          }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {categoryData.map((d) => (
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Recharts Bar per-bar fill still uses Cell
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
