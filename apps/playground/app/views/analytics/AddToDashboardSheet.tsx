import { useEffect, useMemo, useState } from 'react';
import { useOptionalNavigate } from '@/hooks/useOptionalNavigate';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Hash,
  LineChart as LineChartIcon,
  Plus,
  Table2,
} from 'lucide-react';
import {
  EditorDialog,
  WidgetChart,
  createExecutorDocumentHost,
  outputsToRunResult,
  type SessionActionContext,
  type WidgetRunResult,
} from '@bitcobblers/wod-wiki-ui';
import {
  SharedQueryDocumentRunner,
  appendWidget,
  buildWorkoutDashboardScaffold,
  dashboardSlug,
  parseQuery,
  serializeQueryBlock,
  type QueryBlockObject,
  type WidgetSpec,
} from '@bitcobblers/wod-wiki-wql';
import { buildDashboardSeeds } from '../../lib/dashboardSeeds';
import { parseFrontmatter } from '@/lib/frontmatter';
import { analyticsExplorerPath, dashboardViewPath } from '../../lib/routes';
import { TEST_IDS } from '@/lib/testIds';
import { queryService, setContextualPageSources } from '@/services/queryService';
import { useSeedContent } from '@/services/content/seedContent';
import { useDashboardList } from '../../hooks/useDashboards';
import { dashboardNotes } from '../../services/dashboardNotes';
import { notifyDashboardsChanged } from '../../services/dashboardEvents';
import { journalNotes } from '../../services/journalNotes';

export type WorkoutMeasureId =
  | 'totalVolume'
  | 'reps'
  | 'elapsed'
  | 'calc.e1rm'
  | 'tis'
  | 'sessionLoad'
  | 'distance';

export type WorkoutVizType = 'timeseries' | 'bar' | 'summary' | 'table' | 'value';

export type ComparisonScopeId = 'current' | 'block' | 'notebook' | 'history';

const VIZ_OPTIONS: readonly { id: WorkoutVizType; label: string; icon: typeof LineChartIcon }[] = [
  { id: 'timeseries', label: 'Trend Line', icon: LineChartIcon },
  { id: 'bar', label: 'Comparison Bar', icon: BarChart3 },
  { id: 'summary', label: 'Session Summary', icon: Activity },
  { id: 'table', label: 'Data Table', icon: Table2 },
  { id: 'value', label: 'KPI Value', icon: Hash },
];

const MEASURE_LABELS: Record<WorkoutMeasureId, string> = {
  totalVolume: 'Total Volume',
  reps: 'Total Reps',
  elapsed: 'Split Duration',
  'calc.e1rm': 'Estimated 1RM',
  tis: 'Intensity Score (TIS)',
  sessionLoad: 'Session Load',
  distance: 'Total Distance',
};

function defaultMeasureForContext(ctx: SessionActionContext): WorkoutMeasureId {
  const s = ctx.summary;
  if (!s) return 'totalVolume';
  if (s.totalDistance > 0 && s.totalVolume === 0) return 'elapsed';
  if (s.totalVolume > 0) return 'totalVolume';
  if (s.totalReps > 0) return 'reps';
  if (s.tis !== undefined) return 'tis';
  return 'elapsed';
}

