import React, { type ReactNode } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { NoteContainer, QueryResult } from '@bitcobblers/wod-wiki-wql';
import { isDashboardWidgetType, PLANNED_WIDGET_TYPES, resolveWidgetType, unknownWidgetTypeMessage } from '@bitcobblers/wod-wiki-wql';
import { SERIES_COLORS } from './chartPalette';
import { compactNumber, type WidgetRunResult } from './chartData';
import { QueryValue } from './QueryValue';
import { WqlTimeseries } from './WqlTimeseries';
import { WqlBars } from './WqlBars';
import { WqlTable } from './WqlTable';
import { TopList } from './TopList';
import { StackedBar } from './StackedBar';
import { GoalRings } from './GoalRings';
import { ZoneDistribution } from './ZoneDistribution';
import { WqlEmptyState } from './WqlEmptyState';

export interface WidgetChartProps {
  /** Raw widget type from the fence suffix; '' picks the dashboard default (table). */
  type: string;
  result: WidgetRunResult | QueryResult | undefined;
  /** Fallback label for value widgets (widget title or metric). */
  label?: string;
  unit?: string;
  /** Positional widget parameters from the block body (e.g. goal target or zone targets). */
  params?: string[];
  /** Fence-tag presentation attributes (decision 22) — preferred over legacy positional params. */
  attributes?: Record<string, string>;
  /** When true, an empty `type` infers the chart shape (value / timeseries / bar) from `result.series`. */
  inferDefaultShape?: boolean;
  /** Optional click handler for opening a note/block from content-plane list results. */
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  /** Optional resolver returning the destination href for an item in content-plane list results. */
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}

function inferChartTypeFromResult(result: QueryResult | undefined): string {
  if (!result || result.series.length === 0) return 'table';
  if (result.series.length === 1 && result.series[0].points.length === 1) return 'value';
  const hasTimeAxis = result.series.some((s) => s.points.length > 1);
  return hasTimeAxis ? 'timeseries' : 'bar';
}

export function WidgetChart({
  type,
  result,
  label,
  unit,
  params,
  attributes,
  inferDefaultShape = false,
  onOpenNote,
  noteHref,
}: WidgetChartProps) {
  if (type !== '' && !isDashboardWidgetType(type)) {
    return <WidgetProblemBadge message={unknownWidgetTypeMessage(type)} />;
  }

  const resolved = type === '' && inferDefaultShape
    ? inferChartTypeFromResult(result)
    : resolveWidgetType(type);
  const runResult = result as WidgetRunResult | undefined;

  const parsedFamily = (runResult?.parsed as { family?: string } | undefined)?.family;
  const hasContentItems =
    parsedFamily === 'find' ||
    Boolean(runResult?.notes?.length || runResult?.blocks?.length || runResult?.efforts?.length || runResult?.runs?.length);

  if (resolved === 'table' && runResult?.table) {
    return (
      <div className="w-full h-full min-h-[160px]">
        <TabularTable table={runResult.table} />
      </div>
    );
  }
  if (resolved === 'table' && hasContentItems && (!result || !('series' in result) || result.series.length === 0)) {
    return (
      <div className="w-full h-full min-h-[160px]">
        <ContentRecordsTable
          result={runResult}
          onOpenNote={onOpenNote}
          noteHref={noteHref}
        />
      </div>
    );
  }
  if (resolved === 'list' && hasContentItems) {
    return (
      <div className="w-full h-full min-h-[160px]">
        <ThingList
          result={runResult}
          onOpenNote={onOpenNote}
          noteHref={noteHref}
        />
      </div>
    );
  }

  if (!result || result.parsed.error || ('series' in result && result.series.length === 0)) {
    return <WqlEmptyState result={result} />;
  }

  return (
    <div className="w-full h-full min-h-[160px]">
      {renderChart(resolved, result, label, unit, params, attributes)}
    </div>
  );
}

function renderChart(
  type: string,
  result: QueryResult,
  label?: string,
  unit?: string,
  params?: string[],
  attributes?: Record<string, string>,
): ReactNode {
  switch (type) {
    case 'value':
      return <QueryValue result={result} label={label ?? ''} unit={unit} />;
    case 'donut':
      return <WqlDonut result={result} unit={unit} label={label} />;
    case 'timeseries':
      return <WqlTimeseries result={result} unit={unit} />;
    case 'bar':
    case 'bars':
      return <WqlBars result={result} unit={unit} />;
    case 'top':
    case 'toplist':
      return <TopList result={result} unit={unit} />;
    case 'stacked':
    case 'stacked-bar':
      return <StackedBar result={result} unit={unit} />;
    case 'goal-rings':
      return <GoalRings result={result} attributes={attributes} params={params} label={label} unit={unit} />;
    case 'zone-distribution':
      return <ZoneDistribution result={result} attributes={attributes} params={params} unit={unit} />;
    case 'table':
      return <WqlTable result={result} unit={unit} />;
    default:
      if (Array.isArray(PLANNED_WIDGET_TYPES) ? (PLANNED_WIDGET_TYPES as readonly string[]).includes(type) : (PLANNED_WIDGET_TYPES as unknown as { has?: (t: string) => boolean }).has?.(type)) {
        return <PlannedWidgetPlaceholder type={type} />;
      }
      return <WqlTable result={result} unit={unit} />;
  }
}

