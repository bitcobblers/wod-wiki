import { useMemo } from 'react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { useChartShape } from './useChartShape';
import { WqlEmptyState } from './WqlEmptyState';
import { formatTimestamp } from './chartData';
import { formatTimeseriesTooltipValue } from './WqlTimeseries';

export interface WqlTableProps {
  result: QueryResult;
  unit?: string;
}

const MAX_ROWS = 12;

export function WqlTable({ result, unit: unitProp }: WqlTableProps) {
  const shape = useChartShape(result);
  const unit = result.series[0]?.unit ?? unitProp ?? '';

  const rows = useMemo(() => {
    if (shape.kind === 'scalar') {
      return {
        head: ['Metric', 'Value'],
        body: [[result.series[0]?.label ?? 'scalar', formatTimeseriesTooltipValue(shape.value, unit)]],
        more: 0,
      };
    }
    if (shape.kind === 'bars') {
      const all = result.series.map((s) => [
        s.label,
        formatTimeseriesTooltipValue(s.points[0]?.value ?? 0, unit),
      ]);
      return {
        head: ['Series', 'Value'],
        body: all.slice(0, MAX_ROWS),
        more: Math.max(0, all.length - MAX_ROWS),
      };
    }
    if (shape.kind === 'timeseries') {
      const timestamps = Array.from(
        new Set(result.series.flatMap((s) => s.points.map((p) => p.ts))),
      ).sort((a, b) => b - a);

      const seriesMap = new Map<string, Map<number, number>>();
      for (const s of result.series) {
        seriesMap.set(s.label, new Map(s.points.map((p) => [p.ts, p.value])));
      }

      const head = ['Date', ...result.series.map((s) => s.label)];
      const body = timestamps.slice(0, MAX_ROWS).map((ts) => [
        formatTimestamp(ts),
        ...result.series.map((s) => {
          const v = seriesMap.get(s.label)?.get(ts);
          return v !== undefined ? formatTimeseriesTooltipValue(v, unit) : '—';
        }),
      ]);
      return { head, body, more: Math.max(0, timestamps.length - MAX_ROWS) };
    }
    return { head: [], body: [], more: 0 };
  }, [result, shape, unit]);

  if (shape.kind === 'error' || shape.kind === 'empty') {
    return <WqlEmptyState result={result} />;
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-left">
            {rows.head.map((h, i) => (
              <th
                key={h}
                className={`py-1 px-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.body.map((row, rIdx) => (
            <tr
              key={rIdx}
              className="border-b border-border/40 hover:bg-muted/30 transition-colors"
            >
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className={`py-1 px-2 text-foreground tabular-nums ${cIdx === 0 ? 'text-left' : 'text-right'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.more > 0 && (
        <div className="text-[11px] text-muted-foreground pt-2">… {rows.more} more rows</div>
      )}
    </div>
  );
}
