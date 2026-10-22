/**
 * CastSessionManager — sender-side session orchestration for the cast stack.
 *
 * One module absorbs the four things every cast session needs after a
 * transport is connected:
 *
 *   1. Register a `ChromecastRuntimeSubscription` against the workbench
 *      `SubscriptionManager` so stack snapshots and outputs flow to the
 *      receiver.
 *   2. Build a `ChromecastEventProvider` so D-Pad events from the TV
 *      reach the local runtime via `runtime.handle(...)`.
 *   3. Run `ClockSyncService` to measure the sender/receiver clock offset
 *      — but only when the transport actually traverses a clock-skewed
 *      network (`transport.needsClockSync === true`).
 *   4. Cascade disposal: transport disconnect tears down subscription,
 *      event provider, and clock sync in one motion.
 *
 * Why a class, not scattered effects?
 * ------------------------------------
 * Before this module existed, those four concerns were wired up in five
 * different places: `CastButtonRpc`'s `connectSession` callback, the
 * re-adopt effect, the inline `useEffect` in `RuntimeTimerPanel`, the
 * sender's local-session effect, and the receiver's
 * `setupTransport` callback. Adding a new RPC message type or changing
 * the subscription shape meant five updates.
 *
 * The handle returned by `connect()` exposes the three things the cast
 * button actually needs (transport, event provider, subscription). All
 * four lifecycle concerns are hidden behind that small surface.
 *
 * No React. No refs. No effects. The manager is constructed once per
 * page lifetime and `connect()` is called from the user's cast gesture.
 */

import type { ICastSubscription } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeEventProvider } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeSubscription } from '@bitcobblers/wod-wiki-engine';
import { ChromecastEventProvider } from './ChromecastEventProvider';
import { ChromecastRuntimeSubscription } from './ChromecastRuntimeSubscription';
import { ClockSyncService } from './ClockSync';


import type { IRpcTransport, RpcUnsubscribe } from './IRpcTransport';

import { rpcError } from './rpcLogger';
/**
 * Minimal contract the workbench `SubscriptionManager` exposes — narrowed
 * to the surface the cast session needs. Avoids a cyclic import on
 * `useRuntimeTimer.ts` (which itself re-exports the class).
 */
export interface SubscriptionRegistry {
    add(subscription: IRuntimeSubscription): void;
    remove(subscriptionId: string): boolean | void;
}
/**
 * The handle a connected cast session returns to its caller.
 *
 * Exposes the three things the cast button needs to surface to the rest
 * of the page:
 *   - `transport` — for sending workbench/projection messages.
 *   - `eventProvider` — for routing D-Pad events into the runtime.
 *   - `subscription` — for analytics-summary fan-out. Typed as
 *     `ICastSubscription` because the manager always builds a
 *     `ChromecastRuntimeSubscription` under the hood (which carries
 *     the `sendAnalyticsSummary` extension), but the rest of the
 *     page only needs the base `IRuntimeSubscription` API.
 *
 * `dispose()` tears down the entire session. It is idempotent.
 */
export interface CastSessionHandle {
    readonly transport: IRpcTransport;
    readonly eventProvider: IRuntimeEventProvider;
    readonly subscription: ICastSubscription;
    /**
     * Send the initial workbench-mode message resolved at connect time.
     * Disconnect-tolerant: a failed send (peer already gone) must not tear
     * down the session.
     */
    pushInitialWorkbench(message: RpcMessage): void;
    dispose(): void;
}

/**
 * Options that customize a single `connect()` call.
 */
export interface CastSessionConnectOptions {
    /**
     * Unique id for the runtime subscription registered with the
     * workbench SubscriptionManager. Defaults to `'chromecast'`. Tests
     * that need to assert add/remove calls use this to disambiguate
     * concurrent sessions.
     */
    subscriptionId?: string;
}
/**
 * Dependencies the manager needs. Production wires up the defaults;
 * tests inject fakes. Kept narrow so the unit-test surface is obvious.
 */
export interface CastSessionManagerDeps {
    createSubscription: (transport: IRpcTransport, id: string) => ICastSubscription;
    createEventProvider: (transport: IRpcTransport) => IRuntimeEventProvider;
    createClockSync: (transport: IRpcTransport) => ClockSyncService;
}

const defaultDeps: CastSessionManagerDeps = {
    createSubscription: (transport, id) => new ChromecastRuntimeSubscription(transport, { id }),
    createEventProvider: (transport) => new ChromecastEventProvider(transport),
    createClockSync: (transport) => new ClockSyncService(transport),
};

/**
 * Sender-side session manager. Construct once per cast stack lifetime;
 * call `connect()` from the user gesture to start a session, then call
 * `handle.dispose()` (or the manager's `dispose()`) to end it.
 */
export class CastSessionManager {
    private activeHandle: CastSessionHandle | null = null;
    private activeMeta: ActiveMeta | null = null;

    constructor(
        private readonly deps: CastSessionManagerDeps = defaultDeps,
    ) {}

