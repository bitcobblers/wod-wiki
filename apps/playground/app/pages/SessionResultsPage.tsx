import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, History, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { isFindQuery, parseQuery } from '@bitcobblers/wod-wiki-engine';
import { computeRowsRunSummary, type RowsRun } from '@bitcobblers/wod-wiki-wql';
import {
  EditorDialog,
  ResultsSpreadsheetGrid,
  RpePopoverControl,
  SessionSummaryCard,
  formatSummaryDurationMMSS,
  useSessionPrHighlights,
  type InlineMetricEditPayload,
  type SessionActionContext,
  type SpreadsheetEditSheetContext,
  type SpreadsheetTabId,
  type WqlExecutor,
} from '@bitcobblers/wod-wiki-ui';
import { Button, buttonVariants } from '@bitcobblers/wod-wiki-ui/primitives';
import {
  registerActiveResultsBridge,
  registerActiveStreamBridge,
  setSurfaceBusy,
} from '@/agent/surfaceBridges';
import { ClockValueEntry } from '@/clock/ClockValueEntry';
import type { ClockEntry } from '@/clock/clockCommands';
import { SessionSource } from '@/components/organisms/review/SessionSource';
import { TEST_IDS } from '@/lib/testIds';
import { StickyPageHeader, useMobileQuerySlot } from '@/panels/page-shells';
import {
  captureMetricCorrection,
  clearMetricCorrection,
} from '@/services/analytics/captureMetricCorrection';
import { captureSessionRpe } from '@/services/analytics/captureSessionRpe';
import { useFeedReadiness } from '@/services/feed/feedReadiness';
import {
  clearContextualPageSources,
  queryService,
  setContextualPageSources,
} from '@/services/queryService';
import { onResultSaved } from '@/services/resultRecorder';
import { useComposerQueryState } from '../hooks/useComposerQueryState';
import { useIsMobile } from '../hooks/useIsMobile';
import type { NoteRevision, ScheduleItem, Session } from '@bitcobblers/wod-wiki-core';
import { dashboardsPath, dayPath, notePath, sessionDetailPath, sessionsPath } from '../lib/routes';
import { journalSchedule } from '../services/journalSchedule';
import { storageService } from '@/services/storage';
import { AddToDashboardSheet } from '../views/analytics/AddToDashboardSheet';
import { QueryToDashboardDialog } from '../views/analytics/QueryToDashboardDialog';
import { plainTextFallbackQuery } from '../views/stream/QueriableStreamView';
import { StreamQueryBar } from '../views/stream/StreamQueryBar';

function extractSessionIdFromPath(pathname: string): string {
  const match = /^\/results\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : '';
}

function buildClockEntry(ctx: SpreadsheetEditSheetContext, run: RowsRun): ClockEntry {
  const isSplit = ctx.field === 'split';
  const domain: ClockEntry['domain'] = isSplit
    ? 'duration'
    : ctx.field === 'reps'
      ? 'integer'
      : 'decimal';

  const value =
    isSplit && ctx.currentValue !== null
      ? Math.round(ctx.currentValue * 1000)
      : ctx.currentValue;

  return {
    fieldId: `${run.resultId}:${ctx.row.id}:${ctx.field}`,
    label: `${ctx.row.movement} · ${ctx.label}`,
    metricType: ctx.field,
    domain,
    intent: 'actual',
    required: false,
    value,
    unit: isSplit ? 'ms' : (ctx.unit ?? ''),
    index: ctx.row.index - 1,
    total: Math.max(1, run.events.length),
  };
}

/**
 * Dedicated `/results/:sessionId` execution inspection & promotion workbench.
 * Hosts the session KPI hero (`SessionSummaryCard`), 4-tab spreadsheet
 * (`ResultsSpreadsheetGrid` with `ClockValueEntry` edit sheet and `?q=` filtering),
 * collapsible `SessionSource` & history drawer, and 2-step `AddToDashboardSheet`.
 */
export function SessionResultsPage() {
  const params = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const sessionId = params.sessionId
    ? decodeURIComponent(params.sessionId)
    : extractSessionIdFromPath(location.pathname);

  return <SessionResultsPageInner key={sessionId} sessionId={sessionId} />;
}

