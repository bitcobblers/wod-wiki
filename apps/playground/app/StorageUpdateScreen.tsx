/**
 * StorageUpdateScreen — minimal blocking software-update surface shown while
 * the storage layer checks or applies a schema update (local-first
 * contract). Meaningful phases only: no fake progress percentage. Consumes
 * the storageUpdate external store via useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';
import { getStorageUpdate, subscribeStorageUpdate } from '@/services/storage/storageUpdate';

export function StorageUpdateScreen() {
  const update = useSyncExternalStore(subscribeStorageUpdate, getStorageUpdate);
  const updating = update.phase === 'updating';
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="text-sm font-semibold">
        {updating ? 'Updating local database…' : 'Checking for storage updates…'}
      </p>
      {updating && update.fromVersion !== null && (
        <p className="text-xs text-muted-foreground">
          Schema v{update.fromVersion} → v{update.toVersion}
        </p>
      )}
      {update.message && (
        <p className="max-w-md text-xs text-muted-foreground">{update.message}</p>
      )}
    </div>
  );
}
