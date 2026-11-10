import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Copy, Trash2 } from 'lucide-react';
import { isFindQuery, isPipelineQuery, parseQuery, parseDocument, type AnyParsedQuery, defaultTokenValues, isDashboardWidgetType, resolveWidgetType, substituteTokens, unknownTokensMessage, unknownWidgetTypeMessage, type DashboardDocument, type DashboardWidget, SharedQueryDocumentRunner } from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { WidgetFrame, WidgetToolButton, WidgetEditButton } from './WidgetFrame';
import { WidgetChart, WidgetProblemBadge } from './WidgetChart';
import { createExecutorDocumentHost, outputsToRunResult, type WidgetRunResult } from './chartData';
import { DashboardTokenControls } from './DashboardTokenControls';
export { createExecutorDocumentHost, outputsToRunResult, type WidgetRunResult };
import { cn } from '../utils/cn';

/** A widget's grid placement — column span 1..4, or a forced full row. */
export interface WidgetSpanOption {
  spanCols?: number;
  spanFull?: boolean;
}

/** A note heading rendered as a full-width grid row between widgets, with its
 * own DOM anchor (L3 scroll target). Order within `headings` is preserved. */
export interface DashboardHeadingAnchor {
  id: string;
  /** Markdown heading level (2+; level 1 renders as the page title surface). */
  level: number;
  text: string;
  /** Insert before this widget index; `widgets.length` = after the last. */
  beforeWidget: number;
}

export interface DashboardViewProps {
  /** Parsed dashboard note (buildDashboardDocument). */
  document: DashboardDocument;
  /** Note headings to render between the widgets (document order). */
  headings?: DashboardHeadingAnchor[];
  /** Injected QueryExecutor for executing WQL queries. Zero singleton coupling. */
  executor?: QueryExecutor;
  /** Optional rollup fact warmer callback. */
  onEnsureRollupFacts?: () => Promise<void>;
  /** Current token values; defaults to each token's declared default. */
  tokenValues?: Record<string, string>;
  /** Present when the note is editable — committed control changes write back to frontmatter. */
  onTokenChange?: (name: string, value: string) => void;
  /**
   * Edit mode: per-widget arrangement chrome (edit / duplicate / remove /
   * reorder / size) renders on every card. View mode stays chrome-free —
   * the host gates editing on this flag plus the handler set below.
   */
  editMode?: boolean;
  /** Open the shared authoring composer for this widget (edit flow). */
  onEditWidget?: (widget: DashboardWidget) => void;
  /** Read-only query inspection (prebuilt seeds, teaching surfaces). */
  onInspectWidget?: (widget: DashboardWidget) => void;
  /** Open the widget's token-resolved query in the WQL explorer (host navigates). */
  onOpenInExplorer?: (widget: DashboardWidget, query: string) => void;
  onDuplicateWidget?: (widget: DashboardWidget) => void;
  onRemoveWidget?: (widget: DashboardWidget) => void;
  onMoveWidget?: (widget: DashboardWidget, delta: -1 | 1) => void;
  onResizeWidget?: (widget: DashboardWidget, span: WidgetSpanOption) => void;
  /** Optional execution range (ms epoch). Omit to use each query's own window. */
  rangeStart?: number;
  rangeEnd?: number;
  preferredUnit?: string;
  /** Optional click handler for opening a note/block from content-plane widgets. */
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  /** Optional resolver returning the destination href for an item in content-plane widgets. */
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}

interface WidgetRun {
  result?: WidgetRunResult;
  error?: string;
}
/**
 * Grid span classes for a widget on the 1 / 2 / 4-column responsive grid.
 * An explicit fence span (`-N` / `-full`) wins; otherwise the type default.
 */
function spanClass(widget: DashboardWidget): string {
  if (widget.spanFull) return 'col-span-1 md:col-span-2 lg:col-span-4';
  if (widget.spanCols != null) {
    if (widget.spanCols <= 1) return 'col-span-1';
    if (widget.spanCols === 2) return 'col-span-1 md:col-span-2';
    if (widget.spanCols === 3) return 'col-span-1 md:col-span-2 lg:col-span-3';
    return 'col-span-1 md:col-span-2 lg:col-span-4';
  }
  const resolved = resolveWidgetType(widget.type);
  if (resolved === 'value') return 'col-span-1';
  if (resolved === 'table') return 'col-span-1 md:col-span-2';
  return 'col-span-1 md:col-span-2 lg:col-span-4';
}

/** Size options in the edit-mode toolbar — column span or a full row. */
const SIZE_OPTIONS: Array<{ label: string; span: WidgetSpanOption; testId: string }> = [
  { label: 'Span 1 column', span: { spanCols: 1 }, testId: 'widget-size-1' },
  { label: 'Span 2 columns', span: { spanCols: 2 }, testId: 'widget-size-2' },
  { label: 'Span 4 columns', span: { spanCols: 4 }, testId: 'widget-size-4' },
  { label: 'Full row', span: { spanFull: true }, testId: 'widget-size-full' },
];

