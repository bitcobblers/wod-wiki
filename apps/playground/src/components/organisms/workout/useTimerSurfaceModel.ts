/**
 * useTimerSurfaceModel — shared data model for the Minimal and General
 * timer surfaces (mobile fullscreen + Chromecast receiver).
 *
 * One runtime state in, one plain `TimerSurfaceModel` out. Surfaces are
 * pure presentational components over this model, so Storybook stories and
 * unit tests need no runtime. The derivation mirrors StackIntegratedTimer's
 * label rules (pinned parent timer → rounds context → leaf) but is deduped
 * for sparse surfaces: the session clock and the hero clock never show the
 * same timer, and secondary chips exclude both.
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html — "One runtime
 * state, three surfaces". The Detail tier (TimerStackView) keeps its own
 * richer derivation and is untouched.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useScriptRuntime,
  usePrimaryTimer,
  useStackTimers,
  useStackDisplayRows,
  useRoundDisplay,
  useNextPreview,
  getRuntimeNowMs,
  metricPresentation,
} from '@bitcobblers/wod-wiki-engine';
import { calculateDuration } from '@/lib/timeUtils';
import { useWorkbenchSession } from '@/stores/workbenchSessionStore';

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
  /** Deduped secondary timers (rest countdowns etc.) */
  secondaryTimers: Array<{ id: string; label: string; displayMs: number }>;
  /** One-line description of the next segment */
  upNext: string | null;
  isRunning: boolean;
  isPaused: boolean;
  isNextDisabled: boolean;
  /** "Timer can't be skipped!" flash state (from timer:skip-attempt) */
  skipFlash: boolean;
  skipFlashKey: number;
}

export function useTimerSurfaceModel(handlers: TimerSurfaceHandlers): TimerSurfaceModel {
  const runtime = useScriptRuntime();
  const executionStatus = useWorkbenchSession(s => s.execution.status);
  const primaryTimer = usePrimaryTimer();
  const allTimers = useStackTimers();
  const stackItems = useStackDisplayRows();
  const roundsItem = stackItems?.find(i => i.block.blockType === 'Rounds');
  const roundDisplay = useRoundDisplay(roundsItem?.block);
  const nextPreview = useNextPreview();

  // Flash state for required-timer skip attempts. Key increments per attempt
  // so the surface can re-mount the flash and restart its animation.
  const [skipFlashKey, setSkipFlashKey] = useState(0);
  const [skipFlash, setSkipFlash] = useState(false);
  const skipFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!runtime) return;
    const unsubscribe = runtime.eventBus.on('timer:skip-attempt', () => {
      setSkipFlashKey(k => k + 1);
      setSkipFlash(true);
      clearTimeout(skipFlashTimer.current);
      skipFlashTimer.current = setTimeout(() => setSkipFlash(false), 3000);
    }, 'ui-flash');
    return () => {
      unsubscribe();
      clearTimeout(skipFlashTimer.current);
    };
  }, [runtime]);

  const isAnyTimerRunning = allTimers.some(t => t.timer.spans.some(s => s.ended === undefined));

  const [now, setNow] = useState(getRuntimeNowMs());
  useEffect(() => {
    if (!isAnyTimerRunning) return;
    let frameId: number;
    const tick = () => {
      setNow(getRuntimeNowMs());
      frameId = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frameId);
  }, [isAnyTimerRunning]);

  const model = useMemo(() => {
    const leafItem = stackItems?.find(i => i.isLeaf);
    const leafLabel = leafItem?.label;
    const roundsLabel = roundDisplay?.label ?? roundsItem?.label;

    const leafTimer = leafItem
      ? allTimers.find(t => t.block.key.toString() === leafItem.block.key.toString())
      : undefined;
    const active = primaryTimer?.isPinned ? primaryTimer : leafTimer || primaryTimer;

    const mainLabel =
      (primaryTimer?.isPinned
        ? roundsLabel || primaryTimer.timer.label
        : roundsLabel && roundsLabel !== leafLabel
          ? roundsLabel
          : leafLabel || primaryTimer?.timer.label) || 'Timer';
    const subLabel = mainLabel === leafLabel ? undefined : leafLabel;

    // Multi-line leaf rows (grouped statements)
    let subLabels: string[] | undefined;
    if (leafItem?.displayRows && leafItem.displayRows.length > 1) {
      const lines = leafItem.displayRows
        .map(row =>
          metricPresentation
            .presentGroup([...row], 'timer-subtitle')
            .filter(t => t.visible)
            .map(t => t.label)
            .filter(Boolean)
            .join(' ')
            .trim(),
        )
        .filter(Boolean);
      if (lines.length > 0) subLabels = lines;
    }
    if (!subLabels) subLabels = subLabel ? [subLabel] : undefined;

    // Hero clock value (countdown-aware)
    let displayMs = 0;
    if (active) {
      const elapsed = calculateDuration(active.timer.spans, now);
      displayMs =
        active.timer.direction === 'down' && active.timer.durationMs
          ? Math.max(0, active.timer.durationMs - elapsed)
          : elapsed;
    }

    // Session = the pinned primary timer when present, else the longest-running
    // timer (the session block starts first and outlives every leaf). Deduped
    // from both the hero clock and the secondary chips.
    const withElapsed = allTimers.map(t => ({ t, elapsed: calculateDuration(t.timer.spans, now) }));
    const sessionEntry = primaryTimer?.isPinned
      ? { t: primaryTimer, elapsed: calculateDuration(primaryTimer.timer.spans, now) }
      : withElapsed.reduce(
          (best, cur) => (cur.elapsed > (best?.elapsed ?? -1) ? cur : best),
          withElapsed[0],
        );
    const sessionElapsedMs = sessionEntry?.elapsed ?? 0;

    // Secondary timers (excluding the active one and the session one)
    const activeKey = active?.block.key.toString();
    const sessionKey = sessionEntry?.t.block.key.toString();
    const secondaryTimers = allTimers
      .filter(t => {
        const k = t.block.key.toString();
        return k !== activeKey && k !== sessionKey;
      })
      .map(t => {
        const elapsed = calculateDuration(t.timer.spans, now);
        return {
          id: t.block.key.toString(),
          label: t.timer.label,
          displayMs:
            t.timer.direction === 'down' && t.timer.durationMs
              ? Math.max(0, t.timer.durationMs - elapsed)
              : elapsed,
        };
      });

    // One-line up-next label
    let upNext: string | null = null;
    if (nextPreview?.metrics) {
      upNext =
        metricPresentation
          .presentGroup([...nextPreview.metrics], 'timer-subtitle')
          .filter(t => t.visible)
          .map(t => t.label)
          .filter(Boolean)
          .join(' ')
          .trim() || null;
    }

    return {
      mainLabel,
      subLabels,
      displayMs,
      sessionElapsedMs,
      roundCurrent: roundDisplay?.current,
      roundTotal: roundDisplay?.total,
      roundLabel: roundDisplay?.label,
      secondaryTimers,
      upNext,
    };
  }, [primaryTimer, allTimers, stackItems, now, roundDisplay, roundsItem, nextPreview]);

  return {
    ...model,
    isRunning: isAnyTimerRunning || executionStatus === 'running',
    isPaused: handlers.isPaused,
    isNextDisabled: handlers.isPaused || handlers.canNext === false,
    skipFlash,
    skipFlashKey,
  };
}
