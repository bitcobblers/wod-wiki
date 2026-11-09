/**
 * WidgetComposerDialog — the ONE focused authoring flow for dashboard
 * widgets, shared by every entry point:
 *
 *  - Explorer Save → "Add to dashboard" (QueryToDashboardDialog wraps this,
 *    adding the destination picker and persistence).
 *  - Dashboard page "Add widget".
 *  - Dashboard page widget Edit (seeded from the existing widget).
 *  - Prebuilt "Inspect" — read-only: the composed query and a live preview,
 *    no Apply; the host offers "Clone to vault" via `footerExtra`.
 *
 * Steps: dataset (the subset, read-only) → calculation (the advanced
 * WqlComposer — the full pill model stays available) → visualization
 * (type + grid span) → preview → apply. The preview executes through the
 * injected executor with the SAME range/unit options the dashboard grid
 * uses, and substitutes the board's current token values — what the preview
 * shows is what the widget will render.
 *
 * Mounted in MobileActions' EditorDialog (keyboard-aware, mobile
 * full-screen) — no second dialog system.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EditorDialog,
  WidgetChart,
  WqlComposer,
  createExecutorDocumentHost,
  outputsToRunResult,
  type QueryExecutor,
  type WidgetRunResult,
} from '@bitcobblers/wod-wiki-ui';
import {
  isAggregateQuery,
  isFindQuery,
  parseQuery,
  type AnyParsedQuery,
} from '@bitcobblers/wod-wiki-engine';
import { setMetricQuery, withGroupBy } from '../../lib/wqlEdits';
/** Parse the composer's attribute text: whitespace-separated `key=value`
 *  tokens (values may be double-quoted) — the fence-tag encoding. */
function parseAttributes(text: string): Record<string, string> | undefined {
  const tokens = text.trim().split(/\s+/).filter((tok) => tok !== '');
  if (tokens.length === 0) return undefined;
  const attributes: Record<string, string> = {};
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq === -1) continue; // malformed tokens are ignored by the composer
    const key = token.slice(0, eq);
    let value = token.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    attributes[key] = value;
  }
  return Object.keys(attributes).length === 0 ? undefined : attributes;
}
import {
  DASHBOARD_WIDGET_TYPES,
  isDashboardWidgetType,
  isPipelineQuery,
  parseDocument,
  serialize,
  SharedQueryDocumentRunner,
  substituteTokens,
  unknownTokensMessage,
  type DocumentAssignment,
  type QueryDocument,
} from '@bitcobblers/wod-wiki-wql';

export interface WidgetComposerApply {
  title?: string;
  question?: string;
  type: string;
  spanCols?: number;
  spanFull?: boolean;
  wql: string;
  attributes?: Record<string, string>;
}

export interface WidgetComposerDialogProps {
  open: boolean;
  onClose: () => void;
  /** add = blank widget; edit = seeded from a widget; inspect = read-only. */
  mode: 'add' | 'edit' | 'inspect';
  /** Seed WQL for the calculation composer. */
  initialWql: string;
  /** Seed display fields (edit/inspect of an existing widget). */
  initial?: {
    title?: string;
    question?: string;
    type?: string;
    spanCols?: number;
    spanFull?: boolean;
    attributes?: Record<string, string>;
  };
  /**
   * The dataset step: the subset WQL this calculation joins, shown
   * read-only. Pass `null` to render the "whole store" note; omit the prop
   * to hide the step (dashboard-page Add has no subset).
   */
  subsetQuery?: string | null;
  /**
   * Optional destination step (the Explorer's save flow injects its
   * choose/create-dashboard picker here) — rendered between the dataset and
   * the calculation.
   */
  destination?: ReactNode;
  /** Preview execution — same executor + range/unit context as the board. */
  executor?: QueryExecutor;
  rangeStart?: number;
  rangeEnd?: number;
  preferredUnit?: string;
  /** Board token values for preview substitution (execution-time context). */
  tokenValues?: Record<string, string>;
  /** Absent in inspect mode — the footer hides Apply. */
  onApply?: (spec: WidgetComposerApply) => void | Promise<void>;
  /** Extra footer content (e.g. the prebuilt "Clone to vault" action). */
  footerExtra?: ReactNode;
  applyLabel?: string;
}

const SPAN_OPTIONS = [
  { label: 'Auto', spanCols: undefined, spanFull: false },
  { label: '1 col', spanCols: 1, spanFull: false },
  { label: '2 cols', spanCols: 2, spanFull: false },
  { label: '4 cols', spanCols: 4, spanFull: false },
  { label: 'Full row', spanCols: undefined, spanFull: true },
] as const;


