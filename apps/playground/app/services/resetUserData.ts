/**
 * resetUserData — wipes every durable data store the application owns, so the
 * "Reset & Clear Cache" menu action returns the app to a first-run state.
 *
 * Provider-dependent behaviour:
 *  - Local ('indexed-db', or 'invalid' — nothing usable is open): closes the
 *    live connection, deletes the IndexedDB `wodwiki-db` (the next page load
 *    recreates the full schema from version 0), then clears localStorage and
 *    sessionStorage. Steps are independent and best-effort: a failure in one
 *    store does not skip the others.
 *  - Remote ('api' build override, or a saved Turso connection):
 *    `storage.wipe()` clears the server-side rows (the system `memberships`
 *    store survives — identity is not reset with data). A failed remote wipe
 *    PROPAGATES: nothing is cleared locally and the saved connection
 *    credentials survive, so the next boot stays on the same provider and the
 *    caller can surface the error. On success the data settings are kept too
 *    (the caller/UI must warn that this clears the REMOTE database) — reset
 *    never silently disconnects.
 *
 * The caller reloads the page after this resolves so the singleton services
 * reinitialise against the now-empty state.
 */
import { DATA_SETTINGS_KEY, storage, storageBackend, storageService } from '@/services/storage';

export async function resetUserData(): Promise<void> {
  const remote = storageBackend === 'api' || storageBackend === 'turso';

  // 1. Primary store. Remote wipe failures abort before any local state is
  //    touched; local wipes stay best-effort (the reload re-creates the store
  //    either way).
  if (remote) {
    await storage.wipe();
  } else {
    try {
      await storageService.wipe();
    } catch {
      /* best-effort; secondary stores still cleared, reload re-inits */
    }
  }

  // 2. localStorage — everything except the data settings when a remote
  //    connection must survive the reset.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && !(remote && key === DATA_SETTINGS_KEY)) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — nothing to clear */
  }

  // 3. sessionStorage — the SPA redirect marker and transient UI state.
  try {
    sessionStorage.clear();
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
