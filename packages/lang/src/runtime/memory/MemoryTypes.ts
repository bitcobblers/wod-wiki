import { IMetric } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { TimeSpan } from '../models/TimeSpan';

/**
 * Timer direction for count-down vs count-up.
 */
export type TimerDirection = 'up' | 'down';
export type TimerPolarity = 'work' | 'rest';

/**
 * Timer state stored in block memory.
 * 
 * ## Glossary (docs/architecture/time-terminology.md)
 * - `spans`      — **Time**: raw TimeSpan[] recordings the block tracks
 * - `durationMs` — **Duration**: planned target from the parser (e.g., 300 000 ms for "5:00")
 * - Derived values Elapsed and Total are computed from spans at collection time.
 */
export interface TimerState {
    /** 
     * **Time** — raw time segments being tracked.
     * Source of truth for Elapsed (Σ span durations) and Total (wall-clock bracket).
     */
    readonly spans: readonly TimeSpan[];

    /** **Duration** — planned target in ms from the parser (for countdowns or goals). */
    readonly durationMs?: number;

    /** Timer direction preference */
    readonly direction: TimerDirection;

    /** Human-readable label for the timer */
    readonly label: string;

    /** Timer role for UI prioritization */
    readonly role?: 'primary' | 'secondary' | 'auto' | 'hidden';

    /** True when user Next cannot skip this countdown before expiry. */
    readonly required?: boolean;

    /** Semantic polarity for Work vs Rest visual and priority handling. */
    readonly polarity?: TimerPolarity;
}

/**
 * Round state stored in memory.
 * Represents current iteration and scale of a loop.
 */
export interface RoundState {
    /** Current round number (typically 1-based) */
    readonly current: number;

    /** Total number of rounds planned (undefined for unbounded) */
    readonly total: number | undefined;
}

/** Written by ChildSelectionBehavior to children:status memory tag */
export interface ChildrenStatusState {
    /** Index of the next child to dispatch (0-based) */
    readonly childIndex: number;
    /** Total number of child groups */
    readonly totalChildren: number;
    /** True when all child groups have been dispatched at least once */
    readonly allExecuted: boolean;
    /** True when all dispatched children have completed (popped) */
    readonly allCompleted: boolean;
}

/**
 * Fragment state stored in memory.
 * 
 * Fragment groups represent semantic groupings from compilation (e.g., per-round,
 * per-interval). Each inner array is one group produced by the metrics distributor.
 * This preserves the multi-dimensional structure through the entire pipeline:
 * Parser → Strategy → BlockBuilder → FragmentMemory → RuntimeBlock.metrics
 */
export interface FragmentState {
    /** Fragment groups — each inner array is a semantic group (e.g., per-round metrics) */
    readonly groups: readonly MetricContainer[];
}

/**
 * Display-ready metrics state stored in memory.
 * 
 * Produced by applying precedence resolution to raw metrics groups.
 * The `resolved` array contains metric after per-type precedence
 * selection (user > runtime > compiler > parser).
 */
export interface FragmentDisplayState {
    /** All raw metrics flattened from groups (before precedence) */
    readonly metrics: MetricContainer;
    /** Precedence-resolved metric ready for display */
    readonly resolved: readonly IMetric[];
}

/**
 * Completion state stored in memory.
 * Tracks whether a block has completed and why.
 */
export interface CompletionState {
    /** Whether block is marked complete */
    readonly isComplete: boolean;

    /** Reason for completion */
    readonly reason?: 'timer-expired' | 'rounds-complete' | 'user-advance' | 'manual' | string;

    /** Timestamp of completion (epoch ms) */
    readonly createdAt?: number;
}

/**
 * Display state stored in memory.
 * UI-facing state for labels and modes.
 */
export interface DisplayState {
    /** Current display mode */
    readonly mode: 'clock' | 'timer' | 'countdown' | 'hidden';

    /** Primary label */
    readonly label: string;

    /** Secondary/subtitle label */
    readonly subtitle?: string;

    /** Formatted round string (e.g., "Round 2/5") */
    readonly roundDisplay?: string;

    /** Exercise/action being performed */
    readonly actionDisplay?: string;
}

/**
 * Button style variants for UI rendering.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/**
 * Configuration for a single control button.
 */
export interface ButtonConfig {
    /** Unique button identifier */
    readonly id: string;

    /** Display label */
    readonly label: string;

    /** Button style variant */
    readonly variant: ButtonVariant;

    /** Whether button is currently visible */
    readonly visible: boolean;

    /** Whether button is enabled (clickable) */
    readonly enabled: boolean;

    /** 
     * Event name to emit when clicked.
     * External systems subscribe to these events to handle user actions.
     * Examples: 'timer:pause', 'block:next', 'workout:stop'
     */
    readonly eventName?: string;

    /** 
     * Whether this button is pinned (always visible).
     * Derived from `[:!action]` syntax in Whiteboard scripts.
     */
    readonly isPinned?: boolean;
}

/**
 * Buttons state stored in memory.
 * Represents the current set of control buttons available to the user.
 * 
 * The UI observes this memory to render action buttons. When buttons are
 * clicked, the UI emits the corresponding `eventName` as an external event.
 */
export interface ButtonsState {
    /** Current button configurations */
    readonly buttons: readonly ButtonConfig[];
}

/**
 * Union of all valid memory type keys.
 */
export type MemoryType = 'time' | 'round' | 'children:status' | 'metrics' | 'metric:display' | 'completion' | 'display' | 'controls';

/**
 * Registry mapping memory types to their corresponding data shapes.
 * Enables compile-time type safety when accessing block memory.
 * 
 * @example
 * const timer = block.getMemoryByTag('time')[0]; // Returns IMemoryLocation with TimerState
 */
export interface MemoryTypeMap {
    'time': TimerState;
    round: RoundState;
    'children:status': ChildrenStatusState;
    metrics: FragmentState;
    'metric:display': FragmentDisplayState;
    completion: CompletionState;
    display: DisplayState;
    controls: ButtonsState;
}

/**
 * Utility to resolve the value type for a given memory type key.
 */
export type MemoryValueOf<T extends MemoryType> = MemoryTypeMap[T];
