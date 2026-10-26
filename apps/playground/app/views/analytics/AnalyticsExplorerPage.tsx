/**
 * AnalyticsExplorerPage (`/analytics/explorer`) — WQL workbench over the
 * analytics store, rebuilt around a single command bar (issue #897,
 * prototype variant C): examples combo + shared `WqlComposer` organism
 * (decisions #828/#836) + Run in one row, with the metric/filter vocabulary
 * demoted to a compact meta line beneath it (the old `ExplorerSidebar` is
 * retired from this page). One surface per concern: the result renders in a
 * single full-bleed `WidgetFrame`, pipeline anatomy (`ParsedQueryChips` +
 * `PipelineAnatomy`) hides behind an "Inspect pipeline" disclosure, and the
 * calculation's records list behind a "Records" disclosure — no stacked
 * bordered panels.
 *
 * Data flow is unchanged: clause state round-trips through `?q=` via
 * `useExplorerQueryState` (the router-native #833 pattern), with the
 * run-on-submit split — the live draft drives the meta-line validity
 * indicator, while only the submitted snapshot gates the run effect.
 *
 * Run dispatch is unchanged: find queries go through `queryService.runFind`,
 * analytics queries through `queryService.runQuery` with range/unit options
 * (calc.* metrics resolve directly against the unified event store).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CalendarIcon, CheckCircle2, ChevronDown, ChevronRight, Save } from 'lucide-react';
import { queryService } from '@/services/queryService';
import { parseQuery, serialize, isAggregateQuery, isFindQuery, type QueryResult, type TagFilter } from '@bitcobblers/wod-wiki-engine';
import { StickyPageHeader, StickyGroupHeader, useStickyBoundaryOffset } from '@/panels/page-shells';
import { searchEntries } from '../../lib/entrySearch';
import { groupEntriesByDimension } from '../../lib/entryGrouping';
import { formatDateHeader } from '../../lib/dateFormat';
import { LibraryRow } from '../library/LibraryRow';
import { QueryToDashboardDialog } from './QueryToDashboardDialog';
import { AvailableFieldsPanel } from './AvailableFieldsPanel';
import { fieldCatalog, startFieldCatalogBackfill } from '../../services/fieldCatalog';
import type { Entry } from '../../lib/entryMapper';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import {
  QueryValue,
  useChartShape,
  WidgetFrame,
  WqlBars,
  WqlEmptyState,
  WqlTimeseries,
  useAnalyticsUnitPreference,
  getEffectiveAnalyticsUnit,
} from '@bitcobblers/wod-wiki-ui';
import {
  ParsedQueryChips,
  PipelineAnatomy,
  RawPointsTable,
  windowLabel,
} from '@/components/organisms/analytics';
import { setMetricQuery } from '../../lib/wqlEdits';
import { useRouteWqlConfig } from '../../lib/routeWqlConfig';
import { DASHBOARDS_SURFACE } from '../../lib/queryConfigSurfaces';
import { QuerySettingsDialog } from '../../components/organisms/wql/QuerySettingsDialog';
import { WqlComposer } from '@bitcobblers/wod-wiki-ui';
import { EXAMPLE_QUERIES } from '@/utils/analytics/explorerQueries';
import { useExplorerVocabulary } from '@/utils/analytics/useExplorerVocabulary';
import { useExplorerQueryState } from '../../hooks/useExplorerQueryState';
import { useNav } from '../../nav/NavContext';
import type { NavItemL3 } from '../../nav/navTypes';
import { ExplorerOptionsMenu } from './ExplorerOptionsMenu';
import { SampleDataPrompt } from './SampleDataPrompt';
import { cn } from '@/lib/utils';

/** The /dashboards landing actually searches dashboards: `:dashboard{}` is
 *  the note-head alias injecting type:dashboard (engine side), so the
 *  landing renders dashboard notes through the shared find pipeline while
 *  the full WQL workbench (aggregates, examples, Save-to-dashboard) stays
 *  available above it. */
