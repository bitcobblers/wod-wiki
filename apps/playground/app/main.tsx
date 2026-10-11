import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BootRecovery } from './BootRecovery';
import './lib/telemetry-gtag';
import '../src/index.css';
import { remotePrefsMode, hydrateMetaPrefs } from '@/services/storage/metaStore';
import { readDataSettings, whenStorageReady, storageBackend } from '@/services/storage';

const root = createRoot(document.getElementById('root')!);

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

function renderRecovery(error: unknown) {
  root.render(
    <React.StrictMode>
      <BootRecovery error={error} onRetry={boot} />
    </React.StrictMode>,
  );
}

// Boot gate: every provider must be ready before first render — preferences
// (api/turso) hydrate into the meta cache, and writes before connect would
// land in default state. A malformed saved config or a failed provider (bad
// token, unreachable remote, transport or schema failure) renders the
// standalone BootRecovery screen — the app never silently falls back to this
// browser: switching to IndexedDB there is an explicit choice. /settings/data
// lives inside the app, so recovery carries its own controls.
function boot() {
  const saved = readDataSettings();
  if (storageBackend !== 'api' && saved.state === 'invalid') {
    renderRecovery(new Error(`Saved data settings are invalid: ${saved.error}`));
    return;
  }
  whenStorageReady()
    .then(() => (remotePrefsMode ? hydrateMetaPrefs() : undefined))
    .then(renderApp)
    .catch(renderRecovery);
}

boot();
