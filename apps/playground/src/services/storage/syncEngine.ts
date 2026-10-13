/**
 * TursoSyncEngine — the browser's background backup/sync worker.
 *
 * Local-first invariants:
 *  - The data plane is IndexedDB; this engine never blocks reads/writes and
 *    ordinary saves never await Turso. Every committed local transaction
 *    group is already durable in the `sync_outbox` store (written atomically
 *    with the data); this worker only ships and receives mutations.
 *  - Uploads are bounded batches of WHOLE outbox groups in commit order —
 *    a group is never split, a failed upload never truncates pending writes,
 *    and group ids make retries idempotent (no new revision on a retried
 *    group). The remote rev is monotonic; the per-target watermark only
 *    advances after the batch's SQL transaction commits, so newer writes
 *    during the ack stay queued.
 *  - Uploads are triggered by a debounced post-commit outbox event (local
 *    writes kick the uploader; there is no idle network polling). Failures
 *    keep the outbox queued; the next event/manual retry reships.
 *  - Pulls replay ops with rev > cursor in deterministic (rev, idx) order,
 *    WHOLE revision groups per window (a group is never split by a row
 *    LIMIT — the cursor can never skip the rest of a group). Unsent local
 *    edits are overlaid inside the apply transaction, so the user's latest
 *    edit/delete/clear/wipe remains the visible state even when the remote
 *    row for the same key arrives mid-pull.
 *  - Schema policy: the target is probed WITHOUT emitting UI updates. An
 *    empty target is initialized + snapshotted; an OLDER target (old op-log
 *    schema or legacy direct-Turso layout) is migrated forward by
 *    converting the actual payloads (segments/results-era rows rebuild into
 *    note-owned blocks through the same versioned chain the browser runs
 *    locally) — never just rewriting the version marker. The legacy source
 *    rows stay on the remote until the converted snapshot transaction
 *    commits. A NEWER target is never downgraded — sync halts with a
 *    presentable error and the local app keeps working. An UNKNOWN target
 *    (foreign tables, no schema guard) is refused, not adopted.
 *  - Snapshot/bootstrap group ids are namespaced by a persisted per-client
 *    bootstrap id (`bs:<id>:<n>`) — fixed per-store ids used to collide
 *    across browsers and after target resets, and the idempotent insert
 *    then silently dropped data. Cursors/watermarks are per-target: a
 *    target switch replays the new target and re-bootstraps this browser's
 *    existing local rows (even with an empty outbox), so nothing stays
 *    un-backed-up.
 *  - Multi-tab/multi-engine cycles are single-flighted with a Web Locks
 *    lease (IDB-labs fallback where locks are unavailable); stop() removes
 *    every listener, waits for the in-flight chain, then closes the remote
 *    connection.
 *
 * ponytail: op-log replay pulls — a fresh browser replays the whole log
 * (O(history)) instead of reading per-store current-state tables. Upgrade
 * path: per-store state tables rev-indexed by primary key with periodic
 * log collapse; the wire format stays unchanged.
 */

import { createClient } from '@libsql/client/web';
import { openDB } from 'idb';
import {
  libsqlDatabase,
  probeSyncTarget,
  initSyncTarget,
  applySyncBatch,
  fetchSyncOps,
  readRawSyncOps,
  replaceSyncLog,
  readLegacyRows,
  type Database,
  type SyncEntry,
  type SyncMutation,
} from '@bitcobblers/wod-wiki-storage/sql';
import { DB_VERSION, STORE_DEFS, keyFromValue } from '@bitcobblers/wod-wiki-storage';
import type { KeyDTO } from '@bitcobblers/wod-wiki-storage';
import { beginSyncActivity, reportSyncResult, reportSyncError } from '../syncActivity';
import { markStorageChecking, markStorageIdle, markStorageUpdating, failStorageUpdate } from './storageUpdate';
import { IndexedDBStorage, subscribeOutboxWrites } from './IndexedDBStorage';
import { invalidateSeedContent } from '../content/seedContent';
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '../effortRegistry';

const BATCH_MAX_OPS = 200;
const BATCH_MAX_BYTES = 1_000_000;
const FETCH_PAGE = 500;
const SNAPSHOT_GROUP = 500;
const UPLOAD_PAGE = 50;
const PULL_POLL_MS = 60_000;
const RETRY_MS = 30_000;
const UPLOAD_DEBOUNCE_MS = 750;
const SCRATCH_DB = 'wodwiki-migrate-scratch';
const LOCK_NAME = 'wodwiki-sync';

