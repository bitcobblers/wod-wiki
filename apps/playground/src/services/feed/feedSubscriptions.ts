/**
 * feedSubscriptions — per-feed subscription state (local-first contract).
 * Persisted in localStorage ('wodwiki.seedSubscriptions',
 * { [feedId]: boolean }); absence means "no explicit choice":
 * migrateFeedSubscriptions() subscribes previously imported feeds, a
 * persisted false always stays off, and core is always on (unsubscribe is
 * a no-op for it). Pre-feed-unit records were written per notebook — they
 * fold onto the feed that publishes the notebook on read and on migration.
 * The per-feed auto-sync preference lives beside it ('wodwiki.seedAutoSync')
 * but is a separate choice: subscription never implies auto-update. Kept
 * free of feedSync imports so the runtime graph stays acyclic — callers pass
 * the source list in.
 */
import type { FeedImportStorage } from './FeedImportStorage';
import { mainThreadFeedImportStorage } from './feedStorageDefault';
import { NOTEBOOKS } from './feedSources';
import { seedMetaKey } from '@/types/seed';

const STORAGE_KEY = 'wodwiki.seedSubscriptions';
const AUTO_SYNC_KEY = 'wodwiki.seedAutoSync';

let cache: Record<string, boolean> | null = null;
let autoSyncCache: Record<string, boolean> | null = null;
const listeners = new Set<() => void>();

function readMap(key: string): Record<string, boolean> {
  let parsed: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [id, flag] of Object.entries(value)) {
        if (typeof flag === 'boolean') parsed[id] = flag;
      }
    }
  } catch {
    parsed = {};
  }
  return parsed;
}

function readAll(): Record<string, boolean> {
  if (cache) return cache;
  cache = readMap(STORAGE_KEY);
  return cache;
}

function writeMap(key: string, next: Record<string, boolean>): boolean {
  let persisted = true;
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): in-memory only for this session.
    persisted = false;
  }
  return persisted;
}

function writeAll(next: Record<string, boolean>): boolean {
  cache = next;
  const persisted = writeMap(STORAGE_KEY, next);
  for (const listener of listeners) listener();
  return persisted;
}

/**
 * Core is always subscribed; an absent record means not (yet) subscribed.
 * A pre-feed-unit record — one entry per notebook — still counts: those
 * entries fold onto the feed that publishes the notebook, which is what a
 * subscription means now (an explicit feed record always wins).
 */
export type FeedSubscriptionMode = 'full' | 'partial' | 'unsubscribed';

export function getFeedSubscriptionMode(id: string): FeedSubscriptionMode {
  if (id === 'core') return 'full';
  const all = readAll();
  if (all[id] === true) return 'full';
  const prefix = `${id}#`;
  const hasPartial = Object.entries(all).some(([key, val]) => val === true && key.startsWith(prefix));
  if (hasPartial) return 'partial';
  return 'unsubscribed';
}

export function isFeedSubscribed(id: string): boolean {
  if (id === 'core') return true;
  return getFeedSubscriptionMode(id) !== 'unsubscribed';
}

/** Persist an explicit subscription choice (core ignores unsubscribe).
 *  Writes the feed record and drops the folded notebook records it
 *  supersedes, so one source never holds two verdicts. Returns false when
 *  the choice could NOT be persisted (browser storage unavailable) — it
 *  then lasts this session only, and callers must say so instead of
 *  implying a durable subscription. */
export function setFeedSubscribed(id: string, subscribed: boolean): boolean {
  if (id === 'core') return true;
  const all: Record<string, boolean> = {};
  const prefix = `${id}#`;
  for (const [key, value] of Object.entries(readAll())) {
    if (key.startsWith(prefix)) continue;
    if (NOTEBOOKS.some((notebook) => notebook.feedId === id && notebook.id === key)) continue;
    all[key] = value;
  }
  all[id] = subscribed;
  return writeAll(all);
}

/** Check whether a specific notebook is subscribed (explicitly or via owning feed). */
export function isNotebookSubscribed(feedId: string, notebookId: string): boolean {
  if (feedId === 'core') return true;
  const all = readAll();
  const specificKey = `${feedId}#${notebookId}`;
  if (specificKey in all) return all[specificKey] === true;
  return all[feedId] === true;
}

