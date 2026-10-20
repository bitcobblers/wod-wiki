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
 *  - Schema changes require an explicit CLI copy into a fresh target. Older,
 *    newer and unknown targets never mutate through ordinary browser sync.
 *  - Bootstrap retries reuse frozen, durable chunks for exactly one target.
 *    Pull cursors advance only after replay, never to a probed revision.
 *  - Web Locks serialize cycles across tabs when available; the promise
 *    chain serializes this engine otherwise. stop() removes listeners,
 *    waits for the chain, and closes the connection.
 *
 * ponytail: op-log replay pulls — a fresh browser replays the whole log
 * (O(history)) instead of reading per-store current-state tables. Upgrade
 * path: per-store state tables rev-indexed by primary key with periodic
 * log collapse; the wire format stays unchanged.
 */

import { createClient } from '@libsql/client/web';
import {
  libsqlDatabase,
  probeSyncTarget,
  initSyncTarget,
  applySyncBatch,
  fetchSyncOps,
  type Database,
  type SyncEntry,
  type SyncMutation,
} from '@bitcobblers/wod-wiki-storage/sql';
import { DB_VERSION } from '@bitcobblers/wod-wiki-storage';
import { IndexedDBStorage, subscribeOutboxWrites } from '@bitcobblers/wod-wiki-storage/idb';
import { beginSyncActivity, reportSyncResult, reportSyncError } from '../syncActivity';
import { failStorageUpdate } from './storageUpdate';
import { invalidateSeedContent } from '../content/seedContent';
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '../effortRegistry';

const BATCH_MAX_OPS = 200;
const BATCH_MAX_BYTES = 1_000_000;
const FETCH_PAGE = 500;
const UPLOAD_PAGE = 50;
const PULL_POLL_MS = 60_000;
const RETRY_MS = 30_000;
const UPLOAD_DEBOUNCE_MS = 750;
const LOCK_NAME = 'wodwiki-sync';

/** Stores whose rows carry a raw binary field (base64 in the op log). */
const BINARY_SYNC_FIELDS: Record<string, string> = { attachments: 'data' };


function presentable(err: unknown, secret?: string): string {
  let message = err instanceof Error ? err.message : String(err);
  if (secret) message = message.split(secret).join('••••••');
  return message || 'Sync failed';
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


/** Timer handles — browser number vs Node Timeout depending on the runtime. */
type TimerHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;


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

  restoreNow(): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.stopped) throw new Error('Restore engine is stopped');
      const rows = await this.local.snapshotAllRows();
      if (rows.some(group => group.rows.length > 0) || (await this.local.readOutbox(0, 1)).length > 0) {
        throw new Error('Restore requires an empty isolated local database');
      }
      const db = await this.remote();
      const source = await probeSyncTarget(db);
      if (source === 'empty' || source.kind !== 'current' || source.schemaVersion !== DB_VERSION) {
        throw new Error(`Restore requires a provisioned v${DB_VERSION} backup. Migrate older backups with the CLI first.`);
      }
      let cursor = 0;
      while (cursor < source.rev) {
        const ops = await fetchSyncOps(db, cursor, FETCH_PAGE);
        if (ops.length === 0) break;
        if (ops[ops.length - 1].rev > source.rev) {
          throw new Error('Backup changed during restore. Freeze its writers and retry with a fresh local database.');
        }
        cursor = ops[ops.length - 1].rev;
        await this.local.applySyncMutations(ops.map(op => op.mutation), cursor, this.cursorKey());
      }
      await this.local.validateSyncState();
      const after = await probeSyncTarget(db);
      if (after === 'empty' || after.kind !== 'current' || after.schemaVersion !== source.schemaVersion || after.rev !== source.rev || cursor !== source.rev) {
        throw new Error('Backup changed during restore. Freeze its writers and retry with a fresh local database.');
      }
      await this.local.setSyncState(this.bootstrappedKey(), { done: true });
      this.reconciled = true;
    });
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

  async stop(): Promise<void> {
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
    // Pull overlays pending edits; journal groups append after bootstrap.
    // A failed pull must not prevent already-bootstrapped offline uploads.
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

  private cursorKey(): string { return `cursor:${this.settings.url}`; }
  private watermarkKey(): string { return `watermark:${this.settings.url}`; }
  private bootstrappedKey(): string { return `bootstrapped:${this.settings.url}`; }
  private bootstrapRunKey(): string { return `bootstrap-run:${this.settings.url}`; }

  /** Probe + one-time target reconciliation. Ordinary probes are silent —
   *  storageUpdate only hears about ACTUAL migrations (or hard refusals). */
  private async ensureReconciled(): Promise<void> {
    if (this.reconciled) return;
    const db = await this.remote();
    const target = await probeSyncTarget(db);
    if (target !== 'empty' && target.kind === 'unknown') {
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
      await initSyncTarget(db, DB_VERSION);
    } else if (target.kind === 'legacy' || remoteVersion < DB_VERSION) {
      const message = `Backup schema v${remoteVersion} requires an explicit CLI migration into a fresh v${DB_VERSION} target. The old database was left untouched.`;
      this.halted = true;
      failStorageUpdate(message);
      throw new Error(message);
    }
    this.reconciled = true;
  }


  /** Freeze once before network I/O; retain the exact retry payload until commit. */
  private async bootstrapSnapshot(): Promise<void> {
    const db = await this.remote();
    const entries = await this.local.captureSyncBootstrap(this.bootstrapRunKey());
    for (const entry of entries) await applySyncBatch(db, [entry], { expectSchema: DB_VERSION });
    await this.local.setSyncState(this.bootstrappedKey(), { done: true });
    await (await this.local.open()).delete('sync_state', this.bootstrapRunKey());
  }

  /** Ship pending outbox groups in byte/ops-bounded pages; the per-target
   *  watermark advances only after each batch's SQL transaction commits, so
   *  writes landing during the ack stay queued. */
  private async uploadOnce(): Promise<void> {
    if (!this.reconciled || this.stopped || this.halted) return;
    if (!(await this.local.getSyncState(this.bootstrappedKey()))) return;
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

  /** Replay whole groups before bootstrap, then replay any interleaved writes. */
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
        if (ops.length === 0) {
          if (!(await this.local.getSyncState(this.bootstrappedKey()))) {
            await this.bootstrapSnapshot();
            continue;
          }
          break;
        }
        const lastRev = ops[ops.length - 1].rev;
        const counts = await this.local.applySyncMutations(ops.map(op => op.mutation), lastRev, cursorKey);
        added += counts.added;
        updated += counts.updated;
        cursor = lastRev;
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
