/**
 * seedReadiness — the app-side "vault is queryable" signal.
 *
 * seedSync reports what one sync ATTEMPT did; vault-querying surfaces (the
 * journal/library streams, the root route gate) need to know when querying
 * is safe. The gate is opt-in: 'idle' until a sync starts — unit tests and
 * seed-disabled contexts stay ungated, preserving today's behavior — then
 * 'preparing' while an import can still land rows, and 'ready' once it
 * settles. 'error' ungates too: locally stored rows may still exist, and a
 * permanently empty stream is a worse dead end than an honest one.
 *
 * The multi-tab case matters: 'busy' means a SIBLING tab holds the import
 * claim. We listen for its 'seed-imported' broadcast and re-attempt after
 * the claim TTL — converging to 'ready' whether the sibling finished
 * (fast path → 'current') or crashed (this tab imports instead).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { readSeedCoverage, runBootSeedSync, SEED_CLAIM_TTL_MS, type SeedSyncOutcome } from './seedSync';
import { SEED_BROADCAST_CHANNEL } from '@/types/seed';

export type SeedReadiness = 'preparing' | 'ready' | 'error';

/** Busy-retry timer handle — browser numbers and Bun timers differ. */
type RetryTimer = ReturnType<typeof setTimeout>;

type GateState = 'idle' | SeedReadiness;

let state: GateState = 'idle';
const listeners = new Set<() => void>();
let busyRetryTimer: RetryTimer | null = null;
let busyChannel: BroadcastChannel | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

// CI/e2e diagnostics: trace captures record <html> attributes, so the gate
// state and the last sync outcome surface there instead of a window handle.
// The outcome is removed when an attempt starts.
function reflectState(next: GateState): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.seedState = next;
}

function reflectOutcome(next: SeedSyncOutcome | null): void {
  if (typeof document === 'undefined') return;
  if (next === null) delete document.documentElement.dataset.seedOutcome;
  else document.documentElement.dataset.seedOutcome = next;
}

reflectState(state); // 'idle' visible from module load: bootstrap-not-run vs never-settled

function setState(next: GateState): void {
  if (state === next) return;
  state = next;
  reflectState(next);
  notify();
}

function clearBusyWatch(): void {
  if (busyRetryTimer) {
    clearTimeout(busyRetryTimer);
    busyRetryTimer = null;
  }
  if (busyChannel) {
    busyChannel.close();
    busyChannel = null;
  }
}

/** Called from app bootstrap, before the boot seed sync. */
export function markSeedSyncStarted(): void {
  clearBusyWatch();
  reflectOutcome(null);
  setState('preparing');
}

/** Called with the outcome of every boot seed sync attempt (including retries). */
export function markSeedSyncSettled(outcome: SeedSyncOutcome): void {
  reflectOutcome(outcome);
  switch (outcome) {
    case 'busy': {
      if (state !== 'preparing') return;
      if (typeof BroadcastChannel !== 'undefined' && !busyChannel) {
        busyChannel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
        busyChannel.onmessage = (event) => {
          if ((event.data as { kind?: string } | null)?.kind === 'seed-imported') {
            clearBusyWatch();
            setState('ready');
          }
        };
      }
      busyRetryTimer = setTimeout(() => {
        void runBootSeedSync().then(markSeedSyncSettled);
      }, SEED_CLAIM_TTL_MS);
      break;
    }
    case 'error':
      clearBusyWatch();
      setState('error');
      break;
    default:
      clearBusyWatch();
      setState('ready');
      break;
  }
}

/** Non-reactive read of the gate ('idle' reports as 'ready' — ungated). */
export function getSeedReadiness(): SeedReadiness {
  return state === 'idle' ? 'ready' : state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive vault-readiness gate for vault-querying surfaces. */
export function useSeedReadiness(): SeedReadiness {
  return useSyncExternalStore(subscribe, getSeedReadiness);
}

/** Test-only: reset the gate to its 'idle' (ungated) state. */
export function resetSeedReadinessForTest(): void {
  clearBusyWatch();
  state = 'idle';
  reflectState('idle');
  reflectOutcome(null);
  notify();
}

/**
 * Reactive "no manual library imported yet" probe for the /catalogs and
 * /feeds surfaces. Reads local checkpoints once per mount (no network);
 * null until the read settles — callers render nothing while null. True
 * also when the provider is unreadable: the notice's Sync link leads to a
 * page that surfaces the actual error.
 */
export function useSeedLibraryMissing(): boolean | null {
  const [missing, setMissing] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    readSeedCoverage()
      .then(c => { if (!cancelled) setMissing(!c.libraryImported); })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, []);
  return missing;
}