const METRIC_OPTIONS = ['totalVolume', 'reps', 'tis', 'calc.e1rm', 'calc.readiness'];
const GROUP_OPTIONS = ['week', 'day', 'session', 'round', 'effort', 'equipment'];
const BASELINE_PERIODS = [4, 12, 2] as const;

function primaryAssignment(doc: QueryDocument): DocumentAssignment | undefined {
  return doc.assignments.find((assignment) => assignment.kind === 'query' && doc.show.includes(assignment.name))
    ?? doc.assignments.find((assignment) => assignment.kind === 'query');
}

/** Serialize a synthetic source-reference pipeline back over its named source. */
function serializeAssignment(assignment: DocumentAssignment, parsed: AnyParsedQuery): string {
  const text = serialize(parsed);
  if (assignment.sourceRef && isPipelineQuery(parsed)) {
    return `${assignment.sourceRef} | ${text.split(' | ').slice(1).join(' | ')}`;
  }
  return text;
}

function withoutChartSink(assignment: DocumentAssignment): string {
  if (!assignment.parsed || !isPipelineQuery(assignment.parsed) || !assignment.parsed.sink) {
    return assignment.queryText ?? assignment.raw;
  }
  return serializeAssignment(assignment, { ...assignment.parsed, sink: undefined });
}

function replaceAssignment(lines: string[], name: string, body: string): string[] {
  const assignment = new RegExp(`^${name}\\s*=`);
  return lines.map((line) => assignment.test(line) ? `${name} = ${body}` : line);
}

function replaceShow(lines: string[], names: string[], chartType: string): string[] {
  const show = `show ${names.join(', ')} | :${chartType}{}`;
  const index = lines.findIndex((line) => line.startsWith('show '));
  if (index === -1) return [...lines, show];
  return lines.map((line, lineIndex) => lineIndex === index ? show : line);
}

function removeLayer(lines: string[], name: string, chartType: string): string[] {
  const assignment = new RegExp(`^${name}\\s*=`);
  const remaining = lines.filter((line) => !assignment.test(line));
  const doc = parseDocument(remaining.join('\n')).doc;
  return replaceShow(remaining, doc.show.filter((shown) => shown !== name), chartType);
}

/** Start a layered document without rewriting the calculation's filters or window. */
function layeredDocument(wql: string, chartType: string): { lines: string[]; primary: DocumentAssignment } | null {
  const doc = parseDocument(wql).doc;
  if (!doc.degenerate) {
    const primary = primaryAssignment(doc);
    if (!primary) return null;
    return { lines: wql.trim().split('\n').map((line) => line.trim()).filter(Boolean), primary };
  }
  const source = primaryAssignment(doc);
  if (!source) return null;
  const lines = [`primary = ${withoutChartSink(source)}`, `show primary | :${chartType}{}`];
  const primary = primaryAssignment(parseDocument(lines.join('\n')).doc);
  return primary ? { lines, primary } : null;
}

function clonedPrimary(
  primary: DocumentAssignment,
  edit: { metric?: string; baselineWeeks?: number },
): string | null {
  if (!primary.parsed || primary.parsed.error) return null;
  if (isAggregateQuery(primary.parsed)) {
    return serialize({
      ...primary.parsed,
      metric: edit.metric ?? primary.parsed.metric,
      ...(edit.baselineWeeks
        ? { rollup: { size: edit.baselineWeeks, unit: 'w' as const } }
        : {}),
    });
  }
  if (!isPipelineQuery(primary.parsed) || primary.parsed.transforms.length === 0) return null;
  const last = primary.parsed.transforms.length - 1;
  const transforms = primary.parsed.transforms.map((transform, index) => index === last
    ? {
        ...transform,
        metric: edit.metric ?? transform.metric,
        ...(edit.baselineWeeks
          ? { rollup: { size: edit.baselineWeeks, unit: 'w' as const } }
          : {}),
      }
    : transform);
  return serializeAssignment(primary, { ...primary.parsed, transforms, sink: undefined });
}

function editPrimary(wql: string, edit: (parsed: AnyParsedQuery) => AnyParsedQuery): string {
  const doc = parseDocument(wql).doc;
  const primary = primaryAssignment(doc);
  if (!primary?.parsed || primary.parsed.error) return wql;
  const body = serializeAssignment(primary, edit(primary.parsed));
  return replaceAssignment(wql.trim().split('\n'), primary.name, body).join('\n');
}

