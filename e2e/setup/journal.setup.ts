import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';
import { WOD_DB } from '../helpers/wodwikiDb';

export const JOURNAL_STORAGE_STATE = resolve(
  import.meta.dirname,
  '../../.playwright/journal-storage-state.json',
);
export const JOURNAL_DARK_STORAGE_STATE = resolve(
  import.meta.dirname,
  '../../.playwright/journal-dark-storage-state.json',
);

const THEME_KEY = 'wod-wiki-playground-theme';

interface SeedMetaSummary {
  coreVersion: number;
  activeClaims: number;
}

/**
 * Seed the Playground's core IndexedDB corpus once per worker runner / shard
 * and persist both light and dark `storageState` snapshots (`indexedDB: true`).
 *
 * Dependent projects (`journal-chromium`, `journal-mobile-375`, `journal-dark`)
 * restore the committed `wodwiki-db` instead of re-importing 278+ core rows on
 * every test. Cold-boot specs run in `journal-cold-chromium` without this state.
 */
setup('seed playground core IndexedDB snapshot', async ({ page }) => {
  setup.setTimeout(120_000);

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitForFeedReady(page, 90_000);

  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-boot-feed-settled', /.+/, { timeout: 90_000 });
  await expect(page.getByTestId('sync-activity-indicators')).toHaveCount(0, { timeout: 60_000 });

  await expect
    .poll(
      async (): Promise<SeedMetaSummary> =>
        page.evaluate(async (dbName) => {
          const db = await new Promise<IDBDatabase>((resolveDb, rejectDb) => {
            const req = indexedDB.open(dbName);
            req.onsuccess = () => resolveDb(req.result);
            req.onerror = () => rejectDb(req.error);
          });
          try {
            const rows = await new Promise<Array<{ key?: string; seedVersion?: number; claim?: unknown }>>(
              (resolveRows, rejectRows) => {
                const tx = db.transaction('meta', 'readonly');
                const getAll = tx.objectStore('meta').getAll();
                getAll.onsuccess = () => resolveRows(getAll.result as Array<{ key?: string; seedVersion?: number; claim?: unknown }>);
                getAll.onerror = () => rejectRows(getAll.error);
              },
            );
            const core = rows.find((r) => r.key === 'seed:core');
            const activeClaims = rows.filter((r) => r.claim != null).length;
            return {
              coreVersion: typeof core?.seedVersion === 'number' ? core.seedVersion : 0,
              activeClaims,
            };
          } finally {
            db.close();
          }
        }, WOD_DB),
      { timeout: 30_000, message: 'core seed checkpoint must commit with no active claims' },
    )
    .toEqual({ coreVersion: expect.any(Number), activeClaims: 0 });

  const coreVersion = await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolveDb, rejectDb) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolveDb(req.result);
      req.onerror = () => rejectDb(req.error);
    });
    try {
      return await new Promise<number>((resolveVer, rejectVer) => {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get('seed:core');
        req.onsuccess = () => {
          const row = req.result as { seedVersion?: number } | undefined;
          resolveVer(row?.seedVersion ?? 0);
        };
        req.onerror = () => rejectVer(req.error);
      });
    } finally {
      db.close();
    }
  }, WOD_DB);
  expect(coreVersion).toBeGreaterThan(0);

  await page.evaluate((key) => {
    localStorage.setItem(key, 'light');
  }, THEME_KEY);

  mkdirSync(dirname(JOURNAL_STORAGE_STATE), { recursive: true });
  const lightState = await page.context().storageState({ indexedDB: true });
  writeFileSync(JOURNAL_STORAGE_STATE, JSON.stringify(lightState));

  const originUrl = new URL(page.url()).origin;
  const darkOrigins = lightState.origins.some((o) => o.origin === originUrl)
    ? lightState.origins.map((originEntry) => {
        if (originEntry.origin !== originUrl) return originEntry;
        const filtered = originEntry.localStorage.filter((entry) => entry.name !== THEME_KEY);
        return {
          ...originEntry,
          localStorage: [...filtered, { name: THEME_KEY, value: 'dark' }],
        };
      })
    : [
        ...lightState.origins,
        { origin: originUrl, localStorage: [{ name: THEME_KEY, value: 'dark' }] },
      ];

  const darkState = {
    ...lightState,
    origins: darkOrigins,
  };
  writeFileSync(JOURNAL_DARK_STORAGE_STATE, JSON.stringify(darkState));
});
