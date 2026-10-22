/**
 * TimerDisplay - Stack-driven timer display component
 * 
 * Subscribes to runtime stack events and reads block memory directly.
 * No global memory store — blocks own their state, stack events drive UI updates.
 * 
 * Timer Pinning:
 * - Scans stack bottom-to-top for the lowest block with timer role === 'primary'
 * - If no pinned timer exists, falls back to the leaf (top-of-stack) timer
 * - This allows parent blocks (For Time, AMRAP) to pin their timer as the main display
 */

import React, { useMemo } from 'react';
import { useScriptRuntime } from '@bitcobblers/wod-wiki-engine/react';
import {
  getRuntimeNowMs,
} from '@bitcobblers/wod-wiki-engine';
import {
  usePrimaryTimer,
  useSecondaryTimers,
  useStackTimers,
  useActiveControls,
  useStackDisplayRows,
} from '@bitcobblers/wod-wiki-engine/react';
import { useRoundDisplay } from '@bitcobblers/wod-wiki-engine/react';
import { calculateDuration } from '@/lib/timeUtils';

import { TimerStackView } from '@/components/organisms/workout/TimerStackView';
import { MetricTrackerCard } from '@/components/organisms/track/MetricTrackerCard';
import { useWorkbenchSession } from '@/stores/workbenchSessionStore'
import { metricPresentation } from '@bitcobblers/wod-wiki-engine';
import type { FocusProps } from '@/hooks/useSpatialNavigation';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface TimerDisplayProps {
  /** Current elapsed time in milliseconds */
  elapsedMs: number;

  /** Whether a workout block is active */
  hasActiveBlock: boolean;

  /** Callback to start the timer */
  onStart: () => void;

  /** Callback to pause the timer */
  onPause: () => void;

  /** Callback to stop the timer */
  onStop: () => void;

  /** Callback to advance to next segment */
  onNext: () => void;

  /** Whether the timer is currently running */
  isRunning: boolean;

  /** Whether the workout is paused with resumable state */
  isPaused?: boolean;

  /** Disable next/skip controls */
  disableNext?: boolean;

  /** Authoritative Next availability from the clock snapshot (beyond paused). */
  canNext?: boolean;

  /** Enable compact mode for mobile */
  compact?: boolean;

  /** Callback when hovering a timer block (for highlighting in editor) */
  onBlockHover?: (blockKey: string | null) => void;

  /** Callback when clicking a timer block (for navigation) */
  onBlockClick?: (blockKey: string) => void;

  /** Enable stack-driven display features (requires RuntimeLifecycleProvider) */
  enableDisplayStack?: boolean;

  /** Spatial navigation focus props for TV remote support */
  getFocusProps?: (id: string) => FocusProps;
}



/**
 * StackIntegratedTimer - Timer with full runtime integration
 * 
 * Subscribes to:
 * - Stack events (push/pop) via useSnapshotBlocks
 * - Block timer memory via useStackTimers
 * - Block controls memory via useActiveControls
 * 
 * When a block is popped from the stack, its memory subscriptions complete
 * automatically and the stack event triggers a UI re-render.
 */
