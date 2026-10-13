/** Recovery for local database open/migration failures and API bootstrap errors. */

import { readDataSettings, switchToIndexedDb, storageBackend } from '@/services/storage';
import { TursoConnectForm } from './pages/DataSection';

export function BootRecovery({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const saved = readDataSettings();

  return (
    <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold">{storageBackend === 'api' ? 'The API data store could not be opened.' : 'The local database could not be opened.'}</p>
      <p
        className="max-w-md text-xs text-muted-foreground font-mono break-all"
        data-testid="boot-recovery-error"
      >
        {message}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        Your stored data has not been cleared. Retry after resolving the error above.
        {storageBackend !== 'api' && saved.state !== 'indexed-db' && ' Turn off Turso Sync to skip backup comparison. Settings → Storage has the full controls once the app loads.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          data-testid="boot-recovery-retry"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Retry
        </button>
        {storageBackend !== 'api' && saved.state !== 'indexed-db' && (
          <button
            type="button"
            onClick={() => {
              switchToIndexedDb();
              window.location.reload();
            }}
            data-testid="boot-recovery-local"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Turn off Turso Sync
          </button>
        )}
      </div>
      {storageBackend !== 'api' && saved.state !== 'indexed-db' && (
        <details className="w-full max-w-md rounded-xl border border-border bg-card p-4 text-left">
          <summary className="cursor-pointer text-xs font-medium">Fix Turso credentials</summary>
          <div className="pt-3">
            <TursoConnectForm
              saved={saved.state === 'turso' ? { url: saved.url, authToken: saved.authToken } : undefined}
            />
          </div>
        </details>
      )}
    </div>
  );
}
