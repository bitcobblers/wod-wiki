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
import type { EditorView } from "@codemirror/view";
import { TimerDisplay } from "@/panels/wallclock-panel";
import { TimerSurface } from "@/components/organisms/workout/TimerSurface";
import { VisualStatePanel } from "@/panels/visual-state-panel";
import { PanelSizeProvider, usePanelSize } from "@/panels/panel-system/PanelSizeContext";
import { ScriptRuntimeProvider, useRuntimeExecution, type UseRuntimeExecutionReturn, NextEvent, ScriptRuntime } from "@/hooks/useRuntimeTimer";
import type { IScriptRuntime, StackSnapshot } from "@/hooks/useRuntimeTimer";
import { getActiveWorkbenchSessionStore } from "@/stores/workbenchSessionStore";
import {
  getActiveCastTransport,
  onCastTransportChange,
  ChromecastRuntimeSubscription,
  type IRpcTransport,
} from "@/hooks/useCastSignaling";
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import { dispatchGutterHighlights } from '@bitcobblers/wod-wiki-ui/extensions';
import { buildCompletedRuntimeProjection } from "@/app/cast/workbenchProjection";
import { useUserOverrides } from '@/components/organisms/review/useUserOverrides';
import { buildSessions, countSegmentOutputs, createRuntimeForBlock, prepareRuntimeBlock } from "@/app/editor/runtimeTimerModel";
import { sourceIdsToContentLines } from "@/components/organisms/editor/gutterHighlights";
import { useCollectionMetrics, resolveValueSelection } from "@/hooks/useCollectionMetrics";
import { CollectionWizard } from "@/components/organisms/review/CollectionWizard";
import { useLiveClockAuthority } from "@/clock/useLiveClockAuthority";
import { ClockCommandBoard } from "@/clock/ClockCommandBoard";


// ── Types ───────────────────────────────────────────────────────────────

export interface RuntimeTimerPanelProps {
  /**
   * The WOD block to execute, pinned at the time Run was clicked.
   * `block.startLine` is 0-indexed; gutter base = block.startLine + 1.
   */
  block: ScriptBlock;
  /** The CM6 EditorView — needed to dispatch gutter highlights. Optional for standalone tracker. */
  view?: EditorView;
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
}


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
  /** Authoritative Next availability from the clock snapshot. */
  canNext?: boolean;
}

