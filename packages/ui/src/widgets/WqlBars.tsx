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
} from 'recharts';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { useChartShape } from './useChartShape';
import { WqlEmptyState } from './WqlEmptyState';
import { SERIES_COLORS } from './chartPalette';
import { compactNumber } from './chartData';

export interface WqlBarsProps {
  result: QueryResult;
  unit?: string;
}

export function WqlBars({ result, unit: unitProp }: WqlBarsProps) {
  const shape = useChartShape(result);

  const data = useMemo(
    () =>
      result.series.map((s, i) => ({
        name: s.label,
        value: s.points[0]?.value ?? 0,
        fill: SERIES_COLORS[i % SERIES_COLORS.length],
      })),
    [result],
  );

  const unit = result.series[0]?.unit ?? unitProp;

  if (shape.kind !== 'bars' && shape.kind !== 'scalar') {
    return <WqlEmptyState result={result} />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 48 }}>
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
          width={48}
          tickFormatter={compactNumber}
          stroke="hsl(var(--muted-foreground))"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
          unit={unit ? ` ${unit}` : ''}
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
            return [`${Number(v).toLocaleString()} ${unit ?? ''}`.trim(), label];
          }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Recharts Bar per-bar fill still uses Cell
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
