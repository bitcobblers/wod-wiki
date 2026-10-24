import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { LocalDatabaseInfo } from '@bitcobblers/wod-wiki-storage/idb';
import {
  createLocalDatabase,
  isValidLocalDatabaseName,
  listLocalDatabases,
} from '@bitcobblers/wod-wiki-storage/idb';
import {
  getActiveLocalDbName,
  subscribeActiveLocalDatabase,
  switchActiveLocalDatabase,
  whenStorageReady,
} from '@/services/storage';
import { rehydrateActiveDatabaseCaches } from '@/services/storage/activeDatabaseCaches';
import {
  adoptLegacyCoreRegistryCheckpoint,
  defaultSeedSources,
  isCoreSeedImported,
  runBootSeedSync,
  syncSeedSource,
} from '@/services/seed/seedSync';

export type SeedStatus = 'idle' | 'running' | 'imported' | 'error';

export interface DatabaseSeedState {
  status: SeedStatus;
  message: string | null;
  coreImported: boolean;
}

export interface DatabaseSeedSourceInfo {
  id: string;
  label: string;
  description?: string;
  autoImport: boolean;
}

export interface DatabaseContextValue {
  activeName: string;
  databases: LocalDatabaseInfo[];
  loading: boolean;
  error: string | null;
  seed: DatabaseSeedState;
  seedSources: DatabaseSeedSourceInfo[];
  /**
   * Bumps whenever the active database's CONTENT changes underneath a
   * reader: after a seed import lands, and after a database switch. Pages
   * that read the database (search, sessions, dashboards) re-read when it
   * moves — otherwise a page that mounted before the seed finished would
   * keep showing an empty database.
   */
  dataVersion: number;
  selectDatabase(name: string): Promise<void>;
  createDatabase(name: string): Promise<void>;
  importSeedSource(id: string): Promise<void>;
  refreshDatabases(): Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  // getActiveLocalDbName is a synchronous localStorage read: the current
  // DATA_SETTINGS_KEY.localDbName, otherwise the default database.
  const [activeName, setActiveName] = useState<string>(() => getActiveLocalDbName());
  const [databases, setDatabases] = useState<LocalDatabaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<DatabaseSeedState>({ status: 'idle', message: null, coreImported: false });
  // Readers re-read the database when this moves.
  const [dataVersion, setDataVersion] = useState(0);

  // The shared seed registry (bundled core + the built-in catalogs); a
  // missing flag means boot-auto, mirroring SeedSourceSpec's default.
  const seedSources = useMemo<DatabaseSeedSourceInfo[]>(
    () =>
      defaultSeedSources().map((spec) => ({
        id: spec.id,
        label: spec.label,
        ...(spec.description ? { description: spec.description } : {}),
        autoImport: spec.autoImport !== false,
      })),
    [],
  );

  const refreshDatabases = useCallback(async () => {
    try {
      setDatabases(await listLocalDatabases());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  // The exact boot policy the playground app runs: when the active database
  // has no core seed checkpoint, runBootSeedSync populates it. A failing
  // source lands in seed.status/seed.message — never a broken page. The
  // retired remote Core Registry checkpoint folds into local core BEFORE the
  // imported probe: a returning database whose only import was the old
  // registry must migrate even when runBootSeedSync is then skipped.
  const ensureCoreSeed = useCallback(async () => {
    setSeed((prev) => ({ ...prev, status: 'running', message: null }));
    try {
      await adoptLegacyCoreRegistryCheckpoint();
      const imported = await isCoreSeedImported();
      if (!imported) {
        const outcome = await runBootSeedSync();
        const refreshed = await isCoreSeedImported();
        if (outcome === 'error') {
          setSeed({ status: 'error', message: 'Seed sync failed — catalogs may be incomplete.', coreImported: refreshed });
          // The import may still have committed rows before failing.
          setDataVersion((v) => v + 1);
          return;
        }
        setSeed({ status: 'imported', message: null, coreImported: refreshed });
        // The corpus just landed — readers must re-read.
        setDataVersion((v) => v + 1);
        return;
      }
      setSeed({ status: 'imported', message: null, coreImported: true });
    } catch (err) {
      setSeed((prev) => ({ ...prev, status: 'error', message: errorMessage(err) }));
    }
  }, []);

  // Stories (or sibling tabs) may switch the live storage behind this
  // provider — track the shared selection instead of caching our own.
  useEffect(() => subscribeActiveLocalDatabase(setActiveName), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await whenStorageReady();
        const list = await listLocalDatabases();
        if (cancelled) return;
        setDatabases(list);
        await ensureCoreSeed();
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureCoreSeed]);

  const selectDatabase = useCallback(
    async (name: string) => {
      setError(null);
      await switchActiveLocalDatabase(name);
      // The caches derived from the OLD database's rows (seed content, WQL
      // page sources, effort/equipment registries) must be rebuilt against
      // the new one.
      await rehydrateActiveDatabaseCaches();
      setActiveName(getActiveLocalDbName());
      await whenStorageReady();
      await refreshDatabases();
      // A different database holds different rows — readers must re-read.
      setDataVersion((v) => v + 1);
      await ensureCoreSeed();
    },
    [ensureCoreSeed, refreshDatabases],
  );

  const createDatabase = useCallback(
    async (name: string) => {
      if (!isValidLocalDatabaseName(name)) {
        throw new Error('Database names use 1–100 letters, numbers, dots, dashes, or underscores and must start with a letter or number.');
      }
      await createLocalDatabase(name);
      await refreshDatabases();
      await selectDatabase(name);
    },
    [refreshDatabases, selectDatabase],
  );

  const importSeedSource = useCallback(async (id: string) => {
    setSeed((prev) => ({ ...prev, status: 'running', message: null }));
    try {
      const outcome = await syncSeedSource(id);
      const refreshed = await isCoreSeedImported();
      if (outcome === 'error') {
        setSeed({ status: 'error', message: `Import of "${id}" failed — see the browser console for details.`, coreImported: refreshed });
        return;
      }
      setSeed({ status: 'imported', message: null, coreImported: refreshed });
      // The catalog's rows just landed — readers must re-read.
      setDataVersion((v) => v + 1);
    } catch (err) {
      setSeed((prev) => ({ ...prev, status: 'error', message: errorMessage(err) }));
    }
  }, []);

  const value = useMemo<DatabaseContextValue>(
    () => ({
      activeName,
      databases,
      loading,
      error,
      seed,
      seedSources,
      dataVersion,
      selectDatabase,
      createDatabase,
      importSeedSource,
      refreshDatabases,
    }),
    [activeName, databases, loading, error, seed, seedSources, dataVersion, selectDatabase, createDatabase, importSeedSource, refreshDatabases],
  );

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) throw new Error('useDatabase must be used within a DatabaseProvider.');
  return value;
}
