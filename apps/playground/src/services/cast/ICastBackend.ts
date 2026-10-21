/**
 * ICastBackend — the port that hides whether casting is going through a real
 * Chromecast device, or some future adapter.
 *
 * Callers (the cast button) depend only on this interface. They never import
 * a concrete adapter. `getCastBackend()` returns the singleton adapter.
 *
 * Lifecycle
 * ---------
 * 1. `getCastBackend()` returns the singleton adapter for this build.
 * 2. The button observes `state` to drive its UI (spinner, green dot, hidden).
 * 3. The button calls `startSession()` from a user gesture. The promise
 *    resolves with a connected `IRpcTransport`, or throws on cancel/error.
 * 4. The transport is consumed by the rest of the stack (view session,
 *    WorkbenchCastBridge, etc.) — they don't know which backend produced it.
 * 5. The button calls `endSession()` to tear down the connection.
 *    `dispose()` is reserved for full cleanup (e.g. factory teardown in tests).
 *
 * State semantics
 * ---------------
 * The state stream is the *only* reactive surface the button should observe.
 * Adapters are responsible for keeping it consistent with their internals.
 *
 *   'unavailable'    — this backend cannot run in the current environment
 *                      (e.g. CAF in a non-Chrome browser). The button should
 *                      render hidden.
 *   'ready'          — backend is wired up and waiting for a user gesture.
 *   'connecting'     — `startSession()` is in flight. The button should show
 *                      a spinner.
 *   'session-active' — a transport has been produced; the user is casting.
 *                      The button should show its "active" indicator.
 *   'session-ended'  — the receiver went away (goodbye, TV unplugged, etc.).
 *                      The button should clean up and return to 'ready'.
 *
 * Cancellation
 * ------------
 * `startSession()` is the user gesture. The chromecast adapter throws on
 * user-cancel of the device picker. The local adapter opens a tab and either
 * resolves with a transport or throws on timeout (no popup, no cancel gesture).
 * Both errors are surfaced uniformly to the button's `try/catch`.
 */

import type { IRpcTransport } from './rpc/IRpcTransport';

/**
 * Reactive state the button observes.
 */
export type ICastBackendState =
    | 'unavailable'
    | 'ready'
    | 'connecting'
    | 'session-active'
    | 'session-ended';

/**
 * Unsubscribe function returned by `onStateChanged`.
 */
export type StateUnsubscribe = () => void;

/**
 * The port. See file-level comment for lifecycle and state semantics.
 */
export interface ICastBackend {
    /**
     * Current state. Read on mount and after each `onStateChanged` emission.
     * The button should never need to poll.
     */
    readonly state: ICastBackendState;

    /**
     * Start a cast session from a user gesture. Returns a connected
     * `IRpcTransport` once the receiver has accepted the session.
     *
     * Throws on user cancel (chromecast picker) or on timeout (local adapter
     * could not pair with a receiver tab within `LOCAL_HANDSHAKE_TIMEOUT_MS`).
     *
     * Side effects:
     * - Emits `'connecting'` synchronously before any await.
     * - Emits `'session-active'` before resolving.
     * - Emits `'session-ended'` if the receiver tears down before the
     *   promise resolves.
     */
    startSession(): Promise<IRpcTransport>;

    /**
     * Adopt an already-active platform session without a user gesture.
     *
     * The platform session can outlive the button that started it: SPA
     * navigation unmounts the button (its transport is disposed locally,
     * returning the receiver to its waiting screen) while the CAF session
     * itself keeps running, and a full page reload re-creates it via
     * `resumeSavedSession`. In both cases the new button mount sees
     * `state === 'session-active'` with no local transport — calling
     * `resumeSession()` rebuilds the transport against the live session so
     * casting continues instead of requiring a disconnect + re-pick.
     *
     * Optional: adapters without a resumable platform session (local tab)
     * omit it and the button skips adoption. Implementations should throw
     * when no platform session exists.
     */
    resumeSession?(): Promise<IRpcTransport>;

    /**
     * Tear down the active session. Idempotent — safe to call when no
     * session is active. Does not throw.
     */
    endSession(): void;

    /**
     * Full teardown. Releases all listeners, disposes the active session
     * if any, and prevents future `startSession()` calls (it will throw).
     * Used by the factory's test injection path and by the host during
     * full teardown.
     */
    dispose(): void;

    /**
     * Subscribe to state changes. Returns an unsubscribe function.
     * Listeners are invoked synchronously after a state transition.
     */
    onStateChanged(handler: (state: ICastBackendState) => void): StateUnsubscribe;
}
