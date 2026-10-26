/**
 * restoreService — the browser side of explicit isolated restore.
 *
 * Flow (the remote-restore contract in docs/architecture/interfaces.md):
 * pair a provisioned target → probe its canonical schema/lifecycle → export
 * unsent edits (credential-free) → restoreNow() replays the remote into a
 * UNIQUE, empty local IndexedDB (old DB + old settings untouched) → only
 * after a validated replay are settings saved with sync disabled. Re-pair a
 * fresh target to resume backup. Every failure keeps the previous target
 * settings and the original local database intact and restarts the
 * background sync that was stopped for the attempt.
 */

import { createClient } from '@libsql/client/web';
import { encodeRowJson, libsqlDatabase, probeSyncTarget, type Database } from '@bitcobblers/wod-wiki-storage/sql';
import { DB_VERSION } from '@bitcobblers/wod-wiki-storage';
import { IndexedDBStorage } from '@bitcobblers/wod-wiki-storage/idb';
import { TursoSyncEngine } from './syncEngine';
import {
  presentable,
  readDataSettings,
  sameTursoTarget,
  saveRestoredSettings,
  validateTursoTarget,
} from './dataSettings';
import { readAllLocalRows, readUnsentEdits, startBackgroundStorageSync, stopBackgroundStorageSync } from './index';

// ── Pairing file (CLI `wod db create/backup/migrate/pair` output) ────────────

export interface PairingFile {
  url: string;
  authToken: string;
  /** Provisioned database name — display label only. */
  database?: string;
  /** Schema snapshot at provisioning; the live probe is canonical truth. */
  schemaVersion?: number;
  createdAt?: string;
}

export type PairingParse = { ok: true; pairing: PairingFile } | { ok: false; error: string };

/** Strict envelope, informative extras: require the pairing marker and kind,
 *  refuse missing/blank url or token, ignore everything else. */
export function parsePairingFile(text: string): PairingParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The pairing file is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The pairing file has an unexpected shape.' };
  }
  const record = parsed as Record<string, unknown>;
  if (record.wodWikiPairing !== 1) {
    return { ok: false, error: 'Not a wod.wiki database pairing file (missing "wodWikiPairing": 1).' };
  }
  if (record.kind !== 'turso') {
    return { ok: false, error: `Unsupported pairing kind "${String(record.kind)}" — only Turso databases can be paired here.` };
  }
  const { url, authToken } = record;
  if (typeof url !== 'string' || !url.trim() || typeof authToken !== 'string' || !authToken.trim()) {
    return { ok: false, error: 'The pairing file is missing the database URL or auth token.' };
  }
  return {
    ok: true,
    pairing: {
      url,
      authToken,
      database: typeof record.database === 'string' && record.database.trim() ? record.database : undefined,
      schemaVersion: typeof record.schemaVersion === 'number' && Number.isSafeInteger(record.schemaVersion)
        ? record.schemaVersion
        : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    },
  };
}

// ── Canonical target probe (read-only, no writes, never saves) ───────────────

export type TargetStatus =
  | { state: 'current'; schemaVersion: number; rev: number }
  | { state: 'older'; schemaVersion: number; reason: string }
  | { state: 'newer'; schemaVersion: number; reason: string }
  | { state: 'empty'; reason: string }
  | { state: 'unknown'; reason: string }
  | { state: 'unreachable'; reason: string };

/** Classify a candidate target without mutating it. Errors are presentable
 *  (token masked) and never thrown — the UI renders the status. */
