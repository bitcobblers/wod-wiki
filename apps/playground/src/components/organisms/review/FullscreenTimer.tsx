import React, { useCallback, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { RuntimeTimerPanel } from "@/components/organisms/editor/RuntimeTimerPanel";
import type { ScriptBlock, Sessions } from "@/components/Editor/types";
import { ReviewGrid } from "@/components/organisms/review/ReviewGrid";
import { useDebugMode } from "@/contexts/DebugModeContext";
import { getAnalyticsFromLogs } from "@/hooks/useWorkbenchServices";
import type { IScriptRuntime } from "@/hooks/useRuntimeTimer";
import type { Segment } from '@bitcobblers/wod-wiki-engine';
import { FocusedDialog } from "@/components/molecules/FocusedDialog";
import { CastButtonRpc } from "@/components/organisms/cast/CastButtonRpc";
import { AudioToggle } from "@/components/atoms/AudioToggle";

export interface FullscreenTimerProps {
  block: ScriptBlock;
  view?: EditorView;
  onClose: () => void;
  /**
   * Reports the run's finalized results. May return a promise: the overlay
   * awaits it before transitioning/closing; a rejection keeps the overlay on
   * a same-report Retry. Void-returning hosts keep their own save surface.
   */
  onCompleteWorkout?: (blockId: string, results: Sessions) => void | Promise<unknown>;
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
}

export const FullscreenTimer: React.FC<FullscreenTimerProps> = ({
  block,
  view,
  onClose,
  onCompleteWorkout,
  autoStart,
  onRuntimeReady,
  onRunStarted,
  externalStop,
}) => {
  const [completedSegments, setCompletedSegments] = useState<Segment[] | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());
  const { isDebugMode } = useDebugMode();

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
    const { results } = report;
    if (results.completed && results.logs && results.logs.length > 0) {
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
    // Live run: halt first; close once the partial report has been committed.
    exitRequestedRef.current = true;
    setHaltRequested(true);
  };

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
          <ReviewGrid
            runtime={null}
            segments={completedSegments}
            selectedSegmentIds={selectedSegmentIds}
            onSelectSegment={handleSelectSegment}
            groups={[]}
            gridViewPreset={isDebugMode ? 'debug' : 'default'}
          />
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
        <div className="min-h-0 flex-1">
          <RuntimeTimerPanel
            block={block}
            view={view}
            onClose={handleClose}
            onComplete={handleComplete}
            isExpanded={true}
            autoStart={autoStart}
            onRuntimeReady={onRuntimeReady}
            onRunStarted={handleRunStarted}
            externalStop={externalStop || haltRequested}
          />
        </div>
      </div>
    </FocusedDialog>
  );
};
