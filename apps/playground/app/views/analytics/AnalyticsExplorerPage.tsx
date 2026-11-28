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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, BookOpen, CalendarIcon, CheckCircle2, ChevronDown, ChevronRight, Play, Save, SlidersHorizontal } from 'lucide-react';
import { queryService } from '@/services/queryService';
import { TEST_IDS } from '@/lib/testIds';
import { parseQuery, serialize, isAggregateQuery, isFindQuery, type QueryResult, type TagFilter } from '@bitcobblers/wod-wiki-engine';
import { StickyPageHeader, StickyGroupHeader, useStickyBoundaryOffset } from '@/panels/page-shells';
import { searchEntries } from '../../lib/entrySearch';
import { groupEntriesByDimension, parseGroupingDimensions } from '../../lib/entryGrouping';
import { formatDateHeader } from '@/lib/dateFormat';
import { LibraryRow } from '../library/LibraryRow';
import { QueryToDashboardDialog } from './QueryToDashboardDialog';
import { AvailableFieldsPanel } from './AvailableFieldsPanel';
import { fieldCatalog, startFieldCatalogBackfill } from '../../services/fieldCatalog';
import type { Entry } from '../../lib/entryMapper';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import {
  QueryValue,
  RangeSelector,
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
import {
  WqlComposer,
  type ClauseType,
  type WqlSegmentEditRequest,
} from '@bitcobblers/wod-wiki-ui';
import { EXAMPLE_QUERIES } from '@/utils/analytics/explorerQueries';
import { useExplorerVocabulary } from '@/utils/analytics/useExplorerVocabulary';
import { useExplorerQueryState, type ExplorerRangeWeeks } from '../../hooks/useExplorerQueryState';
import { useNav } from '../../nav/NavContext';
import { ResponsiveActions } from '../../nav/ResponsiveActions';
import { MobileNewEntryCombo } from '../../pages/shared/NewEntryCombo';
import { PageActions } from '../../pages/shared/PageActions';
import { SampleDataPrompt } from './SampleDataPrompt';
import { onSampleDataChanged } from '@/services/analytics/sample';
import { useFeedImportEpoch } from '@/services/feed/feedReadiness';
import { cn } from '@/lib/utils';
import { registerActiveExplorerBridge, setSurfaceBusy } from '@/agent/surfaceBridges';

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
function GroupedEntryList({
  entries,
  stickyOffset,
  idPrefix = '',
  groupBy = 'date',
}: {
  entries: Entry[];
  stickyOffset: number;
  idPrefix?: string;
  groupBy?: string | readonly string[];
}) {
  return (
    <div className="-mx-4">
      {groupEntriesByDimension(entries, groupBy).map(group => (
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
  // The /dashboards landing query — the annotation-9 dashboard search. A
  // stored Route WQL Config default (the page's own query settings, legacy
  // /dashboard key aliased) overrides it; deep links (?q=) still win.
  const routeConfig = useRouteWqlConfig('/dashboards')
  const landingDefault = routeConfig.defaultWql ?? DASHBOARDS_LANDING_QUERY;
  const { draft, setDraft, submitted, invalidUrlQuery, revertDraft, submit, weeks: activeWeeks, setWeeks } =
    useExplorerQueryState({ defaultQuery: landingDefault, runOnLanding: true });
  const submittedParsed = useMemo(() => (submitted ? parseQuery(submitted) : null), [submitted]);
  const submittedInvalid = Boolean(submittedParsed?.error);
  const activeFindParsed = submittedParsed && isFindQuery(submittedParsed) ? submittedParsed : null;
  const findGroupBy = useMemo(
    () => (activeFindParsed ? parseGroupingDimensions(submitted, activeFindParsed) ?? ['date'] : ['date']),
    [submitted, activeFindParsed],
  );
  const findAdvisories = useMemo(() => activeFindParsed?.advisories ?? [], [activeFindParsed]);
  const invalidBannerQuery = submittedInvalid ? submitted : invalidUrlQuery;
  const invalidBannerError = submittedInvalid
    ? submittedParsed?.error
    : invalidUrlQuery
      ? parseQuery(invalidUrlQuery).error
      : undefined;
  const { unit: preferredUnit, setUnit: setPreferredUnit } = useAnalyticsUnitPreference();
  const { forced: unitForced } = useMemo(
    () => getEffectiveAnalyticsUnit(submitted, preferredUnit),
    [submitted, preferredUnit],
  );
  const [examplesOpen, setExamplesOpen] = useState(false);
  const examplesContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!examplesOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (examplesContainerRef.current && !examplesContainerRef.current.contains(event.target as Node)) {
        setExamplesOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExamplesOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [examplesOpen]);
  const [result, setResult] = useState<QueryResult | undefined>(undefined);
  const [settledRunKey, setSettledRunKey] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[] | undefined>(undefined);
  const [records, setRecords] = useState<Entry[] | undefined>(undefined);
  const [efforts, setEfforts] = useState<IEffort[] | undefined>(undefined);
  const [loading, setLoading] = useState(() => Boolean(submitted && !submittedInvalid));
  useEffect(() => setSurfaceBusy(loading), [loading]);
  const [dashOpen, setDashOpen] = useState(false);
  // The page's own query settings — the landing default and the scope
  // favorites, edited where the query lives.
  const [querySettingsOpen, setQuerySettingsOpen] = useState(false);
  // The composer's own synchronous verdict: parse errors AND transient
  // editor states (an unresolved kind/target pivot confirm) — Save must
  // honor both, not just a fresh parse of the draft text.
  const [composerValid, setComposerValid] = useState(true);
  const [segmentEditRequest, setSegmentEditRequest] = useState<WqlSegmentEditRequest | undefined>(undefined);
  const vocabulary = useExplorerVocabulary(loading);
  // Defer field catalog backfill until the primary query settles so IDB
  // read/write contention does not stall initial /dashboards or ?q= reload (WW-154).
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      void startFieldCatalogBackfill();
    }, 150);
    return () => clearTimeout(timer);
  }, [loading]);
  // Route-configured type favorites (the /dashboards surface) prioritize the
  // composer's picker rows without excluding anything.
  const preferredChoices = routeConfig.typeOptions;
  const liveParsed = useMemo(() => parseQuery(draft), [draft]);
  const isStaleInvalid = Boolean((liveParsed.error || queryError) && submitted);
  const showStaleBanner = isStaleInvalid && !invalidBannerQuery;
  const displayedFindParsed = activeFindParsed ?? (isFindQuery(liveParsed) ? liveParsed : null);
  const scopeLabel = sourceFilterLabel(displayedFindParsed ? displayedFindParsed.filters : []);
  const findWindowLabel = displayedFindParsed?.window ? windowLabel(displayedFindParsed.window) : null;
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
    const queryWindow = 'window' in p ? p.window : undefined;
    const derivedWindow =
      queryWindow ??
      (activeWeeks === 'all' ? undefined : { kind: 'relative' as const, size: activeWeeks, unit: 'w' as const });
    return serialize({
      family: 'find', raw: '', target: 'note', filters: compatible,
      ...(derivedWindow ? { window: derivedWindow } : {}),
    });
  }, [submitted, activeWeeks]);

  const [refreshKey, setRefreshKey] = useState(0);
  const queryRunKey = `${submitted}\0${activeWeeks}\0${refreshKey}\0${preferredUnit}`;
  const [samplePendingAction, setSamplePendingAction] = useState<'load' | 'purge' | null>(null);
  const feedImportEpoch = useFeedImportEpoch();
  const prevImportEpochRef = useRef(feedImportEpoch);

  useEffect(() => {
    const unsubscribe = onSampleDataChanged(() => setRefreshKey((k) => k + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (feedImportEpoch !== prevImportEpochRef.current) {
      prevImportEpochRef.current = feedImportEpoch;
      setRefreshKey((k) => k + 1);
    }
  }, [feedImportEpoch]);

  const [anatomyOpen, setAnatomyOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!submitted) {
      setResult(undefined);
      setSettledRunKey(null);
      setQueryError(null);
      setEntries(undefined);
      setEfforts(undefined);
      setLoading(false);
      return;
    }

    const parsed = parseQuery(submitted);
    if (parsed.error) {
      setQueryError(parsed.error);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (isFindQuery(parsed)) {
      // Content query — the shared WQL → Entry[] pipeline (same rows as the
      // Library, #833); effort targets come from the engine's effort plane.
      setResult(undefined);
      setSettledRunKey(null);
      setQueryError(null);
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
      const rangeOptions =
        activeWeeks === 'all'
          ? { preferredUnit }
          : { rangeStart: now - activeWeeks * 7 * DAY, rangeEnd: now, preferredUnit };
      queryService.runQuery(submitted, rangeOptions)
        .then((r) => {
          if (cancelled) return;
          if (r.parsed.error) {
            // Preserve the last valid chart/result when a parse/syntax error occurs (WW-038).
            setQueryError(r.parsed.error);
            return;
          }
          setQueryError(null);
          setResult(r);
          setSettledRunKey(queryRunKey);
        })
        .catch((err) => {
          if (cancelled) return;
          setQueryError(err instanceof Error ? err.message : 'Query execution failed');
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => {
      cancelled = true;
    };
  }, [submitted, activeWeeks, refreshKey, preferredUnit, queryRunKey]);

  const shape = useChartShape(result);

  // Defer the hidden "Records in this calculation" secondary find until the
  // primary analytics query settles so cold loads & `?q=` reloads never run
  // full-corpus note hydration concurrently with `runQuery` (WW-154).
  const canLoadRecords = Boolean(recordsWql) && !loading && settledRunKey === queryRunKey;
  useEffect(() => {
    if (!recordsWql) {
      setRecords(undefined);
      return;
    }
    if (!canLoadRecords) return;
    let cancelled = false;
    searchEntries(recordsWql)
      .then((rows) => { if (!cancelled) setRecords(rows); })
      .catch(() => { if (!cancelled) setRecords(undefined); });
    return () => { cancelled = true; };
  }, [recordsWql, canLoadRecords]);

  /** Metric chip click: pivot to the metrics plane, set the metric, run. */
  const selectMetric = (metric: string) => {
    const next = setMetricQuery(draft, metric);
    setDraft(next);
    submit(next);
  };

  // Explorer hides the L3 rail (0px resting L3) — all query controls (Examples,
  // unified RangeSelector, Units, Query settings, Run, Save) live in the inline
  // Explorer bar right above results.
  const { setL3Items, setL3Actions, setAnalyticsControls } = useNav();
  useEffect(() => {
    setAnalyticsControls?.(null);
    setL3Actions?.([]);
    setL3Items([]);
  }, [setAnalyticsControls, setL3Actions, setL3Items]);

  useEffect(() => {
    return registerActiveExplorerBridge({
      draft,
      submitted,
      weeks: activeWeeks,
      loading,
      saveReady,
      setDraft,
      submit,
      setWeeks,
      openSaveDialog: () => setDashOpen(true),
      openQuerySettings: () => setQuerySettingsOpen(true),
    });
  }, [draft, submitted, activeWeeks, loading, saveReady, setDraft, submit, setWeeks]);

  const exampleQuestion = EXAMPLE_QUERIES.find((e) => sameQuery(e.query, submitted))?.question ?? 'custom query';

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
      <QuerySettingsDialog
        surface={DASHBOARDS_SURFACE}
        open={querySettingsOpen}
        onOpenChange={setQuerySettingsOpen}
      />
      <StickyPageHeader
        title="Metric Explorer"
        actions={
          <ResponsiveActions primary={<MobileNewEntryCombo />} label="Explorer actions">
            {actions ?? <PageActions mode="notebook-readonly" index={[]} />}
          </ResponsiveActions>
        }
      />

      <div className="flex flex-col min-h-0 p-4 gap-3">
        <div className="min-w-[280px]">
          <WqlComposer
            query={draft}
            onQueryChange={(next) => {
              const prevHasWindow = !liveParsed.error && 'window' in liveParsed && Boolean(liveParsed.window);
              const nextParsed = parseQuery(next);
              const nextHasWindow = !nextParsed.error && 'window' in nextParsed && Boolean(nextParsed.window);
              if (prevHasWindow && !nextHasWindow && activeWeeks !== 'all') {
                setWeeks('all');
              }
              setDraft(next);
            }}
            onValidationChange={(v) => setComposerValid(v.valid)}
            onSubmit={(wql) => submit(wql)}
            preferredChoices={preferredChoices}
            showDiagnostics={false}
            defaultExpanded
            surface="inline"
            segmentEditRequest={segmentEditRequest}
            placeholder={WQL_GRAMMAR_PLACEHOLDER}
          />
        </div>

        {/* Inline Explorer bar: Examples (13) popover, unified RangeSelector + Units,
            Query settings, Run, and Save to dashboard right above results. */}
        <div
          data-testid={TEST_IDS.EXPLORER_INLINE_BAR}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div ref={examplesContainerRef} className="relative">
              <button
                type="button"
                data-testid={TEST_IDS.EXPLORER_EXAMPLES_TRIGGER}
                aria-expanded={examplesOpen}
                aria-haspopup="menu"
                onClick={() => setExamplesOpen((open) => !open)}
                className="inline-flex min-h-9 max-lg:min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <BookOpen className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>Examples ({EXAMPLE_QUERIES.length})</span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
              {examplesOpen && (
                <div
                  role="menu"
                  data-testid={TEST_IDS.EXPLORER_EXAMPLES_POPOVER}
                  className="absolute left-0 top-full z-40 mt-1.5 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
                >
                  {EXAMPLE_QUERIES.map((ex) => {
                    const active = sameQuery(submitted, ex.query);
                    return (
                      <button
                        key={ex.query}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDraft(ex.query);
                          submit(ex.query);
                          setExamplesOpen(false);
                        }}
                        className={cn(
                          'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 max-lg:min-h-11 text-left transition-colors',
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted',
                        )}
                      >
                        <span className="text-xs font-semibold">{ex.label}</span>
                        <span className="text-[11px] text-muted-foreground">{ex.question}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <RangeSelector
              allowAll
              weeks={activeWeeks}
              onWeeksChange={(w) => setWeeks(w as ExplorerRangeWeeks)}
            />

            <div
              role="group"
              aria-label={unitForced ? 'Units — pinned by query' : 'Preferred units'}
              className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1"
            >
              {(['kg', 'lb'] as const).map((u) => {
                const active = preferredUnit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    disabled={unitForced}
                    aria-pressed={active}
                    data-testid={u === 'kg' ? TEST_IDS.EXPLORER_UNIT_KG : TEST_IDS.EXPLORER_UNIT_LB}
                    onClick={() => setPreferredUnit(u)}
                    className={cn(
                      'inline-flex min-h-9 max-lg:min-h-11 min-w-10 items-center justify-center rounded-md px-2.5 text-xs font-semibold transition-colors',
                      unitForced
                        ? 'cursor-not-allowed text-muted-foreground/50'
                        : active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {u}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              data-testid={TEST_IDS.EXPLORER_QUERY_SETTINGS_BTN}
              onClick={() => setQuerySettingsOpen(true)}
              aria-label="Query settings"
              title="Query settings"
              className="inline-flex min-h-9 max-lg:min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Defaults</span>
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              data-testid={TEST_IDS.EXPLORER_RUN_BTN}
              disabled={!saveReady}
              onClick={() => submit(draft)}
              className="inline-flex min-h-9 max-lg:min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Play className="size-3.5" aria-hidden="true" />
              Run
            </button>
            <button
              type="button"
              data-testid="save-query"
              disabled={!saveReady}
              onClick={() => setDashOpen(true)}
              title="Save this query — decide where it lands (dashboard, …)"
              className="inline-flex min-h-9 max-lg:min-h-11 items-center gap-1.5 rounded-lg border border-primary/40 bg-card px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 shrink-0 disabled:opacity-40 disabled:hover:bg-card"
            >
              <Save className="size-3.5" aria-hidden="true" />
              Save
            </button>
          </div>
        </div>

        {/* Meta line: quiet draft-validity indicator + the metric/filter
            vocabulary chips that replaced the sidebar (issue #897). */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1" data-testid="explorer-meta">
          {draft.trim().length > 0 && (
            <span data-testid="draft-validity" className="mr-1 inline-flex items-center gap-1 text-[11px]">
              {liveParsed.error ? (
                <span className="inline-flex items-center gap-1 font-mono text-red-600">
                  <AlertCircle size={11} className="shrink-0" /> {liveParsed.error}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={11} className="shrink-0" /> valid
                </span>
              )}
            </span>
          )}
          {saveReady && isFindQuery(liveParsed) && (
            <button
              type="button"
              data-testid="explorer-promote-to-chart"
              title="Chart weekly total volume for this list"
              onClick={() => selectMetric('totalVolume')}
              className="mr-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20"
            >
              Promote list to chart →
            </button>
          )}
          {vocabulary.metricKeys.map((key) => (
            <button
              key={key}
              type="button"
              disabled={!saveReady}
              title={isFindQuery(liveParsed)
                ? `Chart weekly ${key} for this list`
                : `Change the coaching metric to ${key}`}
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
          <span className="mx-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            filters
          </span>
          {vocabulary.tagKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setSegmentEditRequest({
                  type: (key === 'tags' ? 'tag' : key) as ClauseType,
                  token: Date.now(),
                })
              }
              className="min-h-11 sm:min-h-7 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {key}
            </button>
          ))}
        </div>

        <AvailableFieldsPanel catalog={fieldCatalog} />

        <section className="min-w-0">
          {invalidBannerQuery && (
            <div
              role="alert"
              data-testid={TEST_IDS.EXPLORER_INVALID_URL_ALERT}
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <span>
                The URL query <code className="font-mono">{invalidBannerQuery}</code> is invalid ({invalidBannerError}).
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraft(landingDefault);
                  submit(landingDefault);
                }}
                className="rounded border border-destructive/40 bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Restore default query
              </button>
            </div>
          )}
          {activeFindParsed ? (
            /* ── Find query result: Library stream grouped by active WQL dimension ── */
            <div className="mt-3">
              {showStaleBanner && (
                <div
                  role="alert"
                  data-testid="explorer-results-stale"
                  className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700"
                >
                  <span>
                    Stale — showing the last run's results; the current draft is invalid
                    {(liveParsed.error ?? queryError) ? ` (${liveParsed.error ?? queryError})` : ''} and not applied.
                  </span>
                  <button
                    type="button"
                    onClick={revertDraft}
                    className="rounded border border-amber-500/40 bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    Restore last valid query
                  </button>
                </div>
              )}
              {findAdvisories.length > 0 && (
                <div
                  data-testid={TEST_IDS.EXPLORER_FIND_ADVISORIES}
                  className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  {findAdvisories.join(' · ')}
                </div>
              )}
              <div
                data-stale={isStaleInvalid ? 'true' : undefined}
                className={cn(
                  'bg-card border border-border rounded-lg p-4 transition-opacity',
                  isStaleInvalid && 'opacity-60',
                )}
              >
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  Find {activeFindParsed.target}
                  {scopeLabel && <span className="ml-1">in {scopeLabel}</span>}
                  {findWindowLabel && <span className="ml-1">{findWindowLabel}</span>}
                  {findGroupBy.some((d) => d !== 'date') && (
                    <span className="ml-1">by {findGroupBy.join(', ')}</span>
                  )}
                </div>
                {loading ? (
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
                  <GroupedEntryList entries={entries} stickyOffset={stickyOffset} groupBy={findGroupBy} />
                ) : (
                  <div className="text-sm text-muted-foreground">No {activeFindParsed.target}s found.</div>
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

              {showStaleBanner && (
                <div
                  role="alert"
                  data-testid="explorer-results-stale"
                  className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700"
                >
                  <span>
                    Stale — showing the last run's results; the current draft is invalid
                    {(liveParsed.error ?? queryError) ? ` (${liveParsed.error ?? queryError})` : ''} and not applied.
                  </span>
                  <button
                    type="button"
                    onClick={revertDraft}
                    className="rounded border border-amber-500/40 bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    Restore last valid query
                  </button>
                </div>
              )}

              <div
                data-stale={isStaleInvalid ? 'true' : undefined}
                className={cn(
                  'mt-3 transition-opacity',
                  isStaleInvalid && 'opacity-60',
                )}
              >
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
                      <div className="h-full flex flex-col items-center justify-center gap-2">
                        <WqlEmptyState result={undefined} className="h-auto" />
                        {samplePendingAction !== null && (
                          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                            {samplePendingAction === 'load' ? 'Loading sample data…' : 'Purging sample data…'}
                          </p>
                        )}
                      </div>
                    ) : shape.kind === 'error' ? (
                      <div className="h-full flex items-center justify-center text-sm text-destructive font-mono px-4 text-center">
                        {shape.message}
                      </div>
                    ) : shape.kind === 'empty' ? (
                      <div className="h-full flex flex-wrap items-center justify-center gap-6">
                        <SampleDataPrompt
                          result={result}
                          refreshKey={refreshKey}
                          hideBannerWhenLoaded={true}
                          onPendingChange={setSamplePendingAction}
                          onChanged={() => setRefreshKey((k) => k + 1)}
                        />
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

              {result && !loading && ((result.stages.excludedUndated ?? 0) > 0 || (result.stages.excludedCatalog ?? 0) > 0) && (
                <div
                  role="status"
                  className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                >
                  {(result.stages.excludedUndated ?? 0) > 0 && (
                    <span data-testid="explorer-excluded-undated">
                      {result.stages.excludedUndated!.toLocaleString()} undated {result.stages.excludedUndated === 1 ? 'note' : 'notes'} without a valid date excluded from time buckets.
                    </span>
                  )}
                  {(result.stages.excludedCatalog ?? 0) > 0 && (
                    <span data-testid="explorer-excluded-catalog">
                      {result.stages.excludedCatalog!.toLocaleString()} reference catalog {result.stages.excludedCatalog === 1 ? 'record' : 'records'} (efforts, equipment, guides, dashboards) excluded by default.
                    </span>
                  )}
                </div>
              )}

              {submitted && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* While loading, no Inspect toggle renders anywhere — it
                      appears in one stable spot once the run settles (in the
                      empty state, or here when data is on screen). */}
                  {!loading && !resultEmpty && inspectPipelineButton}
                  {/* WW-029: an empty calculation must not advertise an
                      unscoped record count beside "no data" — the records
                      disclosure only means something when data rendered. */}
                  {!resultEmpty && recordsWql && records !== undefined && (
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
        rangeStart={activeWeeks === 'all' ? undefined : Date.now() - activeWeeks * 7 * DAY}
        rangeEnd={activeWeeks === 'all' ? undefined : Date.now()}
        preferredUnit={preferredUnit}
      />
    </div>
  );
}
