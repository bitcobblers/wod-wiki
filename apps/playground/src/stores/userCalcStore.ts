/**
 * UserCalcStore — persistence for user-authored calc lines (#880).
 *
 * Stores each custom calculation as its author-facing line-form source
 * (`compileLineForm`'s input), so edits round-trip losslessly and the store
 * never goes stale against compiler changes. Hydration compiles stored
 * sources back into `CalculationDefinition` records for registration.
 *
 * Local mode keeps a dedicated tiny IndexedDB database
 * (`wodwiki-user-calcs`); server mode (VITE_STORAGE=api) persists the same
 * records as `user-calc:*` meta rows so they survive a fresh browser.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { compileLineForm, LineFormScope } from '@bitcobblers/wod-wiki-engine';
import { CalculationDefinition } from '@bitcobblers/wod-wiki-engine';
import { remotePrefsMode, metaDeleteRow, metaGetRow, metaListRows, metaPutRow } from '@/services/storage/metaStore';

const DB_NAME = 'wodwiki-user-calcs';
const DB_VERSION = 1;
const STORE = 'calcs';
/** Remote-mode namespace in the shared meta store ({ key, value } rows);
 *  also the key format the IDB→Turso migration writes. */
export const META_PREFIX = 'user-calc:';

export interface UserCalcRecord {
  id: string;
  /** Author-facing line-form source for this calc. */
  lineForm: string;
  updatedAt: number;
}

interface UserCalcDB extends DBSchema {
  calcs: {
    key: string;
    value: UserCalcRecord;
  };
}

export interface HydratedCalc {
  def: CalculationDefinition;
  record: UserCalcRecord;
}

export interface HydrationResult {
  defs: CalculationDefinition[];
  /** Individual compile failures keyed by calc id — surfaced as diagnostics. */
  errors: { id: string; message: string }[];
}

let dbPromise: Promise<IDBPDatabase<UserCalcDB>> | undefined;

function open(): Promise<IDBPDatabase<UserCalcDB>> {
  if (!dbPromise) {
    dbPromise = openDB<UserCalcDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** Snapshot of the default scope used when a stored line has no scope header. */
const DEFAULT_LINE_SCOPE: LineFormScope = { scope: 'segment' };

/** List all stored user calc records, newest-first. */
export async function listUserCalcs(): Promise<UserCalcRecord[]> {
  if (remotePrefsMode) {
    const rows = await metaListRows<UserCalcRecord>(META_PREFIX);
    return rows.map((r) => r.value).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const db = await open();
  const all = await db.getAll(STORE);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Get a single stored calc by id, if present. */
export async function getUserCalc(id: string): Promise<UserCalcRecord | undefined> {
  if (remotePrefsMode) return metaGetRow<UserCalcRecord>(META_PREFIX + id);
  const db = await open();
  return db.get(STORE, id);
}

/** Insert or replace a calc record. */
export async function saveUserCalc(record: UserCalcRecord): Promise<void> {
  if (remotePrefsMode) {
    await metaPutRow(META_PREFIX + record.id, {
      id: record.id,
      lineForm: record.lineForm,
      updatedAt: record.updatedAt ?? Date.now(),
    });
    return;
  }
  const db = await open();
  await db.put(STORE, {
    ...record,
    updatedAt: record.updatedAt ?? Date.now(),
  });
}

/** Remove a calc record. */
export async function deleteUserCalc(id: string): Promise<void> {
  if (remotePrefsMode) return metaDeleteRow(META_PREFIX + id);
  const db = await open();
  await db.delete(STORE, id);
}

/** Compile every stored line-form into registerable DAG records. */
export async function hydrateUserCalcs(): Promise<HydrationResult> {
  const records = await listUserCalcs();
  const defs: CalculationDefinition[] = [];
  const errors: { id: string; message: string }[] = [];

  for (const record of records) {
    try {
      const { defs: compiled } = compileLineForm(record.lineForm, DEFAULT_LINE_SCOPE);
      defs.push(...compiled);
    } catch (err) {
      errors.push({ id: record.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { defs, errors };
}
