import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { RuntimeTimerPanel } from "@/components/organisms/editor/RuntimeTimerPanel";
import type { ScriptBlock, Sessions } from "@/components/Editor/types";
import { toStoredOutputStatement } from '@/components/Editor/types';
import { ReviewGrid } from "@/components/organisms/review/ReviewGrid";
import { useDebugMode } from "@/contexts/DebugModeContext";
import { getAnalyticsFromLogs } from "@/hooks/useWorkbenchServices";
import type { IScriptRuntime } from "@/hooks/useRuntimeTimer";
import { type Segment, MetricType, OutputStatement } from '@bitcobblers/wod-wiki-engine';
import { eventsToStoredLogs } from '@bitcobblers/wod-wiki-wql';
import { storageService } from '@/services/storage';
import { FocusedDialog } from "@/components/molecules/FocusedDialog";
import { CastButtonRpc } from "@/components/organisms/cast/CastButtonRpc";
import { AudioToggle } from "@/components/atoms/AudioToggle";
import { telemetry, engagementMs } from "@/services/telemetry";
import {
  type CollectionItem,
  useCollectionMetrics,
  entryFieldId,
} from "@/hooks/useCollectionMetrics";
import { CollectionWizard } from "@/components/organisms/review/CollectionWizard";
import { captureMetricCorrection } from "@/services/analytics/captureMetricCorrection";
import {
  type ClockCommand,
  type ClockSnapshot,
  useClockController,
} from "@/clock/clockCommands";

/** Stable empty override map — post-run queue items drop via local sets instead. */
const NO_OVERRIDES = new Map();

export interface FullscreenTimerProps {
  block: ScriptBlock;
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
}

export const FullscreenTimer: React.FC<FullscreenTimerProps> = ({
  block,
  prepareRun,
  view,
  onClose,
  onCompleteWorkout,
  resultId,
  autoStart,
  onRuntimeReady,
  onRunStarted,
  externalStop,
  adoptRuntime,
  parkOnUnmount,
  onPark,
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
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());
  const { isDebugMode } = useDebugMode();
  // Track runtime dialog load, review screen, and duration in GA4 & telemetry
  const mountTimeRef = useRef(Date.now());
  const prevTitleRef = useRef(typeof document !== 'undefined' ? document.title : 'Wod.Wiki');
  // Suppress duplicate pageviews: label loads and re-renders must not re-fire.
  const lastPagePathRef = useRef<string | null>(null);

  useEffect(() => {
    const workoutLabel = block.label || block.id;
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
  }, [block.id, block.label, block.blockType, completedSegments]);

  useEffect(() => {
    const prevTitle = prevTitleRef.current;
    const workoutLabel = block.label || block.id;
    return () => {
      const durationMs = Date.now() - mountTimeRef.current;
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
  }, [block.id, block.label]);

  // Exit/Stop on a live run must not discard outputs: flip the panel's halt
  // flag (RuntimeTimerPanel externalStop), which stops the execution and
  // reports partial results via onComplete BEFORE we close. Refs make idle
  // exits cheap (plain close, nothing to report) and double-finalize
  // impossible.
  const startedRef = useRef(false);
  const finalizedRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const [haltRequested, setHaltRequested] = useState(false);
  // Live Stop/Exit requests confirmation — it never halts silently.
  const [confirmStop, setConfirmStop] = useState(false);
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
    const events = await storageService.getEventsByResult(resultId);
    const logs = eventsToStoredLogs(events).map(output => toStoredOutputStatement(new OutputStatement(output)));
    const { segments } = getAnalyticsFromLogs(logs);
    setCompletedSegments(segments);
    setCapturedFields((prev) => new Set(prev).add(entryFieldId(item)));
  }, [resultId]);

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
    // Live run: confirm first (Stop is never silent); confirming keeps the
    // partial-results flow — halt, report, then close.
    if (!haltRequested && !externalStop) {
      setConfirmStop(true);
      return;
    }
    exitRequestedRef.current = true;
    setHaltRequested(true);
  };

  const confirmLiveStop = () => {
    setConfirmStop(false);
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

  const handleSelectSegment = (id: number, modifiers?: { ctrlKey: boolean; shiftKey: boolean }, visibleIds?: number[]) => {
    setSelectedSegmentIds((prev) => {
      const next = new Set(prev);
      if (modifiers?.ctrlKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else if (modifiers?.shiftKey && visibleIds) {
        const lastId = Array.from(prev).pop();
        if (lastId !== undefined) {
          const startIdx = visibleIds.indexOf(lastId);
          const endIdx = visibleIds.indexOf(id);
          if (startIdx !== -1 && endIdx !== -1) {
            const min = Math.min(startIdx, endIdx);
            const max = Math.max(startIdx, endIdx);
            for (let i = min; i <= max; i++) next.add(visibleIds[i]);
          } else {
            next.add(id);
          }
        } else {
          next.add(id);
        }
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

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
          <CastButtonRpc />
          <AudioToggle />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
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
          ) : (
            <ReviewGrid
              runtime={null}
              segments={completedSegments}
              selectedSegmentIds={selectedSegmentIds}
              onSelectSegment={handleSelectSegment}
              groups={[]}
              gridViewPreset={isDebugMode ? 'debug' : 'default'}
            />
          )}
        </div>
      </div>
    </FocusedDialog>
  ) : (
    /* ── Track view: active timer ── */
    <FocusedDialog
      onClose={handleClose}
      title="Workout"
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
          <CastButtonRpc />
          <AudioToggle />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {saveBanner}
        {startError ? <div className="space-y-2 p-4">
          <p role="alert">Workout not started. {startError}</p>
          <button type="button" className="rounded border px-3 py-2 hover:bg-accent focus-visible:ring-2" onClick={() => void prepare()}>Retry starting workout</button>
        </div> : !preparedBlock ? <p role="status" aria-live="polite" className="p-4">Saving workout before starting…</p> : null}
        <div className="min-h-0 flex-1">
          <RuntimeTimerPanel
            block={preparedBlock}
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
        {confirmStop && (
          <FocusedDialog
            title="Stop workout?"
            onClose={() => setConfirmStop(false)}
            closeLabel="Keep going"
            actions={undefined}
          >
            <div className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                The run stops now and your partial results are kept.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  data-testid="stop-cancel"
                  onClick={() => setConfirmStop(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Keep going
                </button>
                <button
                  type="button"
                  data-testid="stop-confirm"
                  onClick={confirmLiveStop}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground transition-colors hover:brightness-110"
                >
                  Stop — keep partial results
                </button>
              </div>
            </div>
          </FocusedDialog>
        )}
      </div>
    </FocusedDialog>
  );
};