    /**
     * Whether a session is currently connected via this manager.
     *
     * Used by callers that want to gate "disconnect" UI on a real session
     * — e.g. the cast button's re-adopt effect should not re-enter
     * `connect()` if the manager is already holding a handle.
     */
    get isConnected(): boolean {
        return this.activeHandle !== null;
    }
    getActiveHandle(): CastSessionHandle | null {
        return this.activeHandle;
    }

    setSubscriptionRegistry(registry: SubscriptionRegistry | null): void {
        if (!this.activeHandle || !this.activeMeta) return;
        if (this.activeMeta.registry === registry) return;
        if (this.activeMeta.registry) {
            this.activeMeta.registry.remove(this.activeMeta.subscriptionId);
        }
        this.activeMeta.registry = registry;
        if (registry) {
            registry.add(this.activeHandle.subscription);
        }
    }

    /**
     * Wire a cast session to the supplied transport.
     *
     * Steps:
     *   1. Dispose any previous session held by this manager (idempotent).
     *   2. Create the subscription and event provider, and (when the
     *      transport needs it) clock sync.
     *   3. Register the subscription with the workbench registry (if
     *      provided). Without a registry the cast works for the receiver
     *      side, but the local UI never sees the cast-published stack
     *      snapshots — useful in tests, useless in production.
     *   4. Subscribe to transport disconnect so a peer's goodbye tears
     *      the session down without a manual `dispose()` call.
     *
     * The returned handle exposes the three things the cast button
     * actually needs to surface to the rest of the page. The manager
     * retains the bookkeeping (registry id, clock sync, disconnect
     * unsubscribe) so disposal is a single call.
     */
    connect(
        transport: IRpcTransport,
        subscriptionRegistry: SubscriptionRegistry | null = null,
        options: CastSessionConnectOptions = {},
    ): CastSessionHandle {
        this.dispose();

        const subscriptionId = options.subscriptionId ?? 'chromecast';
        const subscription = this.deps.createSubscription(transport, subscriptionId);
        const eventProvider = this.deps.createEventProvider(transport);
        const clockSync = transport.needsClockSync
            ? this.deps.createClockSync(transport)
            : null;

        subscriptionRegistry?.add(subscription);

        if (clockSync) {
            // Best-effort: don't block `connect()` on the sync handshake
            // completing. The receiver caches the offset as it arrives.
            clockSync.sync().catch((err) => {
                rpcError('CastSessionManager', 'Clock sync failed', err);
            });
        }

        const unsubDisconnected = transport.onDisconnected(() => this.dispose());

        this.activeHandle = {
            transport,
            eventProvider,
            subscription,
            pushInitialWorkbench: (message: RpcMessage) => {
                // Disconnect-tolerant: the peer may have gone away between
                // connect and the first push. A failed send must not tear
                // down the session (and must not reject connect()).
                try {
                    transport.send(message);
                } catch {
                    /* peer gone */
                }
            },
            dispose: () => this.dispose(),
        };
        this.activeMeta = {
            registry: subscriptionRegistry,
            subscriptionId,
            unsubDisconnected,
            clockSync,
        };

        return this.activeHandle;
    }

    sendDisposeSignal(): void {
        if (!this.activeHandle?.transport.connected) return;
        this.activeHandle.transport.send({ type: 'rpc-dispose' });
    }

    /**
     * Send a workbench update through the active session's transport, with
     * the disconnect-tolerant error handling the connect-time push needs.
     * Centralizes the outbound send so CastButtonRpc (and any other caller)
     * doesn't have to know about transport lifecycle. The resolver stays at
     * the call site — this is the I/O seam, not the policy seam.
     */
    pushInitialWorkbench(message: import('./RpcMessages').RpcWorkbenchUpdate): boolean {
        if (!this.activeHandle) return false;
        try {
            this.activeHandle.transport.send(message);
            return true;
        } catch {
            // transport may be tearing down (race with goodbye);
            // the receiver will see the disconnect.
            return false;
        }
    }


    /**
     * Tear down the active session, if any. Idempotent.
     *
     * When `notifyRemote` is `true` the receiver is sent a
     * `rpc-dispose` first so it can return to the waiting screen
     * (rather than hanging on a stale "connected" state). The default
     * `false` is for caller-initiated teardown where the receiver will
     * notice the transport closing on its own.
     */
    dispose(notifyRemote: boolean = false): void {
        if (!this.activeHandle) return;

        const handle = this.activeHandle;
        const meta = this.activeMeta;
        this.activeHandle = null;
        this.activeMeta = null;

        meta?.unsubDisconnected();

        if (notifyRemote && handle.transport.connected) {
            try {
                handle.transport.send({ type: 'rpc-dispose' });
            } catch {
                // transport may be mid-tear-down; the disconnect cascade
                // will take care of the receiver-side state.
            }
        }

        if (meta?.registry) {
            meta.registry.remove(meta.subscriptionId);
        }
        handle.subscription.dispose();
        handle.eventProvider.dispose();
        meta?.clockSync?.dispose();
    }
}

export const sharedCastSessionManager = new CastSessionManager();

interface ActiveMeta {
    registry: SubscriptionRegistry | null;
    subscriptionId: string;
    unsubDisconnected: RpcUnsubscribe;
    clockSync: ClockSyncService | null;
}