/** Stores whose rows carry a raw binary field (base64 in the op log). */
const BINARY_SYNC_FIELDS: Record<string, string> = { attachments: 'data' };

/** Legacy direct-Turso tables that predate the current STORE_DEFS spec. */
const LEGACY_EXTRA_TABLES: { name: string; keyPath: string | string[] }[] = [
  { name: 'segments', keyPath: ['id', 'version'] },
  { name: 'results', keyPath: 'id' },
];

function presentable(err: unknown, secret?: string): string {
  let message = err instanceof Error ? err.message : String(err);
  if (secret) message = message.split(secret).join('••••••');
  return message || 'Sync failed';
}

/** Stable per-target namespace for cursor/watermark sync_state keys. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Narrow a raw (unvalidated) op key to what IndexedDB accepts. */
function isIdbKey(value: unknown): value is IDBValidKey {
  return typeof value === 'string' || typeof value === 'number' || value instanceof Date
    || (Array.isArray(value) && value.length > 0 && value.every(isIdbKey));
}

/** Approximate encoded op-log size of one outbox entry: JSON envelope plus
 *  base64-inflated binary cells (ArrayBuffer serializes as {} in JSON, so a
 *  plain JSON.stringify would undercount attachment-heavy batches). */
function entryBytes(entry: { ops: SyncMutation[] }): number {
  let bytes = 0;
  for (const op of entry.ops) {
    bytes += 32; // envelope + key estimate
    if (op.op !== 'put') continue;
    const field = BINARY_SYNC_FIELDS[op.store];
    const value: unknown = op.value;
    const data = field && value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Reflect.get(value, field)
      : undefined;
    bytes += typeof data === 'string' ? data.length
      : data instanceof ArrayBuffer ? Math.ceil(data.byteLength / 3) * 4 + 64
        : JSON.stringify(op.value)?.length ?? 0;
  }
  return bytes;
}

type ScratchOp =
  | { kind: 'put'; table: string; row: unknown }
  | { kind: 'delete'; table: string; key: IDBValidKey }
  | { kind: 'clear'; table: string };

/** Timer handles — browser number vs Node Timeout depending on the runtime. */
type TimerHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

function deleteIdbDatabase(name: string): Promise<void> {
  const idb = globalThis.indexedDB;
  if (!idb) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const request = idb.deleteDatabase(name);
  request.onsuccess = () => { resolve(); };
  request.onerror = () => { reject(request.error ?? new Error(`failed to delete ${name}`)); };
  // A still-open connection blocks deletion; the scratch rows are
  // disposable either way, so don't hang the cycle on it.
  request.onblocked = () => { resolve(); };
  return promise;
}

export class TursoSyncEngine {
  private db: Database | undefined;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  private timers: TimerHandle[] = [];
  private reconciled = false;
  /** Fatal schema refusal — never retried until the app restarts. */
  private halted = false;
  /** Transient failure backoff — avoids error-report spam on offline polls. */
  private retryAt = 0;
  private debounceTimer: TimeoutHandle | undefined;
  private unsubscribeOutbox: (() => void) | undefined;
  private onOnline: (() => void) | undefined;
  private onVisible: (() => void) | undefined;

  constructor(
    private readonly local: IndexedDBStorage,
    private readonly settings: { url: string; authToken: string },
    /** Seam for tests/checks: build the remote Database some other way (e.g.
     *  a local SQLite file). Defaults to a direct @libsql/client/web client. */
    private readonly connect?: () => Database,
  ) {}

