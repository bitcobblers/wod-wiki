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
import { adoptFeedProvenance, adoptLegacyFeedCheckpoints, adoptNotebookVocabulary, defaultFeedSources, isFeedImportEnabled, readFeedCoverage, runBootFeedSync, SEED_CLAIM_TTL_MS, subscribeFeedUpdates, type FeedSyncDeps, type FeedSyncOutcome, type FeedSyncProgress } from './feedSync';
import { mainThreadFeedImportStorage } from './feedStorageDefault';
import { isFeedAutoSync, isFeedSubscribed, migrateFeedSubscriptions } from './feedSubscriptions';
import { ensurePlaygroundDefaultSubscriptions } from './playgroundFeedBootstrap';
export type FeedReadiness = 'preparing' | 'ready' | 'error';

/** Busy-retry timer handle — browser numbers and Bun timers differ. */
type RetryTimer = ReturnType<typeof setTimeout>;

type GateState = 'idle' | FeedReadiness;

let state: GateState = 'idle';
let progress: FeedSyncProgress | null = null;
let bootImportPending = false;
let freshBootImporting = false;
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

function reflectImportPending(next: boolean): void {
  if (typeof document === 'undefined') return;
  if (!next) delete document.documentElement.dataset.feedImportPending;
  else document.documentElement.dataset.feedImportPending = 'true';
}

reflectState(state); // 'idle' visible from module load: bootstrap-not-run vs never-settled

function setState(next: GateState): void {
  if (state === next) return;
  state = next;
  reflectState(next);
  notify();
}

function setBootImportPending(next: boolean): void {
  if (bootImportPending === next) return;
  bootImportPending = next;
  reflectImportPending(next);
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
  const changedProgress = progress !== null;
  const changedPending = !bootImportPending;
  progress = null;
  bootImportPending = true;
  reflectImportPending(true);
  if (state === 'preparing') {
    if (changedProgress || changedPending) notify();
    return;
  }
  setState('preparing');
}

/**
 * Ungate first-paint route shells once the core canvas chunk commits while
 * keeping `bootImportPending` true until the full boot corpus import settles.
 */
export function markFeedFirstPaint(): void {
  if (state === 'preparing') {
    setState('ready');
  }
}

