/**
 * wallclock-panel-chromecast.tsx — Stateless Chromecast receiver timer panel.
 *
 * Renders the General (Tier 2) timer view directly from a transported
 * `RpcSessionFrame` (interpolated locally at 60fps from serialized spans) plus
 * live Summary Metric bubbles (`MetricTrackerCard`) and the shared
 * `ClockCommandBoard`.
 *
 * Passive Spectator TV fade uses CSS opacity (`opacity-0 pointer-events-none`)
 * rather than conditional unmounting so `useSpatialNavigation` focus targets
 * (`btn-next`, `btn-pause`, `btn-stop`) always remain mounted in the DOM.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  interpolateSessionClockFrame,
  type SessionClockFrame,
} from '@bitcobblers/wod-wiki-engine';
import { useOptionalScriptRuntime } from '@bitcobblers/wod-wiki-engine/react';
import { GeneralTimerSurface } from '@/components/organisms/workout/GeneralTimerSurface';
import { MetricTrackerCard } from '@/components/organisms/track/MetricTrackerCard';
import {
  useTimerSurfaceModel,
  type TimerSurfaceModel,
} from '@/components/organisms/workout/useTimerSurfaceModel';
import { ClockCommandBoard, type ClockCommandBoardProps } from '@/clock/ClockCommandBoard';
import type { ClockCommand, ClockSnapshot } from '@/clock/clockCommands';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import type { RpcSessionFrame } from '@/services/cast/rpc/RpcMessages';

export interface ReceiverTimerPanelProps {
  /** Transported authoritative command snapshot; `null` disables every control. */
  readonly snapshot: ClockSnapshot | null;
  /** Transported projected Session frame (clock spans + typed Summary Metrics). */
  readonly sessionFrame?: RpcSessionFrame | null;
  /** Sender clock source adjusted by measured RTT offset. */
  readonly getSenderNowMs?: () => number;
  /** Visual idle fade for Spectator TV clarity; keeps D-pad DOM targets mounted. */
  readonly controlsIdleHidden?: boolean;
  /** Send one command to the browser authority. */
  readonly sendCommand: (command: ClockCommand) => void;
  readonly getFocusProps?: (id: string) => FocusProps;
  /** Fallback workout title when not carried on `sessionFrame`. */
  readonly workoutTitle?: string;
  /** Clock command board slot; defaults to the shared ClockCommandBoard. */
  readonly CommandBoardSlot?: React.ComponentType<ClockCommandBoardProps>;
}

function frameToSurfaceModel(
  frame: SessionClockFrame,
  isPaused: boolean,
  canNext: boolean,
): TimerSurfaceModel {
  return {
    mainLabel: frame.mainLabel,
    subLabels: frame.subLabels,
    displayMs: frame.displayMs,
    sessionElapsedMs: frame.sessionElapsedMs,
    roundCurrent: frame.roundCurrent,
    roundTotal: frame.roundTotal,
    roundLabel: frame.roundLabel,
    secondaryTimers: frame.secondaryTimers.map((st) => ({
      id: st.id,
      label: st.label,
      displayMs: st.displayMs,
    })),
    upNext: frame.upNext,
    isRunning: frame.isRunning,
    isPaused,
    isNextDisabled: isPaused || !canNext,
    skipFlash: frame.skipFlash,
    skipFlashKey: frame.skipFlashKey,
    polarity: frame.polarity,
    isRequiredLockActive: frame.isRequiredLockActive,
  };
}

export const ReceiverTimerPanel: React.FC<ReceiverTimerPanelProps> = ({
  snapshot,
  sessionFrame,
  getSenderNowMs,
  controlsIdleHidden = false,
  sendCommand,
  getFocusProps,
  workoutTitle,
  CommandBoardSlot = ClockCommandBoard,
}) => {
  const contextRuntime = useOptionalScriptRuntime();
  const resolveNow = useMemo(
    () => getSenderNowMs ?? (() => Date.now()),
    [getSenderNowMs],
  );
  const [nowMs, setNowMs] = useState<number>(() => resolveNow());

  const command = (cmd: ClockCommand): void => {
    if (!snapshot) return;
    sendCommand(cmd);
  };

  const isPaused = !snapshot || snapshot.status === 'paused';
  const canNext = snapshot?.canNext ?? false;

  const handlers = {
    onStart: () =>
      command(snapshot?.phase === 'ready' ? { kind: 'ready-start' } : { kind: 'playback' }),
    onPause: () => command({ kind: 'playback' }),
    onStop: () => command({ kind: 'stop-request' }),
    onNext: () => command({ kind: 'next' }),
    isPaused,
    canNext,
  };

  // Fallback hook runs only when a unit test mounts ReceiverTimerPanel inside
  // ScriptRuntimeProvider without supplying a transported sessionFrame.
  const fallbackRuntimeModel = useTimerSurfaceModel(handlers, {
    active: !sessionFrame && Boolean(contextRuntime),
  });

  const isFrameTicking = Boolean(
    sessionFrame && sessionFrame.frame.isRunning && !isPaused,
  );

  useEffect(() => {
    if (!isFrameTicking || typeof requestAnimationFrame !== 'function') return undefined;
    let frameId = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setNowMs(resolveNow());
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(frameId);
    };
  }, [isFrameTicking, resolveNow]);

  const model: TimerSurfaceModel = useMemo(() => {
    if (!sessionFrame) return fallbackRuntimeModel;
    const interpolated = isFrameTicking
      ? interpolateSessionClockFrame(sessionFrame.frame, nowMs)
      : sessionFrame.frame;
    return frameToSurfaceModel(interpolated, isPaused, canNext);
  }, [sessionFrame, fallbackRuntimeModel, isFrameTicking, nowMs, isPaused, canNext]);

  const effectiveTitle = sessionFrame?.workoutTitle ?? workoutTitle;
  const effectiveFormat = sessionFrame?.workoutFormat;
  const summaries = sessionFrame?.telemetry.summaries;

  const promptRow =
    summaries && summaries.length > 0 ? (
      <div className="shrink-0 border-b border-border px-4 py-1.5">
        <MetricTrackerCard summariesOverride={summaries} />
      </div>
    ) : undefined;

  const fadeBoard =
    controlsIdleHidden &&
    snapshot !== null &&
    snapshot.entry === null &&
    !snapshot.stopRequested;

  return (
    <div className="flex flex-1 flex-col justify-center">
      <GeneralTimerSurface
        model={model}
        onStart={handlers.onStart}
        onPause={handlers.onPause}
        onStop={handlers.onStop}
        onNext={handlers.onNext}
        workoutTitle={effectiveTitle}
        workoutFormat={effectiveFormat}
        promptRow={promptRow}
        showReceiverIndicators={true}
        controlsIdleHidden={fadeBoard}
        getFocusProps={getFocusProps}
      />
      {!snapshot && (
        <div
          data-testid="receiver-controls-disabled"
          className="shrink-0 pb-4 text-center font-mono text-sm uppercase tracking-widest text-muted-foreground"
        >
          No active clock — controls disabled
        </div>
      )}
      {snapshot && (
        <div
          className={`shrink-0 px-10 pb-4 transition-opacity duration-300 ${
            fadeBoard ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
          data-clock-panel
        >
          <CommandBoardSlot
            snapshot={snapshot}
            dispatch={(cmd) => {
              command(cmd);
              return true;
            }}
            getFocusProps={getFocusProps}
          />
        </div>
      )}
    </div>
  );
};
