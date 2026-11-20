import { useState } from 'react';
import { TEST_IDS } from '@/lib/testIds';
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
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { cn } from '@/lib/utils';
import {
  NOTEBOOK_BENCHMARKS,
  OTHER_WORKOUTS,
  defaultComparisonConfigForFixture,
  generateWidgetYamlAndWql,
  measureLabel,
  type ProtoComparisonConfig,
  type ProtoComparisonScopeId,
  type ProtoDashboard,
  type ProtoMeasureId,
  type ProtoSplitRow,
  type ProtoWidgetVizType,
  type ProtoWorkoutFixture,
} from './protoData';
import { ProtoWidgetContent } from './BoundDashboardView';

const VIZ_CHOICES: Array<{
  id: ProtoWidgetVizType;
  label: string;
  icon: typeof LineChartIcon;
}> = [
  { id: 'line', label: 'Line Overlay', icon: LineChartIcon },
  { id: 'bar', label: 'Grouped Bar', icon: BarChart3 },
  { id: 'summary', label: 'Summary Card', icon: Activity },
  { id: 'table', label: 'Spreadsheet', icon: Table2 },
  { id: 'value', label: 'KPI Value', icon: Hash },
];

export interface AddToDashboardSavePayload {
  mode: 'existing' | 'clone' | 'new';
  targetSlug?: string;
  newTitle?: string;
  config: ProtoComparisonConfig;
}

export interface AddToDashboardSheetProps {
  open: boolean;
  onClose: () => void;
  fixture: ProtoWorkoutFixture;
  splits: readonly ProtoSplitRow[];
  rpe: number | null;
  dashboards: readonly ProtoDashboard[];
  initialConfig?: ProtoComparisonConfig;
  onConfigChange?: (next: ProtoComparisonConfig) => void;
  onCommit: (payload: AddToDashboardSavePayload) => void;
}

export function AddToDashboardSheet(props: AddToDashboardSheetProps) {
  if (!props.open) return null;
  return <AddToDashboardSheetSession key={props.fixture.id} {...props} />;
}

