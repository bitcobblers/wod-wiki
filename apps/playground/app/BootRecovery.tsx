/**
 * BootRecovery — the standalone screen rendered when the saved data provider
 * can't be readied at boot (wrong token, unreachable Turso, transport or
 * schema failure). The app proper is not mounted, so this screen carries its
 * own recovery controls: retry, switch to this browser (IndexedDB), and
 * credential repair via the same TursoConnectForm Settings ▸ Data uses.
 */

import { readDataSettings, switchToIndexedDb, storageBackend } from '@/services/storage';
import { TursoConnectForm } from './pages/DataSection';

export function BootRecovery({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const saved = readDataSettings();

  return (
    <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold">Your saved data location couldn't be reached.</p>
      <p
        className="max-w-md text-xs text-muted-foreground font-mono break-all"
        data-testid="boot-recovery-error"
      >
        {message}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        Repair the connection here or switch to this browser; Settings → Data has the full controls once the app loads.
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
        {storageBackend !== 'api' && (
          <button
            type="button"
            onClick={() => {
              switchToIndexedDb();
              window.location.reload();
            }}
            data-testid="boot-recovery-local"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Use this browser (IndexedDB)
          </button>
        )}
      </div>
      {storageBackend !== 'api' && (
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
