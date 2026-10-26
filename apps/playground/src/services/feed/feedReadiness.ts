/**
 * feedReadiness — the app-side "vault is queryable" signal.
 *
 * feedSync reports what one sync ATTEMPT did; vault-querying surfaces (the
 * journal/library streams, the root route gate) need to know when querying
 * is safe. The gate is opt-in: 'idle' until a sync starts — unit tests and
 * feed-disabled contexts stay ungated, preserving today's behavior — then
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
import { SEED_BROADCAST_CHANNEL, seedMetaKey } from '@/types/seed';
import { subscribeSyncActivity } from '@/services/syncActivity';
import { markBootMilestone } from '@/services/bootDiagnostics';
import { adoptFeedProvenance, adoptLegacyFeedCheckpoints, adoptNotebookVocabulary, defaultFeedSources, readFeedCoverage, runBootFeedSync, SEED_CLAIM_TTL_MS, subscribeFeedUpdates, type FeedSyncDeps, type FeedSyncOutcome, type FeedSyncProgress } from './feedSync';
import { mainThreadFeedImportStorage } from './feedStorageDefault';
import { isFeedSubscribed, migrateFeedSubscriptions } from './feedSubscriptions';

export type FeedReadiness = 'preparing' | 'ready' | 'error';

/** Busy-retry timer handle — browser numbers and Bun timers differ. */
type RetryTimer = ReturnType<typeof setTimeout>;

type GateState = 'idle' | FeedReadiness;

let state: GateState = 'idle';
let progress: FeedSyncProgress | null = null;
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
  document.documentElement.dataset.feedState = next;
}

function reflectOutcome(next: FeedSyncOutcome | null): void {
  if (typeof document === 'undefined') return;
  if (next === null) delete document.documentElement.dataset.feedOutcome;
  else document.documentElement.dataset.feedOutcome = next;
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

/** Called with every progress event from the boot feed sync. */
export function markFeedSyncProgress(next: FeedSyncProgress): void {
  progress = next;
  notify();
}

/** Called from app bootstrap, before the boot feed sync. */
export function markFeedSyncStarted(): void {
  clearBusyWatch();
  reflectOutcome(null);
  if (progress !== null) {
    progress = null;
    notify();
  }
  setState('preparing');
}

/** Called with the outcome of every boot feed sync attempt (including retries). */
export function markFeedSyncSettled(outcome: FeedSyncOutcome): void {
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
        void runBootFeedSync({ onProgress: markFeedSyncProgress }).then(markFeedSyncSettled);
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
export function getFeedReadiness(): FeedReadiness {
  return state === 'idle' ? 'ready' : state;
}

/** Non-reactive read of the latest boot progress event. */
export function getFeedSyncProgress(): FeedSyncProgress | null {
  return progress;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive vault-readiness gate for vault-querying surfaces. */
export function useFeedReadiness(): FeedReadiness {
  return useSyncExternalStore(subscribe, getFeedReadiness);
}

/** Reactive boot-progress surface for the corpus gate. */
export function useFeedSyncProgress(): FeedSyncProgress | null {
  return useSyncExternalStore(subscribe, getFeedSyncProgress);
}

/** Test-only: reset the gate to its 'idle' (ungated) state. */
export function resetFeedReadinessForTest(): void {
  clearBusyWatch();
  bootstrapPromise = null;
  progress = null;
  state = 'idle';
  reflectState('idle');
  reflectOutcome(null);
  notify();
}

// ── Boot orchestrator ──────────────────────────────────────────────────────

let bootstrapPromise: Promise<void> | null = null;

/**
 * App-bootstrap feed entry point — App.tsx calls this once; StrictMode's
 * double effect is single-flighted on bootstrapPromise. A returning
 * visitor (core checkpoint present) ungates immediately and refreshes core
 * + subscribed feeds in the background — background outcomes never touch
 * the readiness gate. A first visit (no core checkpoint) gates: the gate
 * flips 'ready' the moment the core canvas chunk commits (first paint),
 * while the rest of the library keeps importing.
 */
export function startFeedBootstrap(deps: FeedSyncDeps = {}): Promise<void> {
  markBootMilestone('feedStart');
  bootstrapPromise ??= runFeedBootstrap(deps).finally(() => {
    markBootMilestone('feedSettled');
  });
  return bootstrapPromise;
}

async function runFeedBootstrap(deps: FeedSyncDeps): Promise<void> {
  const onProgress = (event: FeedSyncProgress): void => {
    markFeedSyncProgress(event);
    deps.onProgress?.(event);
  };
  const all = deps.sources ?? defaultFeedSources();
  // Pre-feed-unit per-notebook checkpoints fold into their feed's checkpoint
  // first: the subscription migration below probes feed checkpoints, and the
  // Retired collection/feed wire identities fold into the notebook
  // vocabulary BEFORE any checkpoint adoption or sync: the migration
  // renames chunk keys in place, and the legacy adoption below reads them.
  await adoptNotebookVocabulary(deps)
    .catch((err) => console.error('[feedSync] notebook vocabulary migration failed', err));
  // folded records are what make an already-imported feed read as imported.
  await adoptLegacyFeedCheckpoints(deps)
    .catch((err) => console.error('[feedSync] checkpoint adoption failed', err));
  // Prior imported feeds become subscriptions (explicit on/off wins).
  await migrateFeedSubscriptions(all, deps.storage)
    .catch((err) => console.error('[feedSync] subscription migration failed', err));
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  let coreMeta;
  try {
    coreMeta = await storage.getSeedMeta(seedMetaKey('core'));
  } catch {
    coreMeta = undefined; // Provider unreadable — the sync run itself surfaces it.
  }
  const fresh = !coreMeta || coreMeta.seedVersion <= 0;
  if (fresh) markFeedSyncStarted();
  else markFeedSyncSettled('current');
  // Notes imported before the feed stamp existed carry only the seed-side
  // stamps: the checkpoints say which feed delivered them, so the repair
  // needs no republication. It runs AFTER the gate decision — the first
  // paint never waits for it.
  await adoptFeedProvenance(deps)
    .catch((err) => console.error('[feedSync] feed provenance repair failed', err));
  if (fresh) {
    const outcome = await runBootFeedSync({ ...deps, sources: all, onProgress, onFirstPaint: () => markFeedSyncSettled('imported') });
    markFeedSyncSettled(outcome);
    // Every page load owes subscribed catalogs their update check — also
    // when the local core checkpoint was reset but subscriptions survived
    // (the fresh sync just re-created it). Nonblocking; never re-gates.
    if (all.some((s) => s.id !== 'core' && isFeedSubscribed(s.id))) {
      await runBootFeedSync({ ...deps, sources: all, onProgress })
        .catch((err) => console.error('[feedSync] background boot sync failed', err));
    }
    return;
  }
  // Returning visitor: the vault is queryable offline from the committed
  // core — feeds keep refreshing in the background; their outcomes only
  // reach sync activity, never the gate (no late 'error' flip, no retry).
  await runBootFeedSync({ ...deps, sources: all, onProgress })
    .catch((err) => console.error('[feedSync] background boot sync failed', err));
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
export function useFeedLibraryMissing(): boolean | null {
  const [missing, setMissing] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      readFeedCoverage()
        .then(c => { if (!cancelled) setMissing(!c.libraryImported); })
        .catch(() => { if (!cancelled) setMissing(true); });
    };
    probe();
    const unsubSync = subscribeSyncActivity(() => probe());
    const unsubUpdates = subscribeFeedUpdates(() => probe());
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
