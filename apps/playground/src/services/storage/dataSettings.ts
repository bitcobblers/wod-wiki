/**
 * dataSettings — the browser-side backup/sync target choice, persisted in
 * localStorage only (never remotely; the token is same-origin readable by
 * design and the UI warns about that).
 *
 * Local-first cutover: this setting NEVER selects the data plane. The app
 * always reads and writes IndexedDB (API builds excepted); a saved Turso
 * target is a backup/sync destination driven by startBackgroundStorageSync.
 * The three display modes — plain IndexedDB, Turso backup/sync, API server —
 * are this setting's state, separate from the actual data plane.
 *
 * Expected saved shape: `{ kind: 'turso', url, authToken }` or
 * `{ kind: 'indexed-db' }`. The `VITE_STORAGE=api` build override always
 * wins over the saved choice (see storage/index.ts).
 *
 * Guarantees:
 *  - readDataSettings() is total — a malformed saved value surfaces as
 *    `{ state: 'invalid', raw, error }` so the Data settings page can offer
 *    repair instead of silently dropping the backup target. An invalid
 *    config never disables the local app — it only surfaces as a sync
 *    error (storage/index.ts startBackgroundStorageSync).
 *  - connectTurso() persists the config ONLY after the connection verified
 *    (schema probe + writability); on any failure nothing is written and the
 *    thrown error is presentable and never contains the token. The initial
 *    backup upload itself is the sync engine's snapshot step — ordinary
 *    saves never await Turso.
 *  - Other tabs reload through a `storage` event guard, so writes can never
 *    land on the wrong target after a cross-tab switch.
 */
import { createClient } from '@libsql/client/web';
import { libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';

export type DataSettings = { kind: 'turso'; url: string; authToken: string } | { kind: 'indexed-db' };

/**
 * Runtime data provider. 'invalid' is runtime-only: a saved config failed
 * validation — no provider is opened and the storage adapter throws until
 * the config is repaired in Data settings (no silent IndexedDB fallback).
 */
export type StorageProvider = 'api' | 'indexed-db' | 'turso' | 'invalid';

export type DataSettingsRead =
  | { state: 'indexed-db' }
  | { state: 'turso'; url: string; authToken: string }
  | { state: 'invalid'; raw: string; error: string };

export const DATA_SETTINGS_KEY = 'wodwiki.dataSettings.v1';

/** Secure transports; plain http/ws only for loopback smoke/dev servers. */
const REMOTE_PROTOCOLS: Record<string, true> = { 'libsql:': true, 'https:': true, 'wss:': true };

/** User-presentable validation error, or undefined when acceptable. */
function validateTursoTarget(url: string, authToken: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return 'That is not a valid URL.';
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'ws:') {
    if (!(parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1')) {
      return 'Plain http:// is only allowed for a local smoke server (localhost / 127.0.0.1).';
    }
  } else if (!REMOTE_PROTOCOLS[parsed.protocol]) {
    return `Unsupported protocol "${parsed.protocol}" — use libsql:// or https://.`;
  }
  if (parsed.username || parsed.password) return 'The URL must not embed credentials — put the token in the token field.';
  if (parsed.search) return 'The URL must not contain a query string.';
  if (parsed.hash) return 'The URL must not contain a fragment.';
  if (!authToken || !authToken.trim()) return 'A database token is required.';
  return undefined;
}

/** Re-thrown error with every secret occurrence masked. */
function presentable(err: unknown, ...secrets: string[]): Error {
  let message = err instanceof Error ? err.message : String(err);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('••••••');
  }
  return new Error(message);
}

function readSavedRaw(): string | null {
  try {
    return localStorage.getItem(DATA_SETTINGS_KEY);
  } catch {
    return null; // storage unavailable — behave as unset
  }
}