function SessionResultsPageInner({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const feedReadiness = useFeedReadiness();
  const isMobile = useIsMobile();
  const mobileSlot = useMobileQuerySlot();

  const defaultQuery = `:session{result:${sessionId}}`;
  const routePath = sessionDetailPath(sessionId);

  const { query, setQuery, urlQueryError } = useComposerQueryState({
    defaultQuery,
  });

  const effectiveQuery = useMemo(
    () => plainTextFallbackQuery(query, 'segment') ?? query,
    [query],
  );
  const parsed = useMemo(() => parseQuery(effectiveQuery), [effectiveQuery]);

  const execute = useCallback<WqlExecutor>(
    (ast) => (isFindQuery(ast) ? queryService.runFind(ast) : queryService.runQuery(ast.raw)),
    [],
  );

  const [baseRun, setBaseRun] = useState<RowsRun | null>(null);
  const [gridRun, setGridRun] = useState<RowsRun | null>(null);
  const [compareRuns, setCompareRuns] = useState<RowsRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [activeTab, setActiveTab] = useState<SpreadsheetTabId>('splits');
  const [mobileViewMode, setMobileViewMode] = useState<'grid' | 'cards'>('grid');
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [dashboardSheetCtx, setDashboardSheetCtx] = useState<SessionActionContext | null>(null);
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);

  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const baseBlockContentId = baseRun?.summary?.blockContentId;

  useEffect(() => {
    return onResultSaved((saved) => {
      if (
        !saved ||
        saved.id === sessionId ||
        (baseBlockContentId && saved.blockContentId === baseBlockContentId)
      ) {
        setRefreshTick((t) => t + 1);
      }
    });
  }, [sessionId, baseBlockContentId]);

  useEffect(() => {
    if (feedReadiness === 'preparing' || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setQueryError(null);

    void (async () => {
      try {
        const baseParsed = parseQuery(`:session{result:${sessionId}}`);
        let nextBase: RowsRun | null = null;
        if (!baseParsed.error && isFindQuery(baseParsed)) {
          const baseRes = await queryService.runFind(baseParsed);
          nextBase = baseRes.runs?.[0] ?? null;
        }

        const blockContentId = nextBase?.summary?.blockContentId;
        let nextCompare: RowsRun[] = [];
        if (nextBase && blockContentId) {
          const cmpParsed = parseQuery(`:session{block:${blockContentId}, !result:${sessionId}}`);
          if (!cmpParsed.error && isFindQuery(cmpParsed)) {
            const cmpRes = await queryService.runFind(cmpParsed);
            nextCompare = (cmpRes.runs ?? []).slice(0, 12);
          }
        }

        let nextGrid: RowsRun | null = nextBase;
        let nextErr: string | null = urlQueryError ?? (parsed.error ? parsed.error : null);

        if (!parsed.error) {
          if (effectiveQuery.trim() === defaultQuery.trim()) {
            nextGrid = nextBase;
          } else if (isFindQuery(parsed)) {
            const filteredRes = await queryService.runFind(parsed);
            if (parsed.target === 'session') {
              nextGrid =
                filteredRes.runs?.[0] ?? (nextBase ? { ...nextBase, events: [] } : null);
            } else if (parsed.target === 'segment' || parsed.target === 'event') {
              const filteredEvents = filteredRes.events ?? [];
              if (nextBase) {
                nextGrid = { ...nextBase, events: filteredEvents };
              } else if (filteredEvents.length > 0) {
                const first = filteredEvents[0]!;
                nextGrid = {
                  resultId: sessionId,
                  noteId: first.noteId,
                  timestamp: first.timestamp,
                  events: filteredEvents,
                };
              }
            }
          } else {
            const aggRes = await queryService.runQuery(effectiveQuery);
            if (aggRes.error) nextErr = aggRes.error;
          }
        }

        if (nextBase) {
          const nbSlug = nextBase.summary?.notebooks?.[0]?.replace(/^notebook\//, '');
          await setContextualPageSources({
            resultId: sessionId,
            blockContentId: nextBase.summary?.blockContentId,
            noteId: nextBase.noteId,
            notebookSlug: nbSlug,
          });
        } else {
          clearContextualPageSources();
        }

        if (!cancelled) {
          setBaseRun(nextBase);
          setCompareRuns(nextCompare);
          setGridRun(nextGrid);
          setQueryError(nextErr);
        }
      } catch (err) {
        if (!cancelled) {
          setQueryError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedReadiness, sessionId, effectiveQuery, defaultQuery, parsed, urlQueryError, refreshTick]);

  useEffect(() => {
    return () => {
      clearContextualPageSources();
    };
  }, []);

  const busy = feedReadiness === 'preparing' || loading;
  useEffect(() => setSurfaceBusy(busy), [busy]);

  const { prHighlights } = useSessionPrHighlights(
    baseRun ?? undefined,
    baseBlockContentId,
    queryService,
    !busy && baseRun !== null,
  );

  const summary = useMemo(
    () => (baseRun ? (baseRun.summary ?? computeRowsRunSummary(baseRun)) : undefined),
    [baseRun],
  );

  const sessionActionCtx = useMemo<SessionActionContext | null>(
    () =>
      baseRun
        ? {
            resultId: baseRun.resultId,
            noteId: baseRun.noteId,
            noteTitle: summary?.noteTitle,
            blockContentId: summary?.blockContentId,
            notebooks: summary?.notebooks,
            summary,
          }
        : null,
    [baseRun, summary],
  );

  const openAddToDashboard = useCallback(
    (ctx?: SessionActionContext) => {
      const target = ctx ?? sessionActionCtx;
      if (target) setDashboardSheetCtx(target);
    },
    [sessionActionCtx],
  );

  useEffect(() => {
    return registerActiveStreamBridge({
      route: routePath,
      defaultQuery,
      query,
      loading: busy,
      layout: 'rows',
      availableLayouts: ['rows'],
      groupBy: undefined,
      setQuery,
      setLayout: () => {},
      setGroupBy: () => {},
    });
  }, [routePath, defaultQuery, query, busy, setQuery]);

  useEffect(() => {
    return registerActiveResultsBridge({
      resultId: sessionId,
      activeTab,
      mobileViewMode,
      sourceDrawerOpen,
      addToDashboardOpen: dashboardSheetCtx !== null,
      setTab: setActiveTab,
      setMobileViewMode,
      openSourceDrawer: (open = true) => setSourceDrawerOpen(open),
      openAddToDashboard: () => openAddToDashboard(),
      closeModals: () => {
        setSourceDrawerOpen(false);
        setDashboardSheetCtx(null);
        setQueryDialogOpen(false);
      },
    });
  }, [
    sessionId,
    activeTab,
    mobileViewMode,
    sourceDrawerOpen,
    dashboardSheetCtx,
    openAddToDashboard,
  ]);

  const handleCaptureRpe = useCallback(async (targetId: string, rpe: number) => {
    setActionError(null);
    await captureSessionRpe(targetId, rpe);
    setRefreshTick((t) => t + 1);
  }, []);

  const handleEditMetric = useCallback(
    async (targetId: string, payload: InlineMetricEditPayload) => {
      setActionError(null);
      if (!payload.occurrence.blockKey) {
        throw new Error('Cannot edit a segment that is missing a source block key.');
      }
      const outcome = await captureMetricCorrection({
        resultId: targetId,
        occurrence: {
          blockKey: payload.occurrence.blockKey,
          sourceStatementId: payload.occurrence.sourceStatementId,
          stackLevel: payload.occurrence.stackLevel,
        },
        metric: {
          type: payload.metric.type as never,
          value: payload.metric.value,
          image: payload.metric.image,
        },
      });
      if (outcome === 'not-found') {
        throw new Error('The target split segment could not be located in storage.');
      }
      setRefreshTick((t) => t + 1);
    },
    [],
  );

  const handleClearMetric = useCallback(
    async (
      targetId: string,
      payload: { sourceBlockKey?: string; sourceStatementId?: number; metricType: string },
    ) => {
      setActionError(null);
      const outcome = await clearMetricCorrection({
        resultId: targetId,
        occurrence: {
          blockKey: payload.sourceBlockKey,
          sourceStatementId: payload.sourceStatementId,
        },
        metricType: payload.metricType,
      });
      if (outcome === 'not-found') {
        throw new Error('No user override was found for this split metric.');
      }
      setRefreshTick((t) => t + 1);
    },
    [],
  );

  const renderClockEditSheet = useCallback(
    (ctx: SpreadsheetEditSheetContext) => {
      if (!baseRun) return null;
      const entry = buildClockEntry(ctx, baseRun);
      const initialDraft =
        entry.domain === 'duration' && ctx.currentValue !== null
          ? formatSummaryDurationMMSS(ctx.currentValue * 1000)
          : ctx.currentValue !== null
            ? String(ctx.currentValue)
            : '';

      return (
        <div className="space-y-4">
          {ctx.onClear && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setSheetSaving(true);
                  setSheetError(null);
                  void ctx
                    .onClear?.()
                    .catch((err) => {
                      setSheetError(err instanceof Error ? err.message : String(err));
                    })
                    .finally(() => setSheetSaving(false));
                }}
                disabled={sheetSaving}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                <span>Revert override</span>
              </button>
            </div>
          )}

          <ClockValueEntry
            key={entry.fieldId}
            entry={entry}
            initialDraft={initialDraft}
            saving={sheetSaving}
            error={sheetError}
            onSave={(rawVal) => {
              setSheetSaving(true);
              setSheetError(null);
              const nextValue =
                entry.domain === 'duration' ? Math.max(0, Math.round(rawVal / 1000)) : rawVal;
              void ctx
                .onSave(nextValue)
                .catch((err) => {
                  setSheetError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => setSheetSaving(false));
            }}
            onCancel={() => {
              setSheetError(null);
              ctx.onClose();
            }}
          />
        </div>
      );
    },
    [baseRun, sheetSaving, sheetError],
  );

  if (feedReadiness === 'preparing') {
    return (
      <div
        className="flex flex-1 flex-col bg-card"
        data-testid={TEST_IDS.RESULTS_PAGE}
        role="status"
        aria-busy="true"
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="w-full max-w-2xl space-y-3" aria-hidden="true">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          </div>
          <span className="text-sm text-muted-foreground">Loading session results…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-card" data-testid={TEST_IDS.RESULTS_PAGE}>
      <QueryToDashboardDialog
        open={queryDialogOpen}
        onOpenChange={setQueryDialogOpen}
        initialQuery={query}
        subsetQuery={!parsed.error && isFindQuery(parsed) ? query : null}
      />

      <StickyPageHeader
        className="max-lg:hidden"
        actions={
          <div className="flex items-center gap-2">
            {baseRun && !isMobile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={TEST_IDS.RESULTS_ADD_DASHBOARD_BTN}
                onClick={() => openAddToDashboard()}
              >
                <BarChart3 className="size-3.5" aria-hidden="true" />
                <span>Promote to dashboard</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={TEST_IDS.SAVE_STREAM_QUERY}
              onClick={() => setQueryDialogOpen(true)}
            >
              <Save className="size-3.5" aria-hidden="true" />
              <span>Add to dashboard</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={TEST_IDS.RESULTS_SOURCE_DRAWER_BTN}
              onClick={() => setSourceDrawerOpen(true)}
            >
              <History className="size-3.5" aria-hidden="true" />
              <span>Source &amp; History</span>
            </Button>
          </div>
        }
        queryBar={
          !isMobile ? (
            <StreamQueryBar
              query={query}
              onQueryChange={setQuery}
              scopeOptions={['journal', 'notebooks']}
              execute={execute}
              defaultQuery={defaultQuery}
              route={routePath}
            />
          ) : undefined
        }
      />

      {isMobile &&
        mobileSlot &&
        createPortal(
          <StreamQueryBar
            query={query}
            onQueryChange={setQuery}
            scopeOptions={['journal', 'notebooks']}
            execute={execute}
            defaultQuery={defaultQuery}
            route={routePath}
            compact
          />,
          mobileSlot,
        )}

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 pb-32 sm:px-6 lg:px-8 lg:pb-8">
        {queryError && (
          <div
            role="alert"
            data-testid={TEST_IDS.STREAM_QUERY_ERROR}
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="flex-1 text-xs">
              <p className="font-bold">Query error</p>
              <p className="mt-1 font-mono text-[11px] opacity-90">{queryError}</p>
            </div>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="text-xs font-medium">{actionError}</p>
          </div>
        )}

        {!loading && !baseRun ? (
          <section
            data-testid={TEST_IDS.RESULTS_EMPTY_RECOVERY}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center"
          >
            <h1 className="text-base font-semibold text-foreground">
              Session results not found
            </h1>
            <p className="max-w-md text-sm text-muted-foreground text-pretty">
              No completed events or analytics are stored for{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {sessionId}
              </code>
              . It may belong to another vault or have been cleared from local storage.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link to={sessionsPath()} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Browse Sessions
              </Link>
              <Link to={dashboardsPath()} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Open Dashboards
              </Link>
            </div>
          </section>
        ) : (
          baseRun && (
            <>
              <div data-testid={TEST_IDS.RESULTS_SESSION_KPI_STRIP}>
                <SessionSummaryCard
                  run={baseRun}
                  prHighlights={prHighlights}
                  onCaptureRpe={handleCaptureRpe}
                  onAddToDashboard={(ctx) => openAddToDashboard(ctx)}
                  onEditSource={
                    baseRun.noteId
                      ? () => void navigate(notePath(baseRun.noteId))
                      : () => setSourceDrawerOpen(true)
                  }
                />
              </div>

              <SessionAttributionPanel sessionId={sessionId} onAttributed={() => setRefreshTick((t) => t + 1)} />

              <ResultsSpreadsheetGrid
                run={gridRun ?? baseRun}
                compareRuns={compareRuns}
                prHighlights={prHighlights}
                noteTitle={summary?.noteTitle}
                tableTestId={TEST_IDS.PROPERTY_TABLE}
                showCustomSummariesStrip
                activeTab={activeTab}
                onTabChange={setActiveTab}
                mobileViewMode={mobileViewMode}
                onMobileViewModeChange={setMobileViewMode}
                onEditMetric={handleEditMetric}
                onClearMetric={handleClearMetric}
                onCaptureRpe={handleCaptureRpe}
                onAddToDashboard={(ctx) => openAddToDashboard(ctx)}
                onSelectCompareRun={(id) => void navigate(sessionDetailPath(id))}
                renderEditSheet={renderClockEditSheet}
              />
            </>
          )
        )}
      </div>

      {/* Mobile sticky thumb action bar */}
      {isMobile && baseRun && (
        <div
          data-testid={TEST_IDS.RESULTS_MOBILE_BAR}
          style={{ bottom: 'var(--thumb-dock-lift, 0px)' }}
          className="sticky z-[25] flex items-center justify-between gap-2 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm lg:hidden"
        >
          <RpePopoverControl
            rpe={summary?.rpe ?? null}
            resultId={baseRun.resultId}
            compact
            onChange={(val) => handleCaptureRpe(baseRun.resultId, val)}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSourceDrawerOpen(true)}
              className="min-h-11"
            >
              <History className="size-3.5" aria-hidden="true" />
              <span>Source</span>
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid={TEST_IDS.RESULTS_ADD_DASHBOARD_BTN}
              onClick={() => openAddToDashboard()}
              className="min-h-11"
            >
              <BarChart3 className="size-3.5" aria-hidden="true" />
              <span>Add to Dashboard</span>
            </Button>
          </div>
        </div>
      )}

      {/* Pinned Workout Source & History Drawer */}
      <EditorDialog
        open={sourceDrawerOpen}
        onClose={() => setSourceDrawerOpen(false)}
        presentation="sheet"
        title="Pinned Workout Source & History"
        description="Inspect the exact block snapshot recorded with this run or replay it live."
      >
        <div data-testid={TEST_IDS.RESULTS_SOURCE_DRAWER} className="space-y-4">
          <SessionSource sessionId={sessionId} />
        </div>
      </EditorDialog>

      <AddToDashboardSheet
        open={dashboardSheetCtx !== null}
        onOpenChange={(open) => {
          if (!open) setDashboardSheetCtx(null);
        }}
        context={dashboardSheetCtx}
      />
    </div>
  );
}

function SessionAttributionPanel({
  sessionId,
  onAttributed,
}: {
  sessionId: string;
  onAttributed: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [linkedSchedule, setLinkedSchedule] = useState<ScheduleItem | null>(null);
  const [nearbyMatches, setNearbyMatches] = useState<ScheduleItem[]>([]);
  const [archivedRevision, setArchivedRevision] = useState<NoteRevision | null>(null);
  const [showRevision, setShowRevision] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissedBanner(false);
    setShowRevision(false);
    setArchivedRevision(null);
    setLinkedSchedule(null);
    setNearbyMatches([]);
    storageService
      .getSessionById(sessionId)
      .then(async (sess) => {
        if (cancelled || !sess) return;
        setSession(sess);
        setDateInput(
          sess.sessionDate ??
            new Date(sess.startTime || sess.createdAt).toISOString().slice(0, 10),
        );
        if (sess.scheduleItemId) {
          const allForNote = await journalSchedule.listForNote(sess.noteId).catch(() => []);
          if (!cancelled) {
            setLinkedSchedule(allForNote.find((item) => item.id === sess.scheduleItemId) ?? null);
          }
        } else {
          const matches = await journalSchedule.findNearbyMatches(sess, 2).catch(() => []);
          if (!cancelled) setNearbyMatches(matches);
        }
        if (sess.noteSourceRevision) {
          const rev = await journalSchedule
            .getNoteRevision(sess.noteId, sess.noteSourceRevision)
            .catch(() => undefined);
          if (!cancelled && rev) setArchivedRevision(rev);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!session) return null;

  const handleAttributeDate = async () => {
    if (!dateInput) return;
    setBusy(true);
    try {
      const updated = await journalSchedule.attributeSession({
        sessionId: session.id,
        sessionDate: dateInput,
        ...(session.scheduleItemId ? { scheduleItemId: session.scheduleItemId } : {}),
      });
      setSession(updated);
      onAttributed();
    } finally {
      setBusy(false);
    }
  };

  const handleLinkSchedule = async (item: ScheduleItem) => {
    setBusy(true);
    try {
      const updated = await journalSchedule.attributeSession({
        sessionId: session.id,
        sessionDate: item.date,
        scheduleItemId: item.id,
      });
      setSession(updated);
      setLinkedSchedule(item);
      setNearbyMatches([]);
      onAttributed();
    } finally {
      setBusy(false);
    }
  };

  const handleUnlinkSchedule = async () => {
    setBusy(true);
    try {
      const updated = await journalSchedule.attributeSession({
        sessionId: session.id,
        scheduleItemId: null,
      });
      setSession(updated);
      setLinkedSchedule(null);
      const matches = await journalSchedule.findNearbyMatches(updated, 2).catch(() => []);
      setNearbyMatches(matches);
      onAttributed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {!session.scheduleItemId && nearbyMatches.length > 0 && !dismissedBanner && (
        <div
          data-testid={TEST_IDS.SESSION_SMART_MATCH_BANNER}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-xs"
        >
          <span className="font-medium text-sky-900 dark:text-sky-100">
            Match to planned workout on <strong>{nearbyMatches[0]!.date}</strong>
            {nearbyMatches[0]!.slot ? ` (${nearbyMatches[0]!.slot})` : ''}?
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void handleLinkSchedule(nearbyMatches[0]!)}
            >
              Link to plan
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDismissedBanner(true)}
            >
              Keep ad-hoc
            </Button>
          </div>
        </div>
      )}

      <section
        data-testid={TEST_IDS.SESSION_ATTRIBUTION_CARD}
        aria-label="Session attribution and note version"
        className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/80 p-3.5 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground">
              Journal Day
            </span>
            <input
              type="date"
              aria-label="Attributed journal day"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              disabled={busy}
              className="h-8 rounded border border-input bg-background px-2 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !dateInput || dateInput === session.sessionDate}
              onClick={() => void handleAttributeDate()}
              className="h-8 text-xs"
            >
              Save day
            </Button>
            {session.sessionDate && (
              <Link to={dayPath(session.sessionDate)} className="text-primary hover:underline">
                Open {session.sessionDate}
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {linkedSchedule ? (
              <>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                  Linked plan: {linkedSchedule.date}
                  {linkedSchedule.slot ? ` (${linkedSchedule.slot})` : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleUnlinkSchedule()}
                  className="h-7 px-2 text-[11px]"
                >
                  Unlink
                </Button>
              </>
            ) : (
              <span className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-muted-foreground">
                Ad-hoc Session
              </span>
            )}
            {session.noteSourceRevision && (
              <button
                type="button"
                onClick={() => setShowRevision((v) => !v)}
                disabled={!archivedRevision}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-[11px] hover:bg-muted disabled:cursor-default"
                title={archivedRevision ? 'View archived note version snapshot' : 'Pinned note version'}
              >
                Note v{session.noteSourceRevision}
                {archivedRevision ? (showRevision ? ' (Hide)' : ' (Snapshot)') : ''}
              </button>
            )}
          </div>
        </div>

        {showRevision && archivedRevision && (
          <div className="rounded border border-border/60 bg-muted/30 p-3 space-y-1.5">
            <div className="font-semibold text-foreground">
              Archived Note Version v{archivedRevision.version}: {archivedRevision.title}
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
              {archivedRevision.rawContent}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
