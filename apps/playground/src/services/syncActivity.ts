/**
 * syncActivity — central sync-activity external store (local-first
 * contract). Counts parallel upload/download activity, keeps the latest
 * committed-record result and the latest user-safe error. No React imports;
 * UI binds through useSyncExternalStore(getSyncActivity, subscribeSyncActivity).
 * Snapshots are stable between mutations.
 */

export type SyncActivityDirection = 'upload' | 'download';

export interface SyncActivityResult {
  id: number;
  source: string;
  added: number;
  updated: number;
}

export interface SyncActivitySnapshot {
  uploading: number;
  downloading: number;
  label: string | null;
  result: SyncActivityResult | null;
  error: string | null;
}

let uploading = 0;
let downloading = 0;
let lastResult: SyncActivityResult | null = null;
let lastError: string | null = null;
let nextResultId = 1;

/** Live task stack — the label is the most recent still-active task's. */
const activeTasks: { direction: SyncActivityDirection; label: string }[] = [];

const listeners = new Set<() => void>();
let snapshot: SyncActivitySnapshot = { uploading: 0, downloading: 0, label: null, result: null, error: null };

function rebuildSnapshot(): void {
  snapshot = {
    uploading,
    downloading,
    label: activeTasks.length ? activeTasks[activeTasks.length - 1].label : null,
    result: lastResult,
    error: lastError,
  };
  for (const listener of listeners) listener();
}

/**
 * Begin one sync task; returns its ender. The ender is idempotent — a
 * second call is a no-op — so finally-block and error paths can both close.
 * The visible label follows the most recent still-active task: a finished
 * concurrent task never leaves its own (or a stale) name showing.
 */
export function beginSyncActivity(direction: SyncActivityDirection, label: string): () => void {
  const task = { direction, label };
  activeTasks.push(task);
  if (direction === 'upload') uploading += 1;
  else downloading += 1;
  rebuildSnapshot();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const at = activeTasks.indexOf(task);
    if (at >= 0) activeTasks.splice(at, 1);
    if (direction === 'upload') uploading = Math.max(0, uploading - 1);
    else downloading = Math.max(0, downloading - 1);
    rebuildSnapshot();
  };
}

/** Report committed consumer records of one finished sync run — a success
 *  also clears any stale failure so an old error never hides it. */
export function reportSyncResult(result: { source: string; added: number; updated: number }): void {
  lastResult = { id: nextResultId++, source: result.source, added: result.added, updated: result.updated };
  lastError = null;
  rebuildSnapshot();
}

/** Report a user-display-safe error (never secrets). */
export function reportSyncError(message: string): void {
  lastError = message;
  rebuildSnapshot();
}

export function getSyncActivity(): SyncActivitySnapshot {
  return snapshot;
}

export function subscribeSyncActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
