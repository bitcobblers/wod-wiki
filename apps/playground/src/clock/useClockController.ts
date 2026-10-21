/**
 * useClockController — React binding for the clock command registry.
 *
 * A mounted controller registers ONE identity; per-render changes flow into
 * the stored input via refs, and a changed snapshot reference is republished
 * through the registry (so `useSyncExternalStore` snapshots stay referentially
 * stable between publishes — no render loops). Unmount removes exactly its own
 * identity; authority then falls back to the next registered controller.
 *
 * The hook is intentionally separate from clockCommands.ts so non-React
 * consumers (Cast sender/receiver) can import the registry without React.
 * It is re-exported from `@/clock/clockCommands`.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  getClockSnapshot,
  getClockDraft,
  getClockDraftError,
  registerClockController,
  subscribeClock,
  subscribeClockDraft,
  unregisterClockController,
  updateClockController,
  type ClockCommand,
  type ClockSnapshot,
} from './clockCommands';

export interface ClockControllerOptions {
  /** Opt this controller into the shared window keyboard listener. Only the
   * authority actually acts on keys; enabling it on the foreground owner is
   * enough. */
  keyboard?: boolean;
}

export function useClockController(
  snapshot: ClockSnapshot | null,
  handler: (command: ClockCommand) => boolean,
  priority = 0,
  options?: ClockControllerOptions,
): void {
  const idRef = useRef<number | null>(null);
  const latest = useRef({ snapshot, handler, priority, keyboard: options?.keyboard === true });
  latest.current = { snapshot, handler, priority, keyboard: options?.keyboard === true };

  // Register once per mount; refresh the stored input every render so the
  // registry always sees current handler/priority without re-registering.
  useEffect(() => {
    const id = registerClockController(latest.current);
    idRef.current = id;
    return () => {
      unregisterClockController(id);
      idRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (idRef.current !== null) updateClockController(idRef.current, latest.current);
  });
}

/** Snapshot of the current authority — null when no clock owns the foreground. */
export function useClockSnapshot(): ClockSnapshot | null {
  return useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
}

/** The shared keyboard digit buffer (entry drafts + quick rep entry). */
export function useClockDraft(): string {
  return useSyncExternalStore(subscribeClockDraft, getClockDraft, getClockDraft);
}

/** Validation message for the last rejected draft commit, if any. */
export function useClockDraftError(): string | null {
  return useSyncExternalStore(subscribeClockDraft, getClockDraftError, getClockDraftError);
}
