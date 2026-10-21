/**
 * getCastBackend — returns the build's `ICastBackend` instance (memoized).
 *
 * There is exactly one backend: `ChromecastBackend`. Every build — dev,
 * storybook, preview, production — casts to the same hosted receiver app
 * (`CAST_APP_ID`); the Cast Web SDK accepts `localhost` as a sender origin,
 * so no local-tab mirror is needed.
 *
 * `__setCastBackendForTest` lets tests substitute a fake adapter (e.g.
 * `FakeCastBackend`) without monkey-patching the singleton.
 */

import { ChromecastBackend } from './adapters/ChromecastBackend';
import type { ICastBackend } from './ICastBackend';

let _instance: ICastBackend | null = null;

/**
 * Return the singleton `ICastBackend` instance, constructing it on the first
 * call. Subsequent calls return the same instance.
 */
export function getCastBackend(): ICastBackend {
    if (_instance) return _instance;
    _instance = new ChromecastBackend();
    return _instance;
}

/**
 * Test-only escape hatch. Replaces the memoized instance; subsequent
 * `getCastBackend()` calls return the supplied backend until the next call
 * to `__resetCastBackendForTest()`.
 *
 * Not exported from the production barrel.
 */
export function __setCastBackendForTest(backend: ICastBackend | null): void {
    if (_instance && _instance !== backend) {
        try {
            _instance.dispose();
        } catch {
            // ignore
        }
    }
    _instance = backend;
}

/**
 * Test-only escape hatch. Clears the memoized instance; the next
 * `getCastBackend()` call re-constructs the `ChromecastBackend`.
 */
export function __resetCastBackendForTest(): void {
    _instance = null;
}