export async function probeRestoreTarget(settings: { url: string; authToken: string }): Promise<TargetStatus> {
  const invalid = validateTursoTarget(settings.url, settings.authToken);
  if (invalid) return { state: 'unreachable', reason: invalid };
  let db: Database;
  try {
    db = libsqlDatabase(createClient({ url: settings.url.trim(), authToken: settings.authToken }));
  } catch (err) {
    return { state: 'unreachable', reason: presentable(err, settings.authToken).message };
  }
  try {
    const probe = await probeSyncTarget(db);
    if (probe === 'empty') {
      return { state: 'empty', reason: 'The database is empty — nothing to restore. Use Enable Sync to back up to it instead.' };
    }
    if (probe.kind === 'unknown') {
      return { state: 'unknown', reason: 'The database contains foreign tables — refusing to touch it.' };
    }
    if (probe.kind === 'legacy' || probe.schemaVersion < DB_VERSION) {
      return {
        state: 'older',
        schemaVersion: probe.schemaVersion,
        reason: `The database uses schema v${probe.schemaVersion}, this app needs v${DB_VERSION}. Migrate it with the CLI to a fresh target, then pair that target.`,
      };
    }
    if (probe.schemaVersion > DB_VERSION) {
      return {
        state: 'newer',
        schemaVersion: probe.schemaVersion,
        reason: `The database uses schema v${probe.schemaVersion}, newer than this app supports (v${DB_VERSION}). Update the app first.`,
      };
    }
    return { state: 'current', schemaVersion: probe.schemaVersion, rev: probe.rev };
  } catch (err) {
    return { state: 'unreachable', reason: presentable(err, settings.authToken).message };
  } finally {
    await db.close().catch(() => undefined);
  }
}

// ── Safe-file export (unsent edits + full local rows + content sources) ──────

/** localStorage keys holding content-source choices (§3.4): registrations,
 *  hidden rows, subscriptions, auto-sync. Data-plane credentials never live in
 *  these keys, and only these known keys are exported. */
const SAFE_CONTENT_KEYS = ['wodwiki.seedSources', 'wodwiki.seedSources.hidden', 'wodwiki.seedSubscriptions', 'wodwiki.seedAutoSync'] as const;

/** Absolute http(s) URL without embedded credentials, query or fragment. */
function credentialFreeUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

/** Re-emit only the known content-source keys with sanitized shapes: seed
 *  source entries are whitelisted to id/label/url/repositoryUrl and any entry
 *  carrying a credential-bearing URL is dropped entirely. */
function safeContentSources(): { key: string; value: unknown }[] {
  const out: { key: string; value: unknown }[] = [];
  for (const key of SAFE_CONTENT_KEYS) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (key === 'wodwiki.seedSources') {
        const sources = (Array.isArray(parsed) ? parsed : []).flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const record = entry as Record<string, unknown>;
          if (typeof record.id !== 'string' || typeof record.label !== 'string' || !credentialFreeUrl(record.url)) return [];
          const clean: { id: string; label: string; url: string; repositoryUrl?: string } = {
            id: record.id,
            label: record.label,
            url: record.url,
          };
          if (typeof record.repositoryUrl === 'string' && credentialFreeUrl(record.repositoryUrl)) {
            clean.repositoryUrl = record.repositoryUrl;
          }
          return [clean];
        });
        out.push({ key, value: sources });
      } else if (key === 'wodwiki.seedSources.hidden') {
        out.push({ key, value: Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [] });
      } else {
        const choices = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.entries(parsed).filter(([, flag]) => typeof flag === 'boolean') : [];
        out.push({ key, value: Object.fromEntries(choices) });
      }
    } catch {
      // An unparsable key is skipped, never exported half-read.
    }
  }
  return out;
}

export interface SafeExportPayload {
  /** Unacked local edit groups in commit order (base64 binary cells — JSON-lossless). */
  pendingGroups: { id: string; at: number; ops: unknown[] }[];
  /** Every retained row of every store — the rollback payload. */
  rows: { store: string; rows: unknown[] }[];
  /** Sanitized content-source settings from the known localStorage keys. */
  contentSources: { key: string; value: unknown }[];
  exportedAt: string;
}

/** Serialize the safe file. Credentials never enter it: no URL/token is
 *  passed in, seed-source URLs are credential-free by construction. */
