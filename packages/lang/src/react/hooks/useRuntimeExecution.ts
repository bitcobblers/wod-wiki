/**
 * useRuntimeExecution - Custom React hook for managing ScriptRuntime execution
 *
 * Encapsulates execution logic, interval management, and lifecycle cleanup.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ScriptRuntime } from '../../runtime/ScriptRuntime';
import { TickEvent } from '../../runtime/events/TickEvent';
import { wallClockNow } from '../../runtime/INowProvider';

/** Fixed execution tick rate in milliseconds (50 ticks per second) */
const EXECUTION_TICK_RATE_MS = 20;

export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error';

export interface UseRuntimeExecutionReturn {
  status: ExecutionStatus;
  elapsedTime: number;
  getElapsedTime: () => number;
  stepCount: number;
  startTime: number | null;
  start: () => void;
  pause: () => void;
  stop: () => void;
  reset: () => void;
  step: () => void;
}

export const useRuntimeExecution = (
  runtime: ScriptRuntime | null
): UseRuntimeExecutionReturn => {
  const [status, setStatus] = useState<ExecutionStatus>('idle');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<ExecutionStatus>('idle');
  const accumulatedElapsedRef = useRef<number>(0);
  const segmentStartRef = useRef<number | null>(null);
  const hasStartTimeRef = useRef(false);

  const readNowMs = useCallback(
    () => runtime?.nowProvider?.nowMs() ?? wallClockNow.nowMs(),
    [runtime],
  );

  const readNowDate = useCallback(
    () => runtime?.nowProvider?.now() ?? wallClockNow.now(),
    [runtime],
  );

  const getElapsedTime = useCallback((): number => {
    if (statusRef.current === 'running' && segmentStartRef.current !== null) {
      return accumulatedElapsedRef.current + Math.max(0, readNowMs() - segmentStartRef.current);
    }
    return accumulatedElapsedRef.current;
  }, [readNowMs]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const finalElapsed = getElapsedTime();
    accumulatedElapsedRef.current = finalElapsed;
    segmentStartRef.current = null;
    statusRef.current = 'idle';
    setElapsedTime(finalElapsed);
    setStatus('idle');
  }, [getElapsedTime]);

  const executeStep = useCallback(() => {
    if (!runtime) return;

    try {
      const tickEvent = new TickEvent(undefined, runtime.nowProvider);
      runtime.handle(tickEvent);
      setStepCount(prev => prev + 1);
    } catch {
      stop();
      statusRef.current = 'error';
      setStatus('error');
    }
  }, [runtime, stop]);

  useEffect(() => {
    if (!runtime) return;

    const unsubscribe = runtime.subscribeToStack((snapshot) => {
      if (snapshot.blocks.length === 0 && statusRef.current !== 'completed') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        const finalElapsed = getElapsedTime();
        accumulatedElapsedRef.current = finalElapsed;
        segmentStartRef.current = null;
        statusRef.current = 'completed';
        setElapsedTime(finalElapsed);
        setStatus('completed');
      }
    });

    return unsubscribe;
  }, [runtime, getElapsedTime]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (!runtime) {
      console.warn('useRuntimeExecution: Cannot start execution without a runtime');
      return;
    }
    if (statusRef.current === 'running') {
      console.warn('useRuntimeExecution: Runtime is already running');
      return;
    }

    if (statusRef.current === 'paused') {
      runtime.handle({
        name: 'timer:resume',
        timestamp: readNowDate(),
        data: {}
      });
    }

    const now = readNowMs();
    segmentStartRef.current = now;
    if (!hasStartTimeRef.current) {
      hasStartTimeRef.current = true;
      setStartTime(now);
    }

    statusRef.current = 'running';
    setStatus('running');
    intervalRef.current = setInterval(executeStep, EXECUTION_TICK_RATE_MS);
  }, [runtime, readNowDate, readNowMs, executeStep]);

  const pause = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const pausedElapsed = getElapsedTime();
    accumulatedElapsedRef.current = pausedElapsed;
    segmentStartRef.current = null;
    setElapsedTime(pausedElapsed);

    if (runtime) {
      runtime.handle({
        name: 'timer:pause',
        timestamp: readNowDate(),
        data: {}
      });
    }

    statusRef.current = 'paused';
    setStatus('paused');
  }, [runtime, getElapsedTime, readNowDate]);

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    accumulatedElapsedRef.current = 0;
    segmentStartRef.current = null;
    hasStartTimeRef.current = false;
    statusRef.current = 'idle';
    setElapsedTime(0);
    setStepCount(0);
    setStatus('idle');
    setStartTime(null);
  }, []);

  const step = useCallback(() => {
    if (!runtime || statusRef.current === 'running') {
      return;
    }

    statusRef.current = 'paused';
    setStatus('paused');
    executeStep();
  }, [runtime, executeStep]);

  useEffect(() => {
    if (status !== 'running') return;

    const updateInterval = setInterval(() => {
      setElapsedTime(getElapsedTime());
    }, 100);

    return () => clearInterval(updateInterval);
  }, [status, getElapsedTime]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    reset();
  }, [runtime, reset]);

  return useMemo(() => ({
    status,
    elapsedTime,
    getElapsedTime,
    stepCount,
    startTime,
    start,
    pause,
    stop,
    reset,
    step
  }), [status, elapsedTime, getElapsedTime, stepCount, startTime, start, pause, stop, reset, step]);
};
