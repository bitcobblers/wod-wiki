/**
 * useRuntimeTimer — Public hook boundary for runtime timer access.
 *
 * Re-exports all timer-related hooks and types from the runtime layer
 * so that components in `src/components/` never need to import directly
 * from `src/runtime/`.
 *
 * Follows the pattern established in `useWorkoutEvents.ts`:
 *   single responsibility, re-export stable contracts, no side effects
 *   in the hook body outside `useEffect`/`useCallback`.
 */

// ── Runtime hooks ─────────────────────────────────────────────────────────
export { useTimerElapsed } from '@bitcobblers/wod-wiki-engine/react';
export { useRoundDisplay, useBlockMemory } from '@bitcobblers/wod-wiki-engine/react';
export { useNextPreview } from '@bitcobblers/wod-wiki-engine/react';
export { usePrimaryTimer, useStackTimers, useStackFragmentSources, useStackDisplayRows } from '@bitcobblers/wod-wiki-engine/react';
export { useRuntimeExecution } from '@bitcobblers/wod-wiki-engine/react';
export type { UseRuntimeExecutionReturn } from '@bitcobblers/wod-wiki-engine/react';
export { useOutputStatements, useLiveAnalytics } from '@bitcobblers/wod-wiki-engine/react';

// ── Runtime context ───────────────────────────────────────────────────────
export { useScriptRuntime, ScriptRuntimeProvider } from '@bitcobblers/wod-wiki-engine/react';

// ── Runtime contracts (types only) ───────────────────────────────────────
export type { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
export type { IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
export type { StackSnapshot } from '@bitcobblers/wod-wiki-engine';
export type { IRuntimeSubscription } from '@bitcobblers/wod-wiki-engine';
export type { ICastSubscription } from '@bitcobblers/wod-wiki-engine';
export { isCastSubscription } from '@bitcobblers/wod-wiki-engine';
export type { IEventHandler } from '@bitcobblers/wod-wiki-engine';
export type { IEvent } from '@bitcobblers/wod-wiki-engine';

// ── Runtime memory ────────────────────────────────────────────────────────
export type { MetricVisibility } from '@bitcobblers/wod-wiki-engine';
export { VISIBILITY_LABELS, VISIBILITY_ICONS } from '@bitcobblers/wod-wiki-engine';

// ── Runtime events & actions ──────────────────────────────────────────────
export { NextEvent } from '@bitcobblers/wod-wiki-engine';
export { RegisterEventHandlerAction } from '@bitcobblers/wod-wiki-engine';
export { UnregisterEventHandlerAction } from '@bitcobblers/wod-wiki-engine';

// ── Runtime subscriptions ─────────────────────────────────────────────────
export { SubscriptionManager } from '@bitcobblers/wod-wiki-engine';
export { LocalRuntimeSubscription } from '@bitcobblers/wod-wiki-engine';

// ── Runtime adapters & logging ────────────────────────────────────────────
export { RuntimeLogger } from '@bitcobblers/wod-wiki-engine';
export { RuntimeAdapter } from '@bitcobblers/wod-wiki-engine';
export type { MemoryEntry } from '@bitcobblers/wod-wiki-engine';

// ── ScriptRuntime class (for type-safe prop passing) ─────────────────────
export { ScriptRuntime } from '@bitcobblers/wod-wiki-engine';
