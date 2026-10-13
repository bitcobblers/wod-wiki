import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BootRecovery } from './BootRecovery';
import { StorageUpdateScreen } from './StorageUpdateScreen';
import './lib/telemetry-gtag';
import '../src/index.css';
import { remotePrefsMode, hydrateMetaPrefs } from '@/services/storage/metaStore';
import { whenStorageReady, startBackgroundStorageSync } from '@/services/storage';
import { getStorageUpdate, subscribeStorageUpdate } from '@/services/storage/storageUpdate';

const root = createRoot(document.getElementById('root')!);

/** Open the local data plane before starting optional background sync. */
function BootGate() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const update = useSyncExternalStore(subscribeStorageUpdate, getStorageUpdate);

  useEffect(() => {
    let cancelled = false;
    let cleanupSync: (() => void) | undefined;
    whenStorageReady()
      .then(() => (remotePrefsMode ? hydrateMetaPrefs() : undefined))
      .then(() => {
        if (!cancelled) {
          cleanupSync = startBackgroundStorageSync();
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(err);
      });
    return () => {
      cancelled = true;
      cleanupSync?.();
    };
  }, [attempt]);

  if (failed) {
    return <BootRecovery error={failed} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} />;
  }
  if (update.phase === 'checking' || update.phase === 'updating') {
    return <StorageUpdateScreen />;
  }
  if (!ready) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  return <App />;
}

root.render(
  <React.StrictMode>
    <BootGate />
  </React.StrictMode>,
);
