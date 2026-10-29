/**
 * Forms / Organisms / WqlComposer
 *
 * Renders the shared WqlComposer organism exported from @bitcobblers/wod-wiki-ui.
 *
 * Shared omni command bar — the WQL row activates a compact contextual writer
 * below the active segment. Arrows move through rendered options, Enter
 * selects an explicitly active option, Escape dismisses one level, and
 * Tab/Shift+Tab traverse segments. External commands use segmentEditRequest.
 * Run/Apply/Save actions consume the synchronously resolved draft.
 *
 * Stories — interaction model:
 *  1. Default — uncontrolled, seeded from an initial WQL string
 *  2. Controlled — WQL string + validation / AST surfaced live
 *  3. CustomSlots — consumer-supplied extension content inside the bar
 *  4. RegisteredSlot — ComposerRegistry date-range picker plugin (issue #830)
 *  5. LiveDiagnostics — diagnostics strip with debounced stage counts (issue #832)
 *  6. AnalyticsComposition — metrics-plane pivot with aggregate chips (issue #838)
 *
 * Stories — host configurations (one per production embedding; the review
 * surface for "the composer as used across the app". Each mirrors the exact
 * prop configuration of its host, with live stage counts over the seeded
 * corpus journals via the gallery's inMemoryEventStore → QueryService):
 *  7. HostLibraryPage — controlled + execute + hidden where-stored clause (/library)
 *  8. HostEffortsCatalog — effort plane, hidden where-stored clause (/efforts)
 *  9. HostAnalyticsExplorer — run-on-submit split, diagnostics off, composer-owned Run
 * 10. HostQueryToDashboard — uncontrolled seed + key remount per subset
 * 11. HostDashboardWidgetEditor — controlled editor whose validity gates Save
 * 12. HostCommandPalette — per-open remount, palette wiring
 * 13. HostQueryInspectorModal — the ui-package modal embedder (QueryBlockView)
 * 14. HostWorkbenchFilter — the minimal query/onQueryChange embedding
 */

import React, { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  WqlComposer,
  WqlQueryInspectorModal,
  composerRegistry,
  dateRangeSlot,
  type QueryExecutor,
  type WqlExecutor,
  type WqlValidationState,
} from '@bitcobblers/wod-wiki-ui';
import type { AnyParsedQuery, FindQueryResult, QueryResult } from '@bitcobblers/wod-wiki-engine';
import { isFindQuery } from '@bitcobblers/wod-wiki-engine';

import { JOURNALS, buildServiceForJournal } from './gallery/journals';