/** Subscribe or unsubscribe an individual notebook from a feed. */
export function setNotebookSubscribed(
  feedId: string,
  notebookId: string,
  subscribed: boolean,
  knownChunkIds?: readonly string[],
): boolean {
  if (feedId === 'core') return true;
  const all = { ...readAll() };
  const specificKey = `${feedId}#${notebookId}`;
  const prefix = `${feedId}#`;

  const siblings = knownChunkIds ?? NOTEBOOKS.filter((n) => n.feedId === feedId).map((n) => n.chunkId);

  // If feed was full and unsubscribing this chunk: expand full feed into explicit siblings
  if (all[feedId] === true && !subscribed) {
    all[feedId] = false;
    for (const sib of siblings) {
      if (sib !== notebookId) {
        all[`${feedId}#${sib}`] = true;
      }
    }
    all[specificKey] = false;
    return writeAll(all);
  }

  all[specificKey] = subscribed;

  // If subscribing and all known chunks are now subscribed, fold back into full feed
  if (subscribed && siblings.length > 0 && siblings.every((sib) => sib === notebookId || all[`${feedId}#${sib}`] === true)) {
    all[feedId] = true;
    for (const key of Object.keys(all)) {
      if (key.startsWith(prefix)) delete all[key];
    }
  } else if (!subscribed && siblings.length > 0 && siblings.every((sib) => all[`${feedId}#${sib}`] === false)) {
    all[feedId] = false;
  }

  return writeAll(all);
}

/** Returns the explicit notebook ids subscribed for a feed, or null if the whole feed is subscribed, or [] if unsubscribed. */
export function getSubscribedNotebooks(feedId: string): string[] | null {
  const mode = getFeedSubscriptionMode(feedId);
  if (mode === 'full') return null;
  if (mode === 'unsubscribed') return [];
  const all = readAll();
  const prefix = `${feedId}#`;
  return Object.entries(all)
    .filter(([key, val]) => val === true && key.startsWith(prefix))
    .map(([key]) => key.slice(prefix.length));
}

export function subscribeFeedSubscriptions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readAutoSyncAll(): Record<string, boolean> {
  if (autoSyncCache) return autoSyncCache;
  autoSyncCache = readMap(AUTO_SYNC_KEY);
  return autoSyncCache;
}

/**
 * Per-source auto-sync preference, persisted separately from subscription.
 * Default: core on (it is the app's own first-paint feed), every other
 * source off — subscribing never implies auto-updating.
 */
export function isFeedAutoSync(id: string): boolean {
  const all = readAutoSyncAll();
  return id in all ? all[id] === true : id === 'core';
}

/** Persist the auto-sync choice. Returns false when it could NOT be
 *  persisted (browser storage unavailable) — session-only then. */
export function setFeedAutoSync(id: string, enabled: boolean): boolean {
  const all = { ...readAutoSyncAll(), [id]: enabled };
  const persisted = writeMap(AUTO_SYNC_KEY, all);
  autoSyncCache = all;
  for (const listener of listeners) listener();
  return persisted;
}

/**
 * Migration: a registered library with an imported checkpoint becomes
 * subscribed when the user never made an explicit choice. Persisted
 * on/off entries always win. Returns the migrated source ids.
 */
export async function migrateFeedSubscriptions(
  sources: ReadonlyArray<{ id: string }>,
  storage: FeedImportStorage = mainThreadFeedImportStorage(),
): Promise<string[]> {
  const all = { ...readAll() };
  const migrated: string[] = [];
  let renamedLegacyKeys = false;
  // Pre-rename builds keyed per-notebook verdicts by the old chunk-id
  // spelling (`<feedId>#collection.<slug>` / `<feedId>#feed.<slug>`).
  // Rewrite them to the current `notebook.<slug>` key, preserving the
  // value; an explicit current-key verdict always wins, and the rewrite
  // is idempotent (the legacy key is deleted once read).
  for (const notebook of NOTEBOOKS) {
    const slug = notebook.chunkId.replace(/^notebook\./, '');
    const currentKey = `${notebook.feedId}#${notebook.chunkId}`;
    for (const legacyId of [`collection.${slug}`, `feed.${slug}`]) {
      const legacyKey = `${notebook.feedId}#${legacyId}`;
      if (!(legacyKey in all)) continue;
      if (!(currentKey in all)) all[currentKey] = all[legacyKey]!;
      delete all[legacyKey];
      renamedLegacyKeys = true;
    }
  }
  // Pre-feed-unit builds subscribed per notebook and never wrote a feed
  // record; the notebook verdicts they left behind become the feed's.
  for (const notebook of NOTEBOOKS) {
    if (!(notebook.id in all)) continue;
    if (!(notebook.feedId in all)) {
      all[notebook.feedId] = all[notebook.id];
      if (all[notebook.id]) migrated.push(notebook.feedId);
    }
    delete all[notebook.id];
  }
  for (const { id } of sources) {
    if (id === 'core' || id in all) continue;
    try {
      const meta = await storage.getSeedMeta(seedMetaKey(id));
      if (meta && meta.seedVersion > 0) {
        all[id] = true;
        migrated.push(id);
      }
    } catch {
      // Unreadable provider: nothing to migrate for this source.
    }
  }
  if (migrated.length || renamedLegacyKeys) writeAll(all);
  return migrated;
}

/** Test-only: drop the cached maps (tests mutate localStorage). */
export function resetFeedSubscriptionsForTest(): void {
  cache = null;
  autoSyncCache = null;
}
