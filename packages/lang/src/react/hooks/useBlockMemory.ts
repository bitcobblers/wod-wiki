import { useState, useEffect, useMemo } from 'react';
import { IRuntimeBlock } from '../../runtime/contracts/IRuntimeBlock';
import { MemoryType, MemoryValueOf, TimerState, RoundState, DisplayState } from '../../runtime/memory/MemoryTypes';
import { IMetricSource } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { formatDurationSmart } from '../../utils/formatTime';
import { calculateDuration } from '../../utils/timeUtils';
import { MemoryTag } from '../../runtime/memory/MemoryLocation';

/**
 * React hook to subscribe to a specific memory type on a block.
 * 
 * Automatically subscribes when the block or type changes, and
 * unsubscribes on cleanup. Returns the current value and updates
 * reactively when behaviors modify the memory.
 * 
 * @param block The runtime block to subscribe to (can be undefined)
 * @param type The memory type to subscribe to
 * @returns The current memory value or undefined
 * 
 * @example
 * ```tsx
 * function TimerComponent({ block }: { block: IRuntimeBlock }) {
 *   const timerState = useBlockMemory(block, 'time');
 *   
 *   if (!timerState) return null;
 *   
 *   return <div>Direction: {timerState.direction}</div>;
 * }
 * ```
 */