function buildWidgetSpec(params: {
  ctx: SessionActionContext;
  viz: WorkoutVizType;
  measure: WorkoutMeasureId;
  movementSlug: string;
  scopes: readonly ComparisonScopeId[];
  bindBlockToken: boolean;
  bindNotebookToken: boolean;
  bindRangeToken: boolean;
}): {
  title: string;
  question: string;
  wql: string;
  yaml: string;
  queryObject: QueryBlockObject;
  tokens: Record<string, string>;
} {
  const { ctx, viz, measure, movementSlug, scopes, bindBlockToken, bindNotebookToken, bindRangeToken } = params;
  const notebookSlug = ctx.notebooks?.[0]?.replace(/^notebook\//, '');
  const baseTitle = ctx.noteTitle ?? 'Workout';

  const tokenValues: Record<string, string> = {};
  if (ctx.blockContentId) tokenValues.block = ctx.blockContentId;
  if (notebookSlug) tokenValues.notebook = notebookSlug;
  tokenValues.range = '12w';

  if (viz === 'summary') {
    const wql = `:session{result:${ctx.resultId}}`;
    const queryObject: QueryBlockObject = { view: 'summary', title: `${baseTitle} — Summary`, query: wql };
    return {
      title: `${baseTitle} — Summary`,
      question: 'Key execution KPIs and movement breakdown',
      wql,
      yaml: serializeQueryBlock(queryObject),
      queryObject,
      tokens: tokenValues,
    };
  }

  if (viz === 'table' && scopes.length === 1 && scopes[0] === 'current') {
    const wql = `:session{result:${ctx.resultId}}`;
    const queryObject: QueryBlockObject = { view: 'table', title: `${baseTitle} — Splits`, query: wql };
    return {
      title: `${baseTitle} — Splits`,
      question: 'Recorded segment splits for this workout run',
      wql,
      yaml: serializeQueryBlock(queryObject),
      queryObject,
      tokens: tokenValues,
    };
  }

  const agg = measure === 'elapsed' ? 'avg' : measure === 'calc.e1rm' ? 'max' : measure === 'tis' ? 'avg' : 'sum';
  const filters: string[] = [];

  if (movementSlug !== 'all') {
    filters.push(`effort:${movementSlug}`);
  }

  if (scopes.includes('current') && scopes.length === 1) {
    filters.push(`result:${ctx.resultId}`);
  } else if (scopes.includes('block') && ctx.blockContentId && !scopes.includes('history')) {
    filters.push(`block:${bindBlockToken ? '$block' : ctx.blockContentId}`);
  } else if (scopes.includes('notebook') && notebookSlug && !scopes.includes('history')) {
    filters.push(`notebook:${bindNotebookToken ? '$notebook' : notebookSlug}`);
  }

  let groupBy = ' by {week}';
  if (viz === 'value') {
    groupBy = '';
  } else if (scopes.includes('current') && scopes.length === 1) {
    groupBy = viz === 'timeseries' ? ' by {split}' : ' by {effort}';
  } else if (viz === 'bar') {
    groupBy = movementSlug !== 'all' || scopes.includes('block') ? ' by {session}' : ' by {effort}';
  }

  const windowClause =
    scopes.includes('current') && scopes.length === 1
      ? ''
      : bindRangeToken
        ? ' last $range'
        : ' last 12w';

  const wql = `${agg}:${measure}{${filters.join(', ')}}${groupBy}${windowClause}`;
  const measureLabel = MEASURE_LABELS[measure];
  const title =
    movementSlug !== 'all'
      ? `${measureLabel} — ${movementSlug}`
      : `${baseTitle} · ${measureLabel}`;
  const question = scopes.includes('history')
    ? `${measureLabel} across all recorded workouts`
    : scopes.includes('block') && ctx.blockContentId
      ? `${measureLabel} across attempts of ${baseTitle}`
      : `${measureLabel} from this workout`;

  const queryObject: QueryBlockObject = {
    view: viz,
    title,
    description: question,
    query: wql,
  };

  return {
    title,
    question,
    wql,
    yaml: serializeQueryBlock(queryObject),
    queryObject,
    tokens: tokenValues,
  };
}

export interface AddToDashboardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: SessionActionContext | null;
  preferredUnit?: string;
  onOpenInStudio?: (wql: string) => void;
  onNavigateDashboard?: (slug: string) => void;
}

/**
 * Production 2-step "Add to Dashboard" sheet:
 *   Step 1 — Configure metric, comparison scope (`current` / `block` / `notebook` / `history`),
 *            optional `$block` / `$notebook` / `$range` tokens, live `WidgetChart` preview, YAML inspect.
 *   Step 2 — Add to existing vault dashboard, clone a prebuilt seed & append, or scaffold a new workout dashboard.
 */
