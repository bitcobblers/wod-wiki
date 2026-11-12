/**
 * useTimerSurfaceModel — thin Playground adapter over the engine's unified
 * `useSessionClockProjection`.
 *
 * Keeps `TimerSurfaceModel` + `TimerSurfaceHandlers` stable for Minimal,
 * General, Detail, and Storybook fixtures while delegating all clock
 * selection, secondary deduplication, visual polarity, skip-lock detection,
 * and single-loop ticking to `SessionClockProjection`.
 */

import { useMemo } from 'react';
import type { SessionVisualPolarity } from '@bitcobblers/wod-wiki-engine';
import { useSessionClockProjection } from '@bitcobblers/wod-wiki-engine/react';
import { useActiveRunStore } from '@/stores/activeRunStore';

export interface TimerSurfaceHandlers {
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  /** Whether the workout is paused with resumable state */
  isPaused: boolean;
  /** Authoritative command availability (clock snapshot). false disables Next
   * beyond the paused gate; undefined keeps the paused-only derivation. */
  canNext?: boolean;
}

export interface TimerSurfaceModel {
  mainLabel: string;
  subLabels?: string[];
  /** Hero clock value (countdown-aware) */
  displayMs: number;
  /** Whole-session wall clock */
  sessionElapsedMs: number;
  /** Round position (undefined when the workout has no rounds block) */
  roundCurrent?: number;
  roundTotal?: number;
  roundLabel?: string;
  /** Deduped secondary timers (rest countdowns, caps, parent intervals) */
  secondaryTimers: Array<{ id: string; label: string; displayMs: number }>;
  /** One-line description of the next segment */
  upNext: string | null;
  isRunning: boolean;
  isPaused: boolean;
  isNextDisabled: boolean;
  /** "Timer can't be skipped!" flash state (from timer:skip-attempt) */
  skipFlash: boolean;
  skipFlashKey: number;
  /** Semantic state polarity for Work / Rest / Final-5s / Paused / Overrun */
  polarity?: SessionVisualPolarity;
  /** Proactive read-side lock indicator for unexpired required countdowns */
  isRequiredLockActive?: boolean;
}

export interface UseTimerSurfaceModelOptions {
  /** False suspends the 60fps loop when a prebuilt frame or Detail view owns rendering. */
  readonly active?: boolean;
}

export function useTimerSurfaceModel(
  handlers: TimerSurfaceHandlers,
  options: UseTimerSurfaceModelOptions = {},
): TimerSurfaceModel {
  const storeStatus = useActiveRunStore((s) => s.execution.status);
  const executionStatus = handlers.isPaused
    ? 'paused'
    : storeStatus === 'error'
      ? 'idle'
      : storeStatus;

  const frame = useSessionClockProjection({
    executionStatus,
    canNextOverride: handlers.canNext,
    active: options.active ?? true,
  });

  return useMemo<TimerSurfaceModel>(
    () => ({
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
      isPaused: handlers.isPaused,
      isNextDisabled: handlers.isPaused || handlers.canNext === false,
      skipFlash: frame.skipFlash,
      skipFlashKey: frame.skipFlashKey,
      polarity: frame.polarity,
      isRequiredLockActive: frame.isRequiredLockActive,
    }),
    [frame, handlers.isPaused, handlers.canNext],
  );
}