const meta: Meta<typeof WqlComposer> = {
  title: 'Gallery/WQL Composer',
  component: WqlComposer,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof WqlComposer>;

// ── Live corpus executor ─────────────────────────────────────────────────────
// The gallery's round trip (journal fixtures → inMemoryEventStore →
// QueryService) drives stage counts, so every host story shows real numbers.
const journalService = buildServiceForJournal(JOURNALS.crossfit);

const anchoredExecutor: QueryExecutor = {
  runQuery: (query, options) => journalService.runQuery(query, options),
  runFind: (parsed, options) => journalService.runFind(parsed, options),
  runRows: (parsed, options) => journalService.runRows(parsed, options),
};

const liveExecute: WqlExecutor = async (ast: AnyParsedQuery) => {
  if (isFindQuery(ast)) return anchoredExecutor.runFind(ast);
  return journalService.runQuery(ast.raw);
};

// ── Interaction model ────────────────────────────────────────────────────────

export const Default: Story = {
  render: () => (
    <div className="max-w-3xl">
      <WqlComposer />
    </div>
  ),
};

const ControlledHarness: React.FC = () => {
  const [wql, setWql] = useState(':note last 2w');
  const [validation, setValidation] = useState<WqlValidationState>({ valid: true });
  const [ast, setAst] = useState<AnyParsedQuery | null>(null);

  return (
    <div className="max-w-3xl space-y-3">
      <WqlComposer
        query={wql}
        onQueryChange={setWql}
        onValidationChange={setValidation}
        onAstChange={setAst}
      />
      <div className="font-mono text-xs break-all">
        <span className={validation.valid ? 'text-signal-positive' : 'text-signal-negative'}>
          {validation.valid ? 'valid' : `error: ${validation.error}`}
        </span>
        {' — '}
        {wql}
      </div>
      <pre className="text-[10px] text-muted-foreground overflow-x-auto">
        {JSON.stringify(ast, null, 2)}
      </pre>
    </div>
  );
};

export const Controlled: Story = {
  render: () => <ControlledHarness />,
};

export const CustomSlots: Story = {
  render: () => (
    <div className="max-w-3xl">
      <WqlComposer
        customSlots={
          <button
            type="button"
            className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Run ▶
          </button>
        }
      />
    </div>
  ),
};

const RegisteredSlotHarness: React.FC = () => {
  const [wql, setWql] = useState('');
  const [validation, setValidation] = useState<WqlValidationState>({ valid: true });

  // Pages register their custom slots during initialization; unregister on teardown.
  useEffect(() => composerRegistry.registerSlot(dateRangeSlot), []);

  return (
    <div className="max-w-3xl space-y-3">
      <WqlComposer onQueryChange={setWql} onValidationChange={setValidation} />
      <div className="font-mono text-xs break-all">
        <span className={validation.valid ? 'text-signal-positive' : 'text-signal-negative'}>
          {validation.valid ? 'valid' : `error: ${validation.error}`}
        </span>
        {' — '}
        {wql}
      </div>
      <p className="text-[10px] text-muted-foreground">
        The “Date Range” entry in Add Filter comes from the ComposerRegistry demo
        slot (dateRangeSlot). Pick start + end, Set Range — the clause serializes
        the range and the composer emits a parseable `daterange:` fragment.
      </p>
    </div>
  );
};

export const RegisteredSlot: Story = {
  render: () => <RegisteredSlotHarness />,
};

const LiveDiagnosticsHarness: React.FC = () => {
  // Deterministic stand-in for queryService: counts scale with the number of
  // active filter clauses so edits visibly move the numbers.
  const execute: WqlExecutor = async (ast: AnyParsedQuery) => {
    if (isFindQuery(ast)) {
      return {
        parsed: ast,
        notes: [],
        blocks: [],
        stages: { selected: 128, matched: Math.max(0, 128 - ast.filters.length * 37) },
      } as FindQueryResult
    }
    return {
      parsed: ast as QueryResult['parsed'],
      series: [],
      stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
      matched: [],
    }
  }

  return (
    <div className="max-w-3xl space-y-2">
      <WqlComposer execute={execute} />
      <p className="text-[10px] text-muted-foreground">
        The strip under the bar re-parses on every clause change: green/red
        validity badge (red names the offending clause), AST summary
        (target · window · join), and debounced (150ms) matched/selected
        stage counts. Type “garbage” into a Metric Join slot to see the error
        attribution; add Tag filters to move the counts.
      </p>
    </div>
  );
};

export const LiveDiagnostics: Story = {
  render: () => <LiveDiagnosticsHarness />,
};

const AnalyticsCompositionHarness: React.FC = () => {
  const [wql, setWql] = useState('sum:totalVolume{} by {week}');

  const execute: WqlExecutor = async (ast: AnyParsedQuery) => {
    return {
      parsed: ast as QueryResult['parsed'],
      series: [],
      stages: { selected: 12, buckets: 4, aggregated: 4, groups: 2 },
      matched: [],
    };
  };

  return (
    <div className="max-w-3xl space-y-2">
      <WqlComposer query={wql} onQueryChange={setWql} execute={execute} />
      <p className="text-[10px] text-muted-foreground">
        Analytics composition (issue #838): the Kind control pivots to the
        Measure plane, revealing the aggregate head (agg · metric · groupby ·
        rollup). The diagnostics strip shows aggregate chips and the aggregate
        stage counts (selected · buckets · aggregated · groups).
      </p>
    </div>
  );
};

export const AnalyticsComposition: Story = {
  render: () => <AnalyticsCompositionHarness />,
};

// ── Host configurations ──────────────────────────────────────────────────────
// One story per production embedding, mirroring the exact prop configuration
// of the host. Captions name the host file; the composer props are the point.

/** Canonical Where-stored scopes (WQL_SOURCE_VALUES); "all" is no scope
 *  filter at all — the bare `:note` head. */
const LIBRARY_SCOPES = ['journal', 'feeds', 'guides'] as const;
type LibraryScope = (typeof LIBRARY_SCOPES)[number] | 'all';

/**
 * HostLibraryPage — apps/playground/app/views/stream/QueriableStreamView.tsx
 * (`/library`): controlled composer + live `execute`, with the Where-stored
 * scope clause kept in the query model but hidden — the scope picker above
 * the bar owns its UI and re-writes the `source:` filter. "All" emits no
 * source filter; scopes are the canonical WQL_SOURCE_VALUES storage
 * locations (never plural-noun targets).
 */
const LibraryHarness: React.FC = () => {
  const [wql, setWql] = useState(':note last 2w');
  const [scope, setScope] = useState<LibraryScope>('all');

  const pickScope = (next: LibraryScope) => {
    setScope(next);
    const window = wql.match(/last \S+/)?.[0] ?? '';
    const filters = next === 'all' ? '' : `{source:${next}}`;
    setWql(`:note${window ? ` ${window}` : ''}`);
  };

  return (
    <div className="max-w-3xl space-y-2">
      <div className="flex gap-1">
        {(['all', ...LIBRARY_SCOPES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => pickScope(s)}
            className={
              'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
              (s === scope
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground')
            }
          >
            {s}
          </button>
        ))}
      </div>
      <WqlComposer
        query={wql}
        onQueryChange={setWql}
        execute={liveExecute}
        hiddenClauseTypes={['source']}
      />
      <p className="text-[10px] text-muted-foreground">
        Mirrors the library stream: the scope picker owns the Where-stored
        clause (kept in the model, hidden from the chip row); edits flow back
        through onQueryChange and stage counts run live over the seeded corpus.
      </p>
    </div>
  );
};

export const HostLibraryPage: Story = {
  render: () => <LibraryHarness />,
};

/**
 * HostEffortsCatalog — apps/playground/app/views/stream/QueriableStreamView.tsx
 * (`/efforts`): same shape as the library but on the effort plane —
 * `:effort{…}`, with text/discipline/intensity/origin filters
 * applied engine-side (QueryService.runFindEffort vocabulary).
 */
const EffortsHarness: React.FC = () => {
  const [wql, setWql] = useState(':effort');

  return (
    <div className="max-w-3xl space-y-2">
      <WqlComposer
        query={wql}
        onQueryChange={setWql}
        execute={liveExecute}
        hiddenClauseTypes={['source']}
      />
      <p className="text-[10px] text-muted-foreground">
        Mirrors the efforts stream: the effort find plane over the bundled
        registry. Try the Add Filter → Intensity / Discipline entries — counts
        move without any host-side filtering.
      </p>
    </div>
  );
};

export const HostEffortsCatalog: Story = {
  render: () => <EffortsHarness />,
};

const EXPLORER_EXAMPLES = [
  'sum:totalVolume{} by {week}',
  'sum:tis{} by {discipline}',
  'avg:heartRate{} by {day}',
];

/**
 * HostAnalyticsExplorer — apps/playground/app/views/analytics/
 * AnalyticsExplorerPage.tsx (`/analytics/explorer`): the run-on-submit
 * split. The composer only reports the draft (`query`/`onQueryChange`);
 * execution happens on Enter (`onSubmit`) or the composer-owned Run button
 * (`actionLabel`) — both receive the resolved valid draft on the first
 * action; the strip is suppressed (`showDiagnostics={false}`) in favor of
 * the page's meta line, and the Save action rides diagnosticsActions.
 */
const ExplorerHarness: React.FC = () => {
  const [draft, setDraft] = useState(EXPLORER_EXAMPLES[0]);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [valid, setValid] = useState(true);

  return (
    <div className="max-w-3xl space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Examples</span>
        {EXPLORER_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDraft(ex)}
            className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>
      <WqlComposer
        query={draft}
        onQueryChange={setDraft}
        onValidationChange={(s) => setValid(s.valid)}
        onSubmit={(wql) => setLastRun(wql)}
        actionLabel="Run"
        showDiagnostics={false}
        placeholder="agg:metric{filters} by {dims} .rollup(period)"
        diagnosticsActions={
          <button
            type="button"
            disabled={!valid}
            title="Save this query — decide where it lands (dashboard, …)"
            className="flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-3 py-1 text-[11px] font-semibold hover:bg-primary/10 transition-all shrink-0 disabled:opacity-40"
          >
            Save
          </button>
        }
      />
      <div className="font-mono text-[10px] text-muted-foreground">
        last run: {lastRun ?? '—'}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Mirrors AnalyticsExplorerPage: Run and Enter submit the current
        resolved draft immediately — no debounce between typing and the first
        action, and invalid drafts never run. Save is disabled while the draft
        is invalid.
      </p>
    </div>
  );
};

export const HostAnalyticsExplorer: Story = {
  render: () => <ExplorerHarness />,
};

const DASHBOARD_SUBSETS = [
  { label: 'whole store', seed: 'sum:totalVolume{} by {week}' },
  { label: 'effort:fran', seed: 'sum:totalVolume{effort:fran} by {week}' },
];

/**
 * HostQueryToDashboard — apps/playground/app/views/analytics/
 * QueryToDashboardDialog.tsx (step 2, “Calculation — over the subset”):
 * uncontrolled usage. The seed query arrives from the parent (the store
 * subset picked in step 1) and a `key` on the seed remounts a fresh composer
 * rather than mutating clause state in place.
 */
const QueryToDashboardHarness: React.FC = () => {
  const [subset, setSubset] = useState(DASHBOARD_SUBSETS[0]);
  const [combined, setCombined] = useState('');

  return (
    <div className="max-w-3xl space-y-2">
      <div className="flex gap-1.5">
        {DASHBOARD_SUBSETS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setSubset(s)}
            className={
              'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
              (s.label === subset.label
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground')
            }
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        2 · Calculation — over the subset
      </div>
      <WqlComposer
        key={subset.label}
        initialQuery={subset.seed}
        hiddenClauseTypes={['source']}
        onQueryChange={setCombined}
      />
      <div
        className="rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2 font-mono text-xs break-all"
        data-testid="story-combined-query"
      >
        {combined || subset.seed}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Mirrors QueryToDashboardDialog: switching subsets re-keys the composer
        — internal clause state rebuilds from the new seed; onQueryChange
        feeds the combined-query preview.
      </p>
    </div>
  );
};

export const HostQueryToDashboard: Story = {
  render: () => <QueryToDashboardHarness />,
};

/**
 * HostDashboardWidgetEditor — apps/playground/app/views/dashboards/
 * DashboardViewPage.tsx (inline widget query editor): controlled composer
 * whose validity gates the Save button, with live stage counts while editing.
 */
const WidgetEditorHarness: React.FC = () => {
  const [editWql, setEditWql] = useState('sum:totalVolume{} by {week}');
  const [isValid, setIsValid] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <div className="max-w-3xl space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Edit widget query
      </div>
      <WqlComposer
        query={editWql}
        onQueryChange={setEditWql}
        onValidationChange={(state) => setIsValid(state.valid)}
        execute={liveExecute}
      />
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
        {saved && (
          <span className="mr-auto font-mono text-[10px] text-signal-positive">saved: {saved}</span>
        )}
        <button
          type="button"
          onClick={() => setSaved(null)}
          className="px-4 py-2 text-xs font-semibold rounded-lg border border-border text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!isValid}
          onClick={() => setSaved(editWql)}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Mirrors DashboardViewPage: onValidationChange drives the save gate —
        type a broken query and Save disables; stage counts stay live.
      </p>
    </div>
  );
};

export const HostDashboardWidgetEditor: Story = {
  render: () => <WidgetEditorHarness />,
};

/**
 * HostCommandPalette — apps/playground/src/components/organisms/
 * command-palette/PaletteShell.tsx: the palette embeds the composer in its
 * dialog header — per-open remount (`key` on a request sequence), seed query
 * from the palette mode config, and configurable diagnostics/
 * customSlots/execute supplied by the opening command. No autoFocus: focus
 * starts on a non-input heading so mobile keyboards stay closed.
 */
const PaletteHarness: React.FC = () => {
  const [seq, setSeq] = useState(0);
  const [wql, setWql] = useState('');

  return (
    <div className="max-w-3xl space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSeq((n) => n + 1)}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Reopen palette
        </button>
        <span className="font-mono text-[10px] text-muted-foreground">open #{seq + 1}</span>
      </div>
      <div className="rounded-lg border border-zinc-200 px-3 py-2 shadow-sm dark:border-zinc-700">
        <WqlComposer
          key={seq}
          initialQuery=":note last 2w"
          onQueryChange={setWql}
          execute={liveExecute}
        />
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">{wql || '—'}</div>
      <p className="text-[10px] text-muted-foreground">
        Mirrors PaletteShell: each “open” re-keys the composer (fresh clause
        state from the seed); the dialog opens without forcing the keyboard.
      </p>
    </div>
  );
};

export const HostCommandPalette: Story = {
  render: () => <PaletteHarness />,
};

/**
 * HostQueryInspectorModal — packages/ui/src/blocks/WqlQueryInspectorModal.tsx
 * (opened from QueryBlockView's ```query fences): the ui-package embedder.
 * The modal owns the string state; Apply is validity-gated; live counts go
 * through the injected QueryExecutor (anchored here to the corpus).
 */
const InspectorModalHarness: React.FC = () => {
  const [open, setOpen] = useState(true);
  const [applied, setApplied] = useState<string | null>(null);

  return (
    <div className="max-w-3xl space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Edit block query
        </button>
        {applied && (
          <span className="font-mono text-[10px] text-signal-positive">applied: {applied}</span>
        )}
      </div>
      <WqlQueryInspectorModal
        isOpen={open}
        onClose={() => setOpen(false)}
        initialQuery=":note last 12w"
        onApply={(q) => {
          setApplied(q);
          setOpen(false);
        }}
        executor={anchoredExecutor}
      />
      <p className="text-[10px] text-muted-foreground">
        Mirrors WqlQueryInspectorModal over QueryBlockView: the composer lives
        inside the modal body; Cancel/Apply-to-Block close it and Apply is
        disabled while the query is invalid.
      </p>
    </div>
  );
};

export const HostQueryInspectorModal: Story = {
  render: () => <InspectorModalHarness />,
};

/**
 * HostWorkbenchFilter — apps/storybook/src/workbench/LanguageWorkbench.tsx
 * (session filter, line ~1039; per-segment widget composer, line ~1794): the
 * minimal embedding — just `query`/`onQueryChange`, defaults for everything
 * else.
 */
const WorkbenchFilterHarness: React.FC = () => {
  const [filterText, setFilterText] = useState('');

  return (
    <div className="max-w-3xl space-y-2">
      <div className="rounded-lg border border-border/70 bg-background/80 p-2 shadow-xs" data-testid="story-workbench-composer">
        <WqlComposer query={filterText} onQueryChange={setFilterText} />
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">{filterText || '—'}</div>
      <p className="text-[10px] text-muted-foreground">
        Mirrors LanguageWorkbench's two embeddings (session filter and widget
        segments): the default diagnostics strip stays on; the host only
        round-trips the WQL string.
      </p>
    </div>
  );
};

export const HostWorkbenchFilter: Story = {
  render: () => <WorkbenchFilterHarness />,
};