export function buildSafeExport(payload: SafeExportPayload): string {
  const encode = (store: string, row: unknown): unknown => JSON.parse(encodeRowJson(row, store === 'attachments' ? 'data' : undefined));
  return JSON.stringify({
    format: 'wod-wiki-safe-export', version: 1, ...payload,
    rows: payload.rows.map(({ store, rows }) => ({ store, rows: rows.map(row => encode(store, row)) })),
    pendingGroups: payload.pendingGroups.map(group => ({ ...group, ops: group.ops.map(op =>
      op && typeof op === 'object' && 'op' in op && op.op === 'put' && 'store' in op && typeof op.store === 'string' && 'value' in op
        ? { ...op, value: encode(op.store, op.value) } : op) })),
  }, null, 2);
}

/** Stop the uploader (so an in-flight ack can't drain entries mid-read),
 *  download `wodwiki-safe-export-<date>.json`, restart the session. The file
 *  always contains the full local snapshot (rollback), even with nothing
 *  pending. */
async function downloadSafeData(): Promise<string> {
  const [groups, rows] = await Promise.all([readUnsentEdits(), readAllLocalRows()]);
  const json = buildSafeExport({
    pendingGroups: groups.map(group => ({ id: group.id, at: group.at, ops: group.ops })),
    rows,
    contentSources: safeContentSources(),
    exportedAt: new Date().toISOString(),
  });
  const filename = `wodwiki-safe-export-${new Date().toISOString().slice(0, 10)}.json`;
  const blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
  return filename;
}

export async function exportSafeData(): Promise<string> {
  const wasRunning = await stopBackgroundStorageSync();
  try {
    return await downloadSafeData();
  } finally {
    if (wasRunning) startBackgroundStorageSync();
  }
}

// ── Explicit isolated restore ────────────────────────────────────────────────

export interface RestoreResult {
  /** The unique local database the restored data was replayed into — saved
   *  settings now select it; it becomes the visible profile after reload. */
  localDbName: string;
}

function deleteLocalDatabase(name: string): Promise<void> {
  const idb = globalThis.indexedDB;
  if (!idb) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const request = idb.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () => resolve(); // disposable scratch — never block on it
  request.onblocked = () => resolve();
  return promise;
}

/**
 * Restore a (different!) target into an isolated local database. Throws a
 * presentable error and changes NOTHING persistent on any refusal or failure:
 * saved settings, the original local database and its unsent edits all stay
 * exactly as they were, and a stopped background sync is restarted.
 */
export async function restoreFromTarget(
  settings: { url: string; authToken: string },
  onPhase?: (message: string) => void,
): Promise<RestoreResult> {
  // Same-URL refusal first: restore always targets a NEW database — running
  // it against the live target would fork the user's own history.
  const current = readDataSettings();
  if (current.state === 'turso' && sameTursoTarget(current.url, settings.url)) {
    throw new Error('This database is already the active sync target. Restore needs the URL of a different database.');
  }

  onPhase?.('Checking the target database…');
  const status = await probeRestoreTarget(settings);
  if (status.state !== 'current') throw new Error(status.reason);

  onPhase?.('Pausing background sync…');
  const wasRunning = await stopBackgroundStorageSync();
  const localDbName = `wodwiki-restore-${crypto.randomUUID().slice(0, 8)}`;
  const restored = new IndexedDBStorage({ dbName: localDbName });
  const engine = new TursoSyncEngine(restored, { url: settings.url.trim(), authToken: settings.authToken });
  try {
    onPhase?.('Exporting your current data and unsent edits…');
    await downloadSafeData();
    onPhase?.('Replaying the remote database into an isolated local copy…');
    // Replay-only: pulls every remote op into the empty scratch database,
    // validates the schema and pinned revisions, uploads nothing.
    await engine.restoreNow();
    await engine.stop();
    await restored.close();
    onPhase?.('Saving the restored database as your data…');
    saveRestoredSettings(localDbName);
  } catch (err) {
    await engine.stop().catch(() => undefined);
    await restored.close().catch(() => undefined);
    await deleteLocalDatabase(localDbName);
    if (wasRunning) startBackgroundStorageSync(); // keep backing up as before
    throw presentable(err, settings.authToken);
  }
  return { localDbName };
}