export function AddToDashboardSheet(props: AddToDashboardSheetProps) {
  if (!props.open || !props.context) return null;
  return <AddToDashboardSheetInner key={props.context.resultId} {...props} context={props.context} />;
}

function AddToDashboardSheetInner({
  onOpenChange,
  context,
  preferredUnit,
  onOpenInStudio,
  onNavigateDashboard,
}: Omit<AddToDashboardSheetProps, 'open' | 'context'> & { context: SessionActionContext }) {
  const navigate = useOptionalNavigate();

  const { items: dashboards, loading: loadingDashboards } = useDashboardList();
  const seedFiles = useSeedContent();
  const seeds = useMemo(() => (seedFiles ? buildDashboardSeeds(seedFiles) : []), [seedFiles]);

  const editableDashboards = useMemo(() => dashboards.filter((d) => d.editable), [dashboards]);
  const prebuiltDashboards = useMemo(() => dashboards.filter((d) => !d.editable), [dashboards]);

  const [step, setStep] = useState<1 | 2>(1);
  const [viz, setViz] = useState<WorkoutVizType>(() =>
    context.blockContentId ? 'timeseries' : 'summary',
  );
  const [measure, setMeasure] = useState<WorkoutMeasureId>(() => defaultMeasureForContext(context));
  const [movementSlug, setMovementSlug] = useState<string>('all');
  const [scopes, setScopes] = useState<ComparisonScopeId[]>(() =>
    context.blockContentId ? ['current', 'block'] : ['current'],
  );
  const [bindBlockToken, setBindBlockToken] = useState(false);
  const [bindNotebookToken, setBindNotebookToken] = useState(false);
  const [bindRangeToken, setBindRangeToken] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [copiedYaml, setCopiedYaml] = useState(false);

  const [destMode, setDestMode] = useState<'existing' | 'clone' | 'new'>(() =>
    editableDashboards.length > 0 ? 'existing' : 'new',
  );
  const [selectedExistingSlug, setSelectedExistingSlug] = useState<string>(
    () => editableDashboards[0]?.slug ?? '',
  );
  const [selectedCloneSlug, setSelectedCloneSlug] = useState<string>(
    () => prebuiltDashboards[0]?.slug ?? '',
  );
  const [newTitle, setNewTitle] = useState<string>(
    () => `${context.noteTitle ?? 'Workout'} Dashboard`,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedExistingSlug && editableDashboards[0]?.slug) {
      setSelectedExistingSlug(editableDashboards[0].slug);
    }
    if (!selectedCloneSlug && prebuiltDashboards[0]?.slug) {
      setSelectedCloneSlug(prebuiltDashboards[0].slug);
    }
  }, [editableDashboards, prebuiltDashboards, selectedExistingSlug, selectedCloneSlug]);

  const spec = useMemo(
    () =>
      buildWidgetSpec({
        ctx: context,
        viz,
        measure,
        movementSlug,
        scopes,
        bindBlockToken,
        bindNotebookToken,
        bindRangeToken,
      }),
    [context, viz, measure, movementSlug, scopes, bindBlockToken, bindNotebookToken, bindRangeToken],
  );

  // Live preview execution via real queryService
  const [previewResult, setPreviewResult] = useState<WidgetRunResult | undefined>(undefined);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(undefined);

    const runPreview = async () => {
      try {
        const notebookSlug = context.notebooks?.[0]?.replace(/^notebook\//, '');
        const pageSources = await setContextualPageSources({
          resultId: context.resultId,
          blockContentId: context.blockContentId,
          noteId: context.noteId,
          notebookSlug,
        });
        const host = createExecutorDocumentHost(queryService, { preferredUnit });
        const runner = new SharedQueryDocumentRunner(host, {
          tokens: spec.tokens,
          pageSources,
        });
        const res = await runner.run(spec.wql);
        const parsed = parseQuery(spec.wql);
        const mapped = outputsToRunResult(parsed, res, {});
        const err = res.outputs.find((o) => o.error)?.error ?? res.diagnostics[0];
        if (!cancelled) {
          setPreviewResult(mapped);
          setPreviewError(err);
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    void runPreview();
    return () => {
      cancelled = true;
    };
  }, [context.resultId, context.blockContentId, context.noteId, context.notebooks, spec.wql, spec.tokens, preferredUnit]);

  const toggleScope = (scopeId: ComparisonScopeId) => {
    setScopes((prev) => {
      const next = prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId];
      return next.length > 0 ? next : ['current'];
    });
  };

  const navigateToBoard = (slug: string) => {
    if (onNavigateDashboard) {
      onNavigateDashboard(slug);
    } else if (navigate) {
      void navigate(dashboardViewPath(slug));
    }
  };

  const handleOpenInStudio = () => {
    onOpenChange(false);
    if (onOpenInStudio) {
      onOpenInStudio(spec.wql);
    } else if (navigate) {
      void navigate(analyticsExplorerPath({ q: spec.wql }));
    }
  };

  const handleCopyYaml = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(`\`\`\`query\n${spec.yaml}\n\`\`\``).catch(() => {});
    }
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 1500);
  };

  const handleCommit = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    const widgetSpec: WidgetSpec = {
      title: spec.title,
      question: spec.question,
      type: viz,
      wql: spec.wql,
      queryObject: spec.queryObject,
    };

    try {
      if (destMode === 'existing') {
        if (!selectedExistingSlug) throw new Error('Select a destination dashboard.');
        const note = await journalNotes.resolve(selectedExistingSlug);
        await journalNotes.update(note, appendWidget(note.rawContent, widgetSpec));
        notifyDashboardsChanged();
        onOpenChange(false);
        navigateToBoard(selectedExistingSlug);
      } else if (destMode === 'clone') {
        if (!selectedCloneSlug) throw new Error('Select a prebuilt dashboard to clone.');
        const seed = seeds.find((s) => s.slug === selectedCloneSlug);
        if (!seed) throw new Error(`Prebuilt dashboard template "${selectedCloneSlug}" was not found.`);
        const cloned = await dashboardNotes.cloneDashboard(selectedCloneSlug, seed.rawContent);
        await journalNotes.update(cloned, appendWidget(cloned.rawContent, widgetSpec));
        notifyDashboardsChanged();
        const { meta } = parseFrontmatter(cloned.rawContent);
        const resolvedSlug = typeof meta.slug === 'string' && meta.slug ? dashboardSlug(meta.slug) : selectedCloneSlug;
        onOpenChange(false);
        navigateToBoard(resolvedSlug);
      } else {
        const title = newTitle.trim() || `${context.noteTitle ?? 'Workout'} Dashboard`;
        const notebookSlug = context.notebooks?.[0]?.replace(/^notebook\//, '');
        const scaffoldMd = buildWorkoutDashboardScaffold({
          title,
          resultId: context.resultId,
          blockContentId: context.blockContentId,
          notebookSlug,
        });
        const finalMd = appendWidget(scaffoldMd, widgetSpec);
        const created = await journalNotes.create({
          title,
          rawContent: finalMd,
          type: 'dashboard',
          sourceId: 'dashboards',
        });
        notifyDashboardsChanged();
        const { meta } = parseFrontmatter(created.rawContent);
        const resolvedSlug = typeof meta.slug === 'string' && meta.slug ? dashboardSlug(meta.slug) : dashboardSlug(title);
        onOpenChange(false);
        navigateToBoard(resolvedSlug);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const movements = context.summary?.movementRollup ?? [];
  const notebookSlug = context.notebooks?.[0]?.replace(/^notebook\//, '');

  return (
    <EditorDialog
      open
      onClose={() => onOpenChange(false)}
      presentation="sheet"
      title={step === 1 ? 'Add Workout to Dashboard' : 'Choose Dashboard Destination'}
      description={
        step === 1
          ? 'Bind a metric and comparison scope, then verify the live chart preview.'
          : 'Append to an existing vault board, clone a prebuilt board, or scaffold a dedicated workout dashboard.'
      }
      footer={
        <>
          {step === 2 ? (
            <button
              type="button"
              data-testid={TEST_IDS.ADD_DASHBOARD_STEP_BACK}
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1 min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back
            </button>
          ) : (
            <button
              type="button"
              data-testid={TEST_IDS.ADD_DASHBOARD_OPEN_STUDIO}
              onClick={handleOpenInStudio}
              className="inline-flex items-center gap-1 min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              <Code2 className="size-3.5 text-primary" aria-hidden="true" />
              Open in WQL Studio
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          {step === 1 ? (
            <button
              type="button"
              data-testid={TEST_IDS.ADD_DASHBOARD_STEP_NEXT}
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 min-h-11 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <span>Destination</span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              data-testid={TEST_IDS.ADD_DASHBOARD_COMMIT}
              onClick={() => void handleCommit()}
              className="inline-flex items-center gap-1.5 min-h-11 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>{saving ? 'Saving…' : destMode === 'new' ? 'Create Dashboard' : 'Save Widget'}</span>
            </button>
          )}
        </>
      }
    >
      <div data-testid={TEST_IDS.ADD_DASHBOARD_SHEET} className="space-y-4">
        {step === 1 ? (
          <>
            {/* Visualization Type */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Visualization
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VIZ_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = viz === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setViz(opt.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors min-h-10 sm:min-h-8 ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {viz !== 'summary' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Measure
                  </span>
                  <select
                    value={measure}
                    onChange={(e) => setMeasure(e.target.value as WorkoutMeasureId)}
                    className="min-h-10 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground"
                  >
                    {(Object.entries(MEASURE_LABELS) as Array<[WorkoutMeasureId, string]>).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Movement Scope
                  </span>
                  <select
                    value={movementSlug}
                    onChange={(e) => setMovementSlug(e.target.value)}
                    className="min-h-10 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground"
                  >
                    <option value="all">All movements in scope</option>
                    {movements.map((m) => (
                      <option key={m.effortSlug} value={m.effortSlug}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {/* Comparison Scopes */}
            {viz !== 'summary' && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Comparison Window &amp; Peers
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    aria-pressed={scopes.includes('current')}
                    onClick={() => toggleScope('current')}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium min-h-9 ${
                      scopes.includes('current')
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    This run
                  </button>
                  <button
                    type="button"
                    disabled={!context.blockContentId}
                    aria-pressed={scopes.includes('block')}
                    onClick={() => toggleScope('block')}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium min-h-9 disabled:opacity-40 ${
                      scopes.includes('block')
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Prior runs of block
                  </button>
                  <button
                    type="button"
                    disabled={!notebookSlug}
                    aria-pressed={scopes.includes('notebook')}
                    onClick={() => toggleScope('notebook')}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium min-h-9 disabled:opacity-40 ${
                      scopes.includes('notebook')
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {notebookSlug ? `Notebook: ${notebookSlug}` : 'Notebook baseline'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={scopes.includes('history')}
                    onClick={() => toggleScope('history')}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium min-h-9 ${
                      scopes.includes('history')
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All history
                  </button>
                </div>

                {/* Parameterized Tokens */}
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
                  {context.blockContentId && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bindBlockToken}
                        onChange={(e) => setBindBlockToken(e.target.checked)}
                      />
                      <span>Bind <code>$block</code> token</span>
                    </label>
                  )}
                  {notebookSlug && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bindNotebookToken}
                        onChange={(e) => setBindNotebookToken(e.target.checked)}
                      />
                      <span>Bind <code>$notebook</code> token</span>
                    </label>
                  )}
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bindRangeToken}
                      onChange={(e) => setBindRangeToken(e.target.checked)}
                    />
                    <span>Bind <code>$range</code> token</span>
                  </label>
                </div>
              </div>
            )}

            {/* Live Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Live Preview
                </span>
                {previewLoading && <span className="text-[11px] text-muted-foreground">Running query…</span>}
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-3 min-h-[200px]">
                {previewError ? (
                  <div className="text-xs text-destructive font-mono">{previewError}</div>
                ) : (
                  <div className={viz === 'summary' || viz === 'table' || viz === 'value' ? undefined : 'h-52'}>
                    <WidgetChart
                      type={viz}
                      result={previewResult}
                      label={spec.title}
                      unit={preferredUnit}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Collapsible YAML / WQL Disclosure */}
            <div className="rounded-lg border border-border/70 bg-muted/20">
              <button
                type="button"
                data-testid={TEST_IDS.ADD_DASHBOARD_WQL_DISCLOSURE}
                aria-expanded={showYaml}
                onClick={() => setShowYaml((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span>Generated YAML &amp; WQL</span>
                {showYaml ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
              {showYaml && (
                <div className="border-t border-border/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-muted-foreground truncate">{spec.wql}</span>
                    <button
                      type="button"
                      onClick={handleCopyYaml}
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted shrink-0"
                    >
                      {copiedYaml ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                      {copiedYaml ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded bg-card p-2 text-[11px] font-mono text-foreground border border-border/60">
                    {spec.yaml}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Step 2: Destination Picker */
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={editableDashboards.length === 0}
                data-testid={TEST_IDS.ADD_DASHBOARD_MODE_EXISTING}
                aria-pressed={destMode === 'existing'}
                onClick={() => setDestMode('existing')}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${
                  destMode === 'existing'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="text-xs font-semibold">Existing Vault Board</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {editableDashboards.length} editable board{editableDashboards.length === 1 ? '' : 's'}
                </div>
              </button>

              <button
                type="button"
                disabled={prebuiltDashboards.length === 0}
                data-testid={TEST_IDS.ADD_DASHBOARD_MODE_CLONE}
                aria-pressed={destMode === 'clone'}
                onClick={() => setDestMode('clone')}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${
                  destMode === 'clone'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="text-xs font-semibold">Clone Prebuilt &amp; Add</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {prebuiltDashboards.length} seed template{prebuiltDashboards.length === 1 ? '' : 's'}
                </div>
              </button>

              <button
                type="button"
                data-testid={TEST_IDS.ADD_DASHBOARD_MODE_NEW}
                aria-pressed={destMode === 'new'}
                onClick={() => setDestMode('new')}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  destMode === 'new'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="text-xs font-semibold">New Workout Dashboard</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Scaffolds 4 linked workout panels
                </div>
              </button>
            </div>

            {loadingDashboards && (
              <p className="text-xs text-muted-foreground">Loading dashboard library…</p>
            )}

            {destMode === 'existing' && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Select Editable Dashboard
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {editableDashboards.map((d) => (
                    <button
                      key={d.slug}
                      type="button"
                      aria-pressed={selectedExistingSlug === d.slug}
                      onClick={() => setSelectedExistingSlug(d.slug)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs font-medium min-h-11 ${
                        selectedExistingSlug === d.slug
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {d.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {destMode === 'clone' && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Select Prebuilt Dashboard to Clone
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {prebuiltDashboards.map((d) => (
                    <button
                      key={d.slug}
                      type="button"
                      data-testid={TEST_IDS.ADD_DASHBOARD_CLONE_PREBUILT}
                      aria-pressed={selectedCloneSlug === d.slug}
                      onClick={() => setSelectedCloneSlug(d.slug)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs font-medium min-h-11 ${
                        selectedCloneSlug === d.slug
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {d.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {destMode === 'new' && (
              <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    New Dashboard Title
                  </span>
                  <input
                    type="text"
                    data-testid={TEST_IDS.ADD_DASHBOARD_NEW_TITLE}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  />
                </label>
                <p className="text-xs text-muted-foreground text-pretty">
                  Creates an editable dashboard bound to this session, its workout block history, movement breakdown, and your newly configured widget.
                </p>
              </div>
            )}

            {saveError && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {saveError}
              </p>
            )}
          </div>
        )}
      </div>
    </EditorDialog>
  );
}