const StackIntegratedTimer: React.FC<TimerDisplayProps> = (props) => {
  const runtime = useScriptRuntime();
  const viewMode = useWorkbenchSession(s => s.viewMode);
  // Subscribe to runtime execution status so the Play/Pause toggle reflects
  // the runtime state, not just whether a timer span is currently open.
  // This prevents the "Run while running silently does nothing" UX bug ([UX-02]):
  // even between segments where no timer span is open, the runtime is still
  // active and the button must show Pause (not Play).
  const executionStatus = useWorkbenchSession(s => s.execution.status);

  // Flash message state for required-timer skip attempts
  // skipFlashKey increments on each skip, giving the flash element a unique key
  // so React re-mounts it and restarts the animation even on rapid repeated attempts.
  const [skipFlashKey, setSkipFlashKey] = React.useState(0);
  const [skipFlash, setSkipFlash] = React.useState(false);
  const skipFlashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to timer:skip-attempt events from the runtime event bus
  React.useEffect(() => {
    if (!runtime) return;
    const unsubscribe = runtime.eventBus.on('timer:skip-attempt', () => {
      setSkipFlashKey(k => k + 1);
      setSkipFlash(true);
      if (skipFlashTimer.current) clearTimeout(skipFlashTimer.current);
      skipFlashTimer.current = setTimeout(() => setSkipFlash(false), 3000);
    }, 'ui-flash');
    return () => {
      unsubscribe();
      if (skipFlashTimer.current) clearTimeout(skipFlashTimer.current);
    };
  }, [runtime]);

  // Stack-driven hooks — subscribe to block memory directly
  const primaryTimer = usePrimaryTimer();
  const secondaryTimers = useSecondaryTimers();
  const allTimers = useStackTimers();
  const activeControls = useActiveControls();
  const stackItems = useStackDisplayRows();

  // Find the Rounds block from the stack (if any) and subscribe to its round state
  // This gives us a reactive "Round X of Y" label that updates as rounds advance
  const roundsItem = stackItems?.find(i => i.block.blockType === 'Rounds');
  const roundDisplay = useRoundDisplay(roundsItem?.block);

  // ---------------------------------------------------------------------------
  // Ticking Logic for Open Spans
  // ---------------------------------------------------------------------------
  const [now, setNow] = React.useState(getRuntimeNowMs());

  // Check if ANY timer is running (has an open span)
  const isAnyTimerRunning = useMemo(() => {
    return allTimers.some(t => t.timer.spans.some(s => s.ended === undefined));
  }, [allTimers]);

  // Run animation frame loop only when needed
  React.useEffect(() => {
    if (!isAnyTimerRunning) return;

    let frameId: number;
    const update = () => {
      setNow(getRuntimeNowMs());
      frameId = requestAnimationFrame(update);
    };

    update();
    return () => cancelAnimationFrame(frameId);
  }, [isAnyTimerRunning]);

  // ---------------------------------------------------------------------------
  // Data Derivation (using `now`)
  // ---------------------------------------------------------------------------

  // 1. Primary Timer Elapsed
  // Note: We use the memory-derived elapsed time, overriding props.elapsedMs
  const primaryElapsedMs = useMemo(() => {
    if (!primaryTimer) return 0;
    return calculateDuration(primaryTimer.timer.spans, now);
  }, [primaryTimer, now]);

  // 2. Timer States for Stack Items
  const timerStates = useMemo(() => {
    const map = new Map<string, { elapsed: number; duration?: number; format: 'down' | 'up' }>();

    for (const entry of allTimers) {
      const blockKey = entry.block.key.toString();
      const elapsed = calculateDuration(entry.timer.spans, now);

      map.set(blockKey, {
        elapsed,
        duration: entry.timer.durationMs,
        format: entry.timer.direction
      });
    }

    return map;
  }, [allTimers, now]);

  // Convert primary timer to Display Entry
  const primaryTimerEntry = useMemo(() => {
    if (!primaryTimer) return undefined;
    const blockKey = primaryTimer.block.key.toString();
    return {
      id: `timer-${blockKey}`,
      ownerId: blockKey,
      timerMemoryId: '',
      label: primaryTimer.timer.label,
      format: primaryTimer.timer.direction,
      durationMs: primaryTimer.timer.durationMs,
      role: primaryTimer.isPinned ? 'primary' as const : 'auto' as const,
    };
  }, [primaryTimer]);

  // Convert secondary timers
  const secondaryTimerEntries = useMemo(() => {
    return secondaryTimers.map(entry => {
      const blockKey = entry.block.key.toString();
      return {
        id: `timer-${blockKey}`,
        ownerId: blockKey,
        timerMemoryId: '',
        label: entry.timer.label,
        format: entry.timer.direction,
        durationMs: entry.timer.durationMs,
        role: entry.isPinned ? 'primary' as const : 'auto' as const,
      };
    });
  }, [secondaryTimers]);

  // Convert active controls
  const actions = useMemo(() => {
    return activeControls
      .filter(btn => btn.visible && btn.enabled && btn.eventName)
      .map(btn => ({
        id: btn.id,
        name: btn.label,
        eventName: btn.eventName!,
        ownerId: '',
        displayLabel: btn.label,
        isPinned: btn.isPinned,
      }));
  }, [activeControls]);

  // The focused block is the primary timer's block
  const focusedBlockId = primaryTimer ? primaryTimer.block.key.toString() : undefined;

  // 3. Label & Time Logic for Display
  const { mainLabel, subLabel, activeTimerEntry, activeElapsed } = useMemo(() => {
    // Determine the Leaf Item (lowest child on stack)
    const leafItem = stackItems?.find(i => i.isLeaf);
    const leafLabel = leafItem?.label;

    // Determine the Context Item (e.g. Rounds, AMRAP, EMOM)
    // We prefer a Rounds block if one exists, otherwise we use the primary timer's block
    const roundsItemInMemo = stackItems?.find(i => i.block.blockType === 'Rounds');
    // Use the reactive roundDisplay?.label ("Round X of Y") if available,
    // otherwise fall back to the static block label ("3 Rounds")
    const roundsLabel = roundDisplay?.label ?? roundsItemInMemo?.label;

    // Find the timer corresponding to the leaf block
    const leafTimer = leafItem ? allTimers.find(t => t.block.key.toString() === leafItem.block.key.toString()) : undefined;
    const leafElapsed = leafTimer ? calculateDuration(leafTimer.timer.spans, now) : 0;

    // If we have a Pinned Primary Timer
    if (primaryTimer && primaryTimer.isPinned) {
      const pinnedElapsed = calculateDuration(primaryTimer.timer.spans, now);

      // Label Resolution:
      // - If we have a rounds label, use it as main and leaf as sub
      // - Otherwise use primary timer label as main and leaf as sub
      const resolvedMainLabel = roundsLabel || primaryTimer.timer.label;
      const resolvedSubLabel = (resolvedMainLabel === leafLabel) ? undefined : leafLabel;

      return {
        mainLabel: resolvedMainLabel,
        subLabel: resolvedSubLabel,
        activeTimerEntry: primaryTimer,
        activeElapsed: pinnedElapsed
      };
    }

    // No pinned timer (Primary is auto/fallback) -> Show the Leaf Label & Time
    // If we have a rounds block context, use it as main label and leaf as sub
    if (roundsLabel && roundsLabel !== leafLabel) {
      return {
        mainLabel: roundsLabel,
        subLabel: leafLabel,
        activeTimerEntry: leafTimer || primaryTimer,
        activeElapsed: leafTimer ? leafElapsed : primaryElapsedMs
      };
    }

    return {
      mainLabel: leafLabel || primaryTimer?.timer.label || "Timer",
      subLabel: undefined,
      activeTimerEntry: leafTimer || primaryTimer,
      activeElapsed: leafTimer ? leafElapsed : primaryElapsedMs /* fallback to session if leaf has no timer */
    };
  }, [primaryTimer, stackItems, allTimers, now, primaryElapsedMs, roundDisplay]);

  // Build subLabels array for multi-line context above the clock.
  // When the leaf block has multiple display rows (grouped code statements),
  // each row is shown as its own line. Otherwise a single subLabel line is used.
  const subLabels = useMemo((): string[] | undefined => {
    const leafItem = stackItems?.find(i => i.isLeaf);
    if (!leafItem) return subLabel ? [subLabel] : undefined;

    // If the leaf has multiple display rows, extract text from each row
    if (leafItem.displayRows && leafItem.displayRows.length > 1) {
      const lines = leafItem.displayRows
        .map(row => metricPresentation.presentGroup([...row], 'timer-subtitle')
          .filter(t => t.visible)
          .map(t => t.label).filter(Boolean).join(' ').trim()
        )
        .filter(Boolean);
      if (lines.length > 0) return lines;
    }

    return subLabel ? [subLabel] : undefined;
  }, [stackItems, subLabel]);

  // Override the label/values in the primaryTimerEntry sent to the view
  const displayTimerEntry = useMemo(() => {
    // If we have an override from Step 3 (activeTimerEntry), use it
    if (activeTimerEntry) {
      const blockKey = activeTimerEntry.block.key.toString();
      return {
        id: `timer-${blockKey}`,
        ownerId: blockKey,
        timerMemoryId: '',
        label: mainLabel,
        format: activeTimerEntry.timer.direction,
        durationMs: activeTimerEntry.timer.durationMs,
        role: activeTimerEntry.isPinned ? 'primary' as const : 'auto' as const,
        accumulatedMs: activeElapsed
      };
    }

    // Otherwise fallback to the existing primaryTimerEntry (likely session or leaf from hook)
    // but update label and elapsed
    if (!primaryTimerEntry) return undefined;

    return {
      ...primaryTimerEntry,
      label: mainLabel,
      accumulatedMs: activeElapsed
    };
  }, [primaryTimerEntry, activeTimerEntry, mainLabel, activeElapsed]);

  return (
    // min-h-0 (no flex-shrink-0): bounded hosts (home pane gate, landscape) must
    // be able to shrink this stack; the tracker strip yields first and scrolls.
    // pb-2 + gap-2 reproduces the old 16px desktop gap while collapsing to 8px
    // (then 0 with the strip) when the host is short.
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 shrink overflow-y-auto pb-2">
        <MetricTrackerCard />
      </div>
      <TimerStackView
        // Use our calculated elapsed time from the active selection
        elapsedMs={activeElapsed}
        // Pass other props
        hasActiveBlock={props.hasActiveBlock}
        onStart={props.onStart}
        onPause={props.onPause}
        onStop={props.onStop}
        onNext={props.onNext}
        actions={actions.length > 0 ? actions : undefined}
        skipFlash={skipFlash}
        skipFlashKey={skipFlashKey}
        onAction={(eventName, payload) => {
          // Dispatch the event to the runtime's event bus.
          // For 'next' events, this goes through NextEventHandler → NextAction
          // which handles block advancement directly.
          runtime.handle({ name: eventName, timestamp: new Date(), data: payload });

          // For non-runtime events, delegate to the appropriate prop callback.
          // Note: 'next' is NOT delegated to props.onNext() because the
          // runtime.handle() call above already advances the block. Calling
          // props.onNext() would double-dispatch and skip a block.
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
        // If any timer span is open OR the runtime is actively executing,
        // the display should treat the workout as running. Including the
        // execution status ensures the central control button shows Pause
        // (and never the silently-failing Play) whenever the runtime is
        // active, even between blocks where no timer span is open.
        isRunning={isAnyTimerRunning || executionStatus === 'running'}
        isPaused={executionStatus === 'paused'}
        disableNext={executionStatus === 'paused' || props.canNext === false}

        primaryTimer={displayTimerEntry}
        subLabel={subLabel}
        subLabels={subLabels}
        secondaryTimers={secondaryTimerEntries}
        stackItems={stackItems}
        compact={props.compact}
        focusedBlockId={focusedBlockId}
        timerStates={timerStates}
        enableGestures={viewMode === 'track'}
        getFocusProps={props.getFocusProps}
      />
    </div>
  );
};

/**
 * TimerDisplay - Enhanced timer display component
 *
 * ponytail: the old per-display hardware keydown listener (any-Enter Next)
 * was retired here — the shared clock command keyboard in `@/clock/clockCommands`
 * now owns foreground input via the live authority; upgrade path is none, the
 * shared owner covers all tiers and gates.
 */
export const TimerDisplay: React.FC<TimerDisplayProps> = (props) => {
  const viewMode = useWorkbenchSession(s => s.viewMode);

  // If display stack is enabled (runtime available), render with runtime hooks
  if (props.enableDisplayStack) {
    return <StackIntegratedTimer {...props} />;
  }

  // Render without runtime dependencies (fallback)
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
      enableGestures={viewMode === 'track'}
      getFocusProps={props.getFocusProps}
    />
  );
};

