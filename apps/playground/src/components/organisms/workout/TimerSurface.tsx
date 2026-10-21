/**
 * TimerSurface — the tier picker (ADR 0003, docs/adrs/0003-timer-surface-tiers.md).
 *
 * Container size decides the tier — no new breakpoints:
 *   compact (<500px) → MinimalTimerSurface
 *   wide    (≥500px) → GeneralTimerSurface (full hero at any height)
 *   full    (≥900px) → TimerDisplay (Detail: StackIntegratedTimer + TimerStackView)
 *
 * VisualStatePanel gating is host-layout logic and stays with the hosts: it
 * belongs only beside Detail (full). The cast receiver bypasses this picker
 * entirely — receiver-rpc mounts GeneralTimerSurface directly.
 *
 * The model hook runs on every tier; on Detail its subscriptions are redundant
 * but cheap, and unconditional use keeps hook order trivial.
 */

import React from 'react';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { TimerDisplay } from '@/panels/wallclock-panel';
import { MetricTrackerCard } from '@/components/organisms/track/MetricTrackerCard';
import { MinimalTimerSurface } from './MinimalTimerSurface';
import { GeneralTimerSurface } from './GeneralTimerSurface';
import { useTimerSurfaceModel, type TimerSurfaceHandlers } from './useTimerSurfaceModel';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';
import type { FocusProps } from '@/hooks/useSpatialNavigation';

export interface TimerSurfaceProps extends TimerSurfaceHandlers {
  /** Current elapsed time — Detail passthrough */
  elapsedMs: number;
  /** Whether a workout block is active — Detail passthrough */
  hasActiveBlock: boolean;
  isRunning: boolean;
  /** Detail-tier stack interactions forwarded to TimerDisplay */
  onBlockHover?: (blockKey: string | null) => void;
  onBlockClick?: (blockKey: string) => void;
  /** Stack-driven display features (requires RuntimeLifecycleProvider) */
  enableDisplayStack?: boolean;
  /** Swipe gestures (Minimal, track view only) */
  enableGestures?: boolean;
  /** Workout title for the General top bar */
  workoutTitle?: string;
  getFocusProps?: (id: string) => FocusProps;
}

export const TimerSurface: React.FC<TimerSurfaceProps> = (props) => {
  const { isCompact, isFull } = usePanelSize();
  const model = useTimerSurfaceModel({
    onStart: props.onStart,
    onPause: props.onPause,
    onStop: props.onStop,
    onNext: props.onNext,
    isPaused: !!props.isPaused,
    canNext: props.canNext,
  });

  if (isFull) {
    return (
      <TimerDisplay
        elapsedMs={props.elapsedMs}
        hasActiveBlock={props.hasActiveBlock}
        onStart={props.onStart}
        onPause={props.onPause}
        onStop={props.onStop}
        onNext={props.onNext}
        isRunning={props.isRunning}
        isPaused={props.isPaused}
        canNext={props.canNext}
        onBlockHover={props.onBlockHover}
        onBlockClick={props.onBlockClick}
        enableDisplayStack={props.enableDisplayStack}
        getFocusProps={props.getFocusProps}
      />
    );
  }

  // Live metric bubbles ride Minimal and General. ponytail: live metric
  // bubbles only — in-run metric INPUT stays Detail-only until an input
  // design exists (ADR 0003 §4); upgrade path is a slot prop per surface.
  const promptRow = (
    <div
      data-testid={TEST_IDS.TIMER_METRIC_PROMPTS}
      className="shrink-0 overflow-y-auto border-b border-border px-4 py-1.5"
    >
      <MetricTrackerCard />
    </div>
  );

  if (isCompact) {
    return (
      <MinimalTimerSurface
        model={model}
        onStart={props.onStart}
        onPause={props.onPause}
        onStop={props.onStop}
        onNext={props.onNext}
        getFocusProps={props.getFocusProps}
        enableGestures={props.enableGestures}
        promptRow={promptRow}
      />
    );
  }

  return (
    <GeneralTimerSurface
      model={model}
      onStart={props.onStart}
      onPause={props.onPause}
      onStop={props.onStop}
      onNext={props.onNext}
      getFocusProps={props.getFocusProps}
      workoutTitle={props.workoutTitle}
      promptRow={promptRow}
    />
  );
};
