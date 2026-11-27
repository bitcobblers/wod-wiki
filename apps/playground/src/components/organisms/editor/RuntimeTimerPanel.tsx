/**
 * RuntimeTimerPanel
 *
 * In-overlay timer UI rendered inside the WhiteboardCompanion slot when a runtime
 * is active for a section.
 *
 * Lifecycle:
 *   - Mount  → creates its own ScriptRuntime via RuntimeFactory
 *   - Unmount → disposes runtime, clears gutter highlights
 *
 * The panel renders in the companion overlay slot (not fixed-position).
 * OverlayTrack expands the slot to ≥75 vh and pins it sticky within the
 * section boundaries when running (see OverlayTrack.tsx).
 *
 * Gutter line highlighting:
 *   Each stack snapshot's top block carries `sourceIds` = Statement IDs.
 *   Lines are resolved through runtime.script.getId(id) (meta.line, 1-based
 *   within the content block); Document line = block.startLine + 1 + meta.line.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useInRouterContext, useNavigate } from "react-router-dom";
import type { EditorView } from "@codemirror/view";
import { TimerDisplay } from "@/panels/wallclock-panel";
import { TimerSurface } from "@/components/organisms/workout/TimerSurface";
import { VisualStatePanel } from "@/panels/visual-state-panel";
import { PanelSizeProvider, usePanelSize } from "@/panels/panel-system/PanelSizeContext";
import { ScriptRuntimeProvider, useRuntimeExecution, type UseRuntimeExecutionReturn, NextEvent, ScriptRuntime } from "@/hooks/useRuntimeTimer";
import type { IScriptRuntime, StackSnapshot } from "@/hooks/useRuntimeTimer";
import {
  clearHaltedRun,
  clearLiveRunCheckpoint,
  getHaltedRun,
  getLiveRunCheckpoint,
  pendingRuntimes,
  recordHaltedRun,
  sameRunNoteId,
  saveLiveRunCheckpoint,
  useActiveRunStore,
  type LiveRunCheckpoint,
} from "@/stores/activeRunStore";
import {
  clearPendingUnloadResult,
  flushPendingUnloadResults,
  getPendingUnloadState,
  onPendingUnloadStateChange,
  playgroundRecorder,
  stagePendingUnloadResult,
} from "@/hooks/useWorkbenchServices";
import { runPath, sessionDetailPath } from "@/lib/routes";
import { getActiveCastTransport } from "@/hooks/useCastSignaling";
import { useSessionCastBridge } from "@/hooks/useSessionCastBridge";
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import { formatDurationMMSS } from '@bitcobblers/wod-wiki-core';
import { createParser, type IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import { dispatchGutterHighlights } from '@bitcobblers/wod-wiki-ui/extensions';
import { buildCompletedRuntimeProjection } from "@/app/cast/workbenchProjection";
import { useUserOverrides } from '@/components/organisms/review/useUserOverrides';
import {
  buildSessions,
  countSegmentOutputs,
  createRuntimeForBlock,
  prepareRuntimeBlock,
  resolveWorkoutRunIdentity,
} from "@/app/editor/runtimeTimerModel";
import { sourceIdsToContentLines } from "@/components/organisms/editor/gutterHighlights";
import { useCollectionMetrics, resolveValueSelection } from "@/hooks/useCollectionMetrics";
import { CollectionWizard } from "@/components/organisms/review/CollectionWizard";
import { useLiveClockAuthority } from "@/clock/useLiveClockAuthority";
import { ClockCommandBoard } from "@/clock/ClockCommandBoard";
import { TEST_IDS } from "@/lib/testIds";


// ── Types ───────────────────────────────────────────────────────────────

export interface RuntimeTimerPanelProps {
  /**
   * The WOD block to execute, pinned at the time Run was clicked.
   * `block.startLine` is 0-indexed; gutter base = block.startLine + 1.
   */
  block: ScriptBlock;
  /** The CM6 EditorView — needed to dispatch gutter highlights. Optional for standalone tracker. */
  view?: EditorView;
  /** Raw Note source for standalone runs without an editor view. */
  noteContent?: string;
  /** Called when the user presses Stop (which also closes the panel). */
  onClose: () => void;
  /** Called when a workout is completed or stopped with results. May return a
   * promise; the panel never awaits it — hosts own their commit lifecycle. */
  onComplete?: (blockId: string, results: Sessions) => void | Promise<unknown>;
  /** Whether the slot is currently in full-height expanded mode. */
  isExpanded?: boolean;
  /** Toggle between expanded and compact runtime view. */
  onToggleExpand?: () => void;
  /** Whether the timer should start automatically on mount. */
  autoStart?: boolean;
  /** Called when the internal runtime is created — allows the parent to subscribe. */
  onRuntimeReady?: (runtime: IScriptRuntime) => void;
  /** Called once when the runtime transitions from idle to running. */
  onRunStarted?: () => void;
  /**
   * Scroll-out stop (#885): while true, a running execution is paused in
   * place — state and outputs are preserved (no reset) so analytics keeps
   * the run's data.
   */
  externalPause?: boolean;
  /**
   * Host-driven stop (home tour metrics arrival / reset chaining): while
   * true and the execution is still live (running or paused), the panel
   * stops it, dispatches `workout:stop`, and reports the partial results
   * via onComplete — WITHOUT calling onClose. Idempotent per execution:
   * once completed, further flips are no-ops.
   */
  externalStop?: boolean;
  /**
   * Adopt an already-live runtime instead of creating one — a run that was
   * parked when its surface unmounted (the user navigated away mid-workout)
   * and is now being re-bound. The runtime keeps running across the gap.
   */
  adoptRuntime?: IScriptRuntime | null;
  /**
   * Park the runtime on unmount instead of disposing it, handing it to
   * `onPark`. The host becomes its owner until a surface re-binds it.
   */
  parkOnUnmount?: boolean;
  /** Receives the runtime when it is parked on unmount. */
  onPark?: (runtime: IScriptRuntime) => void;
  /** Optional session/result identifier for reload halted-run notice links. */
  resultId?: string;
  /** Optional parent note identifier for scoping halted-run notices. */
  noteId?: string;
}