export function WidgetProblemBadge({ message }: { message: string }) {
  return (
    <div
      role="alert"
      data-testid="widget-problem"
      className="flex items-center justify-center h-full p-4 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs font-medium text-center"
    >
      {message}
    </div>
  );
}

export function ProposedMetricBadge({ metric }: { metric: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center h-full p-4 rounded-md border border-dashed border-border bg-muted/20 text-muted-foreground text-xs text-center gap-1"
    >
      <span className="font-mono font-medium text-foreground">{metric}</span>
      <span>Calculated metric pending engine support</span>
    </div>
  );
}

function PlannedWidgetPlaceholder({ type }: { type: string }) {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground font-mono bg-muted/20 rounded p-4 text-center">
      widget:{type} renderer in progress
    </div>
  );
}

/** Donut (`:donut` sink / dashboard `donut` widget): one slice per series —
 *  the series' point total. Recharts Pie with an inner radius; an
 *  accessible text summary rides alongside for screen readers. */
function WqlDonut({ result, unit, label }: { result: QueryResult; unit?: string; label?: string }) {
  const data = result.series.map((s, i) => ({
    name: s.label,
    value: s.points.reduce((sum, p) => sum + (p.missing ? 0 : p.value), 0),
    fill: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
  const slices = data.filter((d) => d.value > 0);
  const summaryUnit = result.series[0]?.unit ?? unit ?? '';
  const summary = slices.length > 0
    ? `${label ?? 'distribution'}: ${slices.map((d) => `${d.name} ${compactNumber(d.value)}${summaryUnit}`).join(', ')}`
    : 'no data';

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center"
      role="img"
      aria-label={summary}
      data-testid="wql-donut"
    >
      {slices.length === 0 ? (
        <span className="text-xs text-muted-foreground">No data</span>
      ) : (
        <>
          <div className="w-full h-[220px] min-h-[160px] shrink-0">
            <ResponsiveDonut data={slices} unit={summaryUnit} />
          </div>
          <ul className="shrink-0 text-[10px] font-mono text-muted-foreground space-y-0.5" aria-hidden="true">
            {slices.map((d) => (
              <li key={d.name} className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-sm" style={{ background: d.fill }} />
                <span>{`${d.name} ${compactNumber(d.value)}${summaryUnit}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ResponsiveDonut({ data, unit }: { data: Array<{ name: string; value: number; fill: string }>; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          stroke="hsl(var(--background))"
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => `${compactNumber(Number(value))}${unit}`} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TabularTable({ table }: { table: { columns: Array<{ name: string; unit?: string }>; rows: Array<Record<string, unknown>>; groups?: Array<{ key: string; label: string; rows: Array<Record<string, unknown>> }> } }) {
  return (
    <div className="h-full overflow-auto" data-testid="tabular-table">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-left">
            {table.columns.map((c) => (
              <th key={c.name} className="py-1 px-2 font-medium">
                {c.name}{c.unit ? ` (${c.unit})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.groups ? (
            table.groups.map((group) => (
              <React.Fragment key={group.key}>
                <tr className="bg-muted/40 font-semibold border-b border-border/60">
                  <td colSpan={table.columns.length} className="py-1 px-2">
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                    {table.columns.map((c) => (
                      <td key={c.name} className="py-1 px-2 whitespace-nowrap">
                        {String(row[c.name] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))
          ) : (
            table.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                {table.columns.map((c) => (
                  <td key={c.name} className="py-1 px-2 whitespace-nowrap">
                    {String(row[c.name] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function containerPageHref(container: NoteContainer | undefined): string | undefined {
  if (!container || container.kind !== 'page') return undefined;
  const { slug, date } = container as { slug?: string; date?: string };
  if (slug) return `/page/${encodeURIComponent(slug)}`;
  if (date) return `/day/${encodeURIComponent(date)}`;
  return undefined;
}

interface ThingListItem {
  id?: string;
  resultId?: string;
  title?: string;
  label?: string;
  noteTitle?: string;
  blockContentId?: string;
  type?: string;
  dataType?: string;
  sourceId?: string;
  discipline?: string;
  baseAttributes?: { discipline?: string; met?: number; intensityTier?: string };
  date?: number | string;
  createdAt?: number | string;
  timestamp?: number;
  tags?: string[];
}

function formatItemDate(item: ThingListItem): string {
  const raw = item.date ?? item.timestamp ?? item.createdAt;
  if (raw === undefined || raw === null || raw === '') return '—';
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

function ContentRecordsTable({
  result,
  onOpenNote,
  noteHref,
}: {
  result: WidgetRunResult | undefined;
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}) {
  const parsed = result?.parsed as unknown as {
    target?: string;
    source?: { kind?: string; query?: { family?: string; target?: string } };
  } | undefined;
  const target: string =
    parsed?.target ??
    (parsed?.source?.kind === 'query' && parsed?.source?.query?.family === 'find'
      ? (parsed.source.query.target ?? 'note')
      : result?.blocks?.length
        ? 'block'
        : 'note');
  const isBlock = target === 'block' || Boolean(result?.blocks?.length && !result?.notes?.length);
  const rawItems: unknown[] = result?.notes?.length
    ? result.notes
    : result?.blocks?.length
      ? result.blocks
      : result?.efforts?.length
        ? result.efforts
        : result?.runs ?? [];
  const items = rawItems as ThingListItem[];

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center" data-testid="content-records-table-empty">
        No {target}s matched this query.
      </div>
    );
  }

  const containers = result?.containers;

  return (
    <div className="h-full overflow-auto border-y border-border/60 bg-card/40" data-testid="content-records-table">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="py-2 px-3">Title</th>
            <th className="py-2 px-3">Kind</th>
            <th className="py-2 px-3">Tags / Details</th>
            <th className="py-2 px-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {items.map((item, i) => {
            const id = item.id ?? item.resultId ?? String(i);
            const typedItem = { ...item, id, title: item.title ?? item.label ?? item.noteTitle };
            const title = isBlock
              ? typedItem.title || typedItem.blockContentId || id
              : typedItem.title || id;
            const href = containers
              ? containerPageHref(containers[id]) ?? (noteHref ? noteHref(typedItem) : undefined)
              : noteHref
                ? noteHref(typedItem)
                : undefined;
            const kindLabel = item.type ?? item.dataType ?? item.baseAttributes?.discipline ?? target;
            const detail = Array.isArray(item.tags) && item.tags.length > 0
              ? item.tags.map((t) => `#${t}`).join(' ')
              : item.baseAttributes?.met
                ? `MET ${item.baseAttributes.met}`
                : item.sourceId ?? '—';
            return (
              <tr key={id} className="hover:bg-muted/30 transition-colors">
                <td className="py-2 px-3 font-medium truncate max-w-[260px]">
                  {href ? (
                    <a
                      href={href}
                      onClick={(e) => {
                        if (onOpenNote) {
                          e.preventDefault();
                          onOpenNote(typedItem);
                        }
                      }}
                      className="text-primary hover:underline"
                    >
                      {title}
                    </a>
                  ) : onOpenNote ? (
                    <button
                      type="button"
                      onClick={() => onOpenNote(typedItem)}
                      className="text-left text-primary hover:underline"
                    >
                      {title}
                    </button>
                  ) : (
                    <span className="text-foreground">{title}</span>
                  )}
                </td>
                <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground">{kindLabel}</td>
                <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground truncate max-w-[200px]">{detail}</td>
                <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground text-right tabular-nums">{formatItemDate(item)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function ThingList({
  result,
  onOpenNote,
  noteHref,
}: {
  result: WidgetRunResult | undefined;
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}) {
  const parsed = result?.parsed as unknown as {
    target?: string;
    source?: { kind?: string; query?: { family?: string; target?: string } };
  } | undefined;
  const target: string =
    parsed?.target ??
    (parsed?.source?.kind === 'query' && parsed?.source?.query?.family === 'find'
      ? (parsed.source.query.target ?? 'note')
      : result?.blocks?.length
        ? 'block'
        : 'note');
  const isBlock = target === 'block' || Boolean(result?.blocks?.length && !result?.notes?.length);
  const rawItems: unknown[] = result?.notes?.length
    ? result.notes
    : result?.blocks?.length
      ? result.blocks
      : result?.efforts?.length
        ? result.efforts
        : result?.runs ?? [];
  const items = rawItems as ThingListItem[];

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2" data-testid="thing-list">
        No {target}s matched this query.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto space-y-1" data-testid="thing-list">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">
        {items.length} {target}{items.length === 1 ? '' : 's'} matched
      </div>
      <ul className="space-y-0.5 max-h-48 overflow-y-auto font-mono text-xs">
        {items.map((item, i) => {
          const id = item.id ?? item.resultId ?? String(i);
          const typedItem = { ...item, id, title: item.title ?? item.label ?? item.noteTitle };
          const title = isBlock
            ? typedItem.title || typedItem.blockContentId || id
            : typedItem.title || id;
          const containers = result?.containers;
          const href = containers
            ? containerPageHref(containers[id]) ?? (noteHref ? noteHref(typedItem) : undefined)
            : noteHref
              ? noteHref(typedItem)
              : undefined;
          return (
            <li key={id} className="rounded hover:bg-muted/50 truncate">
              {href ? (
                <a
                  href={href}
                  onClick={(e) => {
                    if (onOpenNote) {
                      e.preventDefault();
                      onOpenNote(typedItem);
                    }
                  }}
                  className="block py-0.5 px-1.5 text-primary hover:underline truncate"
                >
                  {title}
                </a>
              ) : onOpenNote ? (
                <button
                  type="button"
                  onClick={() => onOpenNote(typedItem)}
                  className="w-full text-left py-0.5 px-1.5 text-primary hover:underline truncate"
                >
                  {title}
                </button>
              ) : (
                <span className="block py-0.5 px-1.5 text-foreground truncate">{title}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
