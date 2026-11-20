import { useState } from 'react';
import { TEST_IDS } from '@/lib/testIds';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Maximize2,
  Play,
  RotateCcw,
  Sparkles,
  Table2,
} from 'lucide-react';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { cn } from '@/lib/utils';
import {
  computeSplitDerived,
  formatDurationMMSS,
  formatPace,
  generateExplicitSummaryFence,
  generateLegacyTableFence,
  type ProtoSplitRow,
  type ProtoSummaryMetrics,
  type ProtoWorkoutFixture,
} from './protoData';
import { SessionSummaryCard } from './SessionSummaryCard';

export interface NoteInjectionViewProps {
  fixture: ProtoWorkoutFixture;
  splits: readonly ProtoSplitRow[];
  summary: ProtoSummaryMetrics;
  rpe: number | null;
  injected: boolean;
  injectionFormat: 'explicit-summary' | 'legacy-table';
  compactMobile: boolean;
  onSimulateRun: () => void;
  onResetRun: () => void;
  onChangeFormat: (fmt: 'explicit-summary' | 'legacy-table') => void;
  onChangeRpe: (nextRpe: number) => void;
  onOpenSpreadsheet: () => void;
  onOpenAddToDashboard: () => void;
}

export function NoteInjectionView({
  fixture,
  splits,
  summary,
  rpe,
  injected,
  injectionFormat,
  compactMobile,
  onSimulateRun,
  onResetRun,
  onChangeFormat,
  onChangeRpe,
  onOpenSpreadsheet,
  onOpenAddToDashboard,
}: NoteInjectionViewProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [completionHeroOpen, setCompletionHeroOpen] = useState(false);

  const fenceText =
    injectionFormat === 'explicit-summary'
      ? generateExplicitSummaryFence(fixture.resultId)
      : generateLegacyTableFence(fixture.resultId);

  const derived = computeSplitDerived(splits);

  return (
    <div
      className={cn(
        'grid gap-6 items-start',
        compactMobile ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]',
      )}
      data-testid={TEST_IDS.PROTO_RESULTS.NOTE_INJECTION_VIEW}
    >
      {/* Left: Journal Note Document Surface */}
      <div className="space-y-4 min-w-0">
        {/* Controls strip (flat on canvas so inner segmented controls never nest cards) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Injection format:</span>
            <div
              role="group"
              aria-label="Query block injection format"
              className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
            >
              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.FORMAT_EXPLICIT}
                aria-pressed={injectionFormat === 'explicit-summary'}
                onClick={() => onChangeFormat('explicit-summary')}
                className={cn(
                  'rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                  injectionFormat === 'explicit-summary'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Explicit YAML (view: summary)
              </button>
              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.FORMAT_LEGACY}
                aria-pressed={injectionFormat === 'legacy-table'}
                onClick={() => onChangeFormat('legacy-table')}
                className={cn(
                  'rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                  injectionFormat === 'legacy-table'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Legacy 1-line (table)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {injected && (
              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.OPEN_COMPLETION_HERO}
                onClick={() => setCompletionHeroOpen(true)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                )}
              >
                <Maximize2 className="size-3.5 text-primary" aria-hidden="true" />
                <span>Preview Completion Hero</span>
              </button>
            )}
            {injected && (
              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.RESET_RUN}
                onClick={onResetRun}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                )}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                <span>Reset to pre-run</span>
              </button>
            )}
          </div>
        </div>

        {/* Simulated Note Body (flat editorial Markdown canvas — no nested-card framing) */}
        <article className="space-y-4 py-2">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              {fixture.noteTitle}
            </h2>
            <span className="text-xs text-muted-foreground">
              {fixture.notebookTitle} · {fixture.dateLabel}
            </span>
          </header>

          <p className="text-sm leading-relaxed text-foreground/90 max-w-[70ch]">
            {fixture.proseBefore}
          </p>

          {/* Actionable Workout Block (no overlapping absolute toolbar) */}
          <div
            data-testid={TEST_IDS.PROTO_RESULTS.WORKOUT_BLOCK}
            className="rounded-xl border border-border bg-card p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-primary" aria-hidden="true" />
                <span className="font-mono text-xs font-semibold text-foreground">
                  ```{fixture.wodBlockTag}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {fixture.attemptLabel}
                </span>
              </div>

              <button
                type="button"
                data-testid={TEST_IDS.PROTO_RESULTS.RUN_WORKOUT_BTN}
                onClick={onSimulateRun}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-9',
                  injected
                    ? 'border border-border bg-background text-foreground hover:bg-muted'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <Play className="size-3.5 fill-current" aria-hidden="true" />
                <span>{injected ? 'Re-run & Inspect Hero' : 'Run Workout (Simulate Finish)'}</span>
              </button>
            </div>

            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
              {fixture.wodScript}
            </pre>
          </div>

          {/* Post-Execution Injected Query Block */}
          {!injected ? (
            <div
              data-testid={TEST_IDS.PROTO_RESULTS.PRE_RUN_PLACEHOLDER}
              className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-5 text-center"
            >
              <p className="text-xs font-medium text-foreground">
                No post-execution block injected yet.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run the workout block above to inject{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                  view: summary
                </code>{' '}
                immediately beneath it without flooding your prose.
              </p>
            </div>
          ) : injectionFormat === 'explicit-summary' ? (
            <SessionSummaryCard
              fixture={fixture}
              summary={summary}
              rpe={rpe}
              onChangeRpe={onChangeRpe}
              onOpenSpreadsheet={onOpenSpreadsheet}
              onOpenAddToDashboard={onOpenAddToDashboard}
              showSourceToggle
              isEditingSource={sourceOpen}
              onToggleSource={() => setSourceOpen((v) => !v)}
              yamlFenceText={fenceText}
              compactMobile={compactMobile}
            />
          ) : (
            /* Legacy 1-line :session{result:<id>} table rendering (backward compatible) */
            <section
              aria-label="Legacy 1-line session table"
              data-testid={TEST_IDS.PROTO_RESULTS.LEGACY_TABLE_BLOCK}
              className="rounded-xl border border-border bg-background"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold text-foreground">
                    Legacy 1-Line Table View
                  </h3>
                  <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                    :session&#123;result:…&#125;
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChangeFormat('explicit-summary')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-primary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                    )}
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    <span>Upgrade to view: summary</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSpreadsheet}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                    )}
                  >
                    <Table2 className="size-3.5" aria-hidden="true" />
                    <span>Open Spreadsheet</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Rd</th>
                      <th className="px-3 py-2 font-semibold">Movement</th>
                      <th className="px-3 py-2 text-right font-semibold">Reps</th>
                      <th className="px-3 py-2 text-right font-semibold">Load</th>
                      <th className="px-3 py-2 text-right font-semibold">Split</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        {fixture.domain === 'endurance' ? 'Pace' : 'Volume'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {derived.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          R{row.round}
                        </td>
                        <td className="px-3 py-2 font-sans font-medium text-foreground whitespace-nowrap">
                          {row.movement}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.actualReps ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.actualLoadLbs != null ? `${row.actualLoadLbs} lb` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatDurationMMSS(row.actualDurationSec)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fixture.domain === 'endurance'
                            ? formatPace(row.paceSecPerKm)
                            : row.volumeLbs != null
                              ? `${row.volumeLbs.toLocaleString()} lb`
                              : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-sm leading-relaxed text-foreground/90 max-w-[70ch]">
            {fixture.proseAfter}
          </p>
        </article>
      </div>

      {/* Right: Live Markdown Fence Inspector */}
      <aside
        aria-label="Live markdown note source"
        className={cn(
          'rounded-xl border border-border bg-card p-4 space-y-3',
          !compactMobile && 'lg:sticky lg:top-6',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">note.md — Live Fence State</h3>
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {injected ? 'injected' : 'pre-run'}
          </span>
        </div>

        <pre
          data-testid={TEST_IDS.PROTO_RESULTS.NOTE_MARKDOWN_SOURCE}
          className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/35 p-3 font-mono text-xs leading-relaxed text-muted-foreground"
        >
          {`# ${fixture.noteTitle}\n\n${fixture.proseBefore}\n\n\`\`\`${fixture.wodBlockTag}\n${fixture.wodScript}\n\`\`\``}
          {injected && (
            <>
              {'\n\n'}
              <span className="block rounded border border-primary/30 bg-primary/10 p-2 text-foreground">
                {fenceText}
              </span>
            </>
          )}
          {`\n\n${fixture.proseAfter}`}
        </pre>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {injectionFormat === 'explicit-summary'
            ? 'New completions inject explicit YAML with view: summary, keeping notes scannable while preserving 1-tap drill-in to the full spreadsheet.'
            : 'Legacy 1-line :session{result:<id>} fences continue rendering as clean tables for full backward compatibility.'}
        </p>
      </aside>

      {/* Post-Workout Fullscreen Completion Hero Preview */}
      <EditorDialog
        open={completionHeroOpen}
        onClose={() => setCompletionHeroOpen(false)}
        presentation="default"
        title="Workout Complete"
        description={`${fixture.title} · ${fixture.attemptLabel} saved to ${fixture.notebookTitle}`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setCompletionHeroOpen(false)}
              className="min-h-11 rounded-lg border border-border bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Done — Back to Note
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setCompletionHeroOpen(false);
                onOpenAddToDashboard();
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <BarChart3 className="size-3.5 text-primary" aria-hidden="true" />
              <span>Add to Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCompletionHeroOpen(false);
                onOpenSpreadsheet();
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <span>Inspect Splits</span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Session saved &amp; summary block injected into your note. Rate effort or review
              splits below.
            </span>
          </div>
          <SessionSummaryCard
            fixture={fixture}
            summary={summary}
            rpe={rpe}
            onChangeRpe={onChangeRpe}
            compactMobile={compactMobile}
            hideDrillActions
            bare
          />
        </div>
      </EditorDialog>
    </div>
  );
}