/** Total: never throws, never returns a half-validated config. */
export function readDataSettings(): DataSettingsRead {
  const raw = readSavedRaw();
  if (raw === null) return { state: 'indexed-db' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'invalid', raw, error: 'Saved data settings are not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'invalid', raw, error: 'Saved data settings have an unexpected shape.' };
  }
  if (!('kind' in parsed)) return { state: 'invalid', raw, error: 'Saved data settings have no kind.' };
  const kind: unknown = parsed.kind;
  if (kind === 'indexed-db') return { state: 'indexed-db' };
  if (kind !== 'turso') {
    return { state: 'invalid', raw, error: `Saved data settings have an unknown kind "${String(kind)}".` };
  }
  if (!('url' in parsed) || !('authToken' in parsed)) {
    return { state: 'invalid', raw, error: 'Saved Turso settings are missing the URL or token.' };
  }
  const url: unknown = parsed.url;
  const authToken: unknown = parsed.authToken;
  if (typeof url !== 'string' || typeof authToken !== 'string') {
    return { state: 'invalid', raw, error: 'Saved Turso settings are missing the URL or token.' };
  }
  const invalid = validateTursoTarget(url, authToken);
  if (invalid) return { state: 'invalid', raw, error: invalid };
  return { state: 'turso', url, authToken };
}

/** Prove connectivity + INSERT permission WITHOUT the SqlStorage schema
 *  guard: existing direct-Turso databases (old or foreign schemas) must stay
 *  connectable — the sync engine imports them. One real write into a probe
 *  table inside a transaction that is then rolled back — zero rows committed. */
async function verifyTursoTarget(settings: { url: string; authToken: string }): Promise<void> {
  const db = libsqlDatabase(createClient({ url: settings.url.trim(), authToken: settings.authToken }));
  try {
    await db.query('SELECT 1');
    const sentinel = new Error('verifyTursoTarget: deliberate rollback');
    try {
      await db.transaction(async (tx) => {
        await tx.exec('CREATE TABLE IF NOT EXISTS "_wodwiki_write_check" ("v" TEXT)');
        await tx.exec('INSERT INTO "_wodwiki_write_check" ("v") VALUES (?)', [crypto.randomUUID()]);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  } finally {
    await db.close().catch(() => undefined);
  }
}

/**
 * Validate + verify the target, then persist. Resolves only after the
 * connection verified — the caller reloads so the sync engine starts fresh
 * against the new target. Throws a presentable Error (never containing the
 * token) and persists nothing on failure. The sync engine uploads the first
 * IndexedDB snapshot in the background after reload.
 */
let connectInFlight: Promise<void> | undefined;

export async function connectTurso(settings: { url: string; authToken: string }): Promise<void> {
  if (connectInFlight) throw new Error('A connect is already running — wait for it to finish.');
  const invalid = validateTursoTarget(settings.url, settings.authToken);
  if (invalid) throw new Error(invalid);
  const run = async (): Promise<void> => {
    try {
      await verifyTursoTarget(settings);
    } catch (err) {
      throw presentable(err, settings.authToken);
    }
    localStorage.setItem(DATA_SETTINGS_KEY, JSON.stringify({ kind: 'turso', url: settings.url.trim(), authToken: settings.authToken }));
  };
  connectInFlight = run();
  try {
    await connectInFlight;
  } finally {
    connectInFlight = undefined;
  }
}

/** Prove INSERT permission with a rolled-back write, without saving settings. */
export async function testTursoConnection(settings: { url: string; authToken: string }): Promise<void> {
  const invalid = validateTursoTarget(settings.url, settings.authToken);
  if (invalid) throw new Error(invalid);
  try {
    await verifyTursoTarget(settings);
  } catch (err) {
    throw presentable(err, settings.authToken);
  }
}

/** Disable backup sync without deleting the local or remote data. */
export function switchToIndexedDb(): void {
  localStorage.setItem(DATA_SETTINGS_KEY, JSON.stringify({ kind: 'indexed-db' } satisfies DataSettings));
}

// Cross-tab guard: a settings write in another tab must not leave this tab
// writing to the old provider. storage events fire only in tabs that did NOT
// write, so the acting tab (which reloads itself) never double-reloads. A
// rewrite of the identical value is ignored.
const bootedRaw = readSavedRaw();
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if ((event.key === DATA_SETTINGS_KEY || event.key === null) && event.newValue !== bootedRaw) {
      window.location.reload();
    }
  });
}
