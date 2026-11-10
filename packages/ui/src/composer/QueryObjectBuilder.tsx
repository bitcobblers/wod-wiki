/**
 * QueryObjectBuilder — Unified UI-driven, Markdown/YAML-backed query object
 * builder across `bar`, `inline`, and `studio` densities.
 *
 * Architectural boundary:
 *   - **WQL** (`query` / `series[].query`) owns search & data selection via
 *     `<WqlComposer />` and pure AST operations (zero regex string surgery).
 *   - **YAML** (`QueryBlockObject`) owns presentation, titles, multi-series
 *     layers, formulas, goals, table columns, sorting, and grid spans via
 *     `parseQueryBlock` / `serializeQueryBlock`.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DASHBOARD_WIDGET_TYPES,
  isDashboardWidgetType,
  isFindQuery,
  isPipelineQuery,
  parseDocument,
  parseQuery,
  queryBlockAttributes,
  queryBlockToDocumentText,
  serialize,
  serializeQueryBlock,
  SharedQueryDocumentRunner,
  substituteTokens,
  unknownTokensMessage,
  type AnyParsedQuery,
  type ParsedAggregateQuery,
  type QueryBlockObject,
  type QuerySeriesSpec,
  type QuerySortSpec,
  type QueryViewKind,
  type ScalarOrParam,
} from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { cn } from '../utils/cn';
import { WidgetChart } from '../widgets/WidgetChart';
import {
  createExecutorDocumentHost,
  outputsToRunResult,
  type WidgetRunResult,
} from '../widgets/chartData';
import { bindTokenParamIntoWql } from './queryAst';
import { GROUPBY_OPTIONS } from './queryClauses';
import { WqlComposer } from './WqlComposer';

export type QueryObjectBuilderDensity = 'bar' | 'inline' | 'studio';

export interface QueryObjectValidationState {
  valid: boolean;
  error?: string;
}

export interface QueryObjectBuilderProps {
  value: QueryBlockObject;
  onChange: (next: QueryBlockObject) => void;
  density: QueryObjectBuilderDensity;
  readOnly?: boolean;
  executor?: QueryExecutor;
  tokenValues?: Record<string, string>;
  preferredUnit?: string;
  rangeStart?: number;
  rangeEnd?: number;
  preferredChoices?: readonly string[];
  /** Optional read-only dataset subset banner for studio mode (Explorer -> Dashboard). */
  subsetQuery?: string | null;
  /** Optional destination slot rendered between dataset and query in studio mode. */
  destination?: ReactNode;
  onValidationChange?: (state: QueryObjectValidationState) => void;
  onSubmit?: (next: QueryBlockObject) => void;
  actionLabel?: string;
  className?: string;
}

const SPAN_OPTIONS: readonly { label: string; span?: 1 | 2 | 4 | 'full' }[] = [
  { label: 'Auto', span: undefined },
  { label: '1 col', span: 1 },
  { label: '2 cols', span: 2 },
  { label: '4 cols', span: 4 },
  { label: 'Full row', span: 'full' },
];

const SENTENCE_METRICS = ['totalVolume', 'reps', 'tis', 'calc.e1rm', 'calc.readiness'];
const SENTENCE_GROUPS = ['week', 'day', 'session', 'round', 'effort', 'equipment'];
const BASELINE_PERIODS = [4, 12, 2] as const;
const PREVIEW_DEBOUNCE_MS = 300;

// ── Pure QueryBlockObject AST Helpers ────────────────────────────────────────

export function primarySeriesOf(obj: QueryBlockObject): QuerySeriesSpec | undefined {
  return obj.series?.find((s) => Boolean(s.query)) ?? obj.series?.[0];
}

export function primaryQueryOf(obj: QueryBlockObject): string {
  return primarySeriesOf(obj)?.query ?? obj.query ?? '';
}

function collapseIfSingleSeries(series: readonly QuerySeriesSpec[]): Pick<QueryBlockObject, 'query' | 'series'> {
  if (series.length === 1) {
    const only = series[0]!;
    if (
      only.id === 'primary' &&
      only.query &&
      !only.formula &&
      !only.label &&
      !only.normalize &&
      !only.unit &&
      only.visible !== false
    ) {
      return { query: only.query, series: undefined };
    }
  }
  return { query: undefined, series: [...series] };
}

export function ensureSeriesList(obj: QueryBlockObject): QuerySeriesSpec[] {
  if (obj.series && obj.series.length > 0) return obj.series.map((s) => ({ ...s }));
  return [{ id: 'primary', query: (obj.query ?? 'sum:totalVolume{}').trim() }];
}

