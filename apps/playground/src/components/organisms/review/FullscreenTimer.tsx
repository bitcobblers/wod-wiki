import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { RuntimeTimerPanel } from "@/components/organisms/editor/RuntimeTimerPanel";
import type { ScriptBlock, Sessions } from "@/components/Editor/types";
import { toStoredOutputStatement } from '@/components/Editor/types';
import { RowsResultsChrome, RowsTable, type InlineMetricEditPayload } from "@bitcobblers/wod-wiki-ui";
import { useDebugMode } from "@/contexts/DebugModeContext";
import { getAnalyticsFromLogs } from "@/hooks/useWorkbenchServices";
import type { IScriptRuntime } from "@/hooks/useRuntimeTimer";
import { type Segment, MetricType, OutputStatement, type EventRecord } from '@bitcobblers/wod-wiki-engine';
import { eventsToStoredLogs, type RowsQueryResult } from '@bitcobblers/wod-wiki-wql';
import { storageService, telemetry, engagementMs, captureMetricCorrection, captureSessionRpe } from '@/hooks/useBrowserServices';
import { queryService } from "@/hooks/useCastSignaling";
import { FocusedDialog } from "@/components/molecules/FocusedDialog";
import { TEST_IDS } from "@/lib/testIds";
import { CastButtonRpc } from "@/components/organisms/cast/CastButtonRpc";
import { AudioToggle } from "@/components/atoms/AudioToggle";
import {
  type CollectionItem,
  useCollectionMetrics,
  entryFieldId,
} from "@/hooks/useCollectionMetrics";
import { CollectionWizard } from "@/components/organisms/review/CollectionWizard";
import {
  type ClockCommand,
  type ClockSnapshot,
  useClockController,
} from "@/clock/clockCommands";
import {
  requestUnifiedSessionStop,
  resolveWorkoutRunIdentity,
} from "@/app/editor/SessionRunHost";

/** Stable empty override map — post-run queue items drop via local sets instead. */
const NO_OVERRIDES = new Map();

export interface FullscreenTimerProps {
  block: ScriptBlock;
  /** Raw Note source used for Property Note metrics on standalone runs. */
  noteContent?: string;
  prepareRun?: () => Promise<ScriptBlock>;
  view?: EditorView;
  onClose: () => void;
  /**
   * Reports the run's finalized results. May return a promise: the overlay
   * awaits it before transitioning/closing; a rejection keeps the overlay on
   * a same-report Retry. Void-returning hosts keep their own save surface.
   */
  onCompleteWorkout?: (blockId: string, results: Sessions) => void | Promise<unknown>;
  /**
   * Pinned run session id (captureRun). Unlocks the durable post-run
   * actuals queue — corrections persist per occurrence via the
   * metric-correction API; without it no queue is shown.
   */
  resultId?: string;
  /** Optional parent note identifier for reload halted-run scoping. */
  noteId?: string;
  /** Whether the timer should start automatically on mount. */
  autoStart?: boolean;
  /** Called when the inner runtime is created — host can send gate-popping events (e.g. Next to clear WaitingToStart). */
  onRuntimeReady?: (runtime: IScriptRuntime) => void;
  /** Called once when the inner runtime transitions from idle to running. */
  onRunStarted?: () => void;
  /**
   * Host-driven halt (doc swap / pending restart): while true, a live run is
   * stopped and its partial results reported via onCompleteWorkout WITHOUT
   * closing — the host keeps control of when the overlay exits.
   */
  externalStop?: boolean;
  /**
   * Adopt an already-live runtime instead of creating one — a run parked
   * when its previous surface unmounted, now re-bound.
   */
  adoptRuntime?: IScriptRuntime | null;
  /**
   * Park the runtime on unmount instead of disposing it (ownership moves to
   * the host, which can re-bind it later).
   */
  parkOnUnmount?: boolean;
  /** Receives the runtime when it is parked on unmount. */
  onPark?: (runtime: IScriptRuntime) => void;
  // Test/storybook seams — production defaults keep normal renders untouched.
  /** Track-view runtime surface; defaults to the live RuntimeTimerPanel. */
  RuntimePanelSlot?: React.ComponentType<any>;
  /** Cast control in the dialog actions; defaults to the live CastButtonRpc. */
  CastButtonSlot?: React.ComponentType;
  /** Audio control in the dialog actions; defaults to the live AudioToggle. */
  AudioToggleSlot?: React.ComponentType;
}

