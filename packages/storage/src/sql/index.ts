/**
 * @bitcobblers/wod-wiki-storage/sql — SQL persistence for WOD Wiki storage.
 *
 * Shared by the API server (node libsql client, Bun postgres driver) and the
 * browser (BrowserTursoStorage over @libsql/client/web). Importing this
 * subpath pulls @libsql/client/web and WQL; the root imports core validation.
 *
 *  StorageError       — shared error with status + stable code
 *  Database/…         — connection contracts + libsqlDatabase() adapter
 *  SqlStorage         — IStorage over SQL (true txs, projections, stale fallback)
 *  BrowserTursoStorage— direct-to-Turso IStorage ({url, authToken} + ready())
 *  store ops/domain   — shared row operations and WQL projection engine
 */

export { StorageError } from './errors';
export {
  libsqlDatabase,
  type Database,
  type LibsqlClient,
  type SqlConnection,
  type SqlRow,
  type SqlValue,
  type SqlStatement,
} from './connection';
export { encodeRowJson, decodeRowJson } from './codec';
export {
  initializeStore,
  storeDefinition,
  getRow,
  getRows,
  listRowsFromIndexMany,
  putRows,
  listRows,
  countRows,
  putRow,
  deleteRows,
  clearRows,
  wipeRows,
  SCHEMA_TABLE,
} from './store';
export {
  initializeDomain,
  verifyReadiness,
  rebuildProjections,
  refreshDomain,
  wipeDomain,
  handleDomainQuery,
  MAX_BODY,
} from './domain';
export {
  SqlStorage,
  BrowserTursoStorage,
  validateTursoUrl,
  type SqlStorageOptions,
  type TursoSettings,
} from './storage';
export {
  SYNC_OPS_TABLE,
  SYNC_STATE_TABLE,
  probeSyncTarget,
  initSyncTarget,
  applySyncBatch,
  fetchSyncOps,
  type ApplySyncBatchOptions,
  readRawSyncOps,
  type RawSyncOp,
  readLegacyRows,
  type SyncEntry,
  type SyncMutation,
  type StoredSyncOp,
  type SyncTargetKind,
} from './sync';
export {
  databaseFingerprint,
  assertDatabaseCopyMatches,
  finalizeMigrationTarget,
  assertPolicySnapshot,
  assertLogPinClosure,
  type DatabaseFingerprint,
} from './backup';
