/**
 * TimerSurface — tier picker + interaction-role adapter (ADR 0003).
 *
 * Container size decides geometry (`compact` <500px -> Minimal, `wide` >=500px ->
 * General, `full` >=900px -> Detail), while `deriveTimerViewPolicy` pairs size
 * with interaction role so sideways phones keep swipe gestures, 768px portrait
 * tablets and pocket cast remotes gain a slide-over Stack & Splits drawer, and
 * Detail runs zero redundant 60fps hooks here.
 */

import React, { useState } from 'react';
import { ListTree, X } from 'lucide-react';
import { useOptionalScriptRuntime } from '@bitcobblers/wod-wiki-engine/react';
import { usePanelSize } from '@/panels/panel-system/PanelSizeContext';
import { TimerDisplay } from '@/panels/wallclock-panel';
import { VisualStatePanel } from '@/panels/visual-state-panel';
import { MetricTrackerCard } from '@/components/organisms/track/MetricTrackerCard';
import { MinimalTimerSurface } from './MinimalTimerSurface';
import { GeneralTimerSurface } from './GeneralTimerSurface';
import { deriveTimerViewPolicy } from './timerViewPolicy';
import {
  useTimerSurfaceModel,
  type TimerSurfaceHandlers,
  type TimerSurfaceModel,
} from './useTimerSurfaceModel';
import { TEST_IDS } from '@/lib/testIds';
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
  /** Stack-driven display features (requires ScriptRuntimeProvider) */
  enableDisplayStack?: boolean;
  /** Swipe gestures (Minimal and touch-capable General) */
  enableGestures?: boolean;
  /** Workout title for the General top bar */
  workoutTitle?: string;
  /** Protocol format badge for the General top bar */
  workoutFormat?: string;
  getFocusProps?: (id: string) => FocusProps;
  // Test/storybook seams — production defaults keep normal renders untouched.
  modelOverride?: TimerSurfaceModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DetailSurface?: React.ComponentType<any>;
  MetricPrompts?: React.ComponentType;
  showMetricPrompts?: boolean;
}

export const TimerSurface: React.FC<TimerSurfaceProps> = (props) => {
  const { mode: sizeMode, isCompact, isFull } = usePanelSize();
  const contextRuntime = useOptionalScriptRuntime();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const policy = deriveTimerViewPolicy({
    sizeMode,
    isReceiver: false,
    enableGestures: props.enableGestures,
  });

  // Suspend the 60fps projection loop when Detail renders or when a static modelOverride is passed.
  const liveModel = useTimerSurfaceModel(
    {
      onStart: props.onStart,
      onPause: props.onPause,
      onStop: props.onStop,
      onNext: props.onNext,
      isPaused: !!props.isPaused,
      canNext: props.canNext,
    },
    { active: !isFull && !props.modelOverride },
  );
  const model = props.modelOverride ?? liveModel;
  const Detail = props.DetailSurface ?? TimerDisplay;
  const Prompts = props.MetricPrompts ?? MetricTrackerCard;
  const showPrompts = props.showMetricPrompts ?? !isFull;

  if (isFull) {
    return (
      <Detail
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

  // `empty:hidden` collapses border + padding to 0px when MetricTrackerCard returns null.
  const promptRow = showPrompts ? (
    <div
      data-testid={TEST_IDS.TIMER_METRIC_PROMPTS}
      className="shrink-0 overflow-y-auto border-b border-border px-4 py-1.5 empty:hidden"
    >
      <Prompts />
    </div>
  ) : null;

  const showDrawerButton = policy.allowStackDrawer && contextRuntime !== null;
  const drawerToggleButton = showDrawerButton ? (
    <button
      type="button"
      data-testid={TEST_IDS.TIMER_STACK_DRAWER_TOGGLE}
      onClick={() => setDrawerOpen((v) => !v)}
      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
    >
      <ListTree className="h-3.5 w-3.5 text-primary" />
      <span>Stack</span>
    </button>
  ) : null;

  const stackDrawer =
    drawerOpen && showDrawerButton ? (
      <>
        <div
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 z-20 bg-black/30"
        />
        <div
          data-testid={TEST_IDS.TIMER_STACK_DRAWER}
          role="dialog"
          aria-label="Workout stack and splits"
          className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-full flex-col border-l border-border bg-background shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-foreground">Stack &amp; Splits</span>
            <button
              type="button"
              aria-label="Close stack drawer"
              onClick={() => setDrawerOpen(false)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <VisualStatePanel />
          </div>
        </div>
      </>
    ) : null;

  if (isCompact) {
    return (
      <MinimalTimerSurface
        model={model}
        onStart={props.onStart}
        onPause={props.onPause}
        onStop={props.onStop}
        onNext={props.onNext}
        getFocusProps={props.getFocusProps}
        enableGestures={policy.allowSwipeGestures}
        promptRow={promptRow}
      />
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GeneralTimerSurface
        model={model}
        onStart={props.onStart}
        onPause={props.onPause}
        onStop={props.onStop}
        onNext={props.onNext}
        getFocusProps={props.getFocusProps}
        workoutTitle={props.workoutTitle}
        workoutFormat={props.workoutFormat}
        promptRow={promptRow}
        showReceiverIndicators={policy.showReceiverIndicators}
        enableGestures={policy.allowSwipeGestures}
        headerActions={drawerToggleButton}
      />
      {stackDrawer}
    </div>
  );
};