export interface HaltedRunNoticeProps {
  noteId?: string | null;
}

function RouterNavigateBridge({ onReady }: { onReady: (nav: (to: string) => void) => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    onReady((to) => { void navigate(to); });
  }, [navigate, onReady]);
  return null;
}

export const HaltedRunNotice: React.FC<HaltedRunNoticeProps> = ({ noteId }) => {
  const haltedRun = useActiveRunStore((state) => state.haltedRun);
  const liveCheckpoint = useActiveRunStore((state) => state.liveCheckpoint);
  const activeRuntime = useActiveRunStore((state) => state.runtime);
  const inRouter = useInRouterContext();
  const navigateRef = useRef<((to: string) => void) | null>(null);
  const [, setUnloadTick] = useState(0);
  const [savingPartial, setSavingPartial] = useState(false);

  const goTo = useCallback((to: string) => {
    if (navigateRef.current) {
      navigateRef.current(to);
    } else if (typeof window !== 'undefined') {
      window.location.assign(to);
    }
  }, []);

  useEffect(() => {
    const stored = getHaltedRun();
    if (stored && !useActiveRunStore.getState().haltedRun) {
      useActiveRunStore.getState().setHaltedRun(stored);
    }
    const storedCp = getLiveRunCheckpoint();
    if (storedCp && !useActiveRunStore.getState().liveCheckpoint) {
      useActiveRunStore.getState().setLiveCheckpoint(storedCp);
    }
  }, []);

  useEffect(() => {
    return onPendingUnloadStateChange(() => {
      setUnloadTick((n) => n + 1);
    });
  }, []);

  const marker = haltedRun ?? getHaltedRun();
  const markerMatchesNote = Boolean(marker && sameRunNoteId(noteId, marker.noteId));
  const activeMarker = markerMatchesNote ? marker : null;

  const checkpointCandidate = liveCheckpoint ?? getLiveRunCheckpoint();
  const activeCheckpoint: LiveRunCheckpoint | null =
    !activeRuntime && checkpointCandidate && sameRunNoteId(noteId, checkpointCandidate.noteId)
      ? checkpointCandidate
      : null;

  const handleResumeCheckpoint = useCallback((cp: LiveRunCheckpoint) => {
    const content = cp.blockContent ?? '';
    const block: ScriptBlock = {
      id: cp.blockId,
      dialect: (cp.blockDialect as ScriptBlock['dialect']) ?? 'time',
      startLine: 0,
      endLine: Math.max(0, content.split('\n').length - 1),
      content,
      statements: content ? createParser().read(content).statements : [],
      state: 'idle',
      version: cp.blockVersion ?? 1,
      createdAt: cp.startedAt,
      widgetIds: {},
      ...(cp.blockContentId ? { contentId: cp.blockContentId } : {}),
      ...(cp.blockSport ? { sport: cp.blockSport } : {}),
    };
    const nextRuntimeId = cp.sessionId;
    pendingRuntimes.set(nextRuntimeId, {
      block,
      noteId: cp.noteId ?? '',
      returnTo: cp.returnTo,
    });
    clearLiveRunCheckpoint(cp.sessionId);
    clearHaltedRun(cp.sessionId);
    goTo(runPath(nextRuntimeId));
  }, [goTo]);

  const handleSaveCheckpointPartial = useCallback(async (cp: LiveRunCheckpoint) => {
    if (savingPartial) return;
    setSavingPartial(true);
    try {
      const partialData: Sessions = {
        startTime: cp.startedAt,
        endTime: cp.lastCheckpointAt,
        duration: cp.elapsedMs,
        completed: false,
      };
      await playgroundRecorder.record({
        resultId: cp.sessionId,
        noteId: cp.noteId ?? '',
        blockId: cp.blockId,
        ...(cp.blockVersion !== undefined ? { blockVersion: cp.blockVersion } : {}),
        ...(cp.blockContentId ? { blockContentId: cp.blockContentId } : {}),
        ...(cp.blockContent !== undefined ? { blockContent: cp.blockContent } : {}),
        ...(cp.blockDialect ? { blockDialect: cp.blockDialect } : {}),
        ...(cp.blockSport ? { blockSport: cp.blockSport } : {}),
        data: partialData,
        createdAt: cp.lastCheckpointAt,
      });
      clearLiveRunCheckpoint(cp.sessionId);
      clearHaltedRun(cp.sessionId);
      goTo(sessionDetailPath(cp.sessionId));
    } finally {
      setSavingPartial(false);
    }
  }, [savingPartial, goTo]);

  const handleDiscardAll = useCallback((sessionId: string) => {
    clearLiveRunCheckpoint(sessionId);
    clearHaltedRun(sessionId);
    clearPendingUnloadResult(sessionId);
  }, []);

  if (!activeMarker && !activeCheckpoint) return null;

  const routerBridge = inRouter ? (
    <RouterNavigateBridge onReady={(fn) => { navigateRef.current = fn; }} />
  ) : null;

  if (activeMarker) {
    const unloadState = getPendingUnloadState(activeMarker.sessionId);
    // Wait for staged reload persistence to settle before claiming the run was saved.
    if (unloadState.status === 'pending' || unloadState.status === 'flushing') {
      return routerBridge;
    }

    if (unloadState.status === 'failed') {
      const handleDismissFailure = () => {
        handleDiscardAll(activeMarker.sessionId);
      };
      return (
        <>
          {routerBridge}
          <div
            role="alert"
            data-testid="halted-run-notice"
            className="mx-4 my-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span>Previous workout run could not be saved on reload.</span>
              {(activeMarker.workoutTitle || (activeMarker.elapsedMs !== undefined && activeMarker.elapsedMs > 0)) && (
                <span className="font-medium text-muted-foreground">
                  {activeMarker.workoutTitle}
                  {activeMarker.elapsedMs !== undefined && activeMarker.elapsedMs > 0
                    ? `${activeMarker.workoutTitle ? ' · ' : ''}${formatDurationMMSS(activeMarker.elapsedMs)}`
                    : ''}
                </span>
              )}
              {unloadState.error && (
                <span className="text-destructive">{unloadState.error}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeCheckpoint?.blockContent && (
                <button
                  type="button"
                  data-testid={TEST_IDS.LIVE_RUN_RESUME}
                  onClick={() => handleResumeCheckpoint(activeCheckpoint)}
                  className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Resume workout
                </button>
              )}
              <button
                type="button"
                onClick={() => { void flushPendingUnloadResults(); }}
                className="min-h-11 rounded border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                Retry save
              </button>
              <button
                type="button"
                onClick={handleDismissFailure}
                aria-label="Dismiss partial results notice"
                className="min-h-11 min-w-11 rounded border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          </div>
        </>
      );
    }

    const resultsHref = sessionDetailPath(activeMarker.sessionId);

    return (
      <>
        {routerBridge}
        <div
          role="status"
          data-testid="halted-run-notice"
          className="mx-4 my-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span>Previous workout run was saved as partial results on reload.</span>
            {(activeMarker.workoutTitle || (activeMarker.elapsedMs !== undefined && activeMarker.elapsedMs > 0)) && (
              <span className="font-medium text-muted-foreground">
                {activeMarker.workoutTitle}
                {activeMarker.elapsedMs !== undefined && activeMarker.elapsedMs > 0
                  ? `${activeMarker.workoutTitle ? ' · ' : ''}${formatDurationMMSS(activeMarker.elapsedMs)}`
                  : ''}
              </span>
            )}
            {inRouter ? (
              <Link
                to={resultsHref}
                onClick={() => {
                  clearHaltedRun(activeMarker.sessionId);
                  clearLiveRunCheckpoint(activeMarker.sessionId);
                }}
                className="font-semibold underline underline-offset-2 hover:text-primary"
              >
                View partial results
              </Link>
            ) : (
              <a
                href={resultsHref}
                onClick={() => {
                  clearHaltedRun(activeMarker.sessionId);
                  clearLiveRunCheckpoint(activeMarker.sessionId);
                }}
                className="font-semibold underline underline-offset-2 hover:text-primary"
              >
                View partial results
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeCheckpoint?.blockContent && (
              <button
                type="button"
                data-testid={TEST_IDS.LIVE_RUN_RESUME}
                onClick={() => handleResumeCheckpoint(activeCheckpoint)}
                className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Resume workout
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDiscardAll(activeMarker.sessionId)}
              aria-label="Dismiss partial results notice"
              className="min-h-11 min-w-11 rounded border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      </>
    );
  }

  // Case D (WW-142): Interrupted live session checkpoint found in localStorage
  // without a committed halted-run marker — offer explicit Resume / Save Partial / Discard.
  if (!activeCheckpoint) return routerBridge;
  return (
    <>
      {routerBridge}
      <div
        role="status"
        data-testid="halted-run-notice"
        className="mx-4 my-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span>Interrupted workout session detected.</span>
          {(activeCheckpoint.workoutTitle || activeCheckpoint.elapsedMs > 0) && (
            <span className="font-medium text-muted-foreground">
              {activeCheckpoint.workoutTitle}
              {activeCheckpoint.elapsedMs > 0
                ? `${activeCheckpoint.workoutTitle ? ' · ' : ''}${formatDurationMMSS(activeCheckpoint.elapsedMs)}`
                : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeCheckpoint.blockContent && (
            <button
              type="button"
              data-testid={TEST_IDS.LIVE_RUN_RESUME}
              onClick={() => handleResumeCheckpoint(activeCheckpoint)}
              className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Resume workout
            </button>
          )}
          <button
            type="button"
            disabled={savingPartial}
            aria-busy={savingPartial}
            data-testid={TEST_IDS.LIVE_RUN_SAVE_PARTIAL}
            onClick={() => void handleSaveCheckpointPartial(activeCheckpoint)}
            className="min-h-11 rounded border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {savingPartial ? 'Saving…' : 'Save partial'}
          </button>
          <button
            type="button"
            data-testid={TEST_IDS.LIVE_RUN_DISCARD}
            onClick={() => handleDiscardAll(activeCheckpoint.sessionId)}
            aria-label="Discard interrupted workout session"
            className="min-h-11 min-w-11 rounded border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Discard
          </button>
        </div>
      </div>
    </>
  );
};


// ── Inner body component (needs PanelSizeContext) ───────────────────────

interface RuntimeTimerBodyProps {
  execution: UseRuntimeExecutionReturn;
  outputCount: number;
  createdAt: Date | null;
  handleStart: () => void;
  handleStop: () => void;
  handleNext: () => void;
  /** Command board (reps counter, legend, entry, stop confirm) from the live authority. */
  commandBoard?: React.ReactNode;
  /** Reload halted-run notice banner shown while idle. */
  notice?: React.ReactNode;
  /** Runtime execution or step dispatch errors surfaced visibly (WW-077). */
  runtimeErrors?: readonly string[];
  /** Authoritative Next availability from the clock snapshot. */
  canNext?: boolean;
  workoutTitle?: string;
  workoutFormat?: string;
}

const RuntimeTimerBody: React.FC<RuntimeTimerBodyProps> = ({
  execution,
  outputCount,
  createdAt,
  handleStart,
  handleStop,
  handleNext,
  commandBoard,
  notice,
  runtimeErrors,
  canNext,
  workoutTitle,
  workoutFormat,
}) => {
  const { isCompact: isMobile, isFull } = usePanelSize();
  const errorAlert = runtimeErrors && runtimeErrors.length > 0 ? (
    <div
      role="alert"
      data-testid={TEST_IDS.RUNTIME_ERROR_BANNER}
      className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {runtimeErrors.join(' · ')}
    </div>
  ) : null;

  // ── Minimal / General tiers (ADR 0003): the surface owns the body and the
  // VisualStatePanel (Detail-tier chrome) does not render. The results footer
  // stays identical so the first output never shifts the surface. ──
  if (!isFull) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background" data-clock-panel>
        {notice}
        {errorAlert}
        <div className="min-h-0 flex-1 overflow-hidden">
          <TimerSurface
            elapsedMs={execution.elapsedTime}
            hasActiveBlock={true}
            onStart={handleStart}
            onPause={execution.pause}
            onStop={handleStop}
            onNext={handleNext}
            isRunning={execution.status === "running"}
            isPaused={execution.status === "paused"}
            canNext={canNext}
            workoutTitle={workoutTitle}
            workoutFormat={workoutFormat}
          />
        </div>

        {commandBoard}

        {/* ── Results footer ── reserved fixed-height strip: renders identically
            whether or not results exist, so the first output landing never
            shifts the clock or controls above it. */}
        <div className={`flex h-[26px] flex-shrink-0 items-center gap-2 px-2.5 text-[10px] text-muted-foreground ${outputCount > 0 ? "border-t border-border bg-muted/20" : ""}`}>
          {outputCount > 0 && (
            <span className="whitespace-nowrap">
              {`${outputCount} ${outputCount !== 1 ? 'results' : 'result'} captured`}
            </span>
          )}
          {outputCount > 0 && createdAt && (
            <span className="ml-auto font-medium text-primary">
              ✓ {createdAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background" data-clock-panel>
      {notice}
      {errorAlert}
      {/* ── Detail tier (full): side-by-side audit + timer. Both columns
          get a proportional share (3:2 favoring the clock) with min-h-0 so
          neither can squeeze the other out of a bounded host: the visual
          state scrolls internally and the clock keeps controls reachable. ── */}
      <div className={`min-h-0 flex-1 overflow-hidden flex ${isMobile ? "flex-col" : "flex-row"}`}>
        {/* Visual State — below the clock on mobile, left on desktop */}
        <div className={`overflow-hidden bg-secondary/10 ${
          isMobile
            ? "order-2 min-h-0 flex-[2] border-t border-border"
            : "min-h-0 min-w-0 w-1/3 border-r border-border"
        }`}>
          <VisualStatePanel />
        </div>

        {/* Timer + controls — top on mobile, right on desktop */}
        <div className={`flex flex-col overflow-y-auto bg-background ${
          isMobile ? "order-1 min-h-[min(280px,100%)] flex-[3]" : "min-h-0 w-2/3"
        }`}>
          <TimerDisplay
            elapsedMs={execution.elapsedTime}
            hasActiveBlock={true}
            onStart={handleStart}
            onPause={execution.pause}
            onStop={handleStop}
            onNext={handleNext}
            isRunning={execution.status === "running"}
            isPaused={execution.status === "paused"}
            canNext={canNext}
            compact={isMobile}
            enableDisplayStack={true}
          />
        </div>
      </div>

      {commandBoard}

      {/* ── Results footer ── reserved fixed-height strip: renders identically
          whether or not results exist, so the first output landing never
          shifts the clock or controls above it. */}
      <div className={`flex h-[26px] flex-shrink-0 items-center gap-2 px-2.5 text-[10px] text-muted-foreground ${outputCount > 0 ? "border-t border-border bg-muted/20" : ""}`}>
        {outputCount > 0 && (
          <span className="whitespace-nowrap">
            {`${outputCount} ${outputCount !== 1 ? 'results' : 'result'} captured`}
          </span>
        )}
        {outputCount > 0 && createdAt && (
          <span className="ml-auto font-medium text-primary">
            ✓ {createdAt.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Component ───────────────────────────────────────────────────────────

export const RuntimeTimerPanel: React.FC<RuntimeTimerPanelProps> = ({
  block,
  view,
  noteContent,
  onClose,
  onComplete,
  isExpanded = false,
  onToggleExpand,
  autoStart,
  onRuntimeReady,
  onRunStarted,
  externalPause,
  externalStop,
  adoptRuntime,
  parkOnUnmount,
  onPark,
  resultId,
  noteId,
}) => {
  const [runtimeBlock] = useState(() => prepareRuntimeBlock(block));
  const [preRunScript] = useState(() => ({ statements: runtimeBlock.statements }));
  const workoutIdentity = React.useMemo(
    () => resolveWorkoutRunIdentity(runtimeBlock, view?.state.doc.toString() ?? noteContent),
    [runtimeBlock, view, noteContent],
  );
  const [runtime, setRuntime] = useState<IScriptRuntime | null>(null);
  const [ready, setReady] = useState(false);
  const [outputCount, setOutputCount] = useState(0);
  const [createdAt, setCompletedAt] = useState<Date | null>(null);
  const [wizardDone, setWizardDone] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  // One-shot "run is live": first captured output or running transition.
  const hasFiredRunStartedRef = useRef(false);
  // True once the run is stopped explicitly or completed naturally (not unload).
  const explicitEndRef = useRef(false);
  // Ensures onComplete is reported at most once per RuntimeTimerPanel mount.
  const hasReportedCompletionRef = useRef(false);
  // True once the factory declined to build a runtime (empty / uncompilable
  // block) — drives the "Nothing to run" empty state instead of hanging on
  // "Initializing…". (#702)
  const [nothingToRun, setNothingToRun] = useState(false);

  // Gutter base: 0-indexed block.startLine → 1-based fence line
  // statement source line = meta.line, 1-based within the fence content
  // document line = (block.startLine + 1) + meta.line
  const gutterBase = block.startLine + 1;
  const { overrides, setOverride } = useUserOverrides(true);
  const { collectionItems } = useCollectionMetrics([], overrides, preRunScript);

  // Create runtime only after pre-run collection has been resolved. This keeps
  // ChoiceGroupMetric out of RuntimeFactory unless the entry point has no wizard,
  // where the factory's safety net defaults it. When collection WAS required,
  // the runtime is created exactly once — at the wizard's explicit Start
  // (wizardDone) — never when the item list drains to 0, and never twice.
  //
  // Two paths: a fresh run (created here) and an adopted run (a live runtime
  // parked by a previous surface — see `adoptRuntime`). The adopted runtime
  // is already past the pre-run collection, so it skips the wizard gate and
  // its own effect never re-creates anything.
  const attachRuntime = useCallback((rt: IScriptRuntime) => {
    // ── Gutter highlighting via stack subscription ──────────────────
    const unsubStack = rt.subscribeToStack(
      (snapshot: StackSnapshot) => {
        if (!view) return;
        if (snapshot.blocks.length === 0) {
          dispatchGutterHighlights(view, []);
          return;
        }
        // StackSnapshot.blocks is top-first: blocks[0] is the current block.
        const topBlock = snapshot.blocks[0];
        if (topBlock?.sourceIds?.length) {
          // sourceIds are Statement IDs, not lines — resolve each to its
          // statement's content-relative source line, deduped (parent and
          // child statements can share one source line).
          const docLines = sourceIdsToContentLines(rt.script, topBlock.sourceIds)
            .map((line) => gutterBase + line);
          dispatchGutterHighlights(view, docLines);
        } else {
          dispatchGutterHighlights(view, []);
        }
      },
    );

    // ── Output counting ─────────────────────────────────────────────
    const unsubOutput = rt.subscribeToOutput(
      (output: IOutputStatement) => {
        if (
          (output.outputType === "segment" || output.outputType === "milestone") &&
          output.sourceBlockKey !== "waiting-to-start"
        ) {
          // Synchronous first-output signal: Next-driven runs never flip to
          // 'running', so this is what stops a fast Exit/Stop discarding them.
          if (!hasFiredRunStartedRef.current) {
            hasFiredRunStartedRef.current = true;
            clearHaltedRun();
            onRunStarted?.();
          }
          setOutputCount((n) => n + 1);
        }
      },
    );

    return () => {
      unsubStack();
      unsubOutput();
      if (view) dispatchGutterHighlights(view, []); // clear gutter on unmount
    };
  }, [view, gutterBase, onRunStarted]);

  // Unmount detector. React runs effect cleanups in declaration order, so
  // this flag flips BEFORE the runtime effect's cleanup on unmount — a
  // deps-driven re-run (not an unmount) leaves it false, so only a real
  // unmount parks the runtime.
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);

  useEffect(() => {
    // Adopted runs are wired by their own effect below.
    if (adoptRuntime) return;
    if (!wizardDone && (collectionItems.length > 0 || wizardEngagedRef.current)) return;

    const rt = createRuntimeForBlock(runtimeBlock, view?.state.doc.toString() ?? noteContent);
    if (!rt) {
      // Block has no compilable statements — nothing to run
      setNothingToRun(true);
      return;
    }
    setRuntime(rt);
    useActiveRunStore.getState().setRuntime(rt);
    onRuntimeReady?.(rt);

    const detach = attachRuntime(rt);
    setReady(true);

    return () => {
      detach();
      if (parkOnUnmount && unmountedRef.current) {
        // Ownership transfers to the host — the clock keeps running.
        onPark?.(rt);
        return;
      }
      if (useActiveRunStore.getState().runtime === rt) {
        useActiveRunStore.getState().setRuntime(null);
      }
      rt.dispose();
    };

    // Block identity pinned at mount; pre-run collection is the only creation gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardDone, collectionItems.length, adoptRuntime]);

  // Adoption path: take over a runtime that was parked when its previous
  // surface unmounted. The run is already past its pre-run collection, so
  // the wizard stays closed and nothing is re-created.
  useEffect(() => {
    if (!adoptRuntime) return;
    const rt = adoptRuntime;
    setWizardDone(true);
    setRuntime(rt);
    useActiveRunStore.getState().setRuntime(rt);
    onRuntimeReady?.(rt);

    const detach = attachRuntime(rt);
    setReady(true);

    return () => {
      detach();
      // The host takes the runtime back so it can re-bind it later.
      onPark?.(rt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptRuntime]);

  const execution = useRuntimeExecution(runtime as ScriptRuntime | null);

  // Sync the inline runtime's execution status into the active Workbench
  // Session store. Store-driven panels (StackIntegratedTimer reads
  // `execution.status` for its Play/Pause/Continue control) have no
  // useWorkbenchSessionLifecycle on this surface to do it — /run creates its
  // runtime locally here, so the label would otherwise never reflect pause.
  // (#701)
  // Idle is the store's default — skipping the sync while idle avoids a
  // render→effect loop when the panel mounts hidden before its first start
  // (unstable idle elapsedTime would re-fire this effect every render).
  useEffect(() => {
    if (execution.status === 'idle') return;
    useActiveRunStore.getState().setExecution(execution);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [execution.status, execution.elapsedTime, execution.stepCount, execution.startTime]);

  // Auto-start only after the runtime exists; if collection is required, the
  // wizard's Start button sets pendingStart after resolving the choices.
  useEffect(() => {
    if ((autoStart || pendingStart) && ready && execution.status === 'idle') {
      const waiting = runtime?.stack.current?.blockType === 'WaitingToStart';
      if (waiting) {
        if (!pendingStart) {
          // autoStart opens the session at the Ready-to-Start gate (idle/ready);
          // only explicit Start/Next (or wizard pendingStart) pops WaitingToStart
          // and begins running.
          return;
        }
        runtime.handle(new NextEvent(undefined, runtime.nowProvider));
      }
      if (!runtime || runtime.stack.count > 0) {
        execution.start();
      }
      setPendingStart(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [autoStart, pendingStart, ready, execution.status, execution.start, runtime]);

  // Surface the first transition to running so tour quest gating can observe
  // an actual run signal rather than just stage visibility.
  useEffect(() => {
    if (execution.status === 'running' && !hasFiredRunStartedRef.current) {
      hasFiredRunStartedRef.current = true;
      clearHaltedRun();
      onRunStarted?.();
    }
  }, [execution.status, onRunStarted]);

  // Scroll-out stop (#885): the home tour halts the ambient demo runtime when
  // the visitor scrolls out of the timer cards. Pause preserves elapsed time
  // and collected outputs — nothing is reset.
  useEffect(() => {
    if (externalPause && execution.status === 'running') {
      execution.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [externalPause, execution.status, execution.pause]);

  // Host-driven stop: same as the Stop button but WITHOUT onClose — the host
  // keeps the panel mounted. Idle-with-outputs (Next-driven) must still
  // report; idle-without-outputs and completed runs have nothing to add.
  useEffect(() => {
    if (!externalStop || execution.status === 'completed') return;
    if (execution.status !== 'running' && execution.status !== 'paused' && !hasFiredRunStartedRef.current) return;
    explicitEndRef.current = true;
    clearLiveRunCheckpoint(resultId ?? useActiveRunStore.getState().activeSessionId ?? block.id);
    useActiveRunStore.getState().setActiveSessionMeta(null, null);
    stopAndReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [externalStop, execution.status, execution.stop]);

  const handleComplete = useCallback((completed: boolean) => {
    if (!runtime || hasReportedCompletionRef.current) return;
    hasReportedCompletionRef.current = true;

    // Finalize analytics to get summary outputs
    runtime.finalizeAnalytics();
    const allOutputs = runtime.getOutputStatements();

    const results: Sessions = buildSessions(allOutputs, {
      startTime: execution.startTime ?? undefined,
      elapsedTime: execution.getElapsedTime(),
      completed,
      now: runtime.nowProvider,
    });

    void onComplete?.(block.id, results);
  }, [block.id, execution, onComplete, runtime]);

  // The active cast transport comes from the process-wide registry, not
  // CastTransportContext — that provider wraps only the cast button, so it
  // cannot reach this panel (a sibling in the dialog). The registry updates on
  // cast connect/disconnect, re-running the mirror bridge below. (#704)
  const castTransport = useSessionCastBridge({
    runtime,
    identity: workoutIdentity,
    executionStatus: execution.status === 'error' ? 'idle' : execution.status,
  });

  // ── Cast workbench mode bridge ───────────────────────────────────────
  // While this inline runtime owns the receiver, flip it to the active clock
  // when the run starts and back to idle when it stops (status returns to
  // 'idle') or the panel unmounts mid-run. Completion is owned by the review
  // projection sent below — clearing the marker there lets the receiver keep
  // showing review (EditorCastBridge re-sends preview once the runtime is no
  // longer active). lastWorkbenchModeRef dedupes: re-renders, ticks and
  // pause/resume must not re-send the same mode.
  const lastWorkbenchModeRef = useRef<'active' | 'idle' | null>(null);
  // Transport (re)connect is a new peer — resend the current mode.
  useEffect(() => { lastWorkbenchModeRef.current = null; }, [castTransport]);
  useEffect(() => {
    if (execution.status === 'completed') {
      lastWorkbenchModeRef.current = null;
      return;
    }
    const mode: 'active' | 'idle' | null = ready
      ? 'active'
      : null;
    if (!mode || mode === lastWorkbenchModeRef.current || !castTransport?.connected) return;
    lastWorkbenchModeRef.current = mode;
    try { castTransport.send({ type: 'rpc-workbench-update', mode }); } catch { /* ignore */ }
  }, [ready, execution.status, castTransport]);
  // Unmount while the receiver shows the active clock → hand back to idle.
  // Registry getter, not the closure state: the transport may have changed.
  useEffect(() => () => {
    if (lastWorkbenchModeRef.current !== 'active') return;
    try { getActiveCastTransport()?.send({ type: 'rpc-workbench-update', mode: 'idle' }); } catch { /* ignore */ }
  }, []);

  // Track completion: notify parent immediately so it can switch to results view.
  // The parent (FullscreenTimer) will unmount this panel when it transitions.
  // Also send review mode to Chromecast BEFORE the panel unmounts (which would
  // otherwise lose the cast subscription).
  useEffect(() => {
    if (execution.status === "completed" && !createdAt && !hasReportedCompletionRef.current) {
      explicitEndRef.current = true;
      clearLiveRunCheckpoint(resultId ?? useActiveRunStore.getState().activeSessionId ?? block.id);
      useActiveRunStore.getState().setActiveSessionMeta(null, null);
      setCompletedAt(new Date());
      handleComplete(true);

      // Send review data to Chromecast so the receiver transitions to the
      // review screen. This must happen before the panel unmounts and the
      // cast subscription is disposed.
      if (castTransport?.connected) {
        const allOutputs = runtime?.getOutputStatements() || [];
        const segmentCount = countSegmentOutputs(allOutputs);
        const reviewMessage = buildCompletedRuntimeProjection({
          totalDurationMs: execution.getElapsedTime(),
          segmentCount,
        });
        try { castTransport.send(reviewMessage); } catch { /* ignore */ }
      }
    }
  }, [execution, createdAt, handleComplete, castTransport, runtime, block.id, resultId]);

  // Halt + report shared by Stop and host-driven stops; a stack drained
  // before the halt is a natural finish, not a partial. Exiting at the
  // Ready-to-Start gate before any work starts is a no-op close (WW-052).
  const stopAndReport = useCallback(() => {
    const hasStarted =
      execution.status === 'running' ||
      execution.status === 'paused' ||
      hasFiredRunStartedRef.current ||
      outputCount > 0;
    const completedBeforeHalt = runtime ? runtime.stack.count === 0 : false;
    execution.stop();
    if (!hasStarted) return;
    runtime?.handle({ name: 'abort', timestamp: runtime.clock.currentDate, data: {} });
    handleComplete(completedBeforeHalt);
  }, [runtime, execution, handleComplete, outputCount]);

  const handleStop = useCallback(() => {
    explicitEndRef.current = true;
    clearLiveRunCheckpoint(resultId ?? useActiveRunStore.getState().activeSessionId ?? block.id);
    useActiveRunStore.getState().setActiveSessionMeta(null, null);
    stopAndReport();
    onClose();
  }, [stopAndReport, onClose, resultId, block.id]);

  const resolvedSessionId = resultId ?? useActiveRunStore.getState().activeSessionId;
  const resolvedNoteId = noteId ?? useActiveRunStore.getState().activeNoteId;
  const isLiveRun =
    (execution.status === 'running' ||
      execution.status === 'paused' ||
      outputCount > 0 ||
      hasFiredRunStartedRef.current) &&
    execution.status !== 'completed';

  const persistCheckpointNow = useCallback(() => {
    if (explicitEndRef.current || !isLiveRun) return;
    const sessionId = resolvedSessionId || block.id;
    saveLiveRunCheckpoint({
      sessionId,
      ...(resolvedNoteId ? { noteId: resolvedNoteId } : {}),
      blockId: block.id,
      ...(typeof block.version === 'number' ? { blockVersion: block.version } : {}),
      ...(block.contentId ? { blockContentId: block.contentId } : {}),
      ...(block.content ? { blockContent: block.content } : {}),
      ...(block.dialect ? { blockDialect: block.dialect } : {}),
      ...(block.sport ? { blockSport: block.sport } : {}),
      workoutTitle: workoutIdentity.workoutTitle,
      startedAt: execution.startTime ?? Date.now(),
      lastCheckpointAt: Date.now(),
      elapsedMs: execution.getElapsedTime(),
      status: execution.status === 'paused' ? 'paused' : 'running',
      stepCount: execution.stepCount,
      ...(typeof window !== 'undefined' ? { returnTo: window.location.pathname } : {}),
    });
  }, [
    isLiveRun,
    resolvedSessionId,
    resolvedNoteId,
    block.id,
    block.version,
    block.contentId,
    block.content,
    block.dialect,
    block.sport,
    workoutIdentity.workoutTitle,
    execution,
  ]);

  // Live checkpointing to localStorage during an active run (WW-142):
  // writes on start, pause/resume, output emission, every 1s while running,
  // and on tab backgrounding so abrupt reloads never silently drop the run.
  useEffect(() => {
    if (!isLiveRun || explicitEndRef.current) return;
    persistCheckpointNow();
    if (execution.status !== 'running') return;
    const interval = window.setInterval(persistCheckpointNow, 1_000);
    return () => window.clearInterval(interval);
  }, [isLiveRun, execution.status, outputCount, persistCheckpointNow]);

  // Synchronous partial-session staging + reporting for hard reloads (WW-012 / WW-142):
  // stop the clock, abort the runtime ONCE so the active block's elapsed time & outputs
  // are emitted, finalize analytics ONCE, stage synchronously into localStorage for
  // next-boot flush, and fire onComplete with the identical completed:false snapshot.
  const finalizePartialUnload = useCallback(() => {
    execution.stop();
    if (!runtime) return;
    runtime.handle({ name: 'abort', timestamp: runtime.clock.currentDate, data: {} });
    runtime.finalizeAnalytics();
    const results = buildSessions(runtime.getOutputStatements(), {
      startTime: execution.startTime ?? undefined,
      elapsedTime: execution.getElapsedTime(),
      completed: false,
      now: runtime.nowProvider,
    });
    stagePendingUnloadResult({
      resultId: resolvedSessionId || block.id,
      ...(resolvedNoteId ? { noteId: resolvedNoteId } : {}),
      blockId: block.id,
      ...(typeof block.version === 'number' ? { blockVersion: block.version } : {}),
      ...(block.contentId ? { blockContentId: block.contentId } : {}),
      ...(block.content ? { blockContent: block.content } : {}),
      ...(block.dialect ? { blockDialect: block.dialect } : {}),
      ...(block.sport ? { blockSport: block.sport } : {}),
      data: results,
      createdAt: Date.now(),
    });
    if (!hasReportedCompletionRef.current) {
      hasReportedCompletionRef.current = true;
      void onComplete?.(block.id, results);
    }
  }, [runtime, execution, onComplete, block.id, block.version, block.contentId, block.content, block.dialect, block.sport, resolvedSessionId, resolvedNoteId]);
  const unloadStateRef = useRef({
    isLive: isLiveRun,
    sessionId: resolvedSessionId,
    noteId: resolvedNoteId,
    workoutTitle: workoutIdentity.workoutTitle,
    elapsedMs: execution.getElapsedTime(),
    finalizePartialUnload,
    persistCheckpointNow,
  });
  unloadStateRef.current = {
    isLive: isLiveRun,
    sessionId: resolvedSessionId,
    noteId: resolvedNoteId,
    workoutTitle: workoutIdentity.workoutTitle,
    elapsedMs: execution.getElapsedTime(),
    finalizePartialUnload,
    persistCheckpointNow,
  };

  useEffect(() => {
    let handled = false;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        unloadStateRef.current.persistCheckpointNow();
      }
    };
    const handleUnload = () => {
      if (handled || explicitEndRef.current) return;
      const current = unloadStateRef.current;
      if (!current.isLive) return;
      handled = true;
      const sessionId = current.sessionId || block.id;
      current.persistCheckpointNow();
      recordHaltedRun({
        sessionId,
        runtimeId: sessionId,
        noteId: current.noteId ?? undefined,
        workoutTitle: current.workoutTitle,
        timestamp: Date.now(),
        elapsedMs: current.elapsedMs,
      });
      current.finalizePartialUnload();
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [block.id]);

  const handleStart = useCallback(() => {
    if (runtime && runtime.stack.current?.blockType === 'WaitingToStart') {
      runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    }
    if (!runtime || runtime.stack.count > 0) {
      execution.start();
    }
    // Auto-expand to full content area when the timer starts.
    if (!isExpanded) onToggleExpand?.();
  }, [runtime, execution, isExpanded, onToggleExpand]);

  // ── Pre-run Choice Wizard ─────────────────────────────────────────────────
  // Scan the parsed block before RuntimeFactory can default unresolved choices.
  // The wizard's Start button resolves all choices into the same statements,
  // then runtime creation proceeds from those collapsed statements.
  // Once engaged (items were non-empty), the wizard stays mounted through the
  // last field so its Ready panel can host the explicit Start.
  const wizardEngagedRef = useRef(false);
  useEffect(() => {
    if (collectionItems.length > 0) wizardEngagedRef.current = true;
  }, [collectionItems.length]);
  const showChoiceWizard = !wizardDone && (collectionItems.length > 0 || wizardEngagedRef.current);

  const handleWizardStart = () => {
    setWizardDone(true);
    setPendingStart(true);
    if (!isExpanded) onToggleExpand?.();
  };

  const handleNext = useCallback(() => {
    // Sender-side paused gate: paused Next is rejected before the runtime
    // (the runtime remains the final authority for required timers).
    if (execution.status === 'paused' || !runtime) return;
    const wasIdle = execution.status === 'idle';
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    if (wasIdle && runtime.stack.count > 0) {
      execution.start();
    }
  }, [runtime, execution]);

  // ── Live clock authority (priority 0) ── keyboard, touch and Cast commands
  // funnel through one gated handler; disabled while the wizard owns the
  // foreground (its own controller registers at priority 10).
  const { snapshot: clockSnapshot, dispatch: dispatchClock } = useLiveClockAuthority({
    runtime,
    executionStatus: execution.status === 'error' ? 'idle' : execution.status,
    enabled: ready && !showChoiceWizard && !nothingToRun && execution.status !== 'error',
    hasCapturedWork: outputCount > 0 || hasFiredRunStartedRef.current,
    actions: {
      next: handleNext,
      start: handleStart,
      playback: () => {
        if (execution.status === 'running') {
          execution.pause();
        } else if (execution.status === 'idle' || runtime?.stack.current?.blockType === 'WaitingToStart') {
          handleStart();
        } else {
          execution.start();
        }
      },
      stop: handleStop,
      dismiss: onClose,
    },
  });

  if (showChoiceWizard) {
    return (
      <PanelSizeProvider>
        <CollectionWizard
          items={collectionItems}
          onSave={(item, val) => {
            if (typeof val !== 'number') throw new TypeError('A numeric target is required');
            // Statement resolution is the required pre-JIT write; the override
            // store stays for display grids only.
            if (!resolveValueSelection(preRunScript, item, val, 'target')) throw new Error('Enter a valid target before starting');
            if (item.kind === 'value') {
              setOverride(item.blockKey, item.metricType, val);
            }
          }}
          onSkip={() => {}}
          onStart={handleWizardStart}
          mode="pre-run"
        />
      </PanelSizeProvider>
    );
  }

  // Empty / uncompilable block: the factory declined to build a runtime, so
  // `ready` never flips. Surface a clear empty state instead of hanging on
  // "Initializing…" forever. Keyed on the factory's decision (not statement
  // count) so it catches every entry path (editor Run, date-page Play, /run
  // route) and every un-runnable shape. (#702)
  if (nothingToRun) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-foreground">Nothing to run</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          This block has no workout statements yet. Add a timer or some
          movements, then run it again.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Close
        </button>
      </div>
    );
  }

  if (!ready || !runtime) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Initializing…
      </div>
    );
  }

  return (
    <PanelSizeProvider>
      <ScriptRuntimeProvider runtime={runtime}>
        <RuntimeTimerBody
          execution={execution}
          outputCount={outputCount}
          createdAt={createdAt}
          handleStart={() => {
            const cmd = clockSnapshot?.phase === 'ready' ? ({ kind: 'ready-start' } as const) : ({ kind: 'playback' } as const);
            if (!dispatchClock(cmd)) handleStart();
          }}
          handleStop={() => {
            if (!dispatchClock({ kind: 'stop-request' })) handleStop();
          }}
          handleNext={handleNext}
          commandBoard={clockSnapshot ? <ClockCommandBoard snapshot={clockSnapshot} dispatch={dispatchClock} /> : null}
          notice={!isLiveRun ? <HaltedRunNotice noteId={noteId} /> : null}
          runtimeErrors={
            (runtime.errors?.length ?? 0) > 0
              ? runtime.errors.map((e) => e.error?.message || String(e.error ?? '')).filter(Boolean)
              : execution.status === 'error'
                ? ['Workout execution error']
                : undefined
          }
          canNext={clockSnapshot?.canNext ?? false}
          workoutTitle={workoutIdentity.workoutTitle}
          workoutFormat={workoutIdentity.workoutFormat}
        />
      </ScriptRuntimeProvider>
    </PanelSizeProvider>
  );
};
