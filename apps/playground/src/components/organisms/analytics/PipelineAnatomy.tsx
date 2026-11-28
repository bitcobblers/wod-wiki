import { ChevronRight } from 'lucide-react';
import type { QueryResult } from '@bitcobblers/wod-wiki-engine';
import { SERIES_COLORS } from '@bitcobblers/wod-wiki-ui';

interface Stage {
  n: number;
  name: string;
  desc: string;
  count: number;
  unit: string;
}

export interface PipelineAnatomyProps {
  result: QueryResult;
}

export function PipelineAnatomy({ result }: PipelineAnatomyProps) {
  const { parsed, stages } = result;
  if (parsed.error) return null;

  const timeDim = parsed.groupBy.find((d) => d === 'day' || d === 'week' || d === 'month');
  const bucketDesc = timeDim
    ? `by ${timeDim}`
    : parsed.rollup
      ? `rollup ${parsed.rollup.size}${parsed.rollup.unit}`
      : 'no rollup';
  const groupDesc = parsed.groupBy.length ? `by {${parsed.groupBy.join(', ')}}` : 'single series';

  const stageList: Stage[] = [
    {
      n: 1,
      name: 'SELECT',
      desc: 'tag + time index scan',
      count: stages.selected,
      unit: 'points',
    },
    { n: 2, name: 'BUCKET', desc: bucketDesc, count: stages.buckets, unit: 'buckets' },
    { n: 3, name: 'AGGREGATE', desc: `${parsed.agg} per bucket`, count: stages.aggregated, unit: 'values' },
    { n: 4, name: 'GROUP', desc: groupDesc, count: stages.groups, unit: 'series' },
  ];

  const excludedUndated = stages.excludedUndated ?? 0;
  const excludedCatalog = stages.excludedCatalog ?? 0;

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-0 overflow-x-auto">
        {stageList.map((s, i) => (
          <div key={s.n} className="flex items-center">
            <div className="border border-border rounded-lg bg-background/60 px-3 py-2 min-w-[130px]">
              <div
                className="text-[10px] font-bold tracking-wide"
                style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}
              >
                {s.n}. {s.name}
              </div>
              <div className="text-[11px] text-muted-foreground">{s.desc}</div>
              <div className="text-sm font-semibold tabular-nums mt-0.5">
                {s.count.toLocaleString()}{' '}
                <span className="text-[10px] font-normal text-muted-foreground">{s.unit}</span>
              </div>
            </div>
            {i < 3 && (
              <ChevronRight size={16} className="text-muted-foreground mx-1 shrink-0" />
            )}
          </div>
        ))}
      </div>
      {(excludedUndated > 0 || excludedCatalog > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {excludedUndated > 0 && (
            <span data-testid="pipeline-excluded-undated">
              {excludedUndated.toLocaleString()} undated {excludedUndated === 1 ? 'note' : 'notes'} excluded from time-bucketed grouping
            </span>
          )}
          {excludedCatalog > 0 && (
            <span data-testid="pipeline-excluded-catalog">
              {excludedCatalog.toLocaleString()} catalog {excludedCatalog === 1 ? 'record' : 'records'} excluded by default (efforts, equipment, guides, dashboards)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
