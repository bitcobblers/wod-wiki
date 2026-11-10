import type { AnyParsedQuery, QueryWindow } from '@bitcobblers/wod-wiki-engine';
import { isAggregateQuery, isFindQuery, isPipelineQuery } from '@bitcobblers/wod-wiki-engine';
import { cn } from '@/lib/utils';

interface ChipProps {
  label: string;
  value: string;
  className?: string;
}

function Chip({ label, value, className }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border bg-background/60 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('font-mono text-xs', className ?? 'text-foreground')}>{value}</span>
    </span>
  );
}

export interface ParsedQueryChipsProps {
  parsed: AnyParsedQuery;
}

/** Human label for a C1 window: `last 8w` / `from 2026-01-01 [to …]`.
 * Shared with the explorer page's result header. */
export function windowLabel(w: QueryWindow): string {
  if (w.kind === 'relative') return `last ${w.size}${w.unit}`;
  if (w.kind === 'param') return `last $${w.param}${w.unit ? ` ${w.unit}` : ''}`;
  return w.end ? `from ${w.start} to ${w.end}` : `from ${w.start}`;
}

/** The WQL elements of one parsed query, one chip per element (C5: the chip
 * set follows the family — aggregate/metric/group-by for analytics, target/
 * window for content, source/stages/sink for pipelines, output-type/window
 * for rows). Pipeline chips mirror stage order; the raw text stays the
 * editable source of truth. */
export function ParsedQueryChips({ parsed }: ParsedQueryChipsProps) {
  if (parsed.error) {
    return <div className="text-sm text-destructive font-mono">{parsed.error}</div>;
  }

  if (isPipelineQuery(parsed)) {
    const sourceChip = parsed.source.kind === 'dataset'
      ? <Chip label="source" value={parsed.source.name} className="text-blue-400 dark:text-blue-300" />
      : <Chip label="source" value={'target' in parsed.source.query ? `:${parsed.source.query.target}` : `:${parsed.source.query.agg}`} className="text-blue-400 dark:text-blue-300" />;
    return (
      <div className="flex flex-wrap gap-1.5">
        {sourceChip}
        {parsed.transforms.map((stage, i) => (
          <Chip key={i} label={`fn ${i + 1}`} value={`${stage.agg}:${stage.metric}`} className="text-green-400 dark:text-green-300" />
        ))}
        {parsed.sink && (
          <Chip label="sink" value={`:${parsed.sink.head}`} className="text-purple-400 dark:text-purple-300" />
        )}
      </div>
    );
  }

  const windowChip = parsed.window && (
    <Chip label="window" value={windowLabel(parsed.window)} className="text-sky-400 dark:text-sky-300" />
  );
  const filterChips = parsed.filters.map((f, i) => (
    <Chip
      key={i}
      label={f.negate ? 'exclude' : 'filter'}
      value={`${f.key}:${f.values.map((v) => `${v.value}${v.wildcard ? '*' : ''}`).join('|')}`}
      className="text-amber-400 dark:text-amber-300"
    />
  ));

  if (isAggregateQuery(parsed)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Chip label="aggregate" value={parsed.agg} className="text-blue-400 dark:text-blue-300" />
        <Chip label="metric" value={parsed.metric} />
        {filterChips}
        {parsed.groupBy.map((d, i) => (
          <Chip key={i} label="group by" value={d} className="text-green-400 dark:text-green-300" />
        ))}
        {parsed.rollup && (
          <Chip label="rollup" value={`${parsed.rollup.size}${parsed.rollup.unit}`} className="text-purple-400 dark:text-purple-300" />
        )}
        {parsed.displayUnit && (
          <Chip label="in" value={parsed.displayUnit} className="text-pink-400 dark:text-pink-300" />
        )}
        {windowChip}
        {parsed.join && (
          <Chip label="where" value={`:${parsed.join.target}`} className="text-teal-400 dark:text-teal-300" />
        )}
      </div>
    );
  }

  if (isFindQuery(parsed)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Chip label="target" value={parsed.target} className="text-blue-400 dark:text-blue-300" />
        {filterChips}
        {windowChip}
        {parsed.join && (
          <Chip
            label="where"
            value={`${parsed.join.agg}:${parsed.join.metric}`}
            className="text-teal-400 dark:text-teal-300"
          />
        )}
      </div>
    );
  }


  return null;
}