function AddToDashboardSheetSession({
  open,
  onClose,
  fixture,
  splits,
  rpe,
  dashboards,
  initialConfig,
  onConfigChange,
  onCommit,
}: AddToDashboardSheetProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [config, setConfig] = useState<ProtoComparisonConfig>(
    () => initialConfig ?? defaultComparisonConfigForFixture(fixture),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copiedWql, setCopiedWql] = useState(false);

  const editableDashboards = dashboards.filter((d) => d.editable);
  const prebuiltDashboards = dashboards.filter((d) => !d.editable);

  const [destMode, setDestMode] = useState<'existing' | 'clone' | 'new'>(() =>
    editableDashboards.length > 0 ? 'existing' : 'new',
  );
  const [selectedExistingSlug, setSelectedExistingSlug] = useState<string>(
    () => editableDashboards[0]?.slug ?? '',
  );
  const [selectedCloneSlug, setSelectedCloneSlug] = useState<string>(
    () => prebuiltDashboards[0]?.slug ?? '',
  );
  const [newDashboardTitle, setNewDashboardTitle] = useState<string>(
    () => `${fixture.shortLabel.split(' ')[0]} Training Board`,
  );

  const updateConfig = (updater: (prev: ProtoComparisonConfig) => ProtoComparisonConfig) => {
    const next = updater(config);
    setConfig(next);
    onConfigChange?.(next);
  };

  const toggleScope = (scopeId: ProtoComparisonScopeId) => {
    updateConfig((prev) => {
      const exists = prev.scopes.includes(scopeId);
      const nextScopes = exists
        ? prev.scopes.filter((s) => s !== scopeId)
        : [...prev.scopes, scopeId];
      return {
        ...prev,
        scopes: nextScopes.length > 0 ? nextScopes : ['current'],
      };
    });
  };

  const availableMeasures: ProtoMeasureId[] =
    fixture.domain === 'endurance'
      ? ['pace', 'splitTime', 'tis']
      : ['splitTime', 'volume', 'e1rm', 'reps', 'tis'];

  const uniqueMovements = Array.from(
    new Map(fixture.initialSplits.map((s) => [s.effortSlug, s.movement])).entries(),
  );

  const generated = generateWidgetYamlAndWql(fixture, config);

  const handleCopyWql = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(generated.yaml).catch(() => {});
    }
    setCopiedWql(true);
    setTimeout(() => setCopiedWql(false), 1600);
  };

  const handleSave = () => {
    if (destMode === 'existing') {
      onCommit({ mode: 'existing', targetSlug: selectedExistingSlug, config });
    } else if (destMode === 'clone') {
      onCommit({ mode: 'clone', targetSlug: selectedCloneSlug, config });
    } else {
      onCommit({ mode: 'new', newTitle: newDashboardTitle, config });
    }
    onClose();
  };

  return (
    <EditorDialog
      open={open}
      onClose={onClose}
      presentation="sheet"
      title="Add Workout Data to Dashboard"
      description={`${fixture.title} · ${fixture.attemptLabel} · ${fixture.notebookTitle}`}
      footer={
        <>
          {step === 2 ? (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>Back to Metric &amp; Preview</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg border border-border bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          )}
          <div className="flex-1" />
          {step === 1 ? (
            <button
              type="button"
              data-testid={TEST_IDS.PROTO_RESULTS.ADD_DASH_NEXT}
              onClick={() => setStep(2)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <span>Choose Destination</span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              data-testid={TEST_IDS.PROTO_RESULTS.ADD_DASH_CONFIRM}
              onClick={handleSave}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>
                {destMode === 'new'
                  ? 'Create Workout Dashboard'
                  : destMode === 'clone'
                    ? 'Clone & Add Widget'
                    : 'Add Widget to Dashboard'}
              </span>
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4" data-testid={TEST_IDS.PROTO_RESULTS.ADD_DASH_SHEET}>
        {/* Clean 2-Step Switcher */}
        <div
          role="tablist"
          aria-label="Add to dashboard steps"
          className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={step === 1}
            onClick={() => setStep(1)}
            className={cn(
              'min-h-11 rounded-lg px-3 text-xs font-medium transition-colors',
              step === 1
                ? 'bg-card text-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            1. Metric &amp; Compare
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={step === 2}
            onClick={() => setStep(2)}
            className={cn(
              'min-h-11 rounded-lg px-3 text-xs font-medium transition-colors',
              step === 2
                ? 'bg-card text-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            2. Destination
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            {/* Step 1A: What to measure */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-foreground">
                  What to measure
                </label>
                {uniqueMovements.length > 1 && (
                  <select
                    aria-label="Filter by movement"
                    value={config.effortFilter}
                    onChange={(e) =>
                      updateConfig((p) => ({ ...p, effortFilter: e.target.value }))
                    }
                    className="min-h-11 sm:min-h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                  >
                    <option value="all">All movements</option>
                    {uniqueMovements.map(([slug, label]) => (
                      <option key={slug} value={slug}>
                        Only {label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {availableMeasures.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`proto-measure-${m}`}
                    aria-pressed={config.measure === m}
                    onClick={() => updateConfig((p) => ({ ...p, measure: m }))}
                    className={cn(
                      'min-h-11 sm:min-h-9 rounded-lg border px-3 text-xs font-medium transition-colors',
                      config.measure === m
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    {measureLabel(m)}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 1B: Compare against */}
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="text-xs font-semibold text-foreground">
                Compare against (overlays &amp; baselines)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['current', `This run (${fixture.attemptLabel})`],
                    ['priorRuns', 'Prior runs of this workout'],
                    ['otherWorkout', 'Another workout'],
                    ['currentNotebook', `This notebook (${fixture.notebookTitle})`],
                    ['otherNotebook', 'Another notebook'],
                    ['baseline4w', '4w baseline'],
                    ['goalTarget', 'Goal target'],
                  ] as const
                ).map(([scopeId, label]) => {
                  const active = config.scopes.includes(scopeId);
                  return (
                    <button
                      key={scopeId}
                      type="button"
                      data-testid={`proto-scope-${scopeId}`}
                      aria-pressed={active}
                      onClick={() => toggleScope(scopeId)}
                      className={cn(
                        'min-h-11 sm:min-h-9 rounded-lg border px-3 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Conditional inline target pickers */}
              {(config.scopes.includes('otherWorkout') ||
                config.scopes.includes('otherNotebook') ||
                config.scopes.includes('goalTarget')) && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
                  {config.scopes.includes('otherWorkout') && (
                    <label className="inline-flex items-center gap-1.5">
                      <span className="text-muted-foreground">Other workout:</span>
                      <select
                        aria-label="Choose comparison workout"
                        value={config.otherWorkoutId}
                        onChange={(e) =>
                          updateConfig((p) => ({ ...p, otherWorkoutId: e.target.value }))
                        }
                        className="min-h-11 sm:min-h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      >
                        {OTHER_WORKOUTS.map((w) => (
                          <option key={w.blockContentId} value={w.blockContentId}>
                            {w.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {config.scopes.includes('otherNotebook') && (
                    <label className="inline-flex items-center gap-1.5">
                      <span className="text-muted-foreground">Other notebook:</span>
                      <select
                        aria-label="Choose comparison notebook"
                        data-testid={TEST_IDS.PROTO_RESULTS.OTHER_NOTEBOOK_SELECT}
                        value={config.otherNotebookSlug}
                        onChange={(e) =>
                          updateConfig((p) => ({ ...p, otherNotebookSlug: e.target.value }))
                        }
                        className="min-h-11 sm:min-h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      >
                        {NOTEBOOK_BENCHMARKS.filter((n) => n.slug !== fixture.notebookSlug).map(
                          (nb) => (
                            <option key={nb.slug} value={nb.slug}>
                              {nb.title}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}

                  {config.scopes.includes('goalTarget') && (
                    <label className="inline-flex items-center gap-1.5">
                      <span className="text-muted-foreground">Goal:</span>
                      <input
                        type="number"
                        aria-label="Goal target value"
                        value={config.goalValue}
                        onChange={(e) =>
                          updateConfig((p) => ({
                            ...p,
                            goalValue: Number(e.target.value) || 0,
                          }))
                        }
                        className="min-h-11 sm:min-h-8 w-20 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Step 1C: Single Visualization Picker + Dynamic Token Binding */}
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">Visualization</span>
                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    aria-pressed={config.bindingMode === 'tokens'}
                    onClick={() => updateConfig((p) => ({ ...p, bindingMode: 'tokens' }))}
                    className={cn(
                      'min-h-11 sm:min-h-7 rounded-md px-2.5 text-xs font-medium',
                      config.bindingMode === 'tokens'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground',
                    )}
                  >
                    Bind to $tokens
                  </button>
                  <button
                    type="button"
                    aria-pressed={config.bindingMode === 'pin'}
                    onClick={() => updateConfig((p) => ({ ...p, bindingMode: 'pin' }))}
                    className={cn(
                      'min-h-11 sm:min-h-7 rounded-md px-2.5 text-xs font-medium',
                      config.bindingMode === 'pin'
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground',
                    )}
                  >
                    Pin to this run
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {VIZ_CHOICES.map((v) => {
                  const Icon = v.icon;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      data-testid={`proto-viz-${v.id}`}
                      aria-pressed={config.vizType === v.id}
                      onClick={() => updateConfig((p) => ({ ...p, vizType: v.id }))}
                      className={cn(
                        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium whitespace-nowrap transition-colors',
                        config.vizType === v.id
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span>{v.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 1D: Live Working Preview (flat surface, zero nested cards) */}
            <div
              data-testid={TEST_IDS.PROTO_RESULTS.ADD_DASH_LIVE_PREVIEW}
              className="space-y-2 border-t border-border/60 pt-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">Live Preview</span>
                <span className="text-xs font-mono text-muted-foreground">
                  {generated.axisLabel}
                </span>
              </div>
              <div className="rounded-lg bg-muted/25 p-3">
                <ProtoWidgetContent
                  fixture={fixture}
                  splits={splits}
                  rpe={rpe}
                  config={config}
                  heightClass="h-[190px] min-h-[160px]"
                />
              </div>
            </div>

            {/* Collapsible Advanced WQL / YAML Disclosure */}
            <div className="border-t border-border/60 pt-2">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((v) => !v)}
                className="inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Code2 className="size-3.5" aria-hidden="true" />
                <span>Advanced WQL / YAML</span>
                {advancedOpen ? (
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                )}
              </button>

              {advancedOpen && (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCopyWql}
                      className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground hover:bg-muted"
                    >
                      {copiedWql ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{copiedWql ? 'Copied' : 'Copy YAML'}</span>
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
                    {generated.yaml}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* STEP 2: Destination + Widget Title */
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold text-foreground">Widget title</span>
                <input
                  type="text"
                  value={config.title}
                  onChange={(e) =>
                    updateConfig((p) => ({ ...p, title: e.target.value }))
                  }
                  className="min-h-11 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-semibold text-foreground">Coaching question</span>
                <input
                  type="text"
                  value={config.question}
                  onChange={(e) =>
                    updateConfig((p) => ({ ...p, question: e.target.value }))
                  }
                  className="min-h-11 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
                />
              </label>
            </div>

            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="text-xs font-semibold text-foreground">Destination</div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['existing', 'Existing vault dashboard'],
                    ['clone', 'Clone & add to prebuilt'],
                    ['new', 'Create new workout dashboard'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`proto-dest-mode-${m}`}
                    aria-pressed={destMode === m}
                    onClick={() => setDestMode(m)}
                    className={cn(
                      'min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors',
                      destMode === m
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {destMode === 'existing' && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {editableDashboards.map((d) => (
                    <button
                      key={d.slug}
                      type="button"
                      aria-pressed={selectedExistingSlug === d.slug}
                      onClick={() => setSelectedExistingSlug(d.slug)}
                      className={cn(
                        'min-h-11 rounded-lg border px-3 text-xs font-medium',
                        selectedExistingSlug === d.slug
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {d.title} ({d.widgets.length} widgets)
                    </button>
                  ))}
                </div>
              )}

              {destMode === 'clone' && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Prebuilt boards stay pristine — this clones the board into your vault and
                    appends your bound widget immediately.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {prebuiltDashboards.map((d) => (
                      <button
                        key={d.slug}
                        type="button"
                        aria-pressed={selectedCloneSlug === d.slug}
                        onClick={() => setSelectedCloneSlug(d.slug)}
                        className={cn(
                          'min-h-11 rounded-lg border px-3 text-xs font-medium',
                          selectedCloneSlug === d.slug
                            ? 'border-primary bg-primary/10 text-primary font-semibold'
                            : 'border-border bg-background text-foreground hover:bg-muted',
                        )}
                      >
                        Clone &amp; add to {d.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {destMode === 'new' && (
                <div className="space-y-3 pt-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-muted-foreground">New dashboard title</span>
                    <input
                      type="text"
                      data-testid={TEST_IDS.PROTO_RESULTS.NEW_DASHBOARD_TITLE}
                      value={newDashboardTitle}
                      onChange={(e) => setNewDashboardTitle(e.target.value)}
                      className="min-h-11 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
                    />
                  </label>
                  <div className="rounded-lg bg-muted/35 p-3 text-xs space-y-1.5">
                    <div className="font-semibold text-foreground">
                      Workout-scoped scaffold (4 bound widgets + $block / $notebook / $effort tokens):
                    </div>
                    <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                      <li>Latest Session Summary card ({fixture.shortLabel})</li>
                      <li>Split Comparison vs Prior Run + 4w Baseline</li>
                      <li>{fixture.notebookTitle} vs Cross-Notebook Load</li>
                      <li>Full Session Splits Spreadsheet table</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </EditorDialog>
  );
}
