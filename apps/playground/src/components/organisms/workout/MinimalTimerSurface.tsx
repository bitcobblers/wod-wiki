/**
 * MinimalTimerSurface — Tier 1: mobile fullscreen timer.
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html, Tier 1 (Minimal).
 * Portrait phone, one thumb, eyes mostly off the screen:
 * - Status strip (session clock + round dots), never moves.
 * - The clock owns the screen (tap to pause; swipe left = Next, right = Stop).
 * - Up next lives on the Next button.
 * - No stack view / interleaved history / chips — that is all this surface cuts.
 */

import React from 'react';
import { TimerControls, TimerHero, useTimerSwipeGestures } from './TimerCore';
import { TimerStatusStrip } from './TimerStatusStrip';
import type { TimerSurfaceModel } from './useTimerSurfaceModel';
import type { FocusProps } from '@/hooks/useSpatialNavigation';

export interface TimerSurfaceProps {
  model: TimerSurfaceModel;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  /** Spatial navigation focus props for TV remote support */
  getFocusProps?: (id: string) => FocusProps;
  /** Whether swipe gestures are enabled (track view only) */
  enableGestures?: boolean;
}

export const MinimalTimerSurface: React.FC<TimerSurfaceProps> = ({
  model,
  onStart,
  onPause,
  onStop,
  onNext,
  getFocusProps,
  enableGestures = true,
}) => {
  const swipe = useTimerSwipeGestures(onNext, onStop, enableGestures, model.isNextDisabled);

  return (
    <div
      className="@container flex h-full flex-col bg-background text-foreground"
      onTouchStart={swipe.onTouchStart}
      onTouchMove={swipe.onTouchMove}
      onTouchEnd={swipe.onTouchEnd}
    >
      <TimerStatusStrip
        sessionElapsedMs={model.sessionElapsedMs}
        roundCurrent={model.roundCurrent}
        roundTotal={model.roundTotal}
      />

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-3 text-center">
        <TimerHero
          model={model}
          onStart={onStart}
          onPause={onPause}
          size="mobile"
          showChips={false}
          getFocusProps={getFocusProps}
        />
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <TimerControls
          model={model}
          onStart={onStart}
          onPause={onPause}
          onStop={onStop}
          onNext={onNext}
          size="mobile"
          getFocusProps={getFocusProps}
        />
      </div>
    </div>
  );
};
