/**
 * seedSubscriptions — per-SEED subscription state (local-first contract).
 * Persisted in localStorage ('wodwiki.seedSubscriptions',
 * { [seedId]: boolean }); absence means "no explicit choice":
 * migrateSeedSubscriptions() subscribes previously imported seeds, a
 * persisted false always stays off, and core is always on (unsubscribe is
 * a no-op for it). Pre-seed-unit records were written per notebook — they
 * fold onto the seed that publishes the notebook on read and on migration.
 * The per-seed auto-sync preference lives beside it ('wodwiki.seedAutoSync')
 * but is a separate choice: subscription never implies auto-update. Kept
 * free of seedSync imports so the runtime graph stays acyclic — callers pass
 * the source list in.
 */
import type { SeedImportStorage } from './SeedImportStorage';
import { mainThreadSeedImportStorage } from './seedStorageDefault';
import { NOTEBOOKS } from './seedSources';
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
 * A pre-seed-unit record — one entry per notebook — still counts: those
 * entries fold onto the seed that publishes the notebook, which is what a
 * subscription means now (an explicit seed record always wins).
 */
export function isSeedSubscribed(id: string): boolean {
  if (id === 'core') return true;
  const all = readAll();
  if (id in all) return all[id] === true;
  return NOTEBOOKS.some((notebook) => notebook.seedId === id && all[notebook.id] === true);
}

/** Persist an explicit subscription choice (core ignores unsubscribe).
 *  Writes the seed record and drops the folded notebook records it
 *  supersedes, so one source never holds two verdicts. Returns false when
 *  the choice could NOT be persisted (browser storage unavailable) — it
 *  then lasts this session only, and callers must say so instead of
 *  implying a durable subscription. */
export function setSeedSubscribed(id: string, subscribed: boolean): boolean {
  if (id === 'core') return true;
  const all: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(readAll())) {
    if (!NOTEBOOKS.some((notebook) => notebook.seedId === id && notebook.id === key)) all[key] = value;
  }
  all[id] = subscribed;
  return writeAll(all);
}

/** Check whether a specific notebook is subscribed (explicitly or via owning seed). */
export function isNotebookSubscribed(seedId: string, notebookId: string): boolean {
  if (seedId === 'core') return true;
  const all = readAll();
  const specificKey = `${seedId}#${notebookId}`;
  if (specificKey in all) return all[specificKey] === true;
  return isSeedSubscribed(seedId);
}

/** Subscribe or unsubscribe an individual notebook from a feed. */
export function setNotebookSubscribed(seedId: string, notebookId: string, subscribed: boolean): boolean {
  const specificKey = `${seedId}#${notebookId}`;
  const all = { ...readAll(), [specificKey]: subscribed };
  return writeAll(all);
}

/** Returns the explicit notebook ids subscribed for a seed, or null if the full seed is subscribed. */
export function getSubscribedNotebooks(seedId: string): string[] | null {
  if (seedId === 'core') return null;
  const all = readAll();
  if (all[seedId] === true) return null;
  const prefix = `${seedId}#`;
  const notebookIds = Object.entries(all)
    .filter(([key, val]) => val === true && key.startsWith(prefix))
    .map(([key]) => key.slice(prefix.length));
  return notebookIds.length > 0 ? notebookIds : null;
}

export function subscribeSeedSubscriptions(listener: () => void): () => void {
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
 * Default: core on (it is the app's own first-paint seed), every other
 * source off — subscribing never implies auto-updating.
 */
export function isSeedAutoSync(id: string): boolean {
  const all = readAutoSyncAll();
  return id in all ? all[id] === true : id === 'core';
}

/** Persist the auto-sync choice. Returns false when it could NOT be
 *  persisted (browser storage unavailable) — session-only then. */
export function setSeedAutoSync(id: string, enabled: boolean): boolean {
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
export async function migrateSeedSubscriptions(
  sources: ReadonlyArray<{ id: string }>,
  storage: SeedImportStorage = mainThreadSeedImportStorage(),
): Promise<string[]> {
  const all = { ...readAll() };
  const migrated: string[] = [];
  // Pre-seed-unit builds subscribed per notebook and never wrote a seed
  // record; the notebook verdicts they left behind become the seed's.
  for (const notebook of NOTEBOOKS) {
    if (!(notebook.id in all)) continue;
    if (!(notebook.seedId in all)) {
      all[notebook.seedId] = all[notebook.id];
      if (all[notebook.id]) migrated.push(notebook.seedId);
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
  if (migrated.length) writeAll(all);
  return migrated;
}

/** Test-only: drop the cached maps (tests mutate localStorage). */
export function resetSeedSubscriptionsForTest(): void {
  cache = null;
  autoSyncCache = null;
}