  /** Queue a sync cycle right now. A manual nudge (syncNow callers, the
   *  initial kick, online/visibility listeners) retries even while timer
   *  polls are backing off after a transient failure. Errors are reported
   *  through reportSyncError, not thrown. */
  syncNow(): Promise<void> {
    const run = this.chain.then(() => this.cycle(true));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Start listeners and kick the first cycle. Returns stop(): removes every
   *  listener, waits for the in-flight chain, then closes the remote. */
  start(): () => void {
    const kick = (scope: 'full' | 'upload'): void => { this.enqueue(() => this.cycle(false, scope)); };
    this.onOnline = () => { kick('full'); };
    this.onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) kick('full'); };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    }
    this.timers.push(setInterval(() => { kick('full'); }, PULL_POLL_MS));
    this.unsubscribeOutbox = subscribeOutboxWrites(() => { this.scheduleUpload(); });
    kick('full');
    return () => { void this.stop(); };
  }

  private async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    if (typeof window !== 'undefined' && this.onOnline) window.removeEventListener('online', this.onOnline);
    if (typeof document !== 'undefined' && this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
    this.onOnline = undefined;
    this.onVisible = undefined;
    this.unsubscribeOutbox?.();
    this.unsubscribeOutbox = undefined;
    // StrictMode mounts/unmounts rapidly: a kicked cycle is on the chain, so
    // wait for it to settle BEFORE closing — never leaving an old listener
    // or a write against a closed connection.
    await this.chain.catch(() => undefined);
    await this.db?.close().catch(() => undefined);
    this.db = undefined;
  }

  private scheduleUpload(): void {
    if (this.stopped || this.debounceTimer !== undefined) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (!this.stopped) this.enqueue(() => this.cycle(false, 'upload'));
    }, UPLOAD_DEBOUNCE_MS);
  }

  private enqueue(step: () => Promise<void>): void {
    this.chain = this.chain.then(step, step);
    void this.chain.catch(() => {});
  }

  /** One sync cycle, single-flighted across tabs/engines. Timer kicks respect
   *  the transient-failure backoff; manual nudges retry immediately. */
  private async cycle(manual = false, scope: 'full' | 'upload' = 'full'): Promise<void> {
    if (this.stopped || this.halted || (!manual && Date.now() < this.retryAt)) return;
    // Web Locks serialize concurrent engines/tabs on one profile; where the
    // API is absent (older engines, test seams) the per-engine chain still
    // serializes this instance.
    const navLocks = globalThis.navigator?.locks;
    try {
      if (navLocks) await navLocks.request(LOCK_NAME, () => this.cycleInner(manual, scope));
      else await this.cycleInner(manual, scope);
    } catch (error) {
      this.retryAt = Date.now() + RETRY_MS;
      reportSyncError(presentable(error, this.settings.authToken));
    }
  }

  private async cycleInner(manual: boolean, scope: 'full' | 'upload'): Promise<void> {
    void manual;
    // Pull runs BEFORE upload, and the legs are failure-independent:
    //  - a pulled remote row plus the unsent-edit overlay is exactly how a
    //    pending local edit survives an offline upload leg;
    //  - the post-pull bootstrap can see (and skip) rows still pending in
    //    the outbox, so nothing ships twice;
    //  - journal groups then append AFTER the bootstrap rows, so the user's
    //    committed writes stay the last writer for their keys.
    // The first failure is reported after all legs ran.
    const failures: unknown[] = [];
    if (scope === 'full') {
      try { await this.ensureReconciled(); } catch (error) { failures.push(error); }
      try { await this.pullOnce(); } catch (error) { failures.push(error); }
    }
    try { await this.uploadOnce(); } catch (error) { failures.push(error); }
    if (failures.length > 0) throw failures[0];
  }

  private async remote(): Promise<Database> {
    if (!this.db) {
      this.db = this.connect?.() ?? libsqlDatabase(createClient({ url: this.settings.url, authToken: this.settings.authToken }));
    }
    return this.db;
  }

  private targetHash(): string { return fnv1a(this.settings.url); }
  private cursorKey(): string { return `cursor:${this.targetHash()}`; }
  private watermarkKey(): string { return `watermark:${this.targetHash()}`; }
  private bootstrappedKey(): string { return `bootstrapped:${this.targetHash()}`; }

  /** Probe + one-time target reconciliation. Ordinary probes are silent —
   *  storageUpdate only hears about ACTUAL migrations (or hard refusals). */
  private async ensureReconciled(): Promise<void> {
    if (this.reconciled) return;
    const db = await this.remote();
    const target = await probeSyncTarget(db);
    if (target.kind === 'unknown') {
      const message = 'Backup database contains unrelated tables and no WOD Wiki schema; refusing to adopt it. Point the backup setting at a fresh database.';
      this.halted = true;
      failStorageUpdate(message);
      throw new Error(message);
    }
    const remoteVersion = target === 'empty' ? 0 : target.schemaVersion;
    if (remoteVersion > DB_VERSION) {
      // Never downgrade a newer backup — stop syncing, keep the local app.
      const message = `Backup database schema is newer than this app supports (v${remoteVersion} > v${DB_VERSION}). Update the app to sync.`;
      this.halted = true;
      failStorageUpdate(message);
      throw new Error(message);
    }
    if (target === 'empty') {
      const end = beginSyncActivity('upload', 'Creating initial backup');
      try {
        await initSyncTarget(db, DB_VERSION);
        await this.bootstrapSnapshot();
        await this.local.setSyncState(this.bootstrappedKey(), { done: true });
        // Skip replaying our own snapshot back into this browser.
        const after = await probeSyncTarget(db);
        if (after.kind === 'current') await this.local.setSyncState(this.cursorKey(), { rev: after.rev });
      } finally {
        end();
      }
    } else if (remoteVersion < DB_VERSION) {
      // Older backup: convert the actual payloads forward (op-log replay or
      // legacy direct-Turso import) — the version marker moves only in the
      // same transaction as the converted snapshot.
      markStorageChecking('Checking backup database schema…');
      const end = beginSyncActivity('upload', `Updating backup database schema to v${DB_VERSION}`);
      try {
        markStorageUpdating(`Updating backup database schema v${remoteVersion} → v${DB_VERSION}…`, remoteVersion, DB_VERSION);
        await this.migrateRemoteToCurrent(db, remoteVersion, target.kind === 'legacy');
        markStorageIdle(DB_VERSION);
      } finally {
        end();
      }
    }
    this.reconciled = true;
  }

  /**
   * Convert an older remote (op-log at schemaVersion < DB_VERSION, or a
   * legacy direct-Turso layout) to the current payload schema:
   *  1. Lift the remote data as ordered scratch ops (op-log replay in rev
   *     order, or legacy per-store rows incl. segments/results).
   *  2. Replay them into a scratch IndexedDB created AT the remote schema
   *     version, then open it through IndexedDBStorage — the same versioned
   *     migration chain the browser runs locally rebuilds segments-era rows
   *     into note-owned blocks, block revisions, sessions and events.
   *  3. Append the converted rows as snapshot groups — leading wipe, schema
   *     marker bumped in the SAME transaction as the final group. The old
   *     op rows / legacy tables stay on the remote as the recoverable source.
   */
  private async migrateRemoteToCurrent(db: Database, fromVersion: number, legacy: boolean): Promise<void> {
    if (fromVersion < 20) {
      throw new Error(
        `Backup database schema v${fromVersion} predates the supported migration chain (v20+); the backup was left untouched. `
        + 'Restore it with an intermediate app version, or point this app at a fresh backup database.',
      );
    }
    const raw: ScratchOp[] = [];
    if (legacy) {
      const tables = [...STORE_DEFS.filter(def => !def.system).map(def => def.name), ...LEGACY_EXTRA_TABLES.map(t => t.name)];
      for (const table of tables) {
        for (const row of await readLegacyRows(db, table)) {
          raw.push({ kind: 'put', table, row });
        }
      }
    } else {
      // Raw (unvalidated) replay: era logs reference store names the current
      // schema rejects (segments/results), which is exactly what the scratch
      // conversion below exists to transform.
      for (const op of await readRawSyncOps(db)) {
        if (op.op === 'put' && op.value !== undefined && typeof op.value === 'object' && !Array.isArray(op.value)) {
          raw.push({ kind: 'put', table: op.store, row: op.value });
        } else if (op.op === 'delete' && isIdbKey(op.key)) {
          raw.push({ kind: 'delete', table: op.store, key: op.key });
        } else if (op.op === 'clear') {
          raw.push({ kind: 'clear', table: op.store });
        } else if (op.op === 'wipe') {
          for (const def of STORE_DEFS.filter(d => !d.system)) raw.push({ kind: 'clear', table: def.name });
        }
      }
    }
    await this.buildScratch(fromVersion, raw);
    try {
      const converted = new IndexedDBStorage({ dbName: SCRATCH_DB });
      await converted.open();
      const byStore = await converted.snapshotRows();
      await converted.close();
      const ops: SyncMutation[] = [{ op: 'wipe' }];
      for (const { store, rows } of byStore) {
        const def = STORE_DEFS.find(d => d.name === store);
        if (!def) continue;
        for (const row of rows) {
          try {
            ops.push({ op: 'put', store, key: keyFromValue(def, row), value: row });
          } catch {
            // Converted row without its keyPath fields — never written back.
          }
        }
      }
      const entries: SyncEntry[] = [];
      for (let i = 0; i < ops.length; i += SNAPSHOT_GROUP) {
        entries.push({ id: `migrate:${crypto.randomUUID()}`, at: Date.now(), ops: ops.slice(i, i + SNAPSHOT_GROUP) });
      }
      // The active log becomes the converted snapshot (rev 1..n); the
      // previous ops are archived, not destroyed — the old source stays
      // recoverable on the remote after the marker moves. Legacy targets
      // have no sync tables yet: create them at the FROM version first (a
      // no-op for op-log targets), then replace.
      if (legacy) await initSyncTarget(db, fromVersion);
      await replaceSyncLog(db, entries, DB_VERSION);
    } finally {
      await deleteIdbDatabase(SCRATCH_DB).catch(() => undefined);
    }
  }

  /** Replay raw remote-era rows into a scratch IndexedDB created at the
   *  REMOTE schema version (generic keyPath-only stores + legacy tables). */
  private async buildScratch(version: number, ops: ScratchOp[]): Promise<void> {
    const tables = [
      ...STORE_DEFS.map(def => ({ name: def.name, keyPath: def.keyPath.length === 1 ? def.keyPath[0] : def.keyPath })),
      ...LEGACY_EXTRA_TABLES,
    ];
    const db = await openDB(SCRATCH_DB, version, {
      upgrade(db) {
        for (const table of tables) {
          if (!db.objectStoreNames.contains(table.name)) db.createObjectStore(table.name, { keyPath: table.keyPath });
        }
      },
    });
    try {
      const present = [...new Set(ops.map(op => op.table))].filter(name => db.objectStoreNames.contains(name));
      if (present.length === 0) return;
      const tx = db.transaction(present, 'readwrite');
      for (const op of ops) {
        if (!db.objectStoreNames.contains(op.table)) continue;
        if (op.kind === 'put') await tx.objectStore(op.table).put(op.row);
        else if (op.kind === 'delete') await tx.objectStore(op.table).delete(op.key);
        else await tx.objectStore(op.table).clear();
      }
      await tx.done;
    } finally {
      db.close();
    }
  }

  /** Per-client bootstrap id, persisted across sessions: namespacing every
   *  snapshot group id prevents cross-browser/target-reset collisions that
   *  the idempotent insert used to swallow silently. */
  private async bootstrapId(): Promise<string> {
    const existing = await this.local.getSyncState<{ id: string }>('bootstrapId');
    if (existing?.id) return existing.id;
    const id = crypto.randomUUID();
    await this.local.setSyncState('bootstrapId', { id });
    return id;
  }

  /** Upload the full local snapshot as idempotent, byte-bounded op-groups
   *  from ONE atomic readonly read (groups `bs:<bootstrapId>:<n>`). Rows
   *  already pending in the outbox are skipped — they ship (in commit order,
   *  with their tombstones) through the journal, never twice. */
  private async bootstrapSnapshot(): Promise<void> {
    const db = await this.remote();
    const id = await this.bootstrapId();
    const pending = await this.local.readOutbox(0, Number.MAX_SAFE_INTEGER);
    const pendingKeys = new Set<string>();
    const clearedStores = new Set<string>();
    for (const group of pending) {
      for (const op of group.ops) {
        if (op.op === 'put' || op.op === 'delete') pendingKeys.add(`${op.store}:${JSON.stringify(op.key)}`);
        else if (op.op === 'clear' || op.op === 'wipe') clearedStores.add(op.op === 'wipe' ? '*' : op.store);
      }
    }
    const byStore = await this.local.snapshotRows();
    let seq = 0;
    let ops: SyncMutation[] = [];
    let bytes = 0;
    const flush = async (): Promise<void> => {
      if (ops.length === 0) return;
      await applySyncBatch(db, [{ id: `bs:${id}:${seq}`, at: Date.now(), ops }], { expectSchema: DB_VERSION });
      seq += 1;
      ops = [];
      bytes = 0;
    };
    for (const { store, rows } of byStore) {
      const def = STORE_DEFS.find(d => d.name === store);
      if (!def) continue;
      for (const row of rows) {
        let key: KeyDTO;
        try {
          key = keyFromValue(def, row);
        } catch {
          continue; // row without keyPath fields — snapshot nothing
        }
        if (pendingKeys.has(`${store}:${JSON.stringify(key)}`) || clearedStores.has(store) || clearedStores.has('*')) continue;
        const op: SyncMutation = { op: 'put', store, key, value: row };
        const size = JSON.stringify(row)?.length ?? 0;
        if (ops.length > 0 && (ops.length >= SNAPSHOT_GROUP || bytes + size > BATCH_MAX_BYTES)) await flush();
        ops.push(op);
        bytes += size;
      }
    }
    await flush();
  }

  /** Ship pending outbox groups in byte/ops-bounded pages; the per-target
   *  watermark advances only after each batch's SQL transaction commits, so
   *  writes landing during the ack stay queued. */
  private async uploadOnce(): Promise<void> {
    if (!this.reconciled || this.stopped || this.halted) return;
    const watermarkKey = this.watermarkKey();
    const first = await this.local.readOutbox((await this.local.getSyncState<{ seq: number }>(watermarkKey))?.seq ?? 0, 1);
    if (first.length === 0) return;
    const end = beginSyncActivity('upload', 'Uploading changes to backup');
    try {
      const db = await this.remote();
      let watermark = (await this.local.getSyncState<{ seq: number }>(watermarkKey))?.seq ?? 0;
      let committed = 0;
      for (;;) {
        const pending = await this.local.readOutbox(watermark, UPLOAD_PAGE);
        if (pending.length === 0) break;
        let i = 0;
        while (i < pending.length) {
          const batch: SyncEntry[] = [];
          let ops = 0;
          let bytes = 0;
          let lastSeq = watermark;
          while (i < pending.length && ops < BATCH_MAX_OPS && bytes < BATCH_MAX_BYTES) {
            const entry = pending[i];
            const size = entryBytes(entry);
            if (batch.length > 0 && (ops + entry.ops.length > BATCH_MAX_OPS || bytes + size > BATCH_MAX_BYTES)) break;
            batch.push({ id: entry.id, at: entry.at, ops: entry.ops });
            ops += entry.ops.length;
            bytes += size;
            lastSeq = entry.seq;
            i += 1;
          }
          await applySyncBatch(db, batch, { expectSchema: DB_VERSION }); // one SQL tx — all groups or none
          committed += batch
            .flatMap(entry => entry.ops)
            .filter(mutation => mutation.op === 'put' && (mutation.store === 'notes' || mutation.store === 'efforts')).length;
          watermark = lastSeq;
          await this.local.setSyncState(watermarkKey, { seq: watermark });
          await this.local.ackOutbox(watermark);
        }
        if (pending.length < UPLOAD_PAGE) break;
      }
      if (committed > 0) reportSyncResult({ source: 'turso backup', added: committed, updated: 0 });
    } finally {
      end();
    }
  }

  /** Replay remote ops past the per-target cursor in commit order
   *  (whole revision groups per window); on first contact, bootstrap this
   *  browser's existing local rows afterwards. Counts come from the committed
   *  apply boundary (canonical notes/efforts only — no metadata/journal
   *  rows, no echo of this browser's own uploads: identical rows are not
   *  re-counted). */
  private async pullOnce(): Promise<void> {
    if (!this.reconciled || this.stopped || this.halted) return;
    const cursorKey = this.cursorKey();
    const cursor0 = (await this.local.getSyncState<{ rev: number }>(cursorKey))?.rev ?? 0;
    const end = beginSyncActivity('download', 'Syncing from backup');
    try {
      const db = await this.remote();
      let cursor = cursor0;
      let added = 0;
      let updated = 0;
      for (;;) {
        const ops = await fetchSyncOps(db, cursor, FETCH_PAGE);
        if (ops.length === 0) break;
        const lastRev = ops[ops.length - 1].rev;
        const counts = await this.local.applySyncMutations(ops.map(op => op.mutation), lastRev, cursorKey);
        added += counts.added;
        updated += counts.updated;
        cursor = lastRev;
        if (ops.length < FETCH_PAGE) break;
      }
      if (!(await this.local.getSyncState(this.bootstrappedKey()))) {
        // Fresh contact with this target: back up this browser's preexisting
        // local rows too — even when the outbox is empty — then mark the
        // target bootstrapped (the snapshot echo replays as no-ops).
        const upEnd = beginSyncActivity('upload', 'Backing up local data');
        try {
          await this.bootstrapSnapshot();
          await this.local.setSyncState(this.bootstrappedKey(), { done: true });
        } finally {
          upEnd();
        }
      }
      if (added + updated > 0) {
        reportSyncResult({ source: 'turso backup', added, updated });
        // Remote changes changed the committed rows — drop cached content so
        // displayed catalog/WQL re-derive, and refresh the effort registry.
        invalidateSeedContent();
        const registry = getAppEffortRegistry();
        if (registry.isInitialized()) await hydrateAppEffortRegistry(registry);
      }
    } finally {
      end();
    }
  }
}