export const FullscreenTimer: React.FC<FullscreenTimerProps> = ({
  block,
  noteContent,
  prepareRun,
  view,
  onClose,
  onCompleteWorkout,
  resultId,
  noteId,
  autoStart,
  onRuntimeReady,
  onRunStarted,
  externalStop,
  adoptRuntime,
  parkOnUnmount,
  onPark,
  RuntimePanelSlot = RuntimeTimerPanel,
  CastButtonSlot = CastButtonRpc,
  AudioToggleSlot = AudioToggle,
}) => {
  const [preparedBlock, setPreparedBlock] = useState<ScriptBlock | null>(prepareRun ? null : block);
  const [startError, setStartError] = useState<string | null>(null);
  const preparingRef = useRef(false);
  const prepare = useCallback(async () => {
    if (!prepareRun || preparingRef.current) return;
    preparingRef.current = true;
    setStartError(null);
    try {
      setPreparedBlock(await prepareRun());
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      preparingRef.current = false;
    }
  }, [prepareRun]);
  useEffect(() => { void prepare(); }, [prepare]);
  const [completedSegments, setCompletedSegments] = useState<Segment[] | null>(null);
  const [reviewEvents, setReviewEvents] = useState<EventRecord[] | null>(null);
  const { isDebugMode } = useDebugMode();
  const workoutIdentity = useMemo(
    () => resolveWorkoutRunIdentity(preparedBlock ?? block, noteContent),
    [preparedBlock, block, noteContent],
  );
  const resolvedWorkoutTitle = workoutIdentity.workoutTitle;
  // Track runtime dialog load, review screen, and duration in GA4 & telemetry
  const mountTimeRef = useRef(Date.now());
  const prevTitleRef = useRef(typeof document !== 'undefined' ? document.title : 'Wod.Wiki');
  // Suppress duplicate pageviews: label loads and re-renders must not re-fire.
  const lastPagePathRef = useRef<string | null>(null);

  useEffect(() => {
    const workoutLabel = resolvedWorkoutTitle || block.label;
    const isReview = completedSegments !== null;

    const pageTitle = isReview
      ? `Wod.Wiki - Workout Complete${workoutLabel ? ': ' + workoutLabel : ''}`
      : `Wod.Wiki - Workout Timer${workoutLabel ? ': ' + workoutLabel : ''}`;
    const pagePath = isReview ? '/workout/review' : '/workout/timer';

    document.title = pageTitle;

    // page_location stays the real URL; the synthetic path is page_path only.
    if (lastPagePathRef.current !== pagePath) {
      lastPagePathRef.current = pagePath;
      window.gtag?.('event', 'page_view', {
        page_title: pageTitle,
        page_path: pagePath,
        page_location: typeof window !== 'undefined' ? window.location.href : pagePath,
        engagement_time_msec: engagementMs(),
      });
    }

    const consented = telemetry.consent;
    if (!isReview) {
      telemetry.record('runtime:dialog_loaded', {
        workout_label: workoutLabel,
        block_type: block.blockType,
      });
      if (consented) window.gtag?.('event', 'runtime_dialog_loaded', {
        workout_label: workoutLabel,
        block_type: block.blockType,
      });
    } else if (consented) {
      window.gtag?.('event', 'runtime_dialog_review', {
        workout_label: workoutLabel,
        block_type: block.blockType,
      });
    }
  }, [block.id, block.label, block.blockType, resolvedWorkoutTitle, completedSegments]);

  useEffect(() => {
    const prevTitle = prevTitleRef.current;
    const mountTime = mountTimeRef.current;
    const workoutLabel = resolvedWorkoutTitle || block.label || block.id;
    return () => {
      const durationMs = Date.now() - mountTime;
      if (durationMs >= 1000) {
        window.gtag?.('event', 'runtime_dialog_closed', {
          workout_label: workoutLabel,
          duration_seconds: Math.round(durationMs / 1000),
          engagement_time_msec: durationMs,
        });
      }
      if (typeof document !== 'undefined') {
        document.title = prevTitle;
      }
    };
  }, [block.id, block.label, resolvedWorkoutTitle]);

  // Exit/Stop on a live run must not discard outputs: flip the panel's halt
  // flag (RuntimeTimerPanel externalStop), which stops the execution and
  // reports partial results via onComplete BEFORE we close. Refs make idle
  // exits cheap (plain close, nothing to report) and double-finalize
  // impossible.
  const startedRef = useRef(false);
  const finalizedRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const [haltRequested, setHaltRequested] = useState(false);
  // Save in flight or failed holds the overlay; retry is the only way past.
  const savingRef = useRef(false);
  const failedRef = useRef(false);
  const lastReportRef = useRef<{ blockId: string; results: Sessions } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  // ── Post-run missing-actual queue (durable corrections) ──────────────────
  const { collectionItems: postRunCandidates } = useCollectionMetrics(
    completedSegments ?? [],
    NO_OVERRIDES,
    null,
  );
  // Locally resolved/skipped queue items (dynamic membership).
  const [capturedFields, setCapturedFields] = useState<Set<string>>(new Set());
  const [skippedFields, setSkippedFields] = useState<Set<string>>(new Set());
  const [queueDismissed, setQueueDismissed] = useState(false);
  const queueItems = useMemo(
    () => postRunCandidates.filter((item) => {
      const id = entryFieldId(item);
      return !capturedFields.has(id) && !skippedFields.has(id);
    }),
    [postRunCandidates, capturedFields, skippedFields],
  );
  const queueVisible = completedSegments !== null && !!resultId && queueItems.length > 0 && !queueDismissed;

  const refreshFromStoredEvents = useCallback(async (targetResultId: string) => {
    const events = await storageService.getEventsByResult(targetResultId);
    setReviewEvents(events);
    const logs = eventsToStoredLogs(events).map((output) =>
      toStoredOutputStatement(new OutputStatement(output)),
    );
    const { segments } = getAnalyticsFromLogs(logs);
    setCompletedSegments(segments);
  }, []);

  const handleCapture = useCallback(async (item: CollectionItem, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid value');
    if (item.kind !== 'value') throw new Error('Unsupported entry');
    if (!resultId) throw new Error('The saved run is unavailable.');
    const outcome = await captureMetricCorrection({
      resultId,
      occurrence: {
        blockKey: item.blockKey,
        ...(item.sourceStatementId !== undefined ? { sourceStatementId: item.sourceStatementId } : {}),
        ...(item.stackLevel !== undefined ? { stackLevel: item.stackLevel } : {}),
      },
      metric: { type: item.metricType as MetricType, value, image: String(value) },
    });
    if (outcome === 'not-found') {
      throw new Error('This result entry could not be found — retry or skip.');
    }
    await refreshFromStoredEvents(resultId);
    setCapturedFields((prev) => new Set(prev).add(entryFieldId(item)));
  }, [resultId, refreshFromStoredEvents]);

  const handleInlineEditMetric = useCallback(
    async (targetResultId: string, payload: InlineMetricEditPayload) => {
      const outcome = await captureMetricCorrection({
        resultId: targetResultId,
        occurrence: payload.occurrence,
        metric: {
          type: payload.metric.type as MetricType,
          value: payload.metric.value,
          image: payload.metric.image,
        },
      });
      if (outcome === 'not-found') {
        throw new Error('This result entry could not be found.');
      }
      await refreshFromStoredEvents(targetResultId);
    },
    [refreshFromStoredEvents],
  );

  const handleCaptureRpe = useCallback(
    async (targetResultId: string, rpe: number) => {
      await captureSessionRpe(targetResultId, rpe);
      await refreshFromStoredEvents(targetResultId);
    },
    [refreshFromStoredEvents],
  );

  const handleSkipQueueItem = useCallback((item: CollectionItem) => {
    // Actual unknown stays unknown — skip only drops the prompt.
    setSkippedFields((prev) => new Set(prev).add(entryFieldId(item)));
  }, []);

  // Review-phase clock controller (priority 20, after the queue wizard):
  // remote/keyboard dismiss of the review, nothing else.
  const reviewSnapshot = useMemo<ClockSnapshot | null>(() => {
    if (completedSegments === null || queueVisible) return null;
    return {
      runId: resultId ? `result:${resultId}` : 'review',
      phase: 'review',
      status: 'idle',
      canNext: false,
      canStop: false,
      stopRequested: false,
      reps: [],
      selectedOccurrenceId: null,
      entry: null,
      error: null,
      saving: false,
    };
  }, [completedSegments, queueVisible, resultId]);

  const commitReport = async () => {
    const report = lastReportRef.current;
    if (!report || savingRef.current) return;
    savingRef.current = true;
    failedRef.current = false;
    setSaveState('saving');
    setSaveError(null);
    let sent: void | Promise<unknown>;
    try {
      sent = onCompleteWorkout?.(report.blockId, report.results);
      await sent;
    } catch (err) {
      failedRef.current = true;
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveState('error');
      savingRef.current = false;
      return;
    }
    savingRef.current = false;
    setSaveState('idle');
    setSavedConfirmed(true);
    const { results } = report;
    if (resultId) {
      try {
        const storedEvents = await storageService.getEventsByResult(resultId);
        if (storedEvents.length > 0) setReviewEvents(storedEvents);
      } catch {
        // Fall back to in-memory segments when storage has no events (e.g. unit test mocks)
      }
    }
    if (results.logs && results.logs.length > 0) {
      try {
        const { segments } = getAnalyticsFromLogs(results.logs, results.startTime);
        setCompletedSegments(segments);
      } catch {
        setCompletedSegments([]);
      }
    } else if (results.completed) {
      setCompletedSegments([]);
    } else if (exitRequestedRef.current) {
      onClose();
    }
  };

  const handleRunStarted = useCallback(() => {
    startedRef.current = true;
    onRunStarted?.();
  }, [onRunStarted]);

  const handleClose = () => {
    // Save in flight or failed: dismissal is blocked, exit intent kept for
    // when the commit settles. Panel-internal Stop lands here too.
    if (savingRef.current || failedRef.current) {
      exitRequestedRef.current = true;
      return;
    }
    // Review view, an already-finalized run, or a never-started run: nothing
    // left to report — dismiss immediately (idle exit finishes with no results).
    if (completedSegments !== null || finalizedRef.current || !startedRef.current) {
      onClose();
      return;
    }
    // Live or Next-captured run: route Stop confirmation through the single
    // authoritative ClockCommandBoard stop-request dialog; fall back to direct
    // halt only when no live clock controller is mounted yet.
    if (!haltRequested && !externalStop) {
      if (requestUnifiedSessionStop()) {
        return;
      }
    }
    exitRequestedRef.current = true;
    setHaltRequested(true);
  };

  // Review-phase controller registration (after handleClose exists — the ref
  // pattern keeps the handler current without stale-closure dismisses).
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  const handleReviewCommand = useCallback((command: ClockCommand): boolean => {
    if (command.kind === 'dismiss') {
      handleCloseRef.current();
      return true;
    }
    return false;
  }, []);
  useClockController(reviewSnapshot, handleReviewCommand, 20, { keyboard: true });

  // Natural completion transitions to the results view only after the host's
  // save settles.
  const handleComplete = (blockId: string, results: Sessions) => {
    if (finalizedRef.current) return; // single report per run — no double-finalize
    finalizedRef.current = true;
    lastReportRef.current = { blockId, results };
    void commitReport();
  };

  const reviewResult = useMemo<RowsQueryResult | null>(() => {
    if (completedSegments === null) return null;
    const effectiveId = resultId ?? 'standalone-review';
    const events: EventRecord[] =
      reviewEvents && reviewEvents.length > 0
        ? reviewEvents
        : completedSegments.map((seg, idx) => {
            const ctx = (seg as Segment & { context?: Record<string, unknown> }).context;
            const started = seg.absoluteStartTime ?? Date.now();
            const ended = started + Math.max(0, (seg.duration ?? 0) * 1000);
            return {
              id: `${effectiveId}:${seg.id ?? idx}`,
              grain: 'event',
              outputType: String(ctx?.outputType ?? seg.type ?? 'segment'),
              sourceBlockKey: String(ctx?.sourceBlockKey ?? seg.name ?? `segment-${idx}`),
              ...(typeof ctx?.sourceStatementId === 'number'
                ? { sourceStatementId: ctx.sourceStatementId }
                : {}),
              stackLevel: seg.depth,
              completionReason: typeof ctx?.completionReason === 'string' ? ctx.completionReason : undefined,
              timestamp: started,
              timeSpan: { started, ended },
              metrics: seg.metrics ? Array.from(seg.metrics) : [],
            } as unknown as EventRecord;
          });
    const timestamp = events[0]?.timeSpan?.started ?? Date.now();
    return {
      parsed: {
        family: 'find',
        raw: `:session{result:${effectiveId}}`,
        target: 'session',
        filters: [{ key: 'result', negate: false, values: [{ value: effectiveId, wildcard: false }] }],
      },
      runs: [
        {
          resultId: effectiveId,
          noteId: '',
          timestamp,
          events,
        },
      ],
    } as unknown as RowsQueryResult;
  }, [completedSegments, reviewEvents, resultId]);

  const saveBanner =
    saveState === 'idle' ? null : (
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-6 py-2 text-sm">
        {saveState === 'saving' && <span className="text-muted-foreground">Saving…</span>}
        {saveState === 'error' && (
          <>
            <span role="alert" className="text-destructive">
              Save failed{saveError ? ` — ${saveError}` : ''}
            </span>
            <button
              type="button"
              onClick={() => void commitReport()}
              className="rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              Retry save
            </button>
          </>
        )}
      </div>
    );

  if (!preparedBlock) {
    return <FocusedDialog title="Starting workout" onClose={onClose}>
      {startError ? <div className="space-y-3 p-6"><p role="alert">Workout not started. {startError} Your draft is kept.</p><button type="button" className="rounded border px-3 py-2 focus-visible:ring-2" onClick={() => void prepare()}>Retry start</button></div> : <p role="status" className="p-6">Saving workout before starting…</p>}
    </FocusedDialog>;
  }
  return completedSegments !== null ? (
    /* ── Results view: shown only after the commit settled (natural completion) ── */
    <FocusedDialog
      title="Workout Complete"
      onClose={handleClose}
      actions={
        <>
          {savedConfirmed && <span className="text-xs font-medium text-muted-foreground">Saved ✓</span>}
          <CastButtonSlot />
          <AudioToggleSlot />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col" data-testid={TEST_IDS.TIMER_FULLSCREEN_OVERLAY}>
        {saveBanner}
        <div className="min-h-0 flex-1">
          {queueVisible ? (
            /* Post-run missing-actual queue: raw run is already saved; these
               corrections persist durably per occurrence (or stay unknown). */
            <CollectionWizard
              mode="post-run"
              items={queueItems}
              onSave={handleCapture}
              onSkip={handleSkipQueueItem}
              onClose={() => setQueueDismissed(true)}
              runId={resultId ? `result:${resultId}` : undefined}
              className="mx-auto max-w-md"
            />
          ) : reviewResult && resultId ? (
            <div className="h-full overflow-auto p-4 sm:p-6">
              <RowsResultsChrome
                resultId={resultId}
                sessionResult={reviewResult}
                executor={queryService}
                onCaptureRpe={handleCaptureRpe}
                onEditMetric={handleInlineEditMetric}
              />
            </div>
          ) : reviewResult ? (
            <div className="h-full overflow-auto p-4 sm:p-6">
              <RowsTable
                result={reviewResult}
                filter={isDebugMode ? '' : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
    </FocusedDialog>
  ) : (
    /* ── Track view: active timer ── */
    <FocusedDialog
      onClose={handleClose}
      title={resolvedWorkoutTitle ?? "Workout"}
      closeLabel="Exit"
      actions={
        <>
          <button
            type="button"
            onClick={handleClose}
            title="Stop Session"
            className="flex h-11 min-w-[44px] items-center justify-center rounded-pill bg-muted/50 px-4 text-sm font-medium text-muted-foreground shadow-[rgba(0,0,0,0.06)_0px_1px_2px] transition-colors hover:bg-muted hover:text-foreground"
          >
            Stop
          </button>
          <CastButtonSlot />
          <AudioToggleSlot />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col" data-testid={TEST_IDS.TIMER_FULLSCREEN_OVERLAY}>
        {saveBanner}
        {startError ? <div className="space-y-2 p-4">
          <p role="alert">Workout not started. {startError}</p>
          <button type="button" className="rounded border px-3 py-2 hover:bg-accent focus-visible:ring-2" onClick={() => void prepare()}>Retry starting workout</button>
        </div> : !preparedBlock ? <p role="status" aria-live="polite" className="p-4">Saving workout before starting…</p> : null}
        <div className="min-h-0 flex-1">
          <RuntimePanelSlot
            block={preparedBlock}
            resultId={resultId}
            noteId={noteId}
            noteContent={noteContent}
            view={view}
            onClose={handleClose}
            onComplete={handleComplete}
            isExpanded={true}
            autoStart={autoStart}
            onRuntimeReady={onRuntimeReady}
            onRunStarted={handleRunStarted}
            externalStop={externalStop || haltRequested}
            adoptRuntime={adoptRuntime}
            parkOnUnmount={parkOnUnmount}
            onPark={onPark}
          />
        </div>
      </div>
    </FocusedDialog>
  );
};
