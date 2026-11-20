import { useMemo } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { useChartShape } from './useChartShape';
import { WqlEmptyState } from './WqlEmptyState';
import { resolveWidgetDisplayUnit } from './unitIntegrity';

export interface QueryValueProps {
  result: QueryResult;
  unit?: string;
  label?: string;
  thresholds?: { green: [number, number]; red: [number, number] };
}

export function QueryValue({ result, unit: unitProp, label = '', thresholds }: QueryValueProps) {
  const shape = useChartShape(result);
  const unit = resolveWidgetDisplayUnit(result, unitProp);

  const value = useMemo(() => {
    if (shape.kind === 'scalar') return shape.value;
    if (result.series.length === 0) return 0;
    return result.series[0].points[result.series[0].points.length - 1]?.value ?? 0;
  }, [result, shape]);

  const colorClass = useMemo(() => {
    if (!thresholds) return 'text-foreground';
    if (value >= thresholds.green[0] && value <= thresholds.green[1]) return 'text-success';
    if (value >= thresholds.red[0]) return 'text-destructive';
    return 'text-warning';
  }, [value, thresholds]);

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <WqlEmptyState result={result} />
      {result.series.length > 0 && !result.parsed.error && (
        <>
          <div className={`text-5xl font-bold tabular-nums ${colorClass}`}>
            {value.toLocaleString(undefined, { maximumSignificantDigits: 3 })}
            <span className="text-lg font-normal text-muted-foreground ml-1">{unit}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2 text-center">{label}</div>
        </>
      )}
    </div>
  );
}
