/**
 * useRuntimeExecution - Custom React hook for managing ScriptRuntime execution
 * 
 * Encapsulates execution logic, interval management, and lifecycle cleanup.
 * 
 * Architecture Decision:
 * - Fixed 20ms tick rate (50 ticks per second)
 * - No speed control (removed for simplicity)
 * - Automatic cleanup on unmount
 * - Reusable across components
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ScriptRuntime } from '../../runtime/ScriptRuntime';
import { TickEvent } from '../../runtime/events/TickEvent';
import { wallClockNow } from '../../runtime/INowProvider';

/** Fixed execution tick rate in milliseconds (50 ticks per second) */
const EXECUTION_TICK_RATE_MS = 20;

/**
 * Execution status states
 */
export type ExecutionStatus =
  | 'idle'       // No runtime or not started
  | 'running'    // Active execution with interval
  | 'paused'     // Execution stopped but state preserved
  | 'completed'  // Runtime finished successfully
  | 'error';     // Runtime encountered error

/**
 * Return type for useRuntimeExecution hook
 */
export interface UseRuntimeExecutionReturn {
  status: ExecutionStatus;
  elapsedTime: number;
  stepCount: number;
  startTime: number | null;
  start: () => void;
  pause: () => void;
  stop: () => void;
  reset: () => void;
  step: () => void;
}

/**
 * Manages ScriptRuntime execution lifecycle with fixed 20ms tick rate
 * 
 * @param runtime - The ScriptRuntime instance to execute (null if not ready)
 * @returns Object with execution state and control methods
 */
export const useRuntimeExecution = (
  runtime: ScriptRuntime | null
): UseRuntimeExecutionReturn => {
  const [status, setStatus] = useState<ExecutionStatus>('idle');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  /**
   * Stops continuous execution without clearing metrics.
   * Preserves elapsedTime and startTime for completion reporting.
   */
  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (startTimeRef.current !== null) {
      const now = runtime?.nowProvider?.nowMs() ?? wallClockNow.nowMs();
      setElapsedTime(now - startTimeRef.current);
    }
    setStatus('idle');
  }, [runtime]);

  /**
   * Executes a single runtime step
   * Called by interval timer and step() method
   */
  const executeStep = useCallback(() => {
    if (!runtime) return;

    try {
      // Use TickEvent for periodic updates instead of NextEvent
      const tickEvent = new TickEvent(undefined, runtime.nowProvider);
      runtime.handle(tickEvent);
      setStepCount(prev => prev + 1);
    } catch {
      stop();
      setStatus('error');
    }
  }, [runtime, stop]);

  /**
   * Reactive completion detection
   * Ensures 'completed' status is set immediately when the stack becomes empty,
   * regardless of whether the playback loop is active. A run advanced purely
   * by Next events never enters 'running' — a drained stack still means done.
   */
  useEffect(() => {
    if (!runtime) return;

    // Subscribe to stack snapshots to detect when everything is finished
    const unsubscribe = runtime.subscribeToStack((snapshot) => {
      if (snapshot.blocks.length === 0 && status !== 'completed') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (startTimeRef.current !== null) {
          const now = runtime?.nowProvider?.nowMs() ?? wallClockNow.nowMs();
          setElapsedTime(now - startTimeRef.current);
        }
        setStatus('completed');
      }
    });

    return unsubscribe;
  }, [runtime, status]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  /**
   * Starts continuous execution at fixed 20ms tick rate
   */
  const start = useCallback(() => {
    if (!runtime) {
      console.warn('useRuntimeExecution: Cannot start execution without a runtime');
      return;
    }
    if (status === 'running') {
      console.warn('useRuntimeExecution: Runtime is already running');
      return;
    }

    // Emit timer:resume event when resuming from paused state
    if (status === 'paused') {
      runtime.handle({
        name: 'timer:resume',
        timestamp: new Date(),
        data: {}
      });
    }

    setStatus('running');
    const now = runtime?.nowProvider?.nowMs() ?? wallClockNow.nowMs();
    startTimeRef.current = now - elapsedTime; // Resume from paused time

    // Only set startTime on first start (not resume)
    if (elapsedTime === 0) {
      setStartTime(now);
    }

    // Start interval for subsequent steps
    intervalRef.current = setInterval(executeStep, EXECUTION_TICK_RATE_MS);
  }, [runtime, status, elapsedTime, executeStep]);

  /**
   * Pauses execution, preserving state
   */
  const pause = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (startTimeRef.current !== null) {
      const now = runtime?.nowProvider?.nowMs() ?? wallClockNow.nowMs();
      setElapsedTime(now - startTimeRef.current);
    }

    // Emit timer:pause event to update timer memory spans
    if (runtime) {
      const pauseDate = runtime.nowProvider?.now() ?? wallClockNow.now();
      runtime.handle({
        name: 'timer:pause',
        timestamp: pauseDate,
        data: {}
      });
    }

    setStatus('paused');
  }, [runtime]);

  /**
   * Resets execution state and clears all metrics.
   * Used for "replay" functionality or starting fresh.
   */
  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setElapsedTime(0);
    setStepCount(0);
    setStatus('idle');
    setStartTime(null);
    startTimeRef.current = null;

    // Reset runtime if available
    if (runtime) {
      // TODO: Add runtime.reset() method when available
    }
  }, [runtime]);

  /**
   * Executes a single step manually
   * Used for debugging and step-through execution
   */
  const step = useCallback(() => {
    if (!runtime || status === 'running') {
      return;
    }

    setStatus('paused');
    executeStep();
  }, [runtime, status, executeStep]);

  /**
   * Update elapsed time while running
   */
  useEffect(() => {
    if (status !== 'running' || !startTimeRef.current) return;

    const updateInterval = setInterval(() => {
      setElapsedTime((runtime?.nowProvider?.nowMs() ?? wallClockNow.nowMs()) - startTimeRef.current!);
    }, 100); // Update display every 100ms

    return () => clearInterval(updateInterval);
  }, [status, runtime?.nowProvider]);

  /**
   * Cleanup on unmount - critical for preventing memory leaks
   */
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  /**
   * Reset state when runtime changes
   */
  useEffect(() => {
    reset();
  }, [runtime, reset]);

  return useMemo(() => ({
    status,
    elapsedTime,
    stepCount,
    startTime,
    start,
    pause,
    stop,
    reset,
    step
  }), [status, elapsedTime, stepCount, startTime, start, pause, stop, reset, step]);
};
