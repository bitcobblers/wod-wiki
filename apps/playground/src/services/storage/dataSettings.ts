/**
 * dataSettings — the browser-side data-provider choice, persisted in
 * localStorage only (never remotely; the token is same-origin readable by
 * design and the UI warns about that).
 *
 * Expected saved shape: `{ kind: 'turso', url, authToken }` or
 * `{ kind: 'indexed-db' }`. The `VITE_STORAGE=api` build override always
 * wins over the saved choice (see storage/index.ts).
 *
 * Guarantees:
 *  - readDataSettings() is total — a malformed saved value surfaces as
 *    `{ state: 'invalid', raw, error }` so the Data settings page can offer
 *    repair instead of silently dropping to IndexedDB.
 *  - connectTurso() persists the config ONLY after connect (+ optional
 *    migration) fully succeeded; on any failure nothing is written, the
 *    active provider is untouched, and the thrown error is presentable and
 *    never contains the token.
 *  - Other tabs reload through a `storage` event guard, so writes can never
 *    land on the wrong provider after a cross-tab switch.
 */
import { BrowserTursoStorage } from '@bitcobblers/wod-wiki-storage/sql';
import { storage, storageBackend } from './index';
import { migrateToSql } from './tursoMigration';

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

/**
 * Validate + connect (+ optionally migrate the current local data), then
 * persist. Resolves only after everything succeeded — the caller reloads so
 * every provider cache re-initialises against the new provider. Throws a
 * presentable Error (never containing the token) and persists nothing on
 * failure; the active provider stays exactly as it was. Migration is only
 * offered from the local IndexedDB provider — never API→Turso or
 * Turso→Turso; switch back to local data first.
 */
let connectInFlight: Promise<void> | undefined;

export async function connectTurso(settings: { url: string; authToken: string }, opts: { migrate: boolean }): Promise<void> {
  if (connectInFlight) throw new Error('A connect or migration is already running — wait for it to finish.');
  const invalid = validateTursoTarget(settings.url, settings.authToken);
  if (invalid) throw new Error(invalid);
  if (opts.migrate && storageBackend !== 'indexed-db') {
    throw new Error('Migration copies your local browser data and is only available while using local (IndexedDB) data.');
  }
  const run = async (): Promise<void> => {
    const dest = new BrowserTursoStorage({ url: settings.url.trim(), authToken: settings.authToken });
    try {
      await dest.ready();
      await dest.verifyWritable();
      if (opts.migrate) await migrateToSql(storage, dest);
    } catch (err) {
      throw presentable(err, settings.authToken);
    } finally {
      // Cleanup must not masquerade: once ready/migration resolved, the copy
      // is committed; a close failure is irrelevant on either path.
      await dest.close().catch(() => undefined);
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

/** Prove INSERT permission with a rolled-back SQL write, without saving settings. */
export async function testTursoConnection(settings: { url: string; authToken: string }): Promise<void> {
  const invalid = validateTursoTarget(settings.url, settings.authToken);
  if (invalid) throw new Error(invalid);
  const dest = new BrowserTursoStorage({ url: settings.url.trim(), authToken: settings.authToken });
  try {
    await dest.ready();
    await dest.verifyWritable();
  } catch (err) {
    throw presentable(err, settings.authToken);
  } finally {
    await dest.close().catch(() => undefined);
  }
}

/** Switch back to the local IndexedDB provider; the caller reloads. The
 *  remote keeps its data and is NOT pulled into the local copy (disconnect
 *  returns you to your last local state). */
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
