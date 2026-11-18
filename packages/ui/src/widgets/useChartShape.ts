import { useMemo } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';

export type ChartShape =
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'scalar'; value: number }
  | { kind: 'bars' }
  | { kind: 'timeseries' };

export function useChartShape(result: QueryResult | undefined): ChartShape {
  return useMemo(() => {
    if (!result) return { kind: 'empty' };
    if (result.parsed?.error) return { kind: 'error', message: result.parsed.error };
    if (result.series.length === 0) return { kind: 'empty' };
    if (result.series.length === 1 && result.series[0].points.length === 1) {
      return { kind: 'scalar', value: result.series[0].points[0].value };
    }
    const hasTimeAxis = result.series.some((s) => s.points.length > 1);
    return { kind: hasTimeAxis ? 'timeseries' : 'bars' };
  }, [result]);
}