/** Called with the outcome of every boot feed sync attempt (including retries). */
export function markFeedSyncSettled(outcome: FeedSyncOutcome): void {
  reflectOutcome(outcome);
  switch (outcome) {
    case 'busy': {
      if (state !== 'preparing' && !bootImportPending) return;
      if (typeof BroadcastChannel !== 'undefined' && !busyChannel) {
        busyChannel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
        busyChannel.onmessage = (event) => {
          if ((event.data as { kind?: string } | null)?.kind === 'seed-imported') {
            clearBusyWatch();
            freshBootImporting = false;
            setBootImportPending(false);
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
      if (!freshBootImporting) setBootImportPending(false);
      setState('error');
      break;
    default:
      clearBusyWatch();
      if (!freshBootImporting) setBootImportPending(false);
      setState('ready');
      break;
  }
}

/** Non-reactive read of the gate ('idle' reports as 'ready' — ungated). */
export function getFeedReadiness(): FeedReadiness {
  return state === 'idle' ? 'ready' : state;
}

/** Non-reactive read of whether background cold-boot corpus import is still running. */
export function isBootImportPending(): boolean {
  return bootImportPending;
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

/** Reactive indicator of whether background cold-boot corpus import is still running. */
export function useFeedImportPending(): boolean {
  return useSyncExternalStore(subscribe, isBootImportPending);
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
  freshBootImporting = false;
  bootImportPending = false;
  state = 'idle';
  reflectState('idle');
  reflectOutcome(null);
  reflectImportPending(false);
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
  // WW-019: hold the boot-import signal from the synchronous entry — the
  // checkpoint probes below are async IndexedDB reads, and the gate only
  // flips once they settle, which left early cold-boot imports invisible
  // to data-agent-status.
  if ((deps.isEnabled ?? isFeedImportEnabled)()) setBootImportPending(true);
  bootstrapPromise ??= runFeedBootstrap(deps).finally(() => {
    markBootMilestone('feedSettled');
  });
  return bootstrapPromise;
}

/** True when a subscribed auto-sync feed still lacks its first checkpoint. */
async function hasUnimportedAutoSyncFeed(
  sources: NonNullable<FeedSyncDeps['sources']>,
  storage: NonNullable<FeedSyncDeps['storage']>,
): Promise<boolean> {
  for (const s of sources) {
    if (s.id === 'core' || !isFeedSubscribed(s.id) || !isFeedAutoSync(s.id)) continue;
    try {
      const meta = await storage.getSeedMeta(seedMetaKey(s.id));
      if (!meta || meta.seedVersion <= 0) return true;
    } catch {
      return true; // unreadable checkpoint — let the sync pass resurface the error
    }
  }
  return false;
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
  ensurePlaygroundDefaultSubscriptions(all);
  const storage = deps.storage ?? mainThreadFeedImportStorage();
  let coreMeta;
  try {
    coreMeta = await storage.getSeedMeta(seedMetaKey('core'));
  } catch {
    coreMeta = undefined; // Provider unreadable — the sync run itself surfaces it.
  }
  const fresh = !coreMeta || coreMeta.seedVersion <= 0;
  if (fresh) {
    freshBootImporting = true;
    markFeedSyncStarted();
  } else if (await hasUnimportedAutoSyncFeed(all, storage)) {
    // Interrupted first visit: core landed but a subscribed auto-sync feed
    // never imported. Keep the boot-import signal up across the background
    // pass without re-gating the already-committed UI shell (WW-019).
    freshBootImporting = true;
    markFeedSyncSettled('current');
  } else {
    markFeedSyncSettled('current');
  }
  // Notes imported before the feed stamp existed carry only the seed-side
  // stamps: the checkpoints say which feed delivered them, so the repair
  // needs no republication. It runs AFTER the gate decision — the first
  // paint never waits for it.
  await adoptFeedProvenance(deps)
    .catch((err) => console.error('[feedSync] feed provenance repair failed', err));
  if (fresh) {
    try {
      const outcome = await runBootFeedSync({
        ...deps,
        sources: all,
        onProgress,
        onFirstPaint: () => markFeedFirstPaint(),
      });
      if (outcome !== 'busy' && outcome !== 'error') {
        markFeedFirstPaint();
      }
      // Every page load owes subscribed catalogs their update check — on a
      // fresh browser ensurePlaygroundDefaultSubscriptions just enabled the
      // default sample feeds, whose initial import is part of the boot corpus.
      // Hold `bootImportPending` until that pass finishes without re-gating UI.
      if (
        outcome !== 'busy' &&
        outcome !== 'error' &&
        all.some((s) => s.id !== 'core' && isFeedSubscribed(s.id))
      ) {
        await runBootFeedSync({ ...deps, sources: all.filter((s) => s.id !== 'core'), onProgress })
          .catch((err) => console.error('[feedSync] background boot sync failed', err));
      }
      freshBootImporting = false;
      markFeedSyncSettled(outcome);
    } finally {
      if (freshBootImporting) {
        freshBootImporting = false;
        setBootImportPending(false);
      }
    }
    return;
  }
  // Returning visitor: the vault is queryable offline from the committed
  // core — feeds keep refreshing in the background; their outcomes only
  // reach sync activity, never the gate (no late 'error' flip, no retry).
  try {
    await runBootFeedSync({ ...deps, sources: all, onProgress })
      .catch((err) => console.error('[feedSync] background boot sync failed', err));
  } finally {
    // Release the WW-019 hold (see the gate decision above) once the pass
    // settles; a no-op when no hold was taken.
    if (freshBootImporting) {
      freshBootImporting = false;
      setBootImportPending(false);
    }
  }
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
