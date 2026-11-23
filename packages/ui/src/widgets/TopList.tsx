import { useMemo } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { useChartShape } from './useChartShape';
import { WqlEmptyState } from './WqlEmptyState';
import { SERIES_COLORS } from './chartPalette';
import { resolveWidgetDisplayUnit } from './unitIntegrity';
import { formatMetricValue } from './chartFormat';

export interface TopListProps {
  result: QueryResult;
  unit?: string;
  limit?: number;
}

export function TopList({ result, unit: unitProp, limit = 8 }: TopListProps) {
  const shape = useChartShape(result);
  const unit = resolveWidgetDisplayUnit(result, unitProp);

  const rows = useMemo(
    () =>
      result.series
        .map((s) => ({ name: s.label, value: s.points[0]?.value ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit),
    [result, limit],
  );

  const max = rows[0]?.value || 1;

  if (shape.kind === 'error' || shape.kind === 'empty') {
    return <WqlEmptyState result={result} />;
  }

  return (
    <div className="space-y-2 pt-1">
      {rows.map((r, i) => (
        <div key={r.name} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-4 text-right">{i + 1}</span>
          <span className="text-xs w-36 truncate text-foreground">{r.name}</span>
          <div className="flex-1 h-4 bg-muted/60 rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: SERIES_COLORS[i % SERIES_COLORS.length],
              }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground w-24 text-right whitespace-nowrap">
            {formatMetricValue(r.value, unit)}
          </span>
        </div>
      ))}
    </div>
  );
}
