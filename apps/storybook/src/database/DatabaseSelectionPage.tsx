import { useState } from 'react';
import { isValidLocalDatabaseName } from '@bitcobblers/wod-wiki-storage/idb';
import { useDatabase } from './DatabaseContext';

const NAME_RULE = 'Use 1–100 letters, numbers, dots, dashes, or underscores — starting with a letter or number.';

export function DatabaseSelectionPage() {
  const {
    activeName,
    databases,
    loading,
    error,
    seed,
    seedSources,
    selectDatabase,
    createDatabase,
    importSeedSource,
    refreshDatabases,
  } = useDatabase();
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...databases].sort((a, b) => a.name.localeCompare(b.name));

  async function handleCreate(): Promise<void> {
    const name = newName.trim();
    if (!isValidLocalDatabaseName(name)) {
      setCreateError(`"${name}" is not a valid database name. ${NAME_RULE}`);
      return;
    }
    setCreateError(null);
    setBusy(true);
    try {
      await createDatabase(name);
      setNewName('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(name: string): Promise<void> {
    setBusy(true);
    try {
      await selectDatabase(name);
    } finally {
      setBusy(false);
    }
  }

  const seedStatusText =
    seed.status === 'running'
      ? 'Importing seed…'
      : seed.status === 'idle'
        ? 'Not checked yet'
        : seed.status === 'error'
          ? 'Seed sync failed'
          : seed.coreImported
            ? 'Core corpus imported'
            : 'Core corpus not imported';

  return (
    <div data-testid="database-selection" className="max-w-3xl mx-auto space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">Local Databases</h1>
        <p className="text-sm text-muted-foreground">
          IndexedDB databases backing the playground storage plane. Selecting one switches the live
          storage for every story in this Storybook.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <div className="text-sm text-muted-foreground">Opening local storage…</div>}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Databases</h2>
          <button
            type="button"
            data-testid="database-refresh"
            onClick={() => void refreshDatabases()}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-card disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <ul className="space-y-2">
          {sorted.map((db) => {
            const active = db.name === activeName;
            return (
              <li
                key={db.name}
                data-testid={`database-row-${db.name}`}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 bg-card ${active ? 'border-primary/50' : 'border-border'}`}
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="font-mono">{db.name}</span>
                    {active && (
                      <span
                        data-testid="database-active-badge"
                        className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground"
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">Schema version {db.version ?? '—'}</div>
                </div>
                {active ? (
                  <span className="text-xs text-muted-foreground">Current</span>
                ) : (
                  <button
                    type="button"
                    data-testid={`database-select-${db.name}`}
                    onClick={() => void handleSelect(db.name)}
                    disabled={busy}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    Use
                  </button>
                )}
              </li>
            );
          })}
          {sorted.length === 0 && !loading && (
            <li className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              No local databases found — create one below.
            </li>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Create database</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            data-testid="database-create-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. wodwiki-storybook"
            className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            data-testid="database-create-button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Create
          </button>
        </div>
        {createError && (
          <p data-testid="database-create-error" className="text-xs text-destructive">
            {createError}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Core seed</h2>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span data-testid="seed-status" className={seed.status === 'error' ? 'text-destructive' : 'text-foreground'}>
            {seedStatusText}
          </span>
          {seed.status === 'running' && <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
        </div>
        {seed.message && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {seed.message}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Catalogs</h2>
        <ul className="space-y-2">
          {seedSources.map((source) => (
            <li
              key={source.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {source.label}
                  {source.autoImport && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">auto</span>
                  )}
                </div>
                {source.description && (
                  <div className="truncate text-xs text-muted-foreground">{source.description}</div>
                )}
              </div>
              <button
                type="button"
                data-testid={`seed-import-${source.id}`}
                onClick={() => void importSeedSource(source.id)}
                disabled={seed.status === 'running' || busy}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-primary hover:bg-card disabled:opacity-50"
              >
                Import
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