export function setPrimaryQueryOnObject(obj: QueryBlockObject, nextQuery: string): QueryBlockObject {
  if (obj.series && obj.series.length > 0) {
    const idx = obj.series.findIndex((s) => Boolean(s.query));
    const targetIdx = idx >= 0 ? idx : 0;
    const nextSeries = obj.series.map((s, i) => (i === targetIdx ? { ...s, query: nextQuery } : s));
    return { ...obj, ...collapseIfSingleSeries(nextSeries) };
  }
  return { ...obj, query: nextQuery };
}

function stripPipelineSink(ast: AnyParsedQuery): AnyParsedQuery {
  if (isPipelineQuery(ast) && ast.sink) {
    return { ...ast, sink: undefined };
  }
  return ast;
}

function mutateCalcAst(
  parsed: AnyParsedQuery,
  edit: { metric?: string; group?: string; rollupWeeks?: number },
): AnyParsedQuery | null {
  if (parsed.error) return null;
  if (parsed.family === 'aggregate') {
    const next: ParsedAggregateQuery = {
      ...parsed,
      ...(edit.metric ? { metric: edit.metric, metricParam: edit.metric.startsWith('$') ? edit.metric.slice(1) : undefined } : {}),
      ...(edit.group ? { groupBy: [edit.group] } : {}),
      ...(edit.rollupWeeks ? { rollup: { size: edit.rollupWeeks, unit: 'w' } } : {}),
    };
    return next;
  }
  if (isPipelineQuery(parsed) && parsed.transforms.length > 0) {
    const lastIdx = parsed.transforms.length - 1;
    const transforms = parsed.transforms.map((fn, idx) =>
      idx === lastIdx
        ? {
            ...fn,
            ...(edit.metric ? { metric: edit.metric, metricParam: edit.metric.startsWith('$') ? edit.metric.slice(1) : undefined } : {}),
            ...(edit.group ? { groupBy: [edit.group] } : {}),
            ...(edit.rollupWeeks ? { rollup: { size: edit.rollupWeeks, unit: 'w' as const } } : {}),
          }
        : fn,
    );
    return { ...parsed, sink: undefined, transforms };
  }
  return null;
}

export function promoteFindToChartObject(
  obj: QueryBlockObject,
  metric = 'totalVolume',
): QueryBlockObject {
  const raw = primaryQueryOf(obj).trim();
  const parsed = parseQuery(raw);
  if (parsed.error || !isFindQuery(parsed)) return obj;

  let nextAst: ParsedAggregateQuery;
  if (parsed.target === 'segment' || parsed.target === 'event') {
    nextAst = {
      family: 'aggregate',
      raw: '',
      agg: 'sum',
      metric,
      filters: parsed.filters,
      groupBy: ['week'],
      window: parsed.window,
      displayUnit: parsed.displayUnit,
    };
  } else {
    const hasScope = parsed.filters.length > 0;
    nextAst = {
      family: 'aggregate',
      raw: '',
      agg: 'sum',
      metric,
      filters: [],
      groupBy: ['week'],
      window: parsed.window,
      displayUnit: parsed.displayUnit,
      ...(hasScope
        ? {
            join: {
              target: parsed.target === 'session' ? 'note' : parsed.target,
              filters: parsed.filters,
            },
          }
        : {}),
    };
  }
  return {
    ...setPrimaryQueryOnObject(obj, serialize(nextAst)),
    view: 'timeseries',
    rawViewType: undefined,
  };
}

export function bindTokenToQueryObject(obj: QueryBlockObject, tokenName: string): QueryBlockObject {
  if (obj.series && obj.series.length > 0) {
    return {
      ...obj,
      series: obj.series.map((s) =>
        s.query ? { ...s, query: bindTokenParamIntoWql(s.query, tokenName) } : s,
      ),
    };
  }
  return {
    ...obj,
    query: bindTokenParamIntoWql(obj.query ?? ':note', tokenName),
  };
}

export function toggleGoalLayer(obj: QueryBlockObject, defaultTarget = 150): QueryBlockObject {
  const series = ensureSeriesList(obj);
  const existingIdx = series.findIndex((s) => s.id === 'goal');
  if (existingIdx >= 0) {
    const next = series.filter((s) => s.id !== 'goal');
    return { ...obj, ...collapseIfSingleSeries(next) };
  }
  const primary = series.find((s) => Boolean(s.query)) ?? series[0]!;
  const cleanPrimary = primary.query ? serialize(stripPipelineSink(parseQuery(primary.query))) : primary.query;
  const normalizedSeries = series.map((s) => (s.id === primary.id && cleanPrimary ? { ...s, query: cleanPrimary } : s));
  normalizedSeries.push({ id: 'goal', formula: `${primary.id} * 0 + ${defaultTarget}` });
  return { ...obj, query: undefined, series: normalizedSeries };
}

