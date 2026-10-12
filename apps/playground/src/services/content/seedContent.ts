/**
 * seedContent — the app-side read seam over the seeded corpus
 * (docs/prototypes/seed-data-unification.md § Module 3: Content reads
 * through Persistence).
 *
 * After the seed import, every bundled-content read loads from IndexedDB
 * through here: one bulk read builds a `markdown/…`-keyed file map (the same
 * shape the old build-time globs served), cached in memory and invalidated
 * `useSeedContent()` returns `null` until the corpus is loaded — consumers
 * render their empty/loading state first, then re-render when it arrives.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { storageService } from '@/services/storage';
import { SEED_BROADCAST_CHANNEL } from '@/types/seed';
import { invalidateCorpusBlocks } from '@/services/content/staticBlockIndex';

export type SeedContentFiles = Record<string, string>;

let cache: SeedContentFiles | null = null;
let promise: Promise<SeedContentFiles> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

async function load(): Promise<SeedContentFiles> {
  const entries = await storageService.getSeedContent();
  const files: SeedContentFiles = {};
  for (const { path, raw } of entries) files[path] = raw;
  return files;
}

/** Memoized corpus load; retries on the next call after a failure. */
export function ensureSeedContent(): Promise<SeedContentFiles> {
  if (!promise) {
    promise = load()
      .then((files) => {
        cache = files;
        notify();
        return files;
      })
      .catch((err) => {
        promise = null;
        throw err;
      });
  }
  return promise;
}

/** Drop the cache and reload — the seed broadcast path. */
export function invalidateSeedContent(): void {
  cache = null;
  promise = null;
  // The derived corpus planes (block rows, static notes/tags) re-derive too.
  invalidateCorpusBlocks();
  void ensureSeedContent();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SeedContentFiles | null {
  return cache;
}

/** React binding — `null` until the corpus lands, then the stable file map. */
export function useSeedContent(): SeedContentFiles | null {
  const files = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void ensureSeedContent();
  }, []);
  return files;
}

let broadcastBound = false;

/** Wire the cross-tab refresh (idempotent) — call once from app bootstrap. */
export function initSeedContentBroadcast(): void {
  if (broadcastBound || typeof BroadcastChannel === 'undefined') return;
  broadcastBound = true;
  const channel = new BroadcastChannel(SEED_BROADCAST_CHANNEL);
  channel.onmessage = () => invalidateSeedContent();
}
