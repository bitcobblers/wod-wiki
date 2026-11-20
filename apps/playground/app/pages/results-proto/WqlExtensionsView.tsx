import { ArrowRight, Code2 } from 'lucide-react';
import { TEST_IDS } from '@/lib/testIds';
import { cn } from '@/lib/utils';
import {
  generateExplicitSummaryFence,
  generateWidgetYamlAndWql,
  type ProtoComparisonConfig,
  type ProtoWorkoutFixture,
} from './protoData';

export interface WqlGapSpec {
  id: string;
  title: string;
  targetFiles: string;
  problemToday: string;
  proposedWql: string;
  jumpTarget: 'note' | 'spreadsheet' | 'dashboard';
  jumpLabel: string;
}

export interface WqlExtensionsViewProps {
  fixture: ProtoWorkoutFixture;
  comparisonConfig: ProtoComparisonConfig;
  compactMobile: boolean;
  onJumpToView: (view: 'note' | 'spreadsheet' | 'dashboard') => void;
}

export function WqlExtensionsView({
  fixture,
  comparisonConfig,
  compactMobile,
  onJumpToView,
}: WqlExtensionsViewProps) {
  const activeComparison = generateWidgetYamlAndWql(fixture, comparisonConfig);

  const gaps: WqlGapSpec[] = [
    {
      id: 'notebook-facts',
      title: '1. Allow notebook: filter & by {notebook} on facts, :session, and :segment',
      targetFiles:
        'packages/wql/src/vocabulary.ts · capabilities.ts · QueryService.ts (loadFactDimensions)',
      problemToday:
        "notebook sits in WQL_CONTENT_ONLY_KEYS, so sum:totalVolume{notebook:benchmarks} and avg:tis{} by {notebook} are rejected as category errors.",
      proposedWql: `avg:tis{notebook:${fixture.notebookSlug}} by {week}\navg:tis{notebook:benchmarks|strength-cycle} by {notebook} last 6w`,
      jumpTarget: 'dashboard',
      jumpLabel: 'View Notebook Compare',
    },
    {
      id: 'negation-scopes',
      title: '2. Fix negated scope filters (!result:, !block:, !note:) in session & table queries',
      targetFiles: 'packages/wql/src/QueryService.ts (runFindSession, runFindTable)',
      problemToday:
        'scopeValues("result") ignores f.negate, so !result:<currentId> actually unions the excluded run back into prior history.',
      proposedWql: `:session{block:${fixture.blockContentId}, !result:${fixture.resultId}}\navg:elapsed{block:${fixture.blockContentId}, !result:${fixture.resultId}} by {split}`,
      jumpTarget: 'spreadsheet',
      jumpLabel: 'Inspect Compare Runs',
    },
    {
      id: 'segment-spreadsheet-cols',
      title: '3. Project spreadsheet virtual columns & edit provenance in :segment / :event',
      targetFiles: 'packages/wql/src/QueryService.ts (runFindTable, TabularColumn)',
      problemToday:
        'runFindTable drops round, splitIndex, elapsed, offset, target vs actual origin, unit metadata, and sourceBlockKey needed for inline editing.',
      proposedWql: `:segment{result:${fixture.resultId}}\n  | select round, effort, reps, resistance, elapsed, totalVolume, calc.e1rm`,
      jumpTarget: 'spreadsheet',
      jumpLabel: 'Open Spreadsheet',
    },
    {
      id: 'ordinal-alignment',
      title: '4. Ordinal / categorical cross-run alignment & human-readable session labels',
      targetFiles: 'packages/wql/src/QueryService.ts (buildResult) · documentRunner.ts',
      problemToday:
        'Multi-series charts align solely by wall-clock timestamps (ts), preventing split-for-split overlays across dates; by {session} emits raw UUIDs.',
      proposedWql: activeComparison.documentWql,
      jumpTarget: 'dashboard',
      jumpLabel: 'Test Multi-Series Overlay',
    },
    {
      id: 'contextual-datasets',
      title: '5. Historical @session / @block / @notebook bindings & $result/$block tokens',
      targetFiles:
        'apps/playground/src/services/queryService.ts · packages/wql/src/queryDocumentRunner.ts',
      problemToday:
        '@session is only populated while a live timer is running; /results/:sessionId and workout dashboards cannot bind contextual $block/$notebook.',
      proposedWql: `---\ndashboard.block: ${fixture.blockContentId}\ndashboard.notebook: ${fixture.notebookSlug}\n---\n:segment{block:$block} | order by elapsed asc`,
      jumpTarget: 'dashboard',
      jumpLabel: 'Try Live $Tokens',
    },
    {
      id: 'session-promote-join',
      title: '6. Direct :session → aggregate promotion & where :session{…} joins',
      targetFiles:
        'packages/ui/src/composer/QueryObjectBuilder.tsx · packages/wql/src/QueryService.ts (runJoined)',
      problemToday:
        'Promote list to chart turns :session{result:X, plane:segment} into invalid where :note{result:X, plane:segment} and runJoined ignores resultIds.',
      proposedWql: `sum:totalVolume{result:${fixture.resultId}} by {effort}`,
      jumpTarget: 'dashboard',
      jumpLabel: 'Open Bound Dashboard',
    },
    {
      id: 'unit-dimensions',
      title: '7. Enforce metric-dimension unit integrity in resolveOutputUnit',
      targetFiles: 'packages/wql/src/units.ts · QueryService.ts (resolveOutputUnit)',
      problemToday:
        'preferredUnit (kg/lb) leaks onto unitless ratios and scores (rendering Adherence: 0.883 kg, Avg TIS: 563 s, Total reps: 3,470 count).',
      proposedWql: `calc.adherence -> % | tis -> pts | sessionLoad -> AU | totalVolume -> ${comparisonConfig.measure === 'volume' ? 'lb' : 'kg/lb'}`,
      jumpTarget: 'dashboard',
      jumpLabel: 'Verify Units on Board',
    },
    {
      id: 'summary-projection',
      title: '8. Authoritative RowsRun.summary & view: summary in QueryBlockObject',
      targetFiles:
        'packages/wql/src/queryBlockCodec.ts · QueryService.ts (RowsRun) · QueryBlockView.tsx',
      problemToday:
        'QueryViewKind lacks summary, forcing notes, FullscreenTimer, and /sessions to compute divergent totals and dump 16-col tables into notes.',
      proposedWql: generateExplicitSummaryFence(fixture.resultId),
      jumpTarget: 'note',
      jumpLabel: 'Inspect Injected Summary',
    },
  ];

  return (
    <div className="space-y-4" data-testid={TEST_IDS.PROTO_RESULTS.WQL_EXTENSIONS_VIEW}>
      <div className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5 space-y-1">
        <h2 className="text-lg font-bold text-foreground">
          WQL Engine Extensions Needed for Coherent Results &amp; Comparisons
        </h2>
        <p className="text-xs text-muted-foreground max-w-[75ch]">
          Each contract diff below updates dynamically with the active workout fixture (
          <strong className="text-foreground">{fixture.shortLabel}</strong>) and your current{' '}
          <strong className="text-foreground">Add to Dashboard</strong> comparison selections.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {gaps.map((gap) => (
          <article
            key={gap.id}
            data-testid={`proto-wql-gap-${gap.id}`}
            className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{gap.title}</h3>
              <div className="flex max-w-full items-start gap-1.5 rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                <Code2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{gap.targetFiles}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Today: </strong>
                {gap.problemToday}
              </p>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/35 p-2.5 font-mono text-xs text-foreground leading-relaxed">
                {gap.proposedWql}
              </pre>
            </div>

            <div className="flex justify-end border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => onJumpToView(gap.jumpTarget)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-primary hover:bg-muted transition-colors',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                )}
              >
                <span>{gap.jumpLabel}</span>
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