export function cycleBaselineLayer(obj: QueryBlockObject): QueryBlockObject {
  const series = ensureSeriesList(obj);
  const primary = series.find((s) => Boolean(s.query));
  if (!primary?.query) return obj;
  const primaryAst = parseQuery(primary.query);
  const existing = series.find((s) => /^baseline_(2|4|12)w$/.test(s.id));
  const currentWeeks = existing ? Number(/^baseline_(\d+)w$/.exec(existing.id)?.[1]) : undefined;
  const currentIdx = BASELINE_PERIODS.findIndex((p) => p === currentWeeks);
  const nextWeeks = currentIdx >= 0 ? BASELINE_PERIODS[(currentIdx + 1) % BASELINE_PERIODS.length]! : 4;
  const baselineAst = mutateCalcAst(primaryAst, { rollupWeeks: nextWeeks });
  if (!baselineAst) return obj;

  const cleanPrimary = serialize(stripPipelineSink(primaryAst));
  const withoutOld = series
    .filter((s) => s.id !== existing?.id)
    .map((s) => (s.id === primary.id ? { ...s, query: cleanPrimary } : s));
  withoutOld.push({ id: `baseline_${nextWeeks}w`, query: serialize(baselineAst) });
  return { ...obj, query: undefined, series: withoutOld };
}

export function toggleCompareLayer(obj: QueryBlockObject): QueryBlockObject {
  const series = ensureSeriesList(obj);
  if (series.some((s) => s.id === 'secondary')) {
    const next = series.filter((s) => s.id !== 'secondary');
    return { ...obj, ...collapseIfSingleSeries(next) };
  }
  const primary = series.find((s) => Boolean(s.query));
  if (!primary?.query) return obj;
  const primaryAst = parseQuery(primary.query);
  const primaryMetric =
    primaryAst.family === 'aggregate'
      ? primaryAst.metric
      : isPipelineQuery(primaryAst)
        ? primaryAst.transforms.at(-1)?.metric
        : undefined;
  const compareMetric = primaryMetric === 'reps' ? 'tis' : 'reps';
  const secondaryAst = mutateCalcAst(primaryAst, { metric: compareMetric });
  if (!secondaryAst) return obj;

  const cleanPrimary = serialize(stripPipelineSink(primaryAst));
  const next = series.map((s) => (s.id === primary.id ? { ...s, query: cleanPrimary } : s));
  next.push({ id: 'secondary', query: serialize(secondaryAst) });
  return { ...obj, query: undefined, series: next };
}

export function removeSeriesLayer(obj: QueryBlockObject, id: string): QueryBlockObject {
  const series = ensureSeriesList(obj).filter((s) => s.id !== id);
  if (series.length === 0) return { ...obj, query: 'sum:totalVolume{}', series: undefined };
  return { ...obj, ...collapseIfSingleSeries(series) };
}

function parseScalarOrParamInput(raw: string): ScalarOrParam | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('$') && trimmed.length > 1) return { param: trimmed.slice(1) };
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

function formatScalarOrParam(val: ScalarOrParam | undefined): string {
  if (val === undefined) return '';
  return typeof val === 'number' ? String(val) : `$${val.param}`;
}

function parseParamsField(
  text: string,
): Pick<QueryBlockObject, 'goal' | 'targets' | 'attributes'> {
  const trimmed = text.trim();
  if (!trimmed) return { goal: undefined, targets: undefined, attributes: undefined };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  // Key=value pairs (e.g. `goal=$squatGoal` or `targets="300 200"`)
  if (tokens.some((t) => t.includes('='))) {
    const extra: Record<string, string> = {};
    let goal: ScalarOrParam | undefined;
    let targets: ScalarOrParam[] | undefined;
    const attrPattern = /([a-zA-Z][a-zA-Z0-9_-]*)=("([^"]*)"|\S+)/g;
    for (const match of trimmed.matchAll(attrPattern)) {
      const key = match[1]!;
      const value = match[3] !== undefined ? match[3] : match[2]!;
      if (key === 'goal') {
        goal = parseScalarOrParamInput(value);
      } else if (key === 'targets') {
        const items = value
          .split(/[\s,]+/)
          .map(parseScalarOrParamInput)
          .filter((x): x is ScalarOrParam => x !== undefined);
        if (items.length > 0) targets = items;
      } else {
        extra[key] = value;
      }
    }
    return {
      goal,
      targets,
      attributes: Object.keys(extra).length > 0 ? extra : undefined,
    };
  }
  // Space-separated scalar/param targets (`300 200` or `$squatGoal`)
  const items = tokens
    .map(parseScalarOrParamInput)
    .filter((x): x is ScalarOrParam => x !== undefined);
  if (items.length === 1) return { goal: items[0], targets: undefined, attributes: undefined };
  if (items.length > 1) return { goal: undefined, targets: items, attributes: undefined };
  return { goal: undefined, targets: undefined, attributes: undefined };
}