const DASHBOARDS_LANDING_QUERY = ':dashboard{}';

const DAY = 86_400_000;

/** WQL grammar hint shown as the composer input's placeholder (issue #897 —
 * syntax discoverable without taking up visual space). */
const WQL_GRAMMAR_PLACEHOLDER = 'agg:metric{filters} by {dims} .rollup(period)';

/** Filter keys the note store understands — the only calculation filters
 * that can derive a records query truthfully. Effort/discipline/intensity
 * are fact-row tags, not note fields; carrying them into a find would
 * silently not filter. */
const NOTE_FILTER_KEYS = new Set(['tags', 'notebook', 'text', 'type', 'has']);

/** The find query's scope label — folded into the `source:` filter (C2). */
function sourceFilterLabel(filters: TagFilter[]): string | null {
  const src = filters.find(f => f.key === 'source' && !f.negate);
  return src ? src.values.map(v => v.value).join('|') : null;
}

/** The date-grouped records stream — shared by the find-result view and the
 * calculation's records section. Group wrappers carry the shared stream-group
 * DOM ids (`date-group-<key>`) so the L3 rail can scroll to them; `idPrefix`
 * keeps the records disclosure's ids distinct while both lists are mounted. */
function GroupedEntryList({ entries, stickyOffset, idPrefix = '' }: { entries: Entry[]; stickyOffset: number; idPrefix?: string }) {
  return (
    <div className="-mx-4">
      {groupEntriesByDimension(entries, 'date').map(group => (
        <div key={group.id} id={`${idPrefix}${group.id}`} className="flex flex-col">
          <StickyGroupHeader
            top={stickyOffset}
            icon={<CalendarIcon className="size-3 shrink-0 text-muted-foreground" />}
            label={group.label}
            meta={<span data-testid="library-group-count" className="font-bold tabular-nums">{group.entries.length}</span>}
          />
          <div className="flex flex-col gap-0 pb-1">
            {group.entries.map(entry => (
              <LibraryRow
                key={entry.block ? `${entry.id}#${entry.block.blockId}` : entry.id}
                entry={entry}
                dateLabel={entry.date ? formatDateHeader(entry.date) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Canonical WQL comparison: parseable strings compare through the
 * serializer's fixed point (so a deep-linked `sum:totalVolume` matches the
 * canonical `sum:totalVolume{}` draft); anything else falls back to raw
 * equality. */
function sameQuery(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = parseQuery(a);
  const pb = parseQuery(b);
  return !pa.error && !pb.error && serialize(pa) === serialize(pb);
}

export interface AnalyticsExplorerPageProps {
  /**
   * Header action bar, injected by the composition root (App.tsx) as a
   * fully-wired `PageActions`. Optional so the page stays renderable in
   * isolation (tests, stories) without app-wide context providers.
   */
  actions?: ReactNode;
}

export function AnalyticsExplorerPage({ actions }: AnalyticsExplorerPageProps) {
  // Ticket 14/15: ensure the field catalog is populated (resumable no-op
  // when complete) before discovery reads it.
  useEffect(() => {
    startFieldCatalogBackfill();
  }, []);
  // The /dashboards landing query — the annotation-9 dashboard search. A
  // stored Route WQL Config default (the page's own query settings, legacy
  // /dashboard key aliased) overrides it; deep links (?q=) still win.
  const routeConfig = useRouteWqlConfig('/dashboards')
  const { draft, setDraft, submitted, submit, weeks: activeWeeks, setWeeks } =
    useExplorerQueryState({ defaultQuery: routeConfig.defaultWql ?? DASHBOARDS_LANDING_QUERY, runOnLanding: true });
  const { unit: preferredUnit } = useAnalyticsUnitPreference();
  const { forced: unitForced } = useMemo(
    () => getEffectiveAnalyticsUnit(submitted, preferredUnit),
    [submitted, preferredUnit],
  );
  const [result, setResult] = useState<QueryResult | undefined>(undefined);
  const [entries, setEntries] = useState<Entry[] | undefined>(undefined);
  const [records, setRecords] = useState<Entry[] | undefined>(undefined);
  const [efforts, setEfforts] = useState<IEffort[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  // The page's own query settings — the landing default and the scope
  // favorites, edited where the query lives.
  const [querySettingsOpen, setQuerySettingsOpen] = useState(false);
  // The composer's own synchronous verdict: parse errors AND transient
  // editor states (an unresolved kind/target pivot confirm) — Save must
  // honor both, not just a fresh parse of the draft text.
  const [composerValid, setComposerValid] = useState(true);
  const vocabulary = useExplorerVocabulary();
  // Route-configured type favorites (the /dashboards surface) prioritize the
  // composer's picker rows without excluding anything.
  const preferredChoices = routeConfig.typeOptions;
  const liveParsed = useMemo(() => parseQuery(draft), [draft]);
  const scopeLabel = sourceFilterLabel(isFindQuery(liveParsed) ? liveParsed.filters : []);
  const findWindowLabel = isFindQuery(liveParsed) && liveParsed.window ? windowLabel(liveParsed.window) : null;
  const stickyOffset = useStickyBoundaryOffset(104);

  // The subset for the Query→Dashboard flow: a find draft IS the subset; an
  // analytics draft contributes its where-join find half when present.
  const draftValid = !liveParsed.error && draft.trim().length > 0;
  const saveReady = draftValid && composerValid;
  const subsetQuery = useMemo(() => {
    if (!draftValid) return null;
    if (isFindQuery(liveParsed)) return draft;
    // The join half comes from the parsed AST, not string surgery — a quoted
    // text filter containing 'where find:…' must not masquerade as the join.
    if (isAggregateQuery(liveParsed) && liveParsed.join) {
      const j = liveParsed.join;
      return serialize({
        family: 'find',
        raw: '',
        target: j.target,
        filters: j.filters,
        window: j.last ? { kind: 'relative', size: j.last.size, unit: j.last.unit } : undefined,
      });
    }
    return null;
  }, [liveParsed, draft, draftValid]);

  // The records behind a calculation: the explicit `where find:…` subset
  // wins verbatim; otherwise the calculation's note-compatible filters plus
  // the active range derive the subset. Fact-row-only filters (effort,
  // discipline, intensity) never leak in — they'd silently not filter notes.
  const recordsWql = useMemo(() => {
    if (!submitted) return null;
    const p = parseQuery(submitted);
    if (isFindQuery(p) || p.error) return null;
    if (p.join) {
      const jf = p.join;
      return serialize({
        family: 'find', raw: '', target: jf.target, filters: jf.filters,
        window: jf.last ? { kind: 'relative', size: jf.last.size, unit: jf.last.unit } : undefined,
      });
    }
    const compatible = p.filters.filter(f => NOTE_FILTER_KEYS.has(f.key) && !f.negate);
    return serialize({
      family: 'find', raw: '', target: 'note', filters: compatible,
      window: { kind: 'relative', size: activeWeeks, unit: 'w' },
    });
  }, [submitted, activeWeeks]);

  useEffect(() => {
    if (!recordsWql) {
      setRecords(undefined);
      return;
    }
    let cancelled = false;
    searchEntries(recordsWql)
      .then((rows) => { if (!cancelled) setRecords(rows); })
      .catch(() => { if (!cancelled) setRecords(undefined); });
    return () => { cancelled = true; };
  }, [recordsWql]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [anatomyOpen, setAnatomyOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!submitted) {
      setResult(undefined);
      setEntries(undefined);
      setEfforts(undefined);
      setLoading(false);
      return;
    }

    setLoading(true);
    const parsed = parseQuery(submitted);

    if (isFindQuery(parsed)) {
      // Content query — the shared WQL → Entry[] pipeline (same rows as the
      // Library, #833); effort targets come from the engine's effort plane.
      setResult(undefined);
      if (parsed.target === 'effort') {
        queryService.runFind(parsed)
          .then((r) => { if (!cancelled) { setEfforts(r.efforts ?? []); setEntries([]); } })
          .catch(() => { if (!cancelled) { setEfforts(undefined); setEntries(undefined); } })
          .finally(() => { if (!cancelled) setLoading(false); });
      } else {
        searchEntries(submitted)
          .then((rows) => { if (!cancelled) { setEntries(rows); setEfforts([]); } })
          .catch(() => { if (!cancelled) { setEntries(undefined); setEfforts(undefined); } })
          .finally(() => { if (!cancelled) setLoading(false); });
      }
    } else {
      // Analytics query — resolves directly against the unified event store.
      setEntries(undefined);
      setEfforts(undefined);
      const now = Date.now();
      const rangeStart = now - activeWeeks * 7 * DAY;
      queryService.runQuery(submitted, { rangeStart, rangeEnd: now, preferredUnit })
        .then((r) => { if (!cancelled) setResult(r); })
        .catch(() => { if (!cancelled) setResult(undefined); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => {
      cancelled = true;
    };
  }, [submitted, activeWeeks, refreshKey, preferredUnit]);

  const shape = useChartShape(result);

  /** Metric chip click: pivot to the metrics plane, set the metric, run. */
  const selectMetric = (metric: string) => {
    const next = setMetricQuery(draft, metric);
    setDraft(next);
    submit(next);
  };

  // L3 group index: the find result's date groups, using the same shared
  // stream-group ids the DOM carries (GroupedEntryList anchors). Cleared when
  // the result leaves or the page unmounts. Aggregate results have no groups
  // and publish an empty index.
  const { setL3Items } = useNav();
  const findGroups = useMemo(
    () => (entries !== undefined && entries.length > 0 ? groupEntriesByDimension(entries, 'date') : []),
    [entries],
  );
  useEffect(() => {
    if (findGroups.length === 0) {
      setL3Items([]);
      return;
    }
    const groupLinks: NavItemL3[] = findGroups.map((g) => ({
      id: g.id,
      label: g.label,
      level: 3,
      action: { type: 'scroll', sectionId: g.id },
    }));
    setL3Items(groupLinks);
    return () => setL3Items([]);
  }, [findGroups, setL3Items]);

  const exampleQuestion = EXAMPLE_QUERIES.find((e) => e.query === submitted)?.question ?? 'custom query';

  // Post-run telemetry shows only while the result answers the current draft.
  // The second disjunct covers deep links the clause model cannot restore
  // (e.g. negated !tags:x filters — the legacy visual composer could emit
  // them): the composer falls back to defaults, but the result still answers
  // the submitted URL query until the user edits the draft.
  const restoredDraft = useMemo(() => {
    const p = parseQuery(submitted);
    return p.error ? submitted : serialize(p);
  }, [submitted]);
  const resultIsCurrent =
    result !== undefined &&
    (sameQuery(result.parsed.raw, draft) ||
      (result.parsed.raw === submitted && draft === restoredDraft));

  // The empty result surface carries its own "Inspect pipeline" toggle next
  // to the sample-data prompt (issue #897 — both next steps equally visible);
  // with data on screen the same toggle lives in the controls row below the
  // frame, so exactly one `inspect-pipeline` control is rendered at a time.
  const resultEmpty = !submitted || (!loading && shape.kind === 'empty');

  const inspectPipelineButton = (
    <button
      type="button"
      data-testid="inspect-pipeline"
      aria-expanded={anatomyOpen}
      onClick={() => setAnatomyOpen((o) => !o)}
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {anatomyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      Inspect pipeline
    </button>
  );

  return (
    <div className="bg-card flex flex-col flex-1">
      <AvailableFieldsPanel catalog={fieldCatalog} />
      <QuerySettingsDialog
        surface={DASHBOARDS_SURFACE}
        open={querySettingsOpen}
        onOpenChange={setQuerySettingsOpen}
      />
      <StickyPageHeader
        title="Metric Explorer"
        actions={
          <div className="flex items-center gap-3">
            <ExplorerOptionsMenu
              weeks={activeWeeks}
              onWeeks={setWeeks}
              unitForced={unitForced}
              onOpenQuerySettings={() => setQuerySettingsOpen(true)}
            />
            {actions}
          </div>
        }
      />

      <div className="flex flex-col min-h-0 p-4">
        {/* Examples live in the dashboards L2 panel — the bar is just the
            composer (Run in its custom slot). */}
        <div className="min-w-[280px]">
          <WqlComposer
            query={draft}
            onQueryChange={setDraft}
            onValidationChange={(v) => setComposerValid(v.valid)}
            onSubmit={(wql) => submit(wql)}
            actionLabel="Run"
            preferredChoices={preferredChoices}
            showDiagnostics={false}
            placeholder={WQL_GRAMMAR_PLACEHOLDER}
            diagnosticsActions={
              <button
                type="button"
                data-testid="save-query"
                disabled={!saveReady}
                onClick={() => setDashOpen(true)}
                title="Save this query — decide where it lands (dashboard, …)"
                className="flex min-h-12 items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-3 text-[11px] font-semibold hover:bg-primary/10 transition-all shrink-0 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Save size={12} /> Save
              </button>
            }
          />
        </div>

        {/* Meta line: quiet draft-validity indicator + the metric/filter
            vocabulary chips that replaced the sidebar (issue #897). */}
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1" data-testid="explorer-meta">
          {draft.trim().length > 0 && (
            <span data-testid="draft-validity" className="mr-1 inline-flex items-center gap-1 text-[11px]">
              {liveParsed.error ? (
                <span className="inline-flex items-center gap-1 font-mono text-red-600">
                  <AlertCircle size={11} className="shrink-0" /> {liveParsed.error}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-green-600">
                  <CheckCircle2 size={11} className="shrink-0" /> valid
                </span>
              )}
            </span>
          )}
          {vocabulary.metricKeys.map((key) => (
            <button
              key={key}
              type="button"
              disabled={!saveReady || !isAggregateQuery(liveParsed)}
              title={
                draftValid && !isAggregateQuery(liveParsed)
                  ? 'Metric shortcuts apply to measure queries — pivot the kind through the composer first'
                  : undefined
              }
              onClick={() => selectMetric(key)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-mono transition-colors disabled:opacity-40 disabled:hover:bg-transparent',
                draft.includes(key)
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {key}
            </button>
          ))}
          <span className="mx-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
            filters
          </span>
          {vocabulary.tagKeys.map((key) => (
            <span
              key={key}
              className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-mono text-muted-foreground/70"
            >
              {key}
            </span>
          ))}
        </div>

        <section className="min-w-0">
          {isFindQuery(liveParsed) ? (
            /* ── Find query result: the Library's date-grouped stream ── */
            <div className="mt-3">
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  Find {liveParsed.target}
                  {scopeLabel && <span className="ml-1">in {scopeLabel}</span>}
                  {findWindowLabel && <span className="ml-1">{findWindowLabel}</span>}
                </div>
                {liveParsed.error ? (
                  <div className="text-sm text-destructive font-mono">{liveParsed.error}</div>
                ) : loading ? (
                  <div className="text-sm text-muted-foreground">Searching…</div>
                ) : efforts && efforts.length > 0 ? (
                  <div className="flex flex-col divide-y divide-border/50">
                    {efforts.map(effort => (
                      <div key={effort.slug} className="flex items-center gap-3 py-2.5">
                        <span className="text-sm font-medium text-foreground">{effort.label}</span>
                        <span className="text-xs text-muted-foreground font-mono">{effort.slug}</span>
                        {effort.baseAttributes.discipline && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {effort.baseAttributes.discipline}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : entries && entries.length > 0 ? (
                  <GroupedEntryList entries={entries} stickyOffset={stickyOffset} />
                ) : (
                  <div className="text-sm text-muted-foreground">No {liveParsed.target}s found.</div>
                )}
              </div>
            </div>
          ) : (
            /* ── Analytics query result: one full-bleed surface, diagnostics
               and records behind on-demand disclosures (issue #897) ── */
            <>
              <div className="mt-3">
                <SampleDataPrompt layout="banner" refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
              </div>

              {liveParsed.error && submitted && (
                <div
                  data-testid="explorer-results-stale"
                  className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700"
                >
                  Stale — showing the last run's results; the current draft is invalid and not applied.
                </div>
              )}

              <div className="mt-3">
                <WidgetFrame title="Query result" question={exampleQuestion} query={submitted || '(empty)'}>
                  <div className="h-64">
                    {!submitted ? (
                      <div className="h-full flex flex-col items-center justify-center gap-3">
                        <div className="text-sm text-muted-foreground">
                          Enter a WQL query or choose an example to explore your data.
                        </div>
                        {inspectPipelineButton}
                      </div>
                    ) : loading ? (
                      <WqlEmptyState result={undefined} />
                    ) : shape.kind === 'error' ? (
                      <div className="h-full flex items-center justify-center text-sm text-destructive font-mono px-4 text-center">
                        {shape.message}
                      </div>
                    ) : shape.kind === 'empty' ? (
                      <div className="h-full flex flex-wrap items-center justify-center gap-6">
                        <SampleDataPrompt result={result} refreshKey={refreshKey} onChanged={() => setRefreshKey(k => k + 1)} />
                        {inspectPipelineButton}
                      </div>
                    ) : shape.kind === 'scalar' ? (
                      <QueryValue result={result!} label={`${result!.parsed.agg}(${result!.parsed.metric})`} />
                    ) : shape.kind === 'timeseries' ? (
                      <WqlTimeseries result={result!} />
                    ) : (
                      <WqlBars result={result!} />
                    )}
                  </div>
                </WidgetFrame>
              </div>

              {submitted && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* While loading, no Inspect toggle renders anywhere — it
                      appears in one stable spot once the run settles (in the
                      empty state, or here when data is on screen). */}
                  {!loading && !resultEmpty && inspectPipelineButton}
                  {recordsWql && records !== undefined && (
                    <button
                      type="button"
                      data-testid="records-toggle"
                      aria-expanded={recordsOpen}
                      onClick={() => setRecordsOpen((o) => !o)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {recordsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Records in this calculation
                      <span className="text-[10px] font-bold text-muted-foreground/60 tabular-nums">
                        {records.length}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {anatomyOpen && (
                <div className="mt-3" data-testid="pipeline-anatomy">
                  {submitted ? (
                    <>
                      <ParsedQueryChips parsed={resultIsCurrent ? result.parsed : liveParsed} />
                      {resultIsCurrent && <PipelineAnatomy result={result} />}
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">Submit a query to see its anatomy.</div>
                  )}
                </div>
              )}

              {recordsOpen && recordsWql && records !== undefined && (
                <div className="mt-3">
                  <code className="block mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground" data-testid="records-wql">
                    {recordsWql}
                  </code>
                  {records.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No records match this calculation.</div>
                  ) : (
                    <GroupedEntryList entries={records} stickyOffset={stickyOffset} idPrefix="records-" />
                  )}
                </div>
              )}

              {result && <RawPointsTable matched={result.matched} displayUnit={result.unit} />}
            </>
          )}
        </section>
      </div>

      <QueryToDashboardDialog
        open={dashOpen}
        onOpenChange={setDashOpen}
        initialQuery={draft}
        subsetQuery={subsetQuery}
        rangeStart={Date.now() - activeWeeks * 7 * DAY}
        rangeEnd={Date.now()}
        preferredUnit={preferredUnit}
      />
    </div>
  );
}
