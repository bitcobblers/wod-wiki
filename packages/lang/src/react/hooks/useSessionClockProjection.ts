import { useEffect, useMemo, useState } from 'react';
import { useOptionalScriptRuntime } from '../context/RuntimeContext';
import { getRuntimeNowMs } from './runtimeNow';
import {
  observeSessionClockInputs,
  projectSessionClock,
  type SessionClockFrame,
  type SessionExecutionStatus,
} from '../../runtime/projection/SessionClockProjection';
import type { IScriptRuntime } from '../../runtime/contracts/IScriptRuntime';

export interface UseSessionClockProjectionOptions {
  readonly runtime?: IScriptRuntime | null;
  readonly executionStatus?: SessionExecutionStatus;
  readonly canNextOverride?: boolean;
  /** False suspends subscriptions and the 60fps loop when hidden/unneeded. */
  readonly active?: boolean;
}

/**
 * Single reactive React hook over `projectSessionClock`.
 *
 * Delegates runtime stack, block-memory, and skip-attempt subscriptions to
 * `observeSessionClockInputs` so browser views and the Cast projector share one
 * observation implementation.
 */
export function useSessionClockProjection(
  options: UseSessionClockProjectionOptions = {},
): SessionClockFrame {
  const contextRuntime = useOptionalScriptRuntime();
  const runtime = options.runtime !== undefined ? options.runtime : contextRuntime;
  const enabled = options.active ?? true;

  const [signalState, setSignalState] = useState({
    revision: 0,
    skipFlash: false,
    skipFlashKey: 0,
  });

  useEffect(() => {
    if (!runtime || !enabled) return undefined;
    return observeSessionClockInputs(runtime, ({ skipFlash, skipFlashKey }) => {
      setSignalState((prev) => ({
        revision: prev.revision + 1,
        skipFlash,
        skipFlashKey,
      }));
    });
  }, [runtime, enabled]);

  const [nowMs, setNowMs] = useState(() => getRuntimeNowMs());

  const structuralFrame = useMemo(() => {
    void signalState.revision;
    return projectSessionClock(runtime, {
      nowMs,
      executionStatus: options.executionStatus,
      canNextOverride: options.canNextOverride,
      skipFlash: signalState.skipFlash,
      skipFlashKey: signalState.skipFlashKey,
    });
  }, [
    runtime,
    signalState.revision,
    signalState.skipFlash,
    signalState.skipFlashKey,
    nowMs,
    options.executionStatus,
    options.canNextOverride,
  ]);

  useEffect(() => {
    if (!enabled || !structuralFrame.isRunning || structuralFrame.isPaused) return undefined;
    if (typeof requestAnimationFrame !== 'function') return undefined;
    let frameId = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setNowMs(getRuntimeNowMs());
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(frameId);
    };
  }, [enabled, structuralFrame.isRunning, structuralFrame.isPaused]);

  return structuralFrame;
}
