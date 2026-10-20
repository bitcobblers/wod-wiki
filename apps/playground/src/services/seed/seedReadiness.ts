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
import { defaultSeedSources, readSeedCoverage, runBootSeedSync, SEED_CLAIM_TTL_MS, subscribeCatalogUpdates, type SeedSyncDeps, type SeedSyncOutcome } from './seedSync';
import { IndexedDBSeedImportStorage } from './SeedImportStorage';
import { isSeedSubscribed, migrateSeedSubscriptions } from './seedSubscriptions';
import { SEED_BROADCAST_CHANNEL, seedMetaKey } from '@/types/seed';
import { subscribeSyncActivity } from '@/services/syncActivity';

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
  bootstrapPromise = null;
  state = 'idle';
  reflectState('idle');
  reflectOutcome(null);
  notify();
}

// ── Boot orchestrator ──────────────────────────────────────────────────────

let bootstrapPromise: Promise<void> | null = null;

/**
 * App-bootstrap seed entry point — App.tsx calls this once; StrictMode's
 * double effect is single-flighted on bootstrapPromise. A returning
 * visitor (core checkpoint present) ungates immediately and refreshes core
 * + subscribed feeds in the background — background outcomes never touch
 * the readiness gate. A first visit (no core checkpoint) gates: the gate
 * flips 'ready' the moment the core canvas chunk commits (first paint),
 * while the rest of the library keeps importing.
 */
export function startSeedBootstrap(deps: SeedSyncDeps = {}): Promise<void> {
  bootstrapPromise ??= runSeedBootstrap(deps);
  return bootstrapPromise;
}

async function runSeedBootstrap(deps: SeedSyncDeps): Promise<void> {
  const all = deps.sources ?? defaultSeedSources();
  // Prior imported libraries become subscriptions (explicit on/off wins).
  await migrateSeedSubscriptions(all, deps.storage)
    .catch((err) => console.error('[seedSync] subscription migration failed', err));
  const storage = deps.storage ?? new IndexedDBSeedImportStorage();
  let coreMeta;
  try {
    coreMeta = await storage.getSeedMeta(seedMetaKey('core'));
  } catch {
    coreMeta = undefined; // Provider unreadable — the sync run itself surfaces it.
  }
  if (!coreMeta || coreMeta.seedVersion <= 0) {
    markSeedSyncStarted();
    const outcome = await runBootSeedSync({ ...deps, sources: all, onFirstPaint: () => markSeedSyncSettled('imported') });
    markSeedSyncSettled(outcome);
    // Every page load owes subscribed catalogs their update check — also
    // when the local core checkpoint was reset but subscriptions survived
    // (the fresh sync just re-created it). Nonblocking; never re-gates.
    if (all.some((s) => s.id !== 'core' && isSeedSubscribed(s.id))) {
      await runBootSeedSync({ ...deps, sources: all })
        .catch((err) => console.error('[seedSync] background boot sync failed', err));
    }
    return;
  }
  markSeedSyncSettled('current');
  // Returning visitor: the vault is queryable offline from the committed
  // core — feeds keep refreshing in the background; their outcomes only
  // reach sync activity, never the gate (no late 'error' flip, no retry).
  await runBootSeedSync({ ...deps, sources: all })
    .catch((err) => console.error('[seedSync] background boot sync failed', err));
}

/**
 * Reactive "no manual library imported yet" probe for the /catalogs and
 * /feeds surfaces. Reads local checkpoints on mount and re-probes when sync
 * activity reports results, a 'seed-imported'/'seed-removed' broadcast
 * lands, or the background load check publishes its grouped catalog-updates
 * snapshot (no network — background runs stay silent in sync activity);
 * null until the read settles — callers render nothing while null. True
 * also when the provider is unreadable: the notice's Sync link leads to a
 * page that surfaces the actual error.
 */
export function useSeedLibraryMissing(): boolean | null {
  const [missing, setMissing] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      readSeedCoverage()
        .then(c => { if (!cancelled) setMissing(!c.libraryImported); })
        .catch(() => { if (!cancelled) setMissing(true); });
    };
    probe();
    const unsubSync = subscribeSyncActivity(() => probe());
    const unsubUpdates = subscribeCatalogUpdates(() => probe());
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
        channel.onmessage = () => probe();
      } catch {
        // Local sync/update subscriptions still refresh without cross-tab messaging.
      }
    }
    return () => {
      cancelled = true;
      unsubSync();
      unsubUpdates();
      channel?.close();
    };
  }, []);
  return missing;
}