function sizeIsActive(widget: DashboardWidget, span: WidgetSpanOption): boolean {
  if (span.spanFull) return widget.spanFull === true;
  return !widget.spanFull && (widget.spanCols ?? null) === (span.spanCols ?? null);
}

/**
 * DashboardView — the state-free dashboard renderer (#900, format locked in #899).
 *
 * Takes a parsed DashboardDocument + current token values, runs all widget
 * queries concurrently via the injected QueryExecutor, and renders the
 * responsive CSS grid. All authoring interactions are host-owned: the view
 * surfaces the affordances (edit-mode toolbar, inspect button) and reports
 * through the injected callbacks — it never owns dialog or write state.
 */
export function DashboardView({
  document,
  headings,
  executor,
  onEnsureRollupFacts,
  tokenValues,
  onTokenChange,
  editMode = false,
  onEditWidget,
  onInspectWidget,
  onOpenInExplorer,
  onDuplicateWidget,
  onRemoveWidget,
  onMoveWidget,
  onResizeWidget,
  rangeStart,
  rangeEnd,
  preferredUnit,
  onOpenNote,
  noteHref,
}: DashboardViewProps) {
  const values = useMemo(
    () => ({ ...defaultTokenValues(document.tokens), ...tokenValues }),
    [document.tokens, tokenValues],
  );

  const resolved = useMemo(
    () =>
      document.widgets.map((widget) => {
        const { query, missing } = substituteTokens(widget.body, values);
        // Fence-tag attributes carry presentation params (`goal=$token`) —
        // they ride the same token values as the body, and a missing token
        // blocks the widget instead of rendering a NaN target.
        const attributes: Record<string, string> = {};
        const allMissing = new Set(missing);
        for (const [key, value] of Object.entries(widget.attributes)) {
          const sub = substituteTokens(value, values);
          attributes[key] = sub.query;
          for (const m of sub.missing) allMissing.add(m);
        }
        return { widget, query, missing: [...allMissing], attributes };
      }),
    [document.widgets, values],
  );

  const [runs, setRuns] = useState<Record<string, WidgetRun>>({});
  const [loading, setLoading] = useState(true);

  const resolvedKey = useMemo(
    () => resolved.map((r) => `${r.widget.key}:${r.query}`).join('|'),
    [resolved],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const next: Record<string, WidgetRun> = {};
      const runnable: Array<{
        widget: DashboardWidget;
        query: string;
        parsed: AnyParsedQuery;
        attributes: Record<string, string>;
      }> = [];

      for (const { widget, query, missing, attributes } of resolved) {
        if (widget.type !== '' && !isDashboardWidgetType(widget.type)) {
          next[widget.key] = { error: unknownWidgetTypeMessage(widget.type) };
          continue;
        }
        if (missing.length > 0) {
          next[widget.key] = { error: unknownTokensMessage(missing) };
          continue;
        }
        const docParse = parseDocument(query);
        const isMultiLineDoc = !docParse.doc.degenerate && docParse.doc.assignments.length > 0;
        const parsed: AnyParsedQuery = isMultiLineDoc
          ? { family: 'aggregate', raw: query, agg: 'sum', metric: docParse.doc.show[0] ?? 'value', filters: [], groupBy: [] }
          : parseQuery(query);
        const syntaxErr = isMultiLineDoc ? docParse.diagnostics[0] : parsed.error;
        if (syntaxErr) {
          next[widget.key] = { error: syntaxErr };
          continue;
        }
        const resolvedType = resolveWidgetType(widget.type);
        if (isFindQuery(parsed)) {
          if (resolvedType !== 'table' && resolvedType !== 'list') {
            next[widget.key] = { error: 'content queries return things — use a table or list widget instead' };
            continue;
          }
        } else if (!isPipelineQuery(parsed) && !isMultiLineDoc && resolvedType === 'list') {
          next[widget.key] = { error: 'aggregate queries return numbers — use a chart or value widget instead' };
          continue;
        }
        runnable.push({ widget, query, parsed, attributes });
      }

      if (!executor) {
        if (!cancelled) {
          setRuns(next);
          setLoading(false);
        }
        return;
      }

      // One runner host per dashboard run; each widget document gets its own
      // captured execution context (ticket 12) — overlapping runs never
      // borrow each other's snapshot. Rollup-ensure is AST-driven inside the
      // runner (calc.* heads incl. pipeline stages), not string sniffing.
      const host = createExecutorDocumentHost(executor, {
        rangeStart,
        rangeEnd,
        preferredUnit,
        rollupEnsure: onEnsureRollupFacts,
      });

      await Promise.all(
        runnable.map(async ({ widget, query, parsed, attributes }) => {
          try {
            const runner = new SharedQueryDocumentRunner(host);
            const res = await runner.run(query);
            // Merge every shown output — a widget whose document shows
            // several bindings (`show a, b | :stacked-bar{}`) renders all
            // of them, not just the first.
            const error = res.outputs.find((o) => o.error !== undefined)?.error ?? res.diagnostics[0];
            next[widget.key] = {
              result: outputsToRunResult(parsed, res, attributes),
              ...(error ? { error } : {}),
            };
          } catch (err) {
            next[widget.key] = { error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );

      if (!cancelled) {
        setRuns(next);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [resolvedKey, resolved, executor, onEnsureRollupFacts, rangeStart, rangeEnd, preferredUnit]);

  return (
    <div data-testid="dashboard-view">
      <DashboardTokenControls tokens={document.tokens} values={values} onChange={onTokenChange} />

      {loading && <div className="text-sm text-muted-foreground mb-3">Loading widgets…</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {resolved.map(({ widget, query, attributes }, index) => {
          const run = runs[widget.key];
          const canArrange = editMode && (onEditWidget || onDuplicateWidget || onRemoveWidget || onMoveWidget || onResizeWidget);
          const before = (headings ?? []).filter((h) => h.beforeWidget === index);
          return (
            <Fragment key={widget.key}>
              {before.map((h) => (
                <div
                  key={h.id}
                  id={h.id}
                  className={cn('col-span-full font-semibold text-foreground', h.level <= 2 ? 'text-base mt-2' : 'text-sm')}
                >
                  {h.text}
                </div>
              ))}
              <WidgetFrame
              key={widget.key}
              id={`widget-${widget.key}`}
              title={widget.title ?? ''}
              question={widget.question ?? ''}
              query={query}
              span={spanClass(widget)}
              onInspect={onInspectWidget ? () => onInspectWidget(widget) : undefined}
              onOpenInExplorer={onOpenInExplorer ? () => onOpenInExplorer(widget, query) : undefined}
              toolbar={
                canArrange ? (
                  <div className="flex flex-wrap items-center gap-1.5" data-testid={`widget-toolbar-${widget.key}`}>
                    {onEditWidget && <WidgetEditButton title={widget.title ?? ''} onClick={() => onEditWidget(widget)} />}
                    {onMoveWidget && (
                      <>
                        <WidgetToolButton
                          label={`Move ${widget.title || 'widget'} up`}
                          disabled={index === 0}
                          onClick={() => onMoveWidget(widget, -1)}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </WidgetToolButton>
                        <WidgetToolButton
                          label={`Move ${widget.title || 'widget'} down`}
                          disabled={index === resolved.length - 1}
                          onClick={() => onMoveWidget(widget, 1)}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </WidgetToolButton>
                      </>
                    )}
                    {onResizeWidget && (
                      <div className="flex items-center gap-0 rounded bg-muted/60 p-0.5">
                        {SIZE_OPTIONS.map((option) => (
                          <button
                            key={option.testId}
                            type="button"
                            data-testid={`${option.testId}-${widget.key}`}
                            title={option.label}
                            aria-label={`${option.label} for ${widget.title || 'widget'}`}
                            aria-pressed={sizeIsActive(widget, option.span)}
                            disabled={sizeIsActive(widget, option.span)}
                            onClick={() => onResizeWidget(widget, option.span)}
                            className="inline-flex items-center justify-center px-1 py-0.5 max-lg:min-h-11 max-lg:min-w-11 text-xs font-mono rounded text-muted-foreground hover:text-foreground disabled:text-primary disabled:bg-primary/10"
                          >
                            {option.span.spanFull ? <ChevronRight className="w-3 h-3" /> : option.span.spanCols}
                          </button>
                        ))}
                      </div>
                    )}
                    {onDuplicateWidget && (
                      <WidgetToolButton
                        label={`Duplicate ${widget.title || 'widget'}`}
                        onClick={() => onDuplicateWidget(widget)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </WidgetToolButton>
                    )}
                    {onRemoveWidget && (
                      <WidgetToolButton
                        label={`Remove ${widget.title || 'widget'}`}
                        onClick={() => onRemoveWidget(widget)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </WidgetToolButton>
                    )}
                  </div>
                ) : undefined
              }
            >
              {run?.error ? (
                <WidgetProblemBadge message={run.error} />
              ) : (
                <WidgetChart
                  type={widget.type !== '' ? widget.type : (run?.result?.chart?.head ?? '')}
                  result={run?.result}
                  label={widget.title}
                  unit={preferredUnit}
                  attributes={{
                    ...Object.fromEntries(
                      (run?.result?.chart?.filters ?? []).map((f) => [f.key, f.values.map((v) => v.value).join(',')]),
                    ),
                    ...attributes,
                  }}
                  onOpenNote={onOpenNote}
                  noteHref={noteHref}
                />
              )}
            </WidgetFrame>
            </Fragment>
          );
        })}
        {(headings ?? []).filter((h) => h.beforeWidget >= resolved.length).map((h) => (
          <div
            key={h.id}
            id={h.id}
            className={cn('col-span-full font-semibold text-foreground', h.level <= 2 ? 'text-base mt-2' : 'text-sm')}
          >
            {h.text}
          </div>
        ))}
      </div>
    </div>
  );
}
