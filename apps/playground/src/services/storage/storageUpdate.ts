/**
 * storageUpdate — external store for the local-first storage lifecycle.
 * No React imports; UI consumes it via useSyncExternalStore.
 *
 * Phases:
 *  - 'idle'     — local database readable, no migration or probe running.
 *  - 'checking' — comparing the local/remote schema version (probe only;
 *                 never blocks ordinary boot or local saves).
 *  - 'updating' — a schema migration is running (fromVersion → toVersion).
 *  - 'error'    — migration or sync-schema failure; message is presentable.
 *
 * Snapshots are stable between mutations: getStorageUpdate() returns the
 * same object until a mutation replaces it.
 */

export interface StorageUpdateSnapshot {
  phase: 'idle' | 'checking' | 'updating' | 'error';
  message: string;
  fromVersion: number | null;
  toVersion: number;
}

let snapshot: StorageUpdateSnapshot = {
  phase: 'idle',
  message: '',
  fromVersion: null,
  toVersion: 0,
};

const listeners = new Set<() => void>();

function publish(next: StorageUpdateSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getStorageUpdate(): StorageUpdateSnapshot {
  return snapshot;
}

export function subscribeStorageUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset to idle (after a migration completes or at fresh-boot). */
export function markStorageIdle(toVersion: number): void {
  publish({ phase: 'idle', message: '', fromVersion: null, toVersion });
}

export function markStorageChecking(message: string): void {
  publish({ ...snapshot, phase: 'checking', message });
}

export function beginStorageUpgrade(fromVersion: number, toVersion: number): void {
  publish({ phase: 'updating', message: `Updating local database schema v${fromVersion} → v${toVersion}…`, fromVersion, toVersion });
}

/** Blocking software-update screen for a schema migration of either side —
 *  the local database (beginStorageUpgrade) or the remote backup target. */
export function markStorageUpdating(message: string, fromVersion: number | null = null, toVersion: number = snapshot.toVersion): void {
  publish({ phase: 'updating', message, fromVersion, toVersion });
}

export function failStorageUpdate(message: string): void {
  publish({ ...snapshot, phase: 'error', message });
}
