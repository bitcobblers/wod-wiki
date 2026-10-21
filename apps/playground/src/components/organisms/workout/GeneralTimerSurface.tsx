/**
 * GeneralTimerSurface — Tier 2: Chromecast receiver default, and mid-size
 * browser hosts via TimerSurface (ADR 0003).
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html, Tier 2 (General).
 * Room-scale reading, no interaction history:
 * - Top bar adds context, not history: session clock, workout title, and
 *   cast/audio indicators.
 * - Center column is the shared TimerCore hero with secondary chips
 *   (rest countdown, round position) restored.
 * - 10-foot controls: same Stop / Pause / Next triad, same up-next caption,
 *   scaled for D-pad distance. Swipe gestures do not apply on TV.
 *
 * Short hosts render this same full hero layout — the prototype's strip
 * compression was removed: one General view everywhere (ADR 0003).
 */

import React from 'react';
import { Cast, Timer, Volume2 } from 'lucide-react';
import { formatTimeMMSS } from '@/lib/formatTime';
import { TimerControls, TimerHero } from './TimerCore';
import type { TimerSurfaceProps } from './MinimalTimerSurface';
import { TEST_IDS } from '@/testing/contracts/TestIdContract';

export interface GeneralTimerSurfaceProps extends TimerSurfaceProps {
  /** Workout title shown in the top bar (hidden when unknown) */
  workoutTitle?: string;
  /** Optional live-metric prompt row rendered under the top bar */
  promptRow?: React.ReactNode;
}

export const GeneralTimerSurface: React.FC<GeneralTimerSurfaceProps> = ({
  model,
  onStart,
  onPause,
  onStop,
  onNext,
  workoutTitle,
  promptRow,
  getFocusProps,
}) => {
  return (
    <div
      className="@container flex h-full flex-col bg-background p-[3cqw_4cqw] text-foreground"
      data-testid={TEST_IDS.TIMER_SURFACE_GENERAL}
    >
      {/* Top bar: session + title + receiver indicators */}
      <div className="flex shrink-0 items-center gap-[1.4cqw]">
        <span className="flex items-center gap-[0.7cqw] font-mono text-[1.7cqw] text-muted-foreground tabular-nums">
          <Timer className="h-[1.9cqw] w-[1.9cqw]" />
          Session {formatTimeMMSS(model.sessionElapsedMs)}
        </span>
        {workoutTitle && (
          <span className="text-[2cqw] font-semibold tracking-tight">{workoutTitle}</span>
        )}
        <span className="ml-auto flex items-center gap-[1.4cqw] text-muted-foreground">
          <Cast className="h-[2.4cqw] w-[2.4cqw]" aria-hidden="true" />
          <Volume2 className="h-[2.4cqw] w-[2.4cqw]" aria-hidden="true" />
        </span>
      </div>

      {promptRow && <div className="shrink-0">{promptRow}</div>}

      <TimerHero
        model={model}
        onStart={onStart}
        onPause={onPause}
        size="tv"
        showChips
        getFocusProps={getFocusProps}
      />

      <div className="shrink-0">
        <TimerControls
          model={model}
          onStart={onStart}
          onPause={onPause}
          onStop={onStop}
          onNext={onNext}
          size="tv"
          getFocusProps={getFocusProps}
        />
      </div>
    </div>
  );
};