function formatParamsField(obj: QueryBlockObject): string {
  const parts: string[] = [];
  if (obj.goal !== undefined) {
    parts.push(`goal=${formatScalarOrParam(obj.goal)}`);
  }
  if (obj.targets && obj.targets.length > 0) {
    const body = obj.targets.map(formatScalarOrParam).join(' ');
    parts.push(obj.targets.length > 1 ? `targets="${body}"` : `targets=${body}`);
  }
  for (const [k, v] of Object.entries(obj.attributes ?? {})) {
    parts.push(v.includes(' ') ? `${k}="${v}"` : `${k}=${v}`);
  }
  return parts.join(' ');
}

function parseSortInput(text: string): QuerySortSpec[] | undefined {
  const items = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): QuerySortSpec => {
      const tokens = part.split(/\s+/);
      const dir = tokens[1]?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      return { col: tokens[0]!, dir };
    });
  return items.length > 0 ? items : undefined;
}

function formatSortInput(sort: readonly QuerySortSpec[] | undefined): string {
  if (!sort || sort.length === 0) return '';
  return sort.map((s) => `${s.col} ${s.dir}`).join(', ');
}

// ── Component ────────────────────────────────────────────────────────────────

export function QueryObjectBuilder({
  value,
  onChange,
  density,
  readOnly = false,
  executor,
  tokenValues,
  preferredUnit,
  rangeStart,
  rangeEnd,
  preferredChoices,
  subsetQuery,
  destination,
  onValidationChange,
  onSubmit,
  actionLabel,
  className,
}: QueryObjectBuilderProps) {
  const primaryWql = primaryQueryOf(value);
  const compiledDocText = useMemo(() => queryBlockToDocumentText(value), [value]);
  const yamlText = useMemo(() => serializeQueryBlock(value), [value]);

  const parsedPrimary = useMemo(() => parseQuery(primaryWql.trim()), [primaryWql]);
  const parsedDoc = useMemo(() => parseDocument(compiledDocText.trim()), [compiledDocText]);
  const isMultiSeriesDoc = !parsedDoc.doc.degenerate && parsedDoc.doc.assignments.length > 0;

  const effectiveParsed = useMemo<AnyParsedQuery>(
    () =>
      isMultiSeriesDoc
        ? {
            family: 'aggregate',
            raw: compiledDocText.trim(),
            agg: 'sum',
            metric: parsedDoc.doc.show[0] ?? 'value',
            filters: [],
            groupBy: [],
          }
        : parsedPrimary,
    [isMultiSeriesDoc, compiledDocText, parsedDoc, parsedPrimary],
  );

  const [composerValid, setComposerValid] = useState<boolean>(() => !parsedPrimary.error);
  const [showYaml, setShowYaml] = useState(false);
  const [columnsDraft, setColumnsDraft] = useState(() => (value.columns ?? []).join(', '));
  const [sortDraft, setSortDraft] = useState(() => formatSortInput(value.sort));
  const [paramsText, setParamsText] = useState(() => formatParamsField(value));

  const draftError = value.error ?? (isMultiSeriesDoc ? parsedDoc.diagnostics[0] : parsedPrimary.error);
  const resolvedView: QueryViewKind = value.view || 'table';
  const viewCompatible =
    !draftError &&
    compiledDocText.trim() !== '' &&
    (density !== 'studio' ||
      (isFindQuery(effectiveParsed)
        ? resolvedView === 'table' || resolvedView === 'list'
        : resolvedView !== 'list'));

  const isValid = viewCompatible && (isMultiSeriesDoc || composerValid);

  useEffect(() => {
    onValidationChange?.({ valid: isValid, error: draftError });
  }, [isValid, draftError, onValidationChange]);

  // ── Studio live preview ──────────────────────────────────────────────────
  const [preview, setPreview] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ok'; result: WidgetRunResult }
    | { status: 'error'; message: string }
    | { status: 'blocked'; message: string }
  >({ status: 'idle' });
  const previewSeq = useRef(0);

  const derivedAttributes = useMemo(() => {
    const rawAttrs = queryBlockAttributes(value).attributes;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAttrs)) {
      out[k] = substituteTokens(v, tokenValues ?? {}).query;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [value, tokenValues]);

  useEffect(() => {
    if (density !== 'studio') return;
    if (!viewCompatible || !executor) {
      setPreview((prev) => (prev.status === 'ok' ? prev : { status: 'idle' }));
      return;
    }
    const substituted = substituteTokens(compiledDocText.trim(), tokenValues ?? {});
    const missingSet = new Set(substituted.missing);
    for (const rawVal of Object.values(queryBlockAttributes(value).attributes)) {
      for (const m of substituteTokens(rawVal, tokenValues ?? {}).missing) missingSet.add(m);
    }
    const missing = [...missingSet];
    if (missing.length > 0) {
      setPreview({ status: 'blocked', message: unknownTokensMessage(missing) });
      return;
    }
    const seq = ++previewSeq.current;
    setPreview({ status: 'loading' });
    const timer = setTimeout(() => {
      const host = createExecutorDocumentHost(executor, { rangeStart, rangeEnd, preferredUnit });
      const runner = new SharedQueryDocumentRunner(host);
      runner
        .run(substituted.query)
        .then((res) => {
          if (previewSeq.current !== seq) return;
          const out = res.outputs[0];
          const err = res.outputs.find((o) => o.error)?.error ?? res.diagnostics[0];
          if (!out || err) {
            setPreview({ status: 'error', message: err ?? 'widget produced no output' });
            return;
          }
          setPreview({ status: 'ok', result: outputsToRunResult(effectiveParsed, res, derivedAttributes) });
        })
        .catch((err: unknown) => {
          if (previewSeq.current === seq) {
            setPreview({ status: 'error', message: err instanceof Error ? err.message : String(err) });
          }
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [density, compiledDocText, value, viewCompatible, executor, rangeStart, rangeEnd, preferredUnit, tokenValues, effectiveParsed, derivedAttributes]);

  const previewStale = !viewCompatible && preview.status === 'ok';

  // ── Bar density ──────────────────────────────────────────────────────────
  if (density === 'bar') {
    const activeGroup =
      (!parsedPrimary.error && !isPipelineQuery(parsedPrimary) && parsedPrimary.groupBy?.[0]) ||
      (Array.isArray(value.groupBy) ? value.groupBy[0] : value.groupBy) ||
      '';

    return (
      <div
        data-testid="query-object-builder-bar"
        className={cn('flex flex-wrap items-center gap-2 min-w-0', className)}
      >
        <div className="min-w-0 flex-1">
          <WqlComposer
            query={primaryWql}
            onQueryChange={(nextWql) => onChange(setPrimaryQueryOnObject(value, nextWql))}
            onValidationChange={(v) => setComposerValid(v.valid)}
            onSubmit={onSubmit ? (nextWql) => onSubmit(setPrimaryQueryOnObject(value, nextWql)) : undefined}
            actionLabel={actionLabel}
            compact
            showDiagnostics={false}
            preferredChoices={preferredChoices}
          />
        </div>
        <select
          aria-label="Group by"
          data-testid="query-bar-groupby"
          value={activeGroup}
          onChange={(e) => {
            const dim = e.target.value;
            const nextGroupBy = dim ? [dim] : undefined;
            if (!parsedPrimary.error && !isPipelineQuery(parsedPrimary)) {
              const nextAst = { ...parsedPrimary, groupBy: dim ? [dim] : [] };
              onChange({
                ...setPrimaryQueryOnObject(value, serialize(nextAst)),
                groupBy: nextGroupBy,
              });
            } else {
              onChange({ ...value, groupBy: nextGroupBy });
            }
          }}
          className="min-h-9 rounded-lg border border-border bg-card px-2 text-xs font-mono text-foreground"
        >
          <option value="">Group: auto</option>
          {GROUPBY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              by {opt.label}
            </option>
          ))}
        </select>
        <select
          aria-label="View"
          data-testid="query-bar-view"
          value={resolvedView}
          onChange={(e) => {
            const nextView = e.target.value;
            if (isDashboardWidgetType(nextView)) {
              onChange({ ...value, view: nextView, rawViewType: undefined });
            }
          }}
          className="min-h-9 rounded-lg border border-border bg-card px-2 text-xs font-mono text-foreground"
        >
          {DASHBOARD_WIDGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // ── Inline density (Note ```query inspector / drawer) ────────────────────
  if (density === 'inline') {
    return (
      <div data-testid="query-object-builder-inline" className={cn('space-y-4', className)}>
        <WqlComposer
          query={primaryWql}
          onQueryChange={(nextWql) => onChange(setPrimaryQueryOnObject(value, nextWql))}
          onValidationChange={(v) => setComposerValid(v.valid)}
          execute={
            executor
              ? (ast) => (isFindQuery(ast) ? executor.runFind(ast) : executor.runQuery(ast.raw))
              : undefined
          }
          showDiagnostics
          preferredChoices={preferredChoices}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">View</span>
            <select
              aria-label="View"
              data-testid="query-inline-view"
              value={resolvedView}
              disabled={readOnly}
              onChange={(e) => {
                const nextView = e.target.value;
                if (isDashboardWidgetType(nextView)) {
                  onChange({ ...value, view: nextView, rawViewType: undefined });
                }
              }}
              className="rounded-md border border-border bg-card px-2 py-1.5 text-xs font-mono text-foreground"
            >
              {DASHBOARD_WIDGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Title</span>
            <input
              type="text"
              data-testid="query-inline-title"
              value={value.title ?? ''}
              disabled={readOnly}
              onChange={(e) => onChange({ ...value, title: e.target.value || undefined })}
              placeholder="Optional block title"
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</span>
            <input
              type="text"
              data-testid="query-inline-description"
              value={value.description ?? ''}
              disabled={readOnly}
              onChange={(e) => onChange({ ...value, description: e.target.value || undefined })}
              placeholder="Optional subtitle / question"
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
            />
          </label>

          {resolvedView === 'table' ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Columns</span>
                <input
                  type="text"
                  data-testid="query-inline-columns"
                  value={columnsDraft}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = e.target.value;
                    setColumnsDraft(next);
                    const cols = next
                      .split(',')
                      .map((c) => c.trim())
                      .filter(Boolean);
                    onChange({ ...value, columns: cols.length > 0 ? cols : undefined });
                  }}
                  placeholder="Auto (e.g. effort, reps, calc.e1rm)"
                  className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sort</span>
                <input
                  type="text"
                  data-testid="query-inline-sort"
                  value={sortDraft}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSortDraft(next);
                    onChange({ ...value, sort: parseSortInput(next) });
                  }}
                  placeholder="e.g. calc.e1rm desc"
                  className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground"
                />
              </label>
              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="query-inline-compare-pr"
                    checked={value.comparePr !== false}
                    disabled={readOnly}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        comparePr: e.target.checked ? undefined : false,
                      })
                    }
                    className="rounded border-border"
                  />
                  <span>Highlight PRs</span>
                </label>
              </div>
            </>
          ) : (
            <label className="flex flex-col gap-1 sm:col-span-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Goal / Targets</span>
              <input
                type="text"
                data-testid="query-inline-goal"
                value={formatScalarOrParam(value.goal)}
                disabled={readOnly}
                onChange={(e) => onChange({ ...value, goal: parseScalarOrParamInput(e.target.value) })}
                placeholder="e.g. 150 or $squatGoal"
                className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-foreground"
              />
            </label>
          )}
        </div>
      </div>
    );
  }

  // ── Studio density (Dashboard Widget & Multi-Series Builder) ─────────────
  const sentenceMetric =
    parsedPrimary.family === 'aggregate'
      ? parsedPrimary.metric
      : isPipelineQuery(parsedPrimary)
        ? parsedPrimary.transforms.at(-1)?.metric
        : undefined;
  const sentenceGroup =
    parsedPrimary.family === 'aggregate'
      ? parsedPrimary.groupBy[0]
      : isPipelineQuery(parsedPrimary)
        ? parsedPrimary.transforms.at(-1)?.groupBy[0]
        : undefined;

  const metricOptions =
    sentenceMetric && !SENTENCE_METRICS.includes(sentenceMetric)
      ? [sentenceMetric, ...SENTENCE_METRICS]
      : SENTENCE_METRICS;
  const groupOptions =
    sentenceGroup && !SENTENCE_GROUPS.includes(sentenceGroup)
      ? [sentenceGroup, ...SENTENCE_GROUPS]
      : SENTENCE_GROUPS;

  const seriesList = value.series ?? [];
  const goalActive = seriesList.some((s) => s.id === 'goal');
  const baselineSeries = seriesList.find((s) => /^baseline_(2|4|12)w$/.test(s.id));
  const baselineWeeks = baselineSeries ? Number(/^baseline_(\d+)w$/.exec(baselineSeries.id)?.[1]) : undefined;
  const compareActive = seriesList.some((s) => s.id === 'secondary');

  const changeVisualization = (next: string) => {
    if (!isDashboardWidgetType(next)) return;
    let updated: QueryBlockObject = { ...value, view: next, rawViewType: undefined };
    if (!updated.series && updated.query) {
      const p = parseQuery(updated.query);
      if (isPipelineQuery(p) && p.sink) {
        updated = { ...updated, query: serialize({ ...p, sink: { head: next, filters: p.sink.filters } }) };
      }
    }
    onChange(updated);
  };

  const changeCalculation = (edit: { metric?: string; group?: string }) => {
    const mutated = mutateCalcAst(parsedPrimary, edit);
    if (!mutated) return;
    onChange(setPrimaryQueryOnObject(value, serialize(mutated)));
  };

  return (
    <div data-testid="query-object-builder-studio" className={cn('flex flex-col gap-4', className)}>
      {subsetQuery !== undefined && (
        <section>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Dataset — the subset
          </div>
          {subsetQuery ? (
            <code
              className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground break-all"
              data-testid="widget-composer-subset"
            >
              {subsetQuery}
            </code>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="widget-composer-subset">
              No subset — the calculation runs over the whole store.
            </p>
          )}
        </section>
      )}

      {destination}

      <section>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Query &amp; Filter Manipulation
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {!readOnly && tokenValues && Object.keys(tokenValues).length > 0 && (
              <div className="flex flex-wrap items-center gap-1" data-testid="widget-composer-token-chips">
                {Object.keys(tokenValues).map((tok) => (
                  <button
                    key={tok}
                    type="button"
                    onClick={() => onChange(bindTokenToQueryObject(value, tok))}
                    className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                    title={`Bind $${tok} token into query`}
                  >
                    +${tok}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              data-testid="query-builder-yaml-toggle"
              aria-pressed={showYaml}
              onClick={() => setShowYaml((v) => !v)}
              className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              {showYaml ? 'Hide YAML' : 'YAML'}
            </button>
          </div>
        </div>

        {readOnly ? (
          <code
            className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground break-all whitespace-pre-wrap"
            data-testid="widget-composer-query"
          >
            {compiledDocText}
          </code>
        ) : (
          <WqlComposer
            query={primaryWql}
            onQueryChange={(nextWql) => onChange(setPrimaryQueryOnObject(value, nextWql))}
            onValidationChange={(v) => setComposerValid(v.valid)}
            showDiagnostics
            preferredChoices={preferredChoices}
            {...(executor ? { execute: (ast) => executor.runQuery(ast.raw, { rangeStart, rangeEnd, preferredUnit }) } : {})}
          />
        )}

        {!readOnly && seriesList.length > 0 && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-2.5" data-testid="query-builder-series-list">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Series Layers ({seriesList.length})
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="query-builder-add-formula"
                  onClick={() => {
                    const nextId = `formula_${seriesList.length + 1}`;
                    const refId = seriesList[0]?.id ?? 'primary';
                    onChange({
                      ...value,
                      query: undefined,
                      series: [...seriesList, { id: nextId, formula: `${refId} * 1` }],
                    });
                  }}
                  className="rounded border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  + Formula
                </button>
              </div>
            </div>
            {seriesList.map((layer, index) => (
              <div
                key={layer.id}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-xs"
              >
                <span className="font-mono font-semibold text-primary">{layer.id}</span>
                <input
                  type="text"
                  aria-label={`Expression for ${layer.id}`}
                  value={layer.formula ?? layer.query ?? ''}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    const updated = seriesList.map((s, i) =>
                      i === index
                        ? layer.formula !== undefined
                          ? { ...s, formula: nextVal }
                          : { ...s, query: nextVal }
                        : s,
                    );
                    onChange({ ...value, query: undefined, series: updated });
                  }}
                  className="min-w-0 flex-1 rounded border border-border/60 bg-background px-2 py-0.5 font-mono text-xs text-foreground"
                />
                {seriesList.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove series ${layer.id}`}
                    onClick={() => onChange(removeSeriesLayer(value, layer.id))}
                    className="rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!readOnly && compiledDocText.trim() !== '' && (
          <code
            className="mt-1.5 block rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2 font-mono text-xs text-foreground break-all whitespace-pre-wrap"
            data-testid="widget-composer-wql"
          >
            {compiledDocText.trim()}
          </code>
        )}

        {showYaml && (
          <pre
            data-testid="query-builder-yaml-preview"
            className="mt-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground overflow-x-auto"
          >
            {yamlText}
          </pre>
        )}

        {!readOnly && (
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Visualization
              </span>
              <select
                value={resolvedView}
                onChange={(e) => changeVisualization(e.target.value)}
                data-testid="widget-composer-type"
                aria-label="Visualization"
                className="rounded-md border border-border bg-card px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
              >
                {DASHBOARD_WIDGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Visualization picker">
              {DASHBOARD_WIDGET_TYPES.map((t) => {
                const active = resolvedView === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => changeVisualization(t)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold truncate transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/70 bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {!readOnly && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Title
            </span>
            <input
              type="text"
              value={value.title ?? ''}
              onChange={(e) => onChange({ ...value, title: e.target.value || undefined })}
              placeholder="Weekly volume"
              data-testid="widget-composer-title"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Coaching question <span className="normal-case font-normal">(optional)</span>
            </span>
            <input
              type="text"
              value={value.description ?? ''}
              onChange={(e) => onChange({ ...value, description: e.target.value || undefined })}
              placeholder="How much work per week?"
              data-testid="widget-composer-question"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Size
            </span>
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 self-start">
              {SPAN_OPTIONS.map((option) => {
                const active = option.span === value.span;
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({ ...value, span: option.span })}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Parameters <span className="normal-case font-normal">(goal / targets, e.g. 300 200 or goal=$squatGoal)</span>
            </span>
            <input
              type="text"
              value={paramsText}
              onChange={(e) => {
                const next = e.target.value;
                setParamsText(next);
                onChange({ ...value, ...parseParamsField(next) });
              }}
              placeholder="300 200"
              data-testid="widget-composer-params"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
            />
          </label>
        </section>
      )}

      {readOnly && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px]">Title</span>
            <div className="text-foreground">{value.title || '—'}</div>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px]">Question</span>
            <div className="text-foreground">{value.description || '—'}</div>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px]">Type</span>
            <div className="font-mono text-foreground">{resolvedView}</div>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px]">Size</span>
            <div className="font-mono text-foreground">
              {value.span === 'full' ? 'full row' : value.span ? `${value.span} cols` : 'default'}
            </div>
          </div>
        </section>
      )}

      {!readOnly && (
        <div
          data-testid="widget-sentence-bar"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
        >
          {isFindQuery(effectiveParsed) ? (
            <button
              type="button"
              data-testid="widget-promote-to-chart"
              onClick={() => onChange(promoteFindToChartObject(value, 'totalVolume'))}
              className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 font-semibold text-primary hover:bg-primary/20"
            >
              Promote list to chart →
            </button>
          ) : (
            <>
              <span className="font-medium text-muted-foreground">Plot</span>
              <select
                aria-label="Coaching metric"
                data-testid="widget-sentence-metric"
                value={sentenceMetric ?? ''}
                disabled={!sentenceMetric}
                onChange={(e) => changeCalculation({ metric: e.target.value })}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                {!sentenceMetric && <option value="">No metric</option>}
                {metricOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">by</span>
              <select
                aria-label="Group by"
                data-testid="widget-sentence-group"
                value={sentenceGroup ?? 'week'}
                disabled={!sentenceMetric}
                onChange={(e) => changeCalculation({ group: e.target.value })}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                {groupOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">as</span>
              <select
                aria-label="Chart type"
                data-testid="widget-sentence-chart"
                value={resolvedView}
                onChange={(e) => changeVisualization(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
              >
                {DASHBOARD_WIDGET_TYPES.filter((wt) => wt !== 'list' && wt !== 'table').map((wt) => (
                  <option key={wt} value={wt}>
                    {wt}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <section>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-2">
          Preview
          {previewStale && (
            <span data-testid="widget-preview-stale" className="font-medium normal-case tracking-normal text-amber-600">
              stale — showing the last valid query
            </span>
          )}
        </div>
        <div className="rounded-lg border border-border bg-background/50 p-3 h-56 overflow-hidden">
          {preview.status === 'idle' &&
            (viewCompatible ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Preview runs as you compose…
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-destructive font-mono px-4 text-center">
                {draftError
                  ? draftError
                  : isFindQuery(effectiveParsed)
                    ? 'find: queries return things — use a table or list widget instead'
                    : 'Compose a calculation to preview.'}
              </div>
            ))}
          {preview.status === 'loading' && (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Running preview…
            </div>
          )}
          {preview.status === 'blocked' && (
            <div className="h-full flex items-center justify-center text-xs text-destructive font-mono px-4 text-center">
              {preview.message}
            </div>
          )}
          {preview.status === 'error' && (
            <div className="h-full flex items-center justify-center text-xs text-destructive font-mono px-4 text-center">
              {preview.message}
            </div>
          )}
          {preview.status === 'ok' && (
            <WidgetChart
              type={resolvedView}
              result={preview.result}
              label={value.title?.trim() || undefined}
              unit={preferredUnit}
              attributes={derivedAttributes}
            />
          )}
        </div>
        {!readOnly && !isFindQuery(effectiveParsed) && (
          <div data-testid="widget-legend-bar" className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Layers
            </span>
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid="legend-chip-goal"
                aria-pressed={goalActive}
                onClick={() => onChange(toggleGoalLayer(value))}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
              >
                {goalActive ? 'Goal 150' : '+ Target Goal'}
              </button>
              {goalActive && (
                <button
                  type="button"
                  aria-label="Remove goal"
                  onClick={() => onChange(toggleGoalLayer(value))}
                  className="rounded-full px-1.5 text-muted-foreground hover:bg-muted"
                >
                  ×
                </button>
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid="legend-chip-baseline"
                aria-pressed={Boolean(baselineSeries)}
                onClick={() => onChange(cycleBaselineLayer(value))}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
              >
                {baselineWeeks ? `${baselineWeeks}w rolling avg` : '+ 4w Baseline'}
              </button>
              {baselineSeries && (
                <button
                  type="button"
                  aria-label="Remove baseline"
                  onClick={() => onChange(removeSeriesLayer(value, baselineSeries.id))}
                  className="rounded-full px-1.5 text-muted-foreground hover:bg-muted"
                >
                  ×
                </button>
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid="legend-chip-compare"
                aria-pressed={compareActive}
                onClick={() => onChange(toggleCompareLayer(value))}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
              >
                {compareActive ? 'Compare series' : '+ Compare / Clone Series'}
              </button>
              {compareActive && (
                <button
                  type="button"
                  aria-label="Remove comparison"
                  onClick={() => onChange(toggleCompareLayer(value))}
                  className="rounded-full px-1.5 text-muted-foreground hover:bg-muted"
                >
                  ×
                </button>
              )}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
