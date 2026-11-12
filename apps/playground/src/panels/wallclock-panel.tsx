/**
 * TimerDisplay — Detail-tier stack-driven timer display.
 *
 * Consumes `useSessionClockProjection` directly so Minimal, General, and Detail
 * share one authoritative label, secondary-clock deduplication, visual
 * polarity, required-timer lock, lookahead, and 60fps tick derivation.
 */

import React, { useMemo } from 'react';
import {
  useActiveControls,
  useScriptRuntime,
  useSessionClockProjection,
  useStackDisplayRows,
} from '@bitcobblers/wod-wiki-engine/react';
import { TimerStackView } from '@/components/organisms/workout/TimerStackView';
import { MetricTrackerCard } from '@/components/organisms/track/MetricTrackerCard';
import { useActiveRunStore } from '@/stores/activeRunStore';
import type { FocusProps } from '@/hooks/useSpatialNavigation';
import type { ITimerDisplayEntry } from '@/clock/types/DisplayTypes';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface TimerDisplayProps {
  elapsedMs: number;
  hasActiveBlock: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  isRunning: boolean;
  isPaused?: boolean;
  disableNext?: boolean;
  canNext?: boolean;
  compact?: boolean;
  onBlockHover?: (blockKey: string | null) => void;
  onBlockClick?: (blockKey: string) => void;
  enableDisplayStack?: boolean;
  getFocusProps?: (id: string) => FocusProps;
}

const StackIntegratedTimer: React.FC<TimerDisplayProps> = (props) => {
  const runtime = useScriptRuntime();
  const executionStatus = useActiveRunStore((s) => s.execution.status);
  const activeControls = useActiveControls();
  const stackItems = useStackDisplayRows();

  const normalizedStatus =
    props.isPaused || executionStatus === 'paused'
      ? 'paused'
      : executionStatus === 'error'
        ? 'idle'
        : executionStatus;

  const frame = useSessionClockProjection({
    runtime,
    executionStatus: normalizedStatus,
    canNextOverride: props.canNext,
  });

  const actions = useMemo(() => {
    return activeControls
      .filter((btn) => btn.visible && btn.enabled && btn.eventName)
      .map((btn) => ({
        id: btn.id,
        name: btn.label,
        eventName: btn.eventName!,
        ownerId: '',
        displayLabel: btn.label,
        isPinned: btn.isPinned,
      }));
  }, [activeControls]);

  const primaryTimerEntry = useMemo<ITimerDisplayEntry>(
    () => ({
      id: 'primary-session-clock',
      ownerId: 'primary',
      timerMemoryId: '',
      label: frame.mainLabel,
      format: 'up',
      accumulatedMs: frame.displayMs,
      role: 'primary',
    }),
    [frame.mainLabel, frame.displayMs],
  );

  const secondaryTimerEntries = useMemo<ITimerDisplayEntry[]>(
    () =>
      frame.secondaryTimers.map((st) => ({
        id: st.id,
        ownerId: st.id,
        timerMemoryId: '',
        label: st.label,
        format: 'up',
        accumulatedMs: st.displayMs,
        role: 'auto',
      })),
    [frame.secondaryTimers],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 shrink overflow-y-auto pb-2 empty:hidden">
        <MetricTrackerCard />
      </div>
      <TimerStackView
        elapsedMs={frame.displayMs}
        hasActiveBlock={props.hasActiveBlock}
        onStart={props.onStart}
        onPause={props.onPause}
        onStop={props.onStop}
        onNext={props.onNext}
        actions={actions.length > 0 ? actions : undefined}
        skipFlash={frame.skipFlash}
        skipFlashKey={frame.skipFlashKey}
        polarity={frame.polarity}
        isRequiredLockActive={frame.isRequiredLockActive}
        roundLabel={frame.roundLabel}
        upNext={frame.upNext}
        onAction={(eventName, payload) => {
          runtime.handle({ name: eventName, timestamp: new Date(), data: payload });
          switch (eventName) {
            case 'timer:pause':
              props.onPause?.();
              break;
            case 'timer:resume':
            case 'timer:start':
              props.onStart?.();
              break;
            case 'workout:stop':
              props.onStop?.();
              break;
          }
        }}
        isRunning={frame.isRunning}
        isPaused={frame.isPaused}
        disableNext={props.disableNext ?? frame.isNextDisabled}
        primaryTimer={primaryTimerEntry}
        subLabels={frame.subLabels}
        secondaryTimers={secondaryTimerEntries}
        stackItems={stackItems}
        compact={props.compact}
        enableGestures={true}
        getFocusProps={props.getFocusProps}
      />
    </div>
  );
};

export const TimerDisplay: React.FC<TimerDisplayProps> = (props) => {
  if (props.enableDisplayStack) {
    return <StackIntegratedTimer {...props} />;
  }

  return (
    <TimerStackView
      elapsedMs={props.elapsedMs}
      hasActiveBlock={props.hasActiveBlock}
      onStart={props.onStart}
      onPause={props.onPause}
      onStop={props.onStop}
      onNext={props.onNext}
      isRunning={props.isRunning}
      isPaused={props.isPaused}
      disableNext={props.disableNext}
      compact={props.compact}
      enableGestures={true}
      getFocusProps={props.getFocusProps}
    />
  );
};
