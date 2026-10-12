/**
 * tursoMigration — one-shot full copy from the local provider to a freshly
 * prepared SQL destination (BrowserTursoStorage).
 *
 * Safety contract:
 *  - The snapshot is taken inside ONE source readonly transaction across every
 *    STORE_DEFS store; every getAll() is issued in the same task (Promise.all,
 *    no interleaved awaits) so the IndexedDB transaction cannot auto-commit
 *    mid-snapshot. Whole Notes, immutable block revisions, attachments (binary buffers),
 *    meta (incl. `seed:*` checkpoints), memberships and derived indexes are a
 *    consistent point-in-time image, copied verbatim — ownership (`userId`)
 *    and seed stamps preserved; the destination is constructed WITHOUT a
 *    `getUserId` option so no adapter restamps.
 *  - Local-mode authored content living outside the shared stores is folded
 *    into namespaced remote `meta` rows: notebooks + active notebook and the
 *    route WQL defaults/shortcuts from localStorage, user-authored calcs from
 *    the private `wodwiki-user-calcs` database. Local rows win over stale
 *    meta rows with the same key. Device-local state (theme, audio,
 *    consent, view settings) intentionally does NOT migrate, local mode has
 *    no telemetry rows, and credentials never enter meta.
 *  - The destination empty check and all writes happen inside ONE destination
 *    write transaction: every store must be empty (count 0) before the first
 *    put, otherwise the transaction throws and rolls back — a nonempty
 *    destination is never silently overwritten and the source is untouched.
 *  - The localStorage profile (`wodwiki.membership`) is validated and folded
 *    into the destination `memberships` rows when its id is absent.
 *  - Callers persist the provider switch only after this resolves.
 */
import { STORE_DEFS, type Membership, type StoreName, type StoreType } from '@bitcobblers/wod-wiki-storage';
import type { SqlStorage } from '@bitcobblers/wod-wiki-storage/sql';
import type { IStorage, IStorageTransaction } from './IStorage';

const ALL_STORE_NAMES = STORE_DEFS.map((def) => def.name);

const MEMBERSHIP_KEY = 'wodwiki.membership';
// Literal twin of dataSettings.DATA_SETTINGS_KEY — importing dataSettings here
// would close the index → dataSettings → tursoMigration import cycle.
const DATA_SETTINGS_KEY = 'wodwiki.dataSettings.v1';

export interface MigrationResult {
  stores: number;
  rows: number;
}

export interface LocalMetaRow {
  key: string;
  value: unknown;
}

/**
 * localStorage rows the remote meta store owns in remote mode: the exact
 * notebook keys and the two route-WQL namespaces. Credentials
 * ('wodwiki.dataSettings.v1') are excluded by name, never by omission.
 */
export async function collectLocalPrefRows(): Promise<LocalMetaRow[]> {
  // Dynamic import: metaStore evaluates `storageBackend` from the storage
  // singleton at module load — a static edge here would TDZ mid-cycle
  // (index → dataSettings → tursoMigration → metaStore → index).
  const { PREF_KEYS, PREF_NAMESPACES } = await import('./metaStore');
  const rows: LocalMetaRow[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key === DATA_SETTINGS_KEY) continue;
      if (PREF_KEYS.includes(key) || PREF_NAMESPACES.some((ns) => key.startsWith(ns))) {
        const value = localStorage.getItem(key);
        if (value !== null) rows.push({ key, value });
      }
    }
  } catch {
    /* localStorage unavailable — nothing to copy */
  }
  return rows;
}

/** User-authored calcs from the private local IDB → `user-calc:*` meta rows
 *  (the same namespace userCalcStore writes in remote mode). */
export async function collectLocalCalcRows(): Promise<LocalMetaRow[]> {
  // Same dynamic-import reasoning as collectLocalPrefRows.
  const { listUserCalcs, META_PREFIX } = await import('@/stores/userCalcStore');
  const records = await listUserCalcs(); // local mode ⇒ private 'wodwiki-user-calcs' IDB
  return records.map((record) => ({ key: META_PREFIX + record.id, value: record }));
}

function collectLocalMetaRows(): Promise<LocalMetaRow[]> {
  return collectLocalPrefRows().then((prefs) => collectLocalCalcRows().then((calcs) => [...prefs, ...calcs]));
}

/** Validated at this trust boundary: localStorage is user-editable input, so
 *  only rows with the required Membership fields pass. */
function readLocalMembership(): Membership | undefined {
  try {
    const raw = localStorage.getItem(MEMBERSHIP_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    if (!('id' in parsed) || !('displayName' in parsed) || !('createdAt' in parsed)) return undefined;
    const id: unknown = parsed.id;
    const displayName: unknown = parsed.displayName;
    const createdAt: unknown = parsed.createdAt;
    if (typeof id !== 'string' || !id) return undefined;
    if (typeof displayName !== 'string' || !displayName.trim()) return undefined;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return undefined;
    const membership = parsed as Membership; // required fields validated above
    return membership;
  } catch {
    return undefined;
  }
}

async function copyStore<K extends StoreName>(tx: IStorageTransaction, name: K, rows: unknown[]): Promise<void> {
  await tx.readwrite(name).putMany(rows as StoreType<K>[]);
}


export async function migrateToSql(
  source: IStorage,
  dest: SqlStorage,
  localMeta?: LocalMetaRow[],
): Promise<MigrationResult> {
  // 1. Auxiliary local-state reads happen before the main IDB transaction
  //    (collectors are overridable so tests can stay off the singleton chain).
  const auxMeta = localMeta ?? (await collectLocalMetaRows());
  // 2. Consistent snapshot across every store — one source transaction, all
  //    getAll() requests issued in the same task.
  const snapshot = new Map<StoreName, unknown[]>();
  await source.transaction(ALL_STORE_NAMES, 'readonly', (tx) =>
    Promise.all(
      ALL_STORE_NAMES.map((name) =>
        tx.readonly(name).getAll().then((rows) => {
          snapshot.set(name, rows as unknown[]);
        }),
      ),
    ),
  );

  // 3. Fold the validated localStorage profile into the membership rows by id.
  const memberships = snapshot.get('memberships') ?? [];
  const local = readLocalMembership();
  if (local && !memberships.some((row) => (row as Membership).id === local.id)) memberships.push(local);

  // 4. Fold local authored prefs/calcs into meta; the local row wins when a
  //    stale meta row carries the same key. Meta rows are { key, value } by
  //    the store's keyPath.
  const meta = (snapshot.get('meta') ?? []) as { key: string; value: unknown }[];
  for (const row of auxMeta) {
    const existing = meta.findIndex((m) => m.key === row.key);
    if (existing >= 0) meta[existing] = row;
    else meta.push(row);
  }
  snapshot.set('meta', meta);

  // Empty check and writes share one SQL transaction and projection rebuild.
  let rows = 0;
  await dest.bulkTransaction(ALL_STORE_NAMES, async (tx) => {
    for (const name of ALL_STORE_NAMES) {
      const count = await tx.readonly(name).count();
      if (count > 0) {
        throw new Error(`Migration refused: destination store "${name}" already holds ${count} row(s). Connect an empty database.`);
      }
    }
    for (const name of ALL_STORE_NAMES) {
      const storeRows = snapshot.get(name) ?? [];
      await copyStore(tx, name, storeRows);
      rows += storeRows.length;
    }
  });
  return { stores: ALL_STORE_NAMES.length, rows };
}