export function useBlockMemory<T extends MemoryType>(
    block: IRuntimeBlock | undefined,
    type: T
): MemoryValueOf<T> | undefined {
    const tag = type as MemoryTag;
    const getVal = (): MemoryValueOf<T> | undefined => {
        const loc = block?.getMemoryByTag(tag)[0];
        if (!loc) return undefined;
        // 'round' tag: the metrics itself IS the value (CurrentRoundMetric satisfies RoundState)
        if (tag === 'round') return loc.metrics[0] as unknown as MemoryValueOf<T>;
        return loc.metrics[0]?.value as MemoryValueOf<T> | undefined;
    };
    const [value, setValue] = useState<MemoryValueOf<T> | undefined>(getVal);

    useEffect(() => {
        if (!block) {
            setValue(undefined);
            return;
        }

        // Get initial value
        setValue(getVal());

        // Subscribe to changes
        const loc = block.getMemoryByTag(tag)[0];
        if (loc) {
            const unsubscribe = loc.subscribe((newFrags) => {
                if (tag === 'round') {
                    setValue(newFrags[0] as unknown as MemoryValueOf<T> | undefined);
                } else {
                    setValue(newFrags[0]?.value as MemoryValueOf<T> | undefined);
                }
            });
            return unsubscribe;
        }

        return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [block, type]);

    return value;
}

/**
 * Hook for subscribing to timer state from a block.
 * 
 * @param block The runtime block
 * @returns The current TimerState or undefined
 */
export function useTimerState(block: IRuntimeBlock | undefined): TimerState | undefined {
    return useBlockMemory(block, 'time');
}

/**
 * Hook for subscribing to round state from a block.
 * 
 * @param block The runtime block
 * @returns The current RoundState or undefined
 */
export function useRoundState(block: IRuntimeBlock | undefined): RoundState | undefined {
    return useBlockMemory(block, 'round');
}

/**
 * Hook for subscribing to display state from a block.
 * 
 * @param block The runtime block
 * @returns The current DisplayState or undefined
 */
export function useDisplayState(block: IRuntimeBlock | undefined): DisplayState | undefined {
    return useBlockMemory(block, 'display');
}

/**
 * Derived timer display values for UI rendering.
 */
export interface TimerDisplayValues {
    /** Total elapsed time in milliseconds */
    elapsed: number;
    /** Remaining time in milliseconds (for countdowns) */
    remaining: number | undefined;
    /** Whether the timer is currently running (not paused) */
    isRunning: boolean;
    /** Timer direction */
    direction: 'up' | 'down';
    /** Whether the timer has completed (countdown reached 0) */
    isComplete: boolean;
    /** Formatted time string (MM:SS or HH:MM:SS) */
    formatted: string;
}

/**
 * Hook for derived timer display values.
 * 
 * Computes elapsed time, remaining time, and formatted display strings
 * from the raw timer state. Uses requestAnimationFrame for smooth 60fps
 * updates when the timer is running.
 * 
 * Consolidated with useTimerElapsed - both now share calculateDuration utility.
 * 
 * @param block The runtime block
 * @returns Derived timer display values or null if no timer
 * 
 * @example
 * ```tsx
 * function TimerDisplay({ block }: { block: IRuntimeBlock }) {
 *   const display = useTimerDisplay(block);
 *   
 *   if (!display) return <div>No timer</div>;
 *   
 *   return (
 *     <div>
 *       <span>{display.formatted}</span>
 *       {display.direction === 'down' && (
 *         <span>{formatTime(display.remaining ?? 0)} remaining</span>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTimerDisplay(block: IRuntimeBlock | undefined): TimerDisplayValues | null {
    const timer = useTimerState(block);

    // Get the sender's clock time if available (Chromecast receiver), otherwise use local clock
    // We check for the global window property set by the receiver during Chromecast sessions
    const getNow = (): number => {
        // `typeof window` (not bare `window`): safe under SSR/env teardown.
        if (typeof window !== 'undefined') {
            const receiverClock = (window as unknown as { __chromecast_senderClockTimeMs?: unknown }).__chromecast_senderClockTimeMs;
            if (typeof receiverClock === 'function') return receiverClock();
        }
        return Date.now();
    };

    const [now, setNow] = useState(getNow());

    // Determine if timer is running (last span has no end time)
    const isRunning = useMemo(() => {
        if (!timer || timer.spans.length === 0) return false;
        const lastSpan = timer.spans[timer.spans.length - 1];
        return lastSpan.ended === undefined;
    }, [timer]);

    // Animation frame loop for smooth updates when running
    useEffect(() => {
        if (!isRunning) return;

        let animationFrameId: number;
        let running = true;

        const tick = () => {
            // rAF may vanish under env teardown; stop the loop instead of throwing unhandled.
            if (!running || typeof requestAnimationFrame !== 'function') return;
            setNow(getNow());
            animationFrameId = requestAnimationFrame(tick);
        };

        animationFrameId = requestAnimationFrame(tick);

        return () => {
            running = false;
            cancelAnimationFrame(animationFrameId);
        };
    }, [isRunning]);

    // Compute derived values using shared utilities
    return useMemo(() => {
        if (!timer) return null;

        const elapsed = calculateDuration(timer.spans, now);
        const remaining = timer.durationMs !== undefined
            ? Math.max(0, timer.durationMs - elapsed)
            : undefined;
        const isComplete = timer.durationMs !== undefined && elapsed >= timer.durationMs;

        // Format based on direction
        const displayMs = timer.direction === 'down' && remaining !== undefined
            ? remaining
            : elapsed;

        return {
            elapsed,
            remaining,
            isRunning,
            direction: timer.direction,
            isComplete,
            formatted: formatDurationSmart(displayMs)
        };
    }, [timer, now, isRunning]);
}

/**
 * Derived round display values for UI rendering.
 */
export interface RoundDisplayValues {
    /** Current round number */
    current: number;
    /** Total rounds (undefined for unbounded) */
    total: number | undefined;
    /** Formatted round label (e.g., "Round 3 of 5") */
    label: string;
    /** Progress as a fraction 0-1 (undefined for unbounded) */
    progress: number | undefined;
}

/**
 * Hook for derived round display values.
 * 
 * @param block The runtime block
 * @returns Derived round display values or null if no rounds
 */
export function useRoundDisplay(block: IRuntimeBlock | undefined): RoundDisplayValues | null {
    const round = useRoundState(block);
    const display = useDisplayState(block);

    return useMemo(() => {
        if (!round) return null;

        const label = display?.roundDisplay ??
            (round.total !== undefined
                ? `Round ${round.current} of ${round.total}`
                : `Round ${round.current}`);

        const progress = round.total !== undefined
            ? Math.min(1, (round.current - 1) / round.total)
            : undefined;

        return {
            current: round.current,
            total: round.total,
            label,
            progress
        };
    }, [round, display?.roundDisplay]);
}

/**
 * Hook for subscribing to the display metrics source from a block.
 *
 * Returns the `IMetricSource` interface from the block's `'metric:display'`
 * memory entry (`DisplayMetricMemory`). The returned source provides
 * precedence-resolved metric that update reactively when the underlying
 * metric memory or runtime state changes.
 *
 * This is the primary hook for UI components that need to render metrics
 * from a runtime block with proper origin precedence (user > runtime > compiler > parser).
 *
 * @param block The runtime block (can be undefined)
 * @returns The IMetricSource for the block, or undefined if no metrics:display memory
 *
 * @example
 * ```tsx
 * function BlockView({ block }: { block: IRuntimeBlock }) {
 *   const source = useFragmentSource(block);
 *   if (!source) return null;
 *
 *   const metrics = source.getDisplayMetrics();
 *   return <MetricVisualizer metric={metric} />;
 * }
 * ```
 */
export function useFragmentSource(block: IRuntimeBlock | undefined): IMetricSource | undefined {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!block) return;
        const loc = block.getMemoryByTag('metric:display')[0];
        if (!loc) return;
        return loc.subscribe(() => setVersion(v => v + 1));
    }, [block]);

    return useMemo(() => {
        if (!block) return undefined;
        const locs = block.getMemoryByTag('metric:display');
        if (locs.length === 0) return undefined;
        const allFragments = MetricContainer.empty(block.key.toString());
        for (const loc of locs) allFragments.merge(loc.metrics);
        return allFragments;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [block, version]);
}