function editCalculation(
  parsed: AnyParsedQuery,
  edit: { metric?: string; group?: string },
): AnyParsedQuery {
  if (isAggregateQuery(parsed)) {
    const text = edit.metric
      ? setMetricQuery(serialize(parsed), edit.metric)
      : withGroupBy(serialize(parsed), edit.group ?? 'week');
    return parseQuery(text);
  }
  if (!isPipelineQuery(parsed) || parsed.transforms.length === 0) return parsed;
  const last = parsed.transforms.length - 1;
  const transforms = parsed.transforms.map((transform, index) => {
    if (index !== last) return transform;
    const text = edit.metric
      ? setMetricQuery(serialize(transform), edit.metric)
      : withGroupBy(serialize(transform), edit.group ?? 'week');
    const next = parseQuery(text);
    return isAggregateQuery(next) ? next : transform;
  });
  return { ...parsed, transforms };
}

const PREVIEW_DEBOUNCE_MS = 300;

export function WidgetComposerDialog({ open, ...props }: WidgetComposerDialogProps) {
  // Gated at this level so every opening mounts a FRESH session — no draft
  // state (query, title, span, preview) can leak across widgets or queries.
  if (!open) return null;
  return <ComposerSession {...props} />;
}

function ComposerSession({
  onClose,
  mode,
  initialWql,
  initial,
  subsetQuery,
  destination,
  executor,
  rangeStart,
  rangeEnd,
  preferredUnit,
  tokenValues,
  onApply,
  footerExtra,
  applyLabel = mode === 'edit' ? 'Apply changes' : 'Add widget',
}: Omit<WidgetComposerDialogProps, 'open'>) {
  const readOnly = mode === 'inspect';
  // Controlled composer draft: the exact text (invalid included) — the
  // final action re-validates it before writing.
  const [wql, setWql] = useState(initialWql);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [question, setQuestion] = useState(initial?.question ?? '');
  // The select speaks resolved types ('table'); a bare ```query fence (raw
  // '') IS the table default — '' would leave the select uncontrolled-blank.
  const [type, setType] = useState(initial?.type || 'table');
  const [span, setSpan] = useState<{ spanCols?: number; spanFull?: boolean }>({
    spanCols: initial?.spanCols,
    spanFull: initial?.spanFull,
  });
  const [paramsText, setParamsText] = useState(
    Object.entries(initial?.attributes ?? {}).map(([k, v]) => `${k}=${v}`).join(' '),
  );
  const [applying, setApplying] = useState(false);
  // The composer's synchronous verdict, including transient editor states
  // (unresolved pivot confirm) that a fresh parse cannot see.
  const [composerValid, setComposerValid] = useState(() => {
    const doc = parseDocument(initialWql);
    return doc.doc.degenerate ? !parseQuery(initialWql).error : doc.diagnostics.length === 0;
  });
  // A refused write (e.g. the note changed while this dialog was open) stays
  // on screen; the draft is untouched and the author can retry or cancel.
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseQuery(wql.trim()), [wql]);
  const parsedDocument = useMemo(() => parseDocument(wql.trim()), [wql]);
  const isDocument = !parsedDocument.doc.degenerate && parsedDocument.doc.assignments.length > 0;
  const effectiveParsed = useMemo<AnyParsedQuery>(() => isDocument
    ? {
        family: 'aggregate',
        raw: wql.trim(),
        agg: 'sum',
        metric: parsedDocument.doc.show[0] ?? 'value',
        filters: [],
        groupBy: [],
      }
    : parsed, [isDocument, parsed, parsedDocument, wql]);
  const draftError = isDocument ? parsedDocument.diagnostics[0] : parsed.error;
  const resolvedType = type === '' ? 'table' : type;
  const widgetReady =
    !draftError &&
    wql.trim() !== '' &&
    (isFindQuery(effectiveParsed) ? resolvedType === 'table' || resolvedType === 'list' : resolvedType !== 'list');

  // Preview: execute through the board's executor with the board's
  // range/unit context and token substitution — matching what the widget
  // itself will do on the grid.
  const [preview, setPreview] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ok'; result: WidgetRunResult }
    | { status: 'error'; message: string }
    | { status: 'blocked'; message: string }
  >({ status: 'idle' });
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!widgetReady || !executor) {
      // An invalid draft never resets the preview to idle: the last valid
      // result stays on screen, marked stale below.
      setPreview((prev) => (prev.status === 'ok' ? prev : { status: 'idle' }));
      return;
    }
    const substituted = substituteTokens(wql.trim(), tokenValues ?? {});
    if (substituted.missing.length > 0) {
      setPreview({ status: 'blocked', message: unknownTokensMessage(substituted.missing) });
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
          const err = res.outputs.find((output) => output.error)?.error ?? res.diagnostics[0];
          if (!out || err) {
            setPreview({ status: 'error', message: err ?? 'widget produced no output' });
            return;
          }
          setPreview({ status: 'ok', result: outputsToRunResult(effectiveParsed, res) });
        })
        .catch((err: unknown) => {
          if (previewSeq.current === seq) {
            setPreview({ status: 'error', message: err instanceof Error ? err.message : String(err) });
          }
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wql, widgetReady, executor, rangeStart, rangeEnd, preferredUnit, tokenValues, effectiveParsed]);

  // The preview answers the last VALID draft; an invalid edit makes it stale
  // until the draft parses again.
  const previewStale = !widgetReady && preview.status === 'ok';

  const applyReady = widgetReady && (isDocument || composerValid);

  const handleApply = async () => {
    if (!applyReady || !onApply || applying) return;
    // Validate the current draft text at action time — state set by the
    // composer's synchronous callback in the same event is not relied on.
    if (draftError || wql.trim() === '') return;
    setApplying(true);
    setError(null);
    try {
      await onApply({
        title: title.trim() || undefined,
        question: question.trim() || undefined,
        // 'table' is the bare-fence default — don't churn ```query into
        // ```query:table when the author never touched the type.
        type: type === 'table' ? '' : type,
        spanCols: span.spanFull ? undefined : span.spanCols,
        spanFull: span.spanFull || undefined,
        wql: wql.trim(),
        attributes: parseAttributes(paramsText),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const primary = primaryAssignment(parsedDocument.doc);
  const sentenceParsed = isDocument ? primary?.parsed : parsed;
  const sentenceMetric = isAggregateQuery(sentenceParsed)
    ? sentenceParsed.metric
    : isPipelineQuery(sentenceParsed)
      ? sentenceParsed.transforms.at(-1)?.metric
      : undefined;
  const sentenceGroup = isAggregateQuery(sentenceParsed)
    ? sentenceParsed.groupBy[0]
    : isPipelineQuery(sentenceParsed)
      ? sentenceParsed.transforms.at(-1)?.groupBy[0]
      : undefined;
  const metricOptions = sentenceMetric && !METRIC_OPTIONS.includes(sentenceMetric)
    ? [sentenceMetric, ...METRIC_OPTIONS]
    : METRIC_OPTIONS;
  const groupOptions = sentenceGroup && !GROUP_OPTIONS.includes(sentenceGroup)
    ? [sentenceGroup, ...GROUP_OPTIONS]
    : GROUP_OPTIONS;
  const goalActive = parsedDocument.doc.assignments.some((assignment) => assignment.name === 'goal');
  const baseline = parsedDocument.doc.assignments.find((assignment) => /^baseline_(2w|4w|12w)$/.test(assignment.name));
  const baselineWeeks = baseline ? Number(/^baseline_(\d+)w$/.exec(baseline.name)?.[1]) : undefined;
  const compareActive = parsedDocument.doc.assignments.some((assignment) => assignment.name === 'secondary');

  const changeCalculation = (edit: { metric?: string; group?: string }) => {
    if (isDocument) {
      setWql(editPrimary(wql, (current) => editCalculation(current, edit)));
    } else {
      setWql(serialize(editCalculation(parsed, edit)));
    }
  };

  const changeVisualization = (next: string) => {
    if (!isDashboardWidgetType(next)) return;
    setType(next);
    if (isDocument) {
      setWql(replaceShow(wql.trim().split('\n'), parsedDocument.doc.show, next).join('\n'));
    } else if (isPipelineQuery(parsed)) {
      setWql(serialize({ ...parsed, sink: { head: next, filters: parsed.sink?.filters ?? [] } }));
    }
  };

  const toggleGoal = () => {
    const layered = layeredDocument(wql, resolvedType);
    if (!layered) return;
    if (goalActive) {
      setWql(removeLayer(layered.lines, 'goal', resolvedType).join('\n'));
      return;
    }
    const lines = [...layered.lines, `goal = ${layered.primary.name} * 0 + 150`];
    const shown = parseDocument(lines.join('\n')).doc.show;
    setWql(replaceShow(lines, [...shown, 'goal'], resolvedType).join('\n'));
  };

  const cycleBaseline = () => {
    const layered = layeredDocument(wql, resolvedType);
    if (!layered) return;
    const baselineIndex = BASELINE_PERIODS.findIndex((period) => period === baselineWeeks);
    const nextWeeks = baselineIndex >= 0
      ? BASELINE_PERIODS[(baselineIndex + 1) % BASELINE_PERIODS.length]
      : 4;
    if (!nextWeeks) return;
    const clone = clonedPrimary(layered.primary, { baselineWeeks: nextWeeks });
    if (!clone) return;
    const withoutCurrent = baseline ? removeLayer(layered.lines, baseline.name, resolvedType) : layered.lines;
    const name = `baseline_${nextWeeks}w`;
    const lines = [...withoutCurrent, `${name} = ${clone}`];
    const shown = parseDocument(withoutCurrent.join('\n')).doc.show.filter((shownName) => shownName !== baseline?.name && shownName !== 'query');
    setWql(replaceShow(lines, [...shown, name], resolvedType).join('\n'));
  };

  const toggleCompare = () => {
    const layered = layeredDocument(wql, resolvedType);
    if (!layered) return;
    if (compareActive) {
      setWql(removeLayer(layered.lines, 'secondary', resolvedType).join('\n'));
      return;
    }
    const clone = clonedPrimary(layered.primary, { metric: sentenceMetric === 'reps' ? 'tis' : 'reps' });
    if (!clone) return;
    const lines = [...layered.lines, `secondary = ${clone}`];
    const shown = parseDocument(lines.join('\n')).doc.show;
    setWql(replaceShow(lines, [...shown, 'secondary'], resolvedType).join('\n'));
  };

  return (
    <EditorDialog
      open
      onClose={onClose}
      presentation="sheet"
      title={mode === 'inspect' ? 'Inspect widget' : mode === 'edit' ? 'Edit widget' : 'Add widget'}
      description={
        readOnly
          ? 'Read-only — clone the dashboard to edit this widget.'
          : 'Dataset, calculation, visualization, preview — then apply.'
      }
      footer={
        readOnly && !footerExtra ? undefined : (
          <>
            {footerExtra}
            <div className="flex-1" />
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-12 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="widget-composer-apply"
                  disabled={!applyReady || applying}
                  title={draftError}
                  onClick={() => void handleApply()}
                  className="min-h-12 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow transition-colors"
                >
                  {applying ? 'Applying…' : applyLabel}
                </button>
              </>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
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
            {!readOnly && tokenValues && Object.keys(tokenValues).length > 0 && (
              <div className="flex flex-wrap items-center gap-1" data-testid="widget-composer-token-chips">
                {Object.keys(tokenValues).map((tok) => (
                  <button
                    key={tok}
                    type="button"
                    onClick={() => {
                      const trimmed = wql.trim();
                      if (tok === 'scope') {
                        if (trimmed.includes('{}')) {
                          setWql(trimmed.replace('{}', '{$scope}'));
                        } else if (!trimmed.includes('$scope')) {
                          setWql(`${trimmed} where :note{$scope}`);
                        }
                      } else if (!trimmed.includes(`$${tok}`)) {
                        setWql(trimmed.replace(/\{([^}]*)\}/, (_m, inner: string) =>
                          inner.trim() ? `{${inner},${tok}:$${tok}}` : `{${tok}:$${tok}}`,
                        ));
                      }
                    }}
                    className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                    title={`Bind $${tok} token into query`}
                  >
                    +${tok}
                  </button>
                ))}
              </div>
            )}
          </div>
          {readOnly ? (
            <code
              className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground break-all"
              data-testid="widget-composer-query"
            >
              {wql}
            </code>
          ) : (
            <WqlComposer
              query={wql}
              onQueryChange={setWql}
              onValidationChange={(v) => setComposerValid(v.valid)}
              showDiagnostics
              {...(executor ? { execute: (ast) => executor.runQuery(ast.raw, { rangeStart, rangeEnd, preferredUnit }) } : {})}
            />
          )}
          {!readOnly && wql.trim() !== '' && (
            <code
              className="mt-1.5 block rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2 font-mono text-xs text-foreground break-all"
              data-testid="widget-composer-wql"
            >
              {wql.trim()}
            </code>
          )}
          {!readOnly && (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Visualization
                </span>
                <select
                  value={type}
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
                  const active = type === t;
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
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
                  const active = option.spanFull
                    ? span.spanFull === true
                    : option.spanCols == null
                      ? !span.spanFull && span.spanCols == null
                      : !span.spanFull && span.spanCols === option.spanCols;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSpan(
                          option.spanFull
                            ? { spanFull: true }
                            : { spanCols: option.spanCols },
                        )
                      }
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
                Parameters <span className="normal-case font-normal">(goal targets, space-separated)</span>
              </span>
              <input
                type="text"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
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
              <div className="text-foreground">{initial?.title || '—'}</div>
            </div>
            <div>
              <span className="font-bold uppercase tracking-wider text-[10px]">Question</span>
              <div className="text-foreground">{initial?.question || '—'}</div>
            </div>
            <div>
              <span className="font-bold uppercase tracking-wider text-[10px]">Type</span>
              <div className="font-mono text-foreground">{type || 'table'}</div>
            </div>
            <div>
              <span className="font-bold uppercase tracking-wider text-[10px]">Size</span>
              <div className="font-mono text-foreground">
                {initial?.spanFull ? 'full row' : initial?.spanCols ? `${initial.spanCols} cols` : 'default'}
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
                onClick={() => {
                  setWql(setMetricQuery(wql, 'totalVolume'));
                  setType('timeseries');
                }}
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
                  onChange={(event) => changeCalculation({ metric: event.target.value })}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  {!sentenceMetric && <option value="">No metric</option>}
                  {metricOptions.map((metric) => <option key={metric} value={metric}>{metric}</option>)}
                </select>
                <span className="text-muted-foreground">by</span>
                <select
                  aria-label="Group by"
                  data-testid="widget-sentence-group"
                  value={sentenceGroup ?? 'week'}
                  disabled={!sentenceMetric}
                  onChange={(event) => changeCalculation({ group: event.target.value })}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  {groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
                <span className="text-muted-foreground">as</span>
                <select
                  aria-label="Chart type"
                  data-testid="widget-sentence-chart"
                  value={resolvedType}
                  onChange={(event) => changeVisualization(event.target.value)}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  {DASHBOARD_WIDGET_TYPES.filter((widgetType) => widgetType !== 'list' && widgetType !== 'table').map((widgetType) => (
                    <option key={widgetType} value={widgetType}>{widgetType}</option>
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
              (widgetReady ? (
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
                type={type}
                result={preview.result}
                label={title.trim() || undefined}
                unit={preferredUnit}
                attributes={parseAttributes(paramsText)}
              />
            )}
          </div>
          {!readOnly && !isFindQuery(effectiveParsed) && (
            <div data-testid="widget-legend-bar" className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Layers</span>
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  data-testid="legend-chip-goal"
                  aria-pressed={goalActive}
                  onClick={toggleGoal}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  {goalActive ? 'Goal 150' : '+ Target Goal'}
                </button>
                {goalActive && <button type="button" aria-label="Remove goal" onClick={toggleGoal} className="rounded-full px-1.5 text-muted-foreground hover:bg-muted">×</button>}
              </span>
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  data-testid="legend-chip-baseline"
                  aria-pressed={Boolean(baseline)}
                  onClick={cycleBaseline}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  {baselineWeeks ? `${baselineWeeks}w rolling avg` : '+ 4w Baseline'}
                </button>
                {baseline && (
                  <button
                    type="button"
                    aria-label="Remove baseline"
                    onClick={() => {
                      const layered = layeredDocument(wql, resolvedType);
                      if (layered) setWql(removeLayer(layered.lines, baseline.name, resolvedType).join('\n'));
                    }}
                    className="rounded-full px-1.5 text-muted-foreground hover:bg-muted"
                  >×</button>
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  data-testid="legend-chip-compare"
                  aria-pressed={compareActive}
                  onClick={toggleCompare}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  {compareActive ? 'Compare series' : '+ Compare / Clone Series'}
                </button>
                {compareActive && <button type="button" aria-label="Remove comparison" onClick={toggleCompare} className="rounded-full px-1.5 text-muted-foreground hover:bg-muted">×</button>}
              </span>
            </div>
          )}
        </section>

        {error && (
          <p
            role="alert"
            data-testid="widget-composer-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono"
          >
            {error}
          </p>
        )}
      </div>
    </EditorDialog>
  );
}