const RuntimeTimerBody: React.FC<RuntimeTimerBodyProps> = ({
  execution,
  outputCount,
  createdAt,
  handleStart,
  handleStop,
  handleNext,
  commandBoard,
  canNext,
}) => {
  const { isCompact: isMobile, isFull } = usePanelSize();

  // ── Minimal / General tiers (ADR 0003): the surface owns the body and the
  // VisualStatePanel (Detail-tier chrome) does not render. The results footer
  // stays identical so the first output never shifts the surface. ──
  if (!isFull) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background" data-clock-panel>
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
          <PanelSizeProvider>
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
          </PanelSizeProvider>
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
}) => {
  const [runtimeBlock] = useState(() => prepareRuntimeBlock(block));
  const [preRunScript] = useState(() => ({ statements: runtimeBlock.statements }));
  const [runtime, setRuntime] = useState<IScriptRuntime | null>(null);
  const [ready, setReady] = useState(false);
  const [outputCount, setOutputCount] = useState(0);
  const [createdAt, setCompletedAt] = useState<Date | null>(null);
  const [wizardDone, setWizardDone] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  // One-shot "run is live": first captured output or running transition.
  const hasFiredRunStartedRef = useRef(false);
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
        if (output.outputType === "segment" || output.outputType === "milestone") {
          // Synchronous first-output signal: Next-driven runs never flip to
          // 'running', so this is what stops a fast Exit/Stop discarding them.
          if (!hasFiredRunStartedRef.current) {
            hasFiredRunStartedRef.current = true;
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

    const rt = createRuntimeForBlock(runtimeBlock);
    if (!rt) {
      // Block has no compilable statements — nothing to run
      setNothingToRun(true);
      return;
    }
    setRuntime(rt);
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
    getActiveWorkbenchSessionStore().getState().setExecution(execution);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [execution.status, execution.elapsedTime, execution.stepCount, execution.startTime]);

  // Auto-start only after the runtime exists; if collection is required, the
  // wizard's Start button sets pendingStart after resolving the choices.
  useEffect(() => {
    if ((autoStart || pendingStart) && ready && execution.status === 'idle') {
      execution.start();
      setPendingStart(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [autoStart, pendingStart, ready, execution.status, execution.start]);

  // Surface the first transition to running so tour quest gating can observe
  // an actual run signal rather than just stage visibility.
  useEffect(() => {
    if (execution.status === 'running' && !hasFiredRunStartedRef.current) {
      hasFiredRunStartedRef.current = true;
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
    stopAndReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- execution identity is unstable each render; field deps avoid a setExecution loop
  }, [externalStop, execution.status, execution.stop]);

  const handleComplete = useCallback((completed: boolean) => {
    if (!runtime) return;

    // Finalize analytics to get summary outputs
    runtime.finalizeAnalytics();
    const allOutputs = runtime.getOutputStatements();

    const results: Sessions = buildSessions(allOutputs, {
      startTime: execution.startTime ?? undefined,
      elapsedTime: execution.elapsedTime,
      completed,
      now: runtime.nowProvider,
    });

    onComplete?.(block.id, results);
  }, [block.id, execution.elapsedTime, execution.startTime, onComplete, runtime]);

  // The active cast transport comes from the process-wide registry, not
  // CastTransportContext — that provider wraps only the cast button, so it
  // cannot reach this panel (a sibling in the dialog). The registry updates on
  // cast connect/disconnect, re-running the mirror bridge below. (#704)
  const [castTransport, setCastTransport] = useState<IRpcTransport | null>(() => getActiveCastTransport());
  useEffect(() => onCastTransportChange(setCastTransport), []);

  // Mirror this runtime's stack + output to a connected cast receiver. This
  // runtime is created locally (on /run and in the editor fullscreen timer) —
  // it is NOT the workbench runtime that CastSessionManager's subscription
  // wraps — so without this bridge a connected receiver never sees block
  // transitions or the countdown. (#704)
  useEffect(() => {
    if (!runtime || !castTransport) return;
    const castSubscription = new ChromecastRuntimeSubscription(castTransport);
    const unsubStack = runtime.subscribeToStack((snapshot) => castSubscription.onStackSnapshot(snapshot));
    const unsubOutput = runtime.subscribeToOutput((output) => castSubscription.onOutput(output));
    return () => {
      unsubStack();
      unsubOutput();
      castSubscription.dispose();
    };
  }, [runtime, castTransport]);

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
    if (execution.status === "completed" && !createdAt) {
      setCompletedAt(new Date());
      handleComplete(true);

      // Send review data to Chromecast so the receiver transitions to the
      // review screen. This must happen before the panel unmounts and the
      // cast subscription is disposed.
      if (castTransport?.connected) {
        const allOutputs = runtime?.getOutputStatements() || [];
        const segmentCount = countSegmentOutputs(allOutputs);
        const reviewMessage = buildCompletedRuntimeProjection({
          totalDurationMs: execution.elapsedTime,
          segmentCount,
        });
        try { castTransport.send(reviewMessage); } catch { /* ignore */ }
      }
    }
  }, [execution.status, execution.elapsedTime, createdAt, handleComplete, castTransport, runtime]);

  // Halt + report shared by Stop and host-driven stops; a stack drained
  // before the halt is a natural finish, not a partial.
  const stopAndReport = useCallback(() => {
    const completedBeforeHalt = runtime ? runtime.stack.count === 0 : false;
    execution.stop();
    runtime?.handle({ name: 'abort', timestamp: runtime.clock.currentDate, data: {} });
    handleComplete(completedBeforeHalt);
  }, [runtime, execution, handleComplete]);

  const handleStop = useCallback(() => {
    stopAndReport();
    onClose();
  }, [stopAndReport, onClose]);

  const handleStart = useCallback(() => {
    execution.start();
    // Auto-expand to full content area when the timer starts.
    if (!isExpanded) onToggleExpand?.();
  }, [execution, isExpanded, onToggleExpand]);

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
    if (execution.status === 'paused') return;
    runtime?.handle(new NextEvent(undefined, runtime!.nowProvider));
  }, [runtime, execution.status]);

  // ── Live clock authority (priority 0) ── keyboard, touch and Cast commands
  // funnel through one gated handler; disabled while the wizard owns the
  // foreground (its own controller registers at priority 10).
  const { snapshot: clockSnapshot, dispatch: dispatchClock } = useLiveClockAuthority({
    runtime,
    executionStatus: execution.status === 'error' ? 'idle' : execution.status,
    enabled: ready && !showChoiceWizard && !nothingToRun && execution.status !== 'error',
    actions: {
      next: handleNext,
      start: handleStart,
      playback: () => {
        if (execution.status === 'running') execution.pause();
        else execution.start();
      },
      stop: handleStop,
      dismiss: onClose,
    },
  });

  useEffect(() => {
    if (!runtime) return;
    const store = getActiveWorkbenchSessionStore().getState();
    store.setRuntime(runtime);
    store.setHandles({
      handleStart,
      handlePause: () => execution.pause(),
      handleStop,
      handleNext,
      handleStartWorkoutAction: () => {},
    });
    return () => {
      const current = getActiveWorkbenchSessionStore().getState();
      if (current.runtime === runtime) {
        current.setRuntime(null);
      }
    };
  }, [runtime, execution, handleStart, handleStop, handleNext]);

  // The cast stack is wired by `CastSessionManager` against the workbench
  // `SubscriptionManager`. The inline runtime's snapshots flow to the
  // receiver through the workbench runtime. D-Pad events are routed by
  // `CastButtonRpc` against the workbench handles. The completion-message
  // send below is a one-shot projection that doesn't need a session.
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
          handleStart={handleStart}
          handleStop={() => { dispatchClock({ kind: 'stop-request' }); }}
          handleNext={handleNext}
          commandBoard={clockSnapshot ? <ClockCommandBoard snapshot={clockSnapshot} dispatch={dispatchClock} /> : null}
          canNext={clockSnapshot?.canNext}
        />
      </ScriptRuntimeProvider>
    </PanelSizeProvider>
  );
};
