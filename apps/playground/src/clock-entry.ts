/**
 * Clock Entry Point for WOD Wiki
 * 
 * Exports timer and clock components for workout tracking and display.
 * Includes DigitalClock, ClockAnchor, and timer-related hooks.
 * 
 * @example
 * ```typescript
 * import { DigitalClock, ClockAnchor } from 'wod-wiki/clock';
 * ```
 */

// Main clock components
export { DigitalClock } from './clock/components/DigitalClock';
export type { DigitalClockProps } from './clock/components/DigitalClock';

export { TimerHarness } from './clock/components/TimerHarness';
export type { TimerHarnessProps, TimerHarnessResult } from './clock/components/TimerHarness';

// Clock anchors
export { ClockAnchor } from './clock/anchors/ClockAnchor';

// Timer hooks
export { useTimerElapsed } from '@bitcobblers/wod-wiki-engine/react';
