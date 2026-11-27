import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
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
import { resolveWidgetDisplayUnit } from './unitIntegrity';
import { SERIES_COLORS } from './chartPalette';
import { SingleLineYAxisTick, computeYAxisWidth, formatMetricValue } from './chartFormat';

export interface StackedBarProps {
  result: QueryResult;
  unit?: string;
}

const INTENSITY_ORDER = ['low', 'moderate', 'high'];

export function StackedBar({ result, unit: unitProp }: StackedBarProps) {
  const shape = useChartShape(result);
  const data = useMemo(() => mergeSeries(result.series), [result]);
  const unit = resolveWidgetDisplayUnit(result, unitProp);
  const yAxisWidth = useMemo(
    () =>
      computeYAxisWidth(
        result.series.flatMap((s) => s.points.map((p) => p.value)),
        unit,
      ),
    [result.series, unit],
  );

  const keys = useMemo(() => {
    const labels = result.series.map((s) => s.label);
    return labels.sort((a, b) => {
      const ai = INTENSITY_ORDER.indexOf(a);
      const bi = INTENSITY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [result]);

  if ((shape.kind !== 'timeseries' && shape.kind !== 'bars') || data.length === 0) {
    return <WqlEmptyState result={result} fallbackMessage="No stacked bar data available for this query." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
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
          allowDecimals={!(result.parsed?.agg === 'count' || unit === 'count' || unit === 'reps' || unit === 'rounds')}
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
          labelFormatter={(v) => tooltipTimestamp(v as number)}
          formatter={(v, name, p) => {
            const label = typeof p?.payload?.name === 'string' && p.payload.name ? p.payload.name : String(name ?? '');
            return [formatMetricValue(v as number | string, unit), label];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k) => {
          const index = result.series.findIndex((s) => s.label === k);
          return (
            <Bar
              key={k}
              dataKey={k}
              stackId="a"
              fill={SERIES_COLORS[index >= 0 ? index % SERIES_COLORS.length : 0]}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
