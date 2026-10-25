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
  adoptFeedProvenance,
  adoptLegacyCoreRegistryCheckpoint,
  defaultFeedSources,
  isCoreFeedImported,
  runBootFeedSync,
  syncFeedSource,
} from '@/services/feed/feedSync';

export type FeedStatus = 'idle' | 'running' | 'imported' | 'error';

export interface DatabaseFeedState {
  status: FeedStatus;
  message: string | null;
  coreImported: boolean;
}

export interface DatabaseFeedSourceInfo {
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
  feed: DatabaseFeedState;
  feedSources: DatabaseFeedSourceInfo[];
  /**
   * Bumps whenever the active database's CONTENT changes underneath a
   * reader: after a feed import lands, and after a database switch. Pages
   * that read the database (search, sessions, dashboards) re-read when it
   * moves — otherwise a page that mounted before the feed finished would
   * keep showing an empty database.
   */
  dataVersion: number;
  selectDatabase(name: string): Promise<void>;
  createDatabase(name: string): Promise<void>;
  importFeedSource(id: string): Promise<void>;
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
  const [feed, setFeed] = useState<DatabaseFeedState>({ status: 'idle', message: null, coreImported: false });
  // Readers re-read the database when this moves.
  const [dataVersion, setDataVersion] = useState(0);

  // The shared feed registry (bundled core + the built-in catalogs); a
  // missing flag means boot-auto, mirroring FeedSourceSpec's default.
  const feedSources = useMemo<DatabaseFeedSourceInfo[]>(
    () =>
      defaultFeedSources().map((spec) => ({
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
  // has no core feed checkpoint, runBootFeedSync populates it. A failing
  // source lands in feed.status/feed.message — never a broken page. The
  // retired remote Core Registry checkpoint folds into local core BEFORE the
  // imported probe: a returning database whose only import was the old
  // registry must migrate even when runBootFeedSync is then skipped.
  const ensureCoreFeed = useCallback(async () => {
    setFeed((prev) => ({ ...prev, status: 'running', message: null }));
    try {
      await adoptLegacyCoreRegistryCheckpoint();
      // Notes imported before the feed stamp existed carry only the seed-side
      // stamps — the checkpoints say which feed delivered them.
      await adoptFeedProvenance();
      const imported = await isCoreFeedImported();
      if (!imported) {
        const outcome = await runBootFeedSync();
        const refreshed = await isCoreFeedImported();
        if (outcome === 'error') {
          setFeed({ status: 'error', message: 'Feed sync failed — catalogs may be incomplete.', coreImported: refreshed });
          // The import may still have committed rows before failing.
          setDataVersion((v) => v + 1);
          return;
        }
        setFeed({ status: 'imported', message: null, coreImported: refreshed });
        // The corpus just landed — readers must re-read.
        setDataVersion((v) => v + 1);
        return;
      }
      setFeed({ status: 'imported', message: null, coreImported: true });
    } catch (err) {
      setFeed((prev) => ({ ...prev, status: 'error', message: errorMessage(err) }));
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
        await ensureCoreFeed();
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureCoreFeed]);

  const selectDatabase = useCallback(
    async (name: string) => {
      setError(null);
      await switchActiveLocalDatabase(name);
      // The caches derived from the OLD database's rows (feed content, WQL
      // page sources, effort/equipment registries) must be rebuilt against
      // the new one.
      await rehydrateActiveDatabaseCaches();
      setActiveName(getActiveLocalDbName());
      await whenStorageReady();
      await refreshDatabases();
      // A different database holds different rows — readers must re-read.
      setDataVersion((v) => v + 1);
      await ensureCoreFeed();
    },
    [ensureCoreFeed, refreshDatabases],
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

  const importFeedSource = useCallback(async (id: string) => {
    setFeed((prev) => ({ ...prev, status: 'running', message: null }));
    try {
      const outcome = await syncFeedSource(id);
      const refreshed = await isCoreFeedImported();
      if (outcome === 'error') {
        setFeed({ status: 'error', message: `Import of "${id}" failed — see the browser console for details.`, coreImported: refreshed });
        return;
      }
      setFeed({ status: 'imported', message: null, coreImported: refreshed });
      // The catalog's rows just landed — readers must re-read.
      setDataVersion((v) => v + 1);
    } catch (err) {
      setFeed((prev) => ({ ...prev, status: 'error', message: errorMessage(err) }));
    }
  }, []);

  const value = useMemo<DatabaseContextValue>(
    () => ({
      activeName,
      databases,
      loading,
      error,
      feed,
      feedSources,
      dataVersion,
      selectDatabase,
      createDatabase,
      importFeedSource,
      refreshDatabases,
    }),
    [activeName, databases, loading, error, feed, feedSources, dataVersion, selectDatabase, createDatabase, importFeedSource, refreshDatabases],
  );

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) throw new Error('useDatabase must be used within a DatabaseProvider.');
  return value;
}
